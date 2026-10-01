import type { ChatInput, ChatItem, ChatState } from "./types.js";

const DEFAULT_PLACEHOLDER = "Tell me anything about the story";

function occasionText(input: ChatInput): string {
  const summary = input.summary;
  if (!summary) return "I've looked through your photos. Is this the story?";
  const total = summary.total;
  const subject = summary.country ? `a trip to ${summary.country}` : "a story";
  const when = summary.season ? ` in ${summary.season}` : "";
  const places = summary.places.length ? `: ${summary.places.join(", ")}` : "";
  return `I've looked through all ${total}. It looks like ${subject}${when}${places}. Is that the story?`;
}

function personAnswer(person: NonNullable<ChatInput["people"]>[number]): string {
  if (person.skipped) return "Skip";
  return person.name ?? "";
}

export function getSetAsideSummary(plan: ChatInput["plan"]) {
  const leftOut = plan?.leftOut ?? [];
  const blurryPhotos = leftOut.filter(({ reason }) => /blur|soft focus/i.test(reason));
  const duplicatePhotos = leftOut.filter(({ reason }) => /duplicat|similar|same burst/i.test(reason));
  return {
    blurry: blurryPhotos.length,
    duplicates: duplicatePhotos.length,
    blurryPhotos: blurryPhotos.slice(0, 4).map(({ shotId, thumbnailUrl }) => ({ shotId, uri: thumbnailUrl })),
    blurryMore: Math.max(0, blurryPhotos.length - 4),
    duplicatePhotos: duplicatePhotos.slice(0, 4).map(({ shotId, thumbnailUrl }) => ({ shotId, uri: thumbnailUrl })),
    duplicateMore: Math.max(0, duplicatePhotos.length - 4),
  };
}

export function deriveChat(input: ChatInput): ChatState {
  const items: ChatItem[] = [];
  let step: ChatState["step"] = "occasion";
  let confirmed: ChatState["confirmed"] = 0;
  let placeholder = DEFAULT_PLACEHOLDER;
  const add = (item: ChatItem) => items.push(item);

  if (!input.summary?.ready.summary) {
    const processed = input.summary?.processed.ingested ?? 0;
    const total = input.summary?.total ?? 0;
    add({ kind: "typing", id: "summary-wait", text: `Reading your photos, ${processed} of ${total}` });
    return { items, step, confirmed, placeholder };
  }

  if (!input.intent) {
    add({ kind: "mosae", id: "occasion-message", text: occasionText(input) });
    add({ kind: "occasion", id: "occasion" });
    return { items, step, confirmed, placeholder };
  }

  add({ kind: "you", id: "occasion-answer", text: input.intent.text });
  input.notes.forEach((note, index) => add({ kind: "you", id: `note-${index + 1}`, text: note }));
  confirmed = 1;

  const facesReady = input.summary.ready.faces;
  const peopleResolved = input.peopleConfirmed || (facesReady && input.people?.length === 0);
  if (!peopleResolved) {
    step = "people";
    if (!facesReady || input.people === null) {
      add({ kind: "typing", id: "faces-wait", text: "Finding the faces in your trip" });
      return { items, step, confirmed, placeholder };
    }

    const people = [...(input.people ?? [])].sort((a, b) => b.momentCount - a.momentCount).slice(0, 3);
    const answered = (person: (typeof people)[number]) => person.skipped || Boolean(person.name);
    const firstUnanswered = people.findIndex((person) => !answered(person));
    const unanswered = firstUnanswered >= 0 ? people[firstUnanswered] : null;
    people.slice(0, firstUnanswered >= 0 ? firstUnanswered : people.length).forEach((person) => {
      add({ kind: "you", id: `person-answer-${person.personId}`, text: personAnswer(person) });
    });
    if (unanswered) {
      add({ kind: "person", id: `person-${unanswered.personId}`, personId: unanswered.personId, ageBand: unanswered.ageBand, momentCount: unanswered.momentCount, sampleShotIds: unanswered.sampleShotIds, sampleFaces: unanswered.sampleFaces ?? [], days: unanswered.days });
    } else {
      add({ kind: "anyone-else", id: "anyone-else" });
    }
    return { items, step, confirmed, placeholder };
  }

  if (input.people?.length) {
    [...input.people].sort((a, b) => b.momentCount - a.momentCount).slice(0, 3).forEach((person) => {
      if (person.skipped || person.name) add({ kind: "you", id: `person-answer-${person.personId}`, text: personAnswer(person) });
    });
  }
  confirmed = 2;

  if (!input.plan || !input.summary.ready.plan) {
    step = "moments";
    add({ kind: "typing", id: "plan-wait", text: "Picking the strongest moments" });
    return { items, step, confirmed, placeholder };
  }

  if (input.conflict) {
    step = "moments";
    add({ kind: "mosae", id: "moments-conflict", text: input.conflict.message });
  }
  const setAside = getSetAsideSummary(input.plan);
  const hasPhotosToReview = setAside.blurry + setAside.duplicates > 0;
  if (hasPhotosToReview) add({ kind: "set-aside", id: "set-aside", ...setAside });

  if (hasPhotosToReview && !input.momentsConfirmed) {
    step = "moments";
    return { items, step, confirmed, placeholder };
  }

  if (hasPhotosToReview) add({ kind: "you", id: "moments-answer", text: "Looks fine" });
  confirmed = 3;
  if (!input.direction) {
    step = "direction";
    add({ kind: "typing", id: "direction-wait", text: "Putting together a direction for your film" });
    return { items, step, confirmed, placeholder };
  }

  if (!input.direction.confirmed) {
    step = "direction";
    add({
      kind: "direction", id: "direction", pace: input.direction.pace, lengthSec: input.direction.lengthSec,
      focus: input.direction.focus, momentCount: input.plan.totalMomentCount ?? input.plan.moments.length,
    });
    return { items, step, confirmed, placeholder };
  }

  add({ kind: "you", id: "direction-answer", text: "Sounds good. Shape it." });
  confirmed = 4;
  if (input.generation?.status === "done" && input.generation.film) {
    step = "ready";
    placeholder = "Ask for a change";
    add({ kind: "film", id: "film", film: input.generation.film });
    return { items, step, confirmed, placeholder };
  }

  step = "shaping";
  if (input.generation) add({ kind: "shaping", id: "shaping", progress: input.generation.progress, stepsDone: input.generation.stepsDone });
  else add({ kind: "typing", id: "shaping-wait", text: "Shaping your film…" });
  return { items, step, confirmed, placeholder };
}
