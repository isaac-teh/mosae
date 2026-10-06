import type { ChatInput, ChatItem, ChatState } from "./types.js";
import { directionFocus } from "./directionFocus.js";
import { orderPeopleByMergeSimilarity } from "./personChips.js";

const DEFAULT_PLACEHOLDER = "Tell me anything about the story";

function occasionText(input: ChatInput): string {
  const summary = input.summary;
  if (!summary) return "What were these moments about?";
  if (!summary.country && !summary.season && summary.places.length === 0) return `What were these ${summary.total} moments about?`;
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

function storyAcknowledgement(text: string, storySummary?: string, mentionedPeople?: string[]): string {
  let cleaned = (storySummary?.trim() || text.trim()).replace(/\s+/g, " ").replace(/children\s+day/gi, "Children's Day");
  const relation = mentionedPerson(text, [], mentionedPeople);
  if (relation && storySummary && !cleaned.toLocaleLowerCase().includes(relation.phrase.replace(/^your\s+/, ""))) {
    cleaned = `A ${cleaned[0]!.toLocaleLowerCase()}${cleaned.slice(1)} for ${relation.phrase}`;
  } else if (relation && !storySummary) {
    const withoutPerson = cleaned.replace(/\b(?:my\s+)?(?:son(?:'s)?|daughter(?:'s)?|wife|husband|mum|mom|mother|dad|father|partner)\b/i, "").trim();
    if (withoutPerson) cleaned = `A ${withoutPerson[0]!.toLocaleLowerCase()}${withoutPerson.slice(1)} for ${relation.phrase}`;
  }
  cleaned = cleaned.replace(/children's day/gi, "Children's Day").replace(/\b([a-z])/i, (letter) => letter.toLocaleUpperCase());
  return `${cleaned.replace(/[.!?]+$/, "")} — lovely!`;
}

function mentionedPerson(text: string, people: NonNullable<ChatInput["people"]>, mentionedPeople: string[] = []): { label: string; phrase: string } | null {
  const normalized = text.toLocaleLowerCase();
  const relations: [RegExp, string, string][] = [
    [/\b(?:my\s+)?son(?:'s)?\b/, "My son", "your son"], [/\b(?:my\s+)?daughter(?:'s)?\b/, "My daughter", "your daughter"],
    [/\b(?:my\s+)?wife\b/, "My wife", "your wife"], [/\b(?:my\s+)?husband\b/, "My husband", "your husband"],
    [/\b(?:my\s+)?(?:mum|mom|mother)\b/, "My mum", "your mum"], [/\b(?:my\s+)?(?:dad|father)\b/, "My dad", "your dad"],
    [/\b(?:my\s+)?partner\b/, "My partner", "your partner"],
  ];
  const relation = relations.find(([pattern]) => pattern.test(normalized));
  if (relation) return { label: relation[1], phrase: relation[2] };
  for (const candidate of mentionedPeople) {
    const name = candidate.trim();
    const escaped = name.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
    if (name && new RegExp(`\\b${escaped}\\b`, "i").test(text)) return { label: name, phrase: name };
  }
  for (const person of people) {
    const name = person.name?.trim();
    if (!name || /^(?:me|family|friend|my son|my daughter|my mum|my dad)$/i.test(name)) continue;
    const bare = name.replace(/^my\s+/i, "");
    const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) return { label: name, phrase: bare };
  }
  return null;
}

function directionAnswer(input: ChatInput): string {
  const direction = input.direction!;
  const focus = directionFocus(input.people, direction.focus, true).label;
  const labels: Record<string, string> = { aspect: "Format", pace: "Pace", lengthSec: "Length", focus: "Focus", collageAmount: "Collages", motionFeel: "Motion" };
  const words = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (first) => first.toUpperCase());
  const displayValue = (key: string, value: unknown) => {
    if (key === "aspect") return value === "16:9" ? "Landscape (for TV/laptop)" : "Portrait (for phones)";
    if (key === "pace") return value === "lively" ? "Lively" : "Gentle";
    if (key === "lengthSec") return `${value} sec`;
    if (key === "focus") return focus;
    if (key === "collageAmount") return value === "lots" ? "Lots" : value === "none" ? "None" : "A few";
    if (key === "motionFeel") return value === "playful" ? "Playful" : "Calm";
    if (typeof value === "string") return words(value);
    return String(value);
  };
  return Object.entries(direction)
    .filter(([key, value]) => key !== "confirmed" && value !== undefined && value !== null)
    .map(([key, value]) => `${labels[key] ?? words(key)}: ${displayValue(key, value)}`)
    .join("\n");
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

export function canConfirmStory(input: ChatInput): boolean {
  const summary = input.summary;
  if (!summary || input.localMediaPending) return false;
  const upload = summary.upload;
  if (upload && (!upload.closed || upload.settled < upload.expected)) return false;
  if (upload && upload.failed + upload.cancelled > 0 && !input.uploadFailuresAcknowledged) return false;
  if (summary.ready.story !== undefined) return summary.ready.story;
  return summary.total > 0 && summary.ready.summary && summary.processed.ingested >= summary.total && summary.processed.understood >= summary.total;
}

export function deriveChat(input: ChatInput): ChatState {
  const items: ChatItem[] = [];
  let step: ChatState["step"] = "occasion";
  let confirmed: ChatState["confirmed"] = 0;
  let placeholder = DEFAULT_PLACEHOLDER;
  const add = (item: ChatItem) => items.push(item);
  const addPhotoProgress = () => {
    const processed = input.summary?.processed.ingested ?? 0;
    const total = input.summary?.total ?? 0;
    const text = total > 0 ? `Reading your photos, ${processed} of ${total}` : "Waiting for your photos to arrive…";
    add({ kind: "typing", id: "summary-wait", text, photoProgress: input.summary?.assetStatuses });
  };

  if ((!input.intent && !canConfirmStory(input)) || !input.summary?.ready.summary) {
    addPhotoProgress();
    input.notes.forEach((note, index) => add({ kind: "you", id: `note-${index + 1}`, text: note }));
    return { items, step, confirmed, placeholder };
  }
  if (input.summary.photos > 0 && !input.summary.ready.faces) addPhotoProgress();

  if (!input.intent) {
    add({ kind: "mosae", id: "occasion-message", text: occasionText(input) });
    input.notes.forEach((note, index) => add({ kind: "you", id: `note-${index + 1}`, text: note }));
    add({ kind: "occasion", id: "occasion" });
    return { items, step, confirmed, placeholder };
  }

  add({ kind: "mosae", id: "occasion-message", text: occasionText(input) });
  add({ kind: "you", id: "occasion-answer", text: input.intent.text });
  add({ kind: "mosae", id: "story-acknowledgement", text: storyAcknowledgement(input.intent.text, input.storySummary, input.mentionedPeople) });
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

    const people = orderPeopleByMergeSimilarity(input.people ?? []).slice(0, 3);
    const answered = (person: (typeof people)[number]) => person.skipped || Boolean(person.name);
    const firstUnanswered = people.findIndex((person) => !answered(person));
    const unanswered = firstUnanswered >= 0 ? people[firstUnanswered] : null;
    people.slice(0, firstUnanswered >= 0 ? firstUnanswered : people.length).forEach((person) => {
      add({ kind: "mosae", id: `person-question-${person.personId}`, text: `Who's this? They're in ${person.momentCount} of your moments.`, photos: (person.sampleFaces ?? []).slice(0, 4).map((face) => face.uri) });
      add({ kind: "you", id: `person-answer-${person.personId}`, text: personAnswer(person) });
      for (const event of input.mergeEvents?.filter(({ personId }) => personId === person.personId) ?? []) add({ kind: "merge-followup", id: event.id, text: `Same ${event.answer.toLocaleLowerCase().replace(/^my\s+/, "")} as before?`, answer: event.targetName, photos: event.sampleFaces.slice(0, 2), response: event.response });
    });
    for (const event of (input.mergeEvents ?? []).filter(({ personId }) => !people.some((person) => person.personId === personId))) {
      add({ kind: "mosae", id: `person-question-${event.personId}`, text: `Who's this? They're in ${event.momentCount} of your moments.`, photos: (event.questionFaces ?? event.sampleFaces).slice(0, 2) });
      add({ kind: "you", id: `person-answer-${event.personId}`, text: event.answer });
      if (!event.automatic) add({ kind: "merge-followup", id: event.id, text: `Same ${event.answer.toLocaleLowerCase().replace(/^my\s+/, "")} as before?`, answer: event.targetName, photos: event.sampleFaces.slice(0, 2), response: event.response });
    }
    if (unanswered) {
      const mention = people[0]?.personId === unanswered.personId ? mentionedPerson(input.intent.text, people, input.mentionedPeople) : null;
      if (mention && !(input.dismissedPersonSuggestionIds ?? []).includes(unanswered.personId)) {
        add({ kind: "person-confirm", id: `person-confirm-${unanswered.personId}`, personId: unanswered.personId, label: mention.label, text: `Is this ${mention.phrase}?`, momentCount: unanswered.momentCount, sampleFaces: (unanswered.sampleFaces ?? []).slice(0, 2) });
      } else add({ kind: "person", id: `person-${unanswered.personId}`, personId: unanswered.personId, ageBand: unanswered.ageBand, momentCount: unanswered.momentCount, sampleShotIds: unanswered.sampleShotIds, sampleFaces: unanswered.sampleFaces ?? [], days: unanswered.days, questionText: `Who's this? They're in ${unanswered.momentCount} of your moments.` });
    } else {
      add({ kind: "anyone-else", id: "anyone-else" });
    }
    return { items, step, confirmed, placeholder };
  }

  const mergeEvents = input.mergeEvents ?? [];
  for (const event of mergeEvents.filter(({ personId }) => !input.people?.some((person) => person.personId === personId))) {
    add({ kind: "mosae", id: `person-question-${event.personId}`, text: `Who's this? They're in ${event.momentCount} of your moments.`, photos: (event.questionFaces ?? event.sampleFaces).slice(0, 2) });
    add({ kind: "you", id: `person-answer-${event.personId}`, text: event.answer });
    if (!event.automatic) add({ kind: "merge-followup", id: event.id, text: `Same ${event.answer.toLocaleLowerCase().replace(/^my\s+/, "")} as before?`, answer: event.targetName, photos: event.sampleFaces.slice(0, 2), response: event.response });
  }
  if (input.people?.length) {
    orderPeopleByMergeSimilarity(input.people).slice(0, 3).forEach((person) => {
      if (person.skipped || person.name) {
        add({ kind: "mosae", id: `person-question-${person.personId}`, text: `Who's this? They're in ${person.momentCount} of your moments.`, photos: (person.sampleFaces ?? []).slice(0, 4).map((face) => face.uri) });
        add({ kind: "you", id: `person-answer-${person.personId}`, text: personAnswer(person) });
        for (const event of input.mergeEvents?.filter(({ personId }) => personId === person.personId) ?? []) add({ kind: "merge-followup", id: event.id, text: `Same ${event.answer.toLocaleLowerCase().replace(/^my\s+/, "")} as before?`, answer: event.targetName, photos: event.sampleFaces.slice(0, 2), response: event.response });
      }
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
  if (hasPhotosToReview && !input.momentsConfirmed) add({ kind: "set-aside", id: "set-aside", ...setAside });

  if (hasPhotosToReview && !input.momentsConfirmed) {
    step = "moments";
    return { items, step, confirmed, placeholder };
  }

  if (hasPhotosToReview) {
    add({ kind: "mosae", id: "set-aside-message", text: `I've set aside ${setAside.blurry} blurry ${setAside.blurry === 1 ? "shot" : "shots"} and ${setAside.duplicates} near-duplicate${setAside.duplicates === 1 ? "" : "s"}, keeping the best of each burst. Your originals are untouched.` });
    add({ kind: "you", id: "moments-answer", text: "Looks fine" });
  }
  confirmed = 3;
  if (!input.direction) {
    step = "direction";
    add({ kind: "typing", id: "direction-wait", text: "Putting together a direction for your film" });
    return { items, step, confirmed, placeholder };
  }

  if (!input.direction.confirmed) {
    step = "direction";
    add({ kind: "mosae", id: "direction-question", text: input.directionNote ?? "For these moments, I’d suggest this." });
    add({
      kind: "direction", id: "direction", aspect: input.direction.aspect ?? "9:16", ...(input.summary?.orientation ? { orientation: input.summary.orientation } : {}), pace: input.direction.pace, lengthSec: input.direction.lengthSec,
      focus: input.direction.focus, momentCount: input.plan.totalMomentCount ?? input.plan.moments.length,
    });
    return { items, step, confirmed, placeholder };
  }

  add({ kind: "mosae", id: "direction-question", text: input.directionNote ?? "For these moments, I’d suggest this." });
  add({ kind: "you", id: "direction-answer", text: directionAnswer(input) });
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
