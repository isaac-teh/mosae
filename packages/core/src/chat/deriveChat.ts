import type { ChatInput, ChatItem, ChatState } from "./types.js";
import { directionFocus } from "./directionFocus.js";
import { orderPeopleByMergeSimilarity } from "./personChips.js";

const DEFAULT_PLACEHOLDER = "Tell me anything about the story";

function personAnswer(person: NonNullable<ChatInput["people"]>[number]): string {
  if (person.skipped) return "Skip";
  return person.name ?? "";
}

function summaryPersonLabel(name: string): string {
  const role = /^My\s+(son|daughter|wife|husband|mum|mom|mother|dad|father|partner)$/i.exec(name.trim())?.[1];
  return role ? `${role[0]!.toLocaleUpperCase()}${role.slice(1).toLocaleLowerCase()}` : name;
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
    if (key === "aspect") return value === "16:9" ? "YouTube style" : "TikTok style";
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
  const summary = input.summary;
  const uploadTotal = input.localUpload?.total ?? summary?.upload?.expected ?? summary?.total ?? 0;
  const uploadDone = input.localUpload ? input.localUpload.settled + input.localUpload.failed : summary?.upload?.settled ?? summary?.processed.ingested ?? 0;
  const photos = input.localUpload?.photos ?? summary?.photos ?? 0;
  const clips = input.localUpload?.clips ?? summary?.clips ?? 0;
  const understoodTotal = uploadTotal;
  const understood = summary?.processed.understood ?? 0;
  const uploadComplete = uploadTotal > 0 && (input.localUpload ? uploadDone >= uploadTotal : summary?.upload ? summary.upload.closed && uploadDone >= summary.upload.expected : Boolean(summary && summary.processed.ingested >= uploadTotal));
  const failedCount = summary?.upload?.failed ?? 0;
  const understandingActive = Boolean(summary && (summary.processed.ingested > 0 || uploadComplete || summary.ready.summary));
  const understoodComplete = Boolean(uploadComplete && understoodTotal > 0 && understood + Math.max(failedCount, input.localUpload?.failed ?? 0) >= understoodTotal);
  const facesApplicable = photos > 0 || Boolean(input.localUpload && summary?.photos);
  const facesComplete = Boolean(facesApplicable && summary?.ready.faces);
  const addUploadStatus = () => add({ kind: "upload-status", id: "upload-status", photos, clips, uploadTotal, uploadDone: Math.min(uploadDone, uploadTotal), understood, understoodTotal, uploadComplete, understandingActive, understoodComplete, facesApplicable, facesComplete });
  const mediaLabel = photos > 0 && clips > 0 ? "photos and clips" : photos > 0 ? `photo${photos === 1 ? "" : "s"}` : `clip${clips === 1 ? "" : "s"}`;
  const mediaCount = uploadTotal || photos + clips;
  const addUploadIntro = () => add({ kind: "mosae", id: "upload-intro", text: uploadComplete ? `Your ${mediaCount} ${mediaLabel} ${mediaCount === 1 && photos + clips === 1 ? "is" : "are"} uploaded.` : `I'm bringing in your ${mediaCount} ${mediaLabel}. Then I'll look through them.` });
  const questionUploadComplete = input.earlyOccasionQuestionUploadComplete ?? uploadComplete;
  const addOccasionQuestion = () => add({ kind: "occasion-question", id: "occasion-question", uploadComplete: questionUploadComplete });
  const acknowledgementText = (text: string, storySummary?: string, mentionedPeople?: string[]) => {
    const acknowledgement = storyAcknowledgement(text, storySummary, mentionedPeople);
    const waiting = !uploadComplete ? ` I'm still bringing in your ${mediaLabel} — hang on a moment.`
      : !understoodComplete ? " I'm looking through them now — almost there."
      : facesApplicable && !facesComplete ? " Now I'm finding the people in them."
      : "";
    return `${acknowledgement}${waiting}`;
  };
  const addVideoFailures = () => (input.summary?.videoStatuses ?? []).filter((video) => video.status === "failed")
    .forEach((video) => add({ kind: "mosae", id: `video-failed-${video.assetId}`, text: "Couldn't read this video" }));
  if (input.filmWait) {
    const statuses = input.summary?.videoStatuses ?? [];
    const progress = statuses.length ? statuses.reduce((sum, video) => sum + video.progress, 0) / statuses.length : 0;
    addUploadIntro();
    addUploadStatus();
    add({ kind: "preparing-videos", id: "preparing-videos", text: `Preparing ${input.filmWait.videoCount} ${input.filmWait.videoCount === 1 ? "video" : "videos"}…`, progress });
    return { items, step: "shaping", confirmed: 4, placeholder };
  }

  if ((!input.intent && !canConfirmStory(input)) || !input.summary?.ready.summary) {
    addUploadIntro();
    addUploadStatus();
    if (input.earlyOccasionAnswer) {
      add({ kind: "you", id: "occasion-answer", text: input.earlyOccasionAnswer });
      add({ kind: "mosae", id: "story-acknowledgement", text: acknowledgementText(input.earlyOccasionAnswer) });
      if (input.pendingResponse === "occasion") add({ kind: "typing", id: "occasion-save-wait", text: "Putting your story together" });
    } else addOccasionQuestion();
    input.notes.forEach((note, index) => add({ kind: "you", id: `note-${index + 1}`, text: note }));
    return { items, step, confirmed, placeholder };
  }
  addUploadIntro();
  addUploadStatus();

  if (!input.intent) {
    addVideoFailures();
    if (input.earlyOccasionAnswer) {
      add({ kind: "you", id: "occasion-answer", text: input.earlyOccasionAnswer });
      add({ kind: "mosae", id: "story-acknowledgement", text: acknowledgementText(input.earlyOccasionAnswer) });
    } else addOccasionQuestion();
    input.notes.forEach((note, index) => add({ kind: "you", id: `note-${index + 1}`, text: note }));
    return { items, step, confirmed, placeholder };
  }

  add({ kind: "mosae", id: "occasion-message", text: questionUploadComplete ? "Tell me a little about them. Is it a trip, a birthday celebration, or something else?" : "While they come in, tell me a little about them. Is it a trip, a birthday celebration, or something else?" });
  add({ kind: "you", id: "occasion-answer", text: input.intent.text });
  add({ kind: "mosae", id: "story-acknowledgement", text: acknowledgementText(input.intent.text, input.storySummary, input.mentionedPeople) });
  addVideoFailures();
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
    if (input.pendingResponse === "person") {
      add({ kind: "typing", id: "person-save-wait", text: "Saving your answer" });
      return { items, step, confirmed, placeholder };
    }
    if (unanswered) {
      const mention = people[0]?.personId === unanswered.personId ? mentionedPerson(input.intent.text, people, input.mentionedPeople) : null;
      if (mention && !(input.dismissedPersonSuggestionIds ?? []).includes(unanswered.personId)) {
        add({ kind: "person-confirm", id: `person-confirm-${unanswered.personId}`, personId: unanswered.personId, label: mention.label, text: `Is this ${mention.phrase}?`, momentCount: unanswered.momentCount, sampleFaces: (unanswered.sampleFaces ?? []).slice(0, 2) });
      } else add({ kind: "person", id: `person-${unanswered.personId}`, personId: unanswered.personId, ageBand: unanswered.ageBand, momentCount: unanswered.momentCount, sampleShotIds: unanswered.sampleShotIds, sampleFaces: unanswered.sampleFaces ?? [], days: unanswered.days, questionText: `Who's this? They're in ${unanswered.momentCount} of your moments.` });
    } else {
      placeholder = "Type a name";
      for (const person of input.missedPeople ?? []) {
        add({ kind: "you", id: `missed-name-${person.personId}`, text: person.name });
        add({ kind: "missed-person", id: `missed-person-${person.personId}`, personId: person.personId, name: person.name });
      }
      if (input.missedPersonTagging) {
        add({ kind: "mosae", id: `missed-select-${input.missedPersonTagging.personId}`, text: `Help me select 1 photo of ${input.missedPersonTagging.name}.` });
        add({ kind: "missed-person", id: `missed-tag-${input.missedPersonTagging.personId}`, ...input.missedPersonTagging });
      } else {
        add({ kind: "anyone-else", id: "anyone-else", text: (input.missedPeople ?? []).length ? "Did I miss anyone else? Type the names of who were missed in the box below." : "Did I miss anyone? Type the names of who were missed in the box below." });
      }
    }
    return { items, step, confirmed, placeholder };
  }

  if (input.peopleConfirmed && input.peopleSummaryConfirmed === false) {
    step = "people";
    const named = (input.people ?? []).filter((person) => !person.skipped && person.name).map((person) => ({ personId: person.personId, name: summaryPersonLabel(person.name!), momentCount: person.momentCount, sampleUri: person.sampleFaces?.[0]?.uri }));
    const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
    if (named.length === 1) add({ kind: "mosae", id: "people-summary-message", text: `Thanks. I've tagged ${named[0]!.name} in your moments.` });
    else add({ kind: "mosae", id: "people-summary-message", text: `Thanks. I've tagged all ${words[named.length] ?? named.length} in your moments.` });
    add({ kind: "people-summary", id: "people-summary", people: named });
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
    add({ kind: "you", id: "moments-answer", text: "Looks good" });
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
    for (const event of input.generation.film.lateVideoEvents ?? []) {
      if (event.status === "dismissed" || input.lateVideoDismissals?.includes(event.assetId)) continue;
      add({ kind: "late-video", id: `late-video-${event.assetId}`, assetId: event.assetId, status: event.status, text: event.status === "added" ? `Added your ${event.label} video 🎬` : `Add your ${event.label} video?` });
    }
    add({ kind: "film", id: "film", film: input.generation.film });
    return { items, step, confirmed, placeholder };
  }

  step = "shaping";
  if (input.generation) add({ kind: "shaping", id: "shaping", progress: input.generation.progress, stepsDone: input.generation.stepsDone });
  else add({ kind: "typing", id: "shaping-wait", text: "Shaping your film…" });
  return { items, step, confirmed, placeholder };
}
