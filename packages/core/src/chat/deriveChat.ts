import type { ChatInput, ChatItem, ChatState } from "./types.js";
import { directionFocus } from "./directionFocus.js";
import { mainPeople } from "./personChips.js";

const DEFAULT_PLACEHOLDER = "Tell me anything about the story";

function personAnswer(person: NonNullable<ChatInput["people"]>[number]): string {
  return person.answerText ?? (person.skipped ? "Skip" : person.name ?? "");
}

function summaryPersonLabel(name: string): string {
  const role = /^My\s+(son|daughter|wife|husband|mum|mom|mother|dad|father|partner)$/i.exec(name.trim())?.[1];
  return role ? `${role[0]!.toLocaleUpperCase()}${role.slice(1).toLocaleLowerCase()}` : name;
}

function taggedPersonItem(person: NonNullable<ChatInput["people"]>[number], canProceed = true): Extract<ChatItem, { kind: "person-tagged" }> {
  const name = summaryPersonLabel(person.name!);
  const pronoun = /^(?:daughter|wife|mum|mom|mother|sister|grandma|grandmother)$/i.test(name) ? "her" : /^(?:son|husband|dad|father|brother|grandpa|grandfather)$/i.test(name) ? "him" : "them";
  return { kind: "person-tagged", id: `person-tagged-${person.personId}`, personId: person.personId, name, pronoun, momentCount: person.momentCount, canProceed, ...(person.sampleFaces?.[0] ? { sampleFace: person.sampleFaces[0] } : {}) };
}

function peopleIntroCount(people: { personId: string }[], mergeEvents: NonNullable<ChatInput["mergeEvents"]>): number {
  const present = new Set(people.map(({ personId }) => personId));
  return people.length + mergeEvents.filter(({ personId, reconciled }) => !reconciled && !present.has(personId)).length;
}

function automaticMergeAcknowledgement(input: ChatInput, personId: string): string | null {
  const event = input.mergeEvents?.find((item) => item.personId === personId && item.automatic);
  const stored = input.flow?.people.find((person) => person.personId === personId);
  if (event) return `Got it — I've added these to ${event.targetName.replace(/^my\s+/i, "")}'s moments.`;
  if (!stored?.mergedInto) return null;
  const targetName = input.flow?.people.find((person) => person.personId === stored.mergedInto)?.name ?? stored.name ?? "this person";
  return `Got it — I've added these to ${targetName.replace(/^my\s+/i, "")}'s moments.`;
}

function peopleIntroText(): string {
  // Reconciliation can remove a face group after the conversation starts, so
  // avoid announcing a provisional count that can exceed the people we ask about.
  return "Let’s go through the people who appear often in your moments.";
}

function peopleCountText(count: number): string {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  const label = words[count] ?? String(count);
  return `${count === 1 ? "One person appears" : `${label[0]!.toLocaleUpperCase()}${label.slice(1)} people appear`} often in your moments.`;
}

function keptPeople(input: ChatInput) {
  const culled = new Set((input.plan?.leftOut ?? []).filter(({ reason }) => /blur|soft focus|duplicat|similar|same burst/i.test(reason)).map(({ shotId }) => shotId));
  return (input.people ?? []).filter((person) => !person.personId.startsWith("p-missed-")).map((person) => {
    if (!person.shotIds) return person; // Old flows did not retain the per-shot cluster membership.
    const shotIds = person.shotIds.filter((shotId) => !culled.has(shotId));
    return { ...person, momentCount: shotIds.length, shotIds, sampleShotIds: person.sampleShotIds.filter((shotId) => !culled.has(shotId)), sampleFaces: person.sampleFaces?.filter((face) => !culled.has(face.shotId)) };
  }).filter((person) => person.momentCount > 0);
}

function announcedPeople(input: ChatInput) {
  const people = keptPeople(input);
  const askedIds = input.flow?.peopleProgress?.askedPersonIds ?? [];
  const pinnedIds = askedIds;
  const present = new Set(people.map(({ personId }) => personId));
  for (const stored of input.flow?.people ?? []) {
    if (!pinnedIds.includes(stored.personId) || present.has(stored.personId) || !(stored.confirmed || stored.skipped || stored.mergedInto)) continue;
    const momentCount = Math.max(0, stored.manualShotAdds.filter((shotId) => !stored.manualShotRemoves.includes(shotId)).length);
    people.push({ personId: stored.personId, name: stored.name, role: stored.role, answerText: stored.answerText, skipped: stored.skipped || Boolean(stored.mergedInto), forceShow: true, momentCount, sampleShotIds: [], shotIds: [], days: [] });
  }
  const culled = new Set((input.plan?.leftOut ?? []).filter(({ reason }) => /blur|soft focus|duplicat|similar|same burst/i.test(reason)).map(({ shotId }) => shotId));
  const culledPhotoCount = culled.size;
  const keptPhotoCount = Math.max(0, (input.summary?.photos ?? 0) - culledPhotoCount);
  const main = mainPeople(people, keptPhotoCount);
  const selected = new Set(main.map(({ personId }) => personId));
  const pinned = people.filter((person) => pinnedIds.includes(person.personId) && !selected.has(person.personId));
  if (askedIds.length) {
    const byId = new Map([...main, ...pinned].map((person) => [person.personId, person]));
    return askedIds.flatMap((personId) => { const person = byId.get(personId); return person ? [person] : []; });
  }
  return orderByProgress(main, input);
}

function orderByProgress<T extends { momentCount: number; personId: string }>(entries: T[], input: ChatInput): T[] {
  const completed = input.proceededPersonIds ?? input.flow?.peopleProgress?.completedPersonIds ?? [];
  const asking = input.flow?.peopleProgress?.askedPersonIds ?? [];
  const order = new Map((asking.length ? asking : completed).map((personId, index) => [personId, index]));
  return entries.sort((a, b) => {
    const aIndex = order.get(a.personId), bIndex = order.get(b.personId);
    if (aIndex !== undefined || bIndex !== undefined) return (aIndex ?? Number.MAX_SAFE_INTEGER) - (bIndex ?? Number.MAX_SAFE_INTEGER);
    return b.momentCount - a.momentCount;
  });
}

function storyAcknowledgement(text: string, storySummary?: string, mentionedPeople?: string[]): string {
  let cleaned = (storySummary?.trim() || text.trim()).replace(/\s+/g, " ").replace(/children\s+day/gi, "Children's Day");
  const tripToPlace = /^a\s+trip\s+to\s+(.+)$/i.exec(cleaned);
  const tripWithDetail = /^a\s+trip[.!?]?\s+(.+)$/i.exec(cleaned);
  if (tripToPlace) cleaned = `A ${tripToPlace[1]!.replace(/[.!?]+$/, "").trim()} trip`;
  else if (tripWithDetail) {
    const detail = tripWithDetail[1]!.replace(/\s+in\s+(?=(?:January|February|March|April|May|June|July|August|September|October|November|December)\b).*$/i, "").replace(/[.!?]+$/, "").trim();
    cleaned = `A ${detail} trip`;
  }
  const relation = mentionedPerson(text, [], mentionedPeople);
  if (relation && storySummary && !cleaned.toLocaleLowerCase().includes(relation.phrase.replace(/^your\s+/, ""))) {
    cleaned = `A ${cleaned[0]!.toLocaleLowerCase()}${cleaned.slice(1)} for ${relation.phrase}`;
  } else if (relation && !storySummary && /^My\s+/i.test(relation.label)) {
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
  const orientation = direction.aspect ?? input.summary?.orientation?.suggested;
  const rows = [
    orientation ? `Orientation: ${orientation === "16:9" ? "Landscape" : "Portrait"}` : null,
    direction.pace ? `Pace: ${direction.pace === "lively" ? "Lively" : "Calm"}` : null,
    direction.focus ? `Focus: ${focus}` : null,
    direction.collageAmount ? `Collage: ${direction.collageAmount === "lots" ? "Lots" : direction.collageAmount === "none" ? "None" : "A few"}` : null,
  ];
  return rows.filter((row): row is string => row !== null).join("\n");
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
  if (input.flow?.people.length && input.people) {
    const saved = new Map(input.flow.people.map((person) => [person.personId, person]));
    input = { ...input, people: input.people.map((person) => {
      const stored = saved.get(person.personId);
      if (!stored || !input.flow?.peopleProgress?.askedPersonIds?.includes(person.personId) || !(stored.confirmed || stored.skipped || stored.mergedInto)) return person;
      return { ...person, name: stored.name, role: stored.role, answerText: stored.answerText, skipped: stored.skipped || Boolean(stored.mergedInto) };
    }) };
  }
  if (input.flow?.story.answer && !input.intent) input = { ...input, intent: { text: input.flow.story.answer }, storySummary: input.flow.story.storySummary ?? undefined, mentionedPeople: input.flow.story.mentionedPeople };
  if (input.flow?.peopleProgress) input = {
    ...input,
    proceededPersonIds: [...new Set([...(input.proceededPersonIds ?? []), ...input.flow.peopleProgress.completedPersonIds])],
  };
  if (input.flow?.missedPeople?.length) input = { ...input,
    missedPeople: input.flow.missedPeople.map((person) => {
      const stored = input.flow!.people.find((entry) => entry.personId === person.personId);
      const local = input.missedPeople?.find((entry) => entry.personId === person.personId);
      const storedCount = stored ? Math.max(0, stored.manualShotAdds.length - stored.manualShotRemoves.length) : 0;
      const momentCount = Math.max(storedCount, local?.momentCount ?? 0, person.samplePhotoUris?.length ?? 0, local?.sampleUris?.length ?? 0, local?.sampleUri ? 1 : 0);
      const sampleUris = person.samplePhotoUris?.length ? person.samplePhotoUris : local?.sampleUris;
      return { personId: person.personId, name: person.name, momentCount,
        ...(sampleUris?.length ? { sampleUris } : {}), ...(person.skipped || local?.skipped ? { skipped: true } : {}) };
    }),
  };
  if (input.flow?.missedPeopleConfirmed !== undefined) input = { ...input, missedPeopleConfirmed: input.flow.missedPeopleConfirmed };
  if (input.peopleSummaryConfirmed === undefined && input.flow?.peopleSummaryConfirmed !== undefined) input = { ...input, peopleSummaryConfirmed: input.flow.peopleSummaryConfirmed };
  if (input.missedAnswer === undefined && input.flow?.missedAnswer !== undefined) input = { ...input, missedAnswer: input.flow.missedAnswer };
  if (input.peopleSummaryAnswer === undefined && input.flow?.peopleSummaryAnswer !== undefined) input = { ...input, peopleSummaryAnswer: input.flow.peopleSummaryAnswer };
  if (input.missedReply === undefined && input.flow?.missedReply !== undefined) input = { ...input, missedReply: input.flow.missedReply };
  if (input.missedPeople === undefined && input.flow?.missedPeople) input = { ...input, missedPeople: input.flow.missedPeople.map((person) => {
    const stored = input.flow!.people.find((entry) => entry.personId === person.personId);
    return { personId: person.personId, name: person.name, momentCount: stored ? Math.max(0, stored.manualShotAdds.length - stored.manualShotRemoves.length) : 0, ...(person.samplePhotoUris ? { sampleUris: person.samplePhotoUris } : {}), ...(person.skipped ? { skipped: true } : {}) };
  }) };
  if (input.flow?.missedClarifications?.length) input = { ...input, interpTurns: [...(input.interpTurns ?? []).filter((turn) => turn.stage !== "missed" && turn.stage !== "summary"), ...input.flow.missedClarifications.map((turn) => ({ ...turn, stage: turn.stage ?? "missed" as const }))] };
  if (input.flow?.peopleSummaryFollowups?.length) input = { ...input, summaryFollowups: input.flow.peopleSummaryFollowups };
  const missedFlowHistory = input.missedPeopleConfirmed !== undefined || input.missedAnswer !== undefined || input.flow?.missedPeopleConfirmed !== undefined;
  const hasSummaryHistory = Boolean(input.flow?.peopleSummaryHistory?.length);
  const hasSummaryFollowup = Boolean(input.summaryFollowups?.length || input.interpTurns?.some((turn) => turn.stage === "summary"));
  const postSummaryTurns = input.summaryFollowups ?? input.interpTurns?.filter((turn) => turn.stage === "summary") ?? [];
  const items: ChatItem[] = [];
  let step: ChatState["step"] = "occasion";
  let confirmed: ChatState["confirmed"] = 0;
  let placeholder = DEFAULT_PLACEHOLDER;
  const add = (item: ChatItem) => items.push(item);
  const summary = input.summary;
  const uploadTotal = input.localUpload?.total ?? summary?.upload?.expected ?? summary?.total ?? 0;
  const uploadDone = input.localUpload ? input.localUpload.settled : summary?.upload ? summary.upload.uploaded ?? Math.max(0, summary.upload.settled - summary.upload.failed - summary.upload.cancelled) : summary?.processed.ingested ?? 0;
  const uploadSettled = input.localUpload ? input.localUpload.settled + input.localUpload.failed : summary?.upload?.settled ?? uploadDone;
  const photos = input.localUpload?.photos ?? summary?.photos ?? 0;
  const clips = input.localUpload?.clips ?? summary?.clips ?? 0;
  const understoodTotal = uploadTotal;
  const understood = summary?.processed.understood ?? 0;
  const uploadComplete = uploadTotal > 0 && (input.localUpload ? uploadSettled >= uploadTotal : summary?.upload ? summary.upload.closed && uploadSettled >= summary.upload.expected : Boolean(summary && summary.processed.ingested >= uploadTotal));
  const failedCount = input.localUpload?.failed ?? (summary?.upload ? summary.upload.failed + summary.upload.cancelled : 0);
  const understandingActive = Boolean(summary && (summary.processed.ingested > 0 || uploadComplete || summary.ready.summary));
  const understoodComplete = Boolean(uploadComplete && understoodTotal > 0 && understood + failedCount + (summary?.upload?.processingFailed ?? 0) >= understoodTotal);
  const facesApplicable = photos > 0 || Boolean(input.localUpload && summary?.photos);
  const facesComplete = Boolean(facesApplicable && understoodComplete && summary?.ready.faces);
  const addUploadStatus = () => add({ kind: "upload-status", id: "upload-status", photos, clips, uploadTotal, uploadDone: Math.min(uploadDone, uploadTotal), uploadFailed: failedCount, understood, understoodTotal, uploadComplete, understandingActive, understoodComplete, facesApplicable, facesComplete });
  const noteStatus = () => {
    if (facesApplicable && understoodComplete && !facesComplete) return "I'm finding the people in them now.";
    return `${Math.min(uploadDone, uploadTotal)} of ${uploadTotal} uploaded and ${Math.min(understood, understoodTotal)} of ${understoodTotal} looked through.`;
  };
  const addNotes = () => input.notes.forEach((note, index) => {
    add({ kind: "you", id: `note-${index + 1}`, text: note });
    const questionLike = /\?|\bstill\b|\bprogress\b|\bhow long\b|\bwhen\b/i.test(note);
    const reply = questionLike
      ? `Still working on it — ${noteStatus()}${facesApplicable && understoodComplete && !facesComplete ? "" : " I'll ask you about the people next."}`
      : `Got it, I'll keep that in mind for the film. ${noteStatus()}`;
    add({ kind: "mosae", id: `note-reply-${index + 1}`, text: reply });
  });
  const mediaLabel = photos > 0 && clips > 0 ? "photos and clips" : photos > 0 ? `photo${photos === 1 ? "" : "s"}` : `clip${clips === 1 ? "" : "s"}`;
  const mediaCount = uploadTotal || photos + clips;
  const addUploadIntro = () => add({ kind: "mosae", id: "upload-intro", text: uploadComplete && failedCount > 0 ? `I uploaded ${Math.min(uploadDone, uploadTotal)} of your ${mediaCount} ${mediaLabel}; ${failedCount} couldn't upload.` : uploadComplete ? `Your ${mediaCount} ${mediaLabel} ${mediaCount === 1 && photos + clips === 1 ? "is" : "are"} uploaded.` : `I'm bringing in your ${mediaCount} ${mediaLabel}. Then I'll look through them.` });
  const questionUploadComplete = uploadComplete;
  const addOccasionQuestion = () => add({ kind: "occasion-question", id: "occasion-question", uploadComplete: questionUploadComplete });
  const acknowledgementText = (text: string, storySummary?: string, mentionedPeople?: string[]) => {
    // Keep this anchored to the user's answer; later interpretation can refine
    // the story summary without rewriting the acknowledgement in chat history.
    const acknowledgement = storyAcknowledgement(text, undefined, mentionedPeople);
    const waiting = !uploadComplete ? ` I'm still bringing in your ${mediaLabel} — hang on a moment.`
      : !understoodComplete ? " I'm looking through them now — almost there."
      : facesApplicable && !facesComplete ? " Now I'm finding the people in them."
      : "";
    return `${acknowledgement}${waiting}`;
  };
  const addVideoFailures = () => (input.summary?.videoStatuses ?? []).filter((video) => video.status === "failed")
    .forEach((video) => add({ kind: "mosae", id: `video-failed-${video.assetId}`, text: "Couldn't read this video" }));
  // Mid-flow questions the user asks during the automated upload/understand/faces phases render
  // inline (their question, then a "Thinking" bubble or the model's reply) without changing step.
  // Rendered in both !input.intent branches so questions answer during faces/confirm too.
  const addInterp = () => {
    input.interpTurns?.filter((turn) => !turn.personId && !turn.stage && !missedFlowHistory).forEach((turn, i) => {
      add({ kind: "you", id: `interp-question-${i + 1}`, text: turn.question });
      if (turn.reply) add({ kind: "mosae", id: `interp-reply-${i + 1}`, text: turn.reply });
      else if (input.interpReplying && i === input.interpTurns!.length - 1) {
        add({ kind: "typing", id: "interp-typing", text: "Thinking" });
      }
    });
  };
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
    addNotes();
    addInterp();
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
    addNotes();
    addInterp();
    return { items, step, confirmed, placeholder };
  }

  add({ kind: "mosae", id: "occasion-message", text: questionUploadComplete ? "Tell me a little about them. Is it a trip, a birthday celebration, or something else?" : "While they come in, tell me a little about them. Is it a trip, a birthday celebration, or something else?" });
  add({ kind: "you", id: "occasion-answer", text: input.intent.text });
  add({ kind: "mosae", id: "story-acknowledgement", text: acknowledgementText(input.intent.text, input.storySummary, input.mentionedPeople) });
  addInterp();
  addVideoFailures();
  addNotes();
  confirmed = 1;

  const facesReady = facesComplete;
  const completedPersonIds = input.proceededPersonIds;
  const tracksProceedActions = input.proceededPersonIds !== undefined || input.flow?.peopleProgress !== undefined;
  const missedPersonIds = new Set((input.missedPeople ?? []).map(({ personId }) => personId));
  const allNamedPeopleProceeded = !tracksProceedActions || announcedPeople(input).filter((person) => !missedPersonIds.has(person.personId)).every((person) => person.skipped || !person.name || completedPersonIds?.includes(person.personId));
  const missedPeople = input.missedPeople ?? [];
  const missedSelectionsResolved = missedPeople.length > 0 && missedPeople.every((person) => person.skipped || person.momentCount > 0 || Boolean(person.sampleUri || person.sampleUris?.length));
  const peopleResolved = input.peopleSummaryConfirmed === true || input.peopleConfirmed && allNamedPeopleProceeded || allNamedPeopleProceeded && missedSelectionsResolved || (facesReady && input.people?.length === 0);
  if (!peopleResolved) {
    step = "people";
    if (!facesReady || input.people === null) {
      add({ kind: "typing", id: "faces-wait", text: "Finding the faces in your trip" });
      return { items, step, confirmed, placeholder };
    }

    const people = announcedPeople(input);
    const mergeEvents = input.mergeEvents ?? [];
    add({ kind: "mosae", id: "people-intro", text: peopleIntroText() });
    const answered = (person: (typeof people)[number]) => person.skipped || Boolean(person.name);
    const firstUnanswered = people.findIndex((person) => !answered(person));
    const proceededPersonIds = new Set(input.proceededPersonIds ?? []);
    const pendingProceedIndex = tracksProceedActions ? people.findIndex((person) => !person.skipped && Boolean(person.name) && !proceededPersonIds.has(person.personId)) : -1;
    const awaitingProceed = pendingProceedIndex >= 0 ? people[pendingProceedIndex] : null;
    const unanswered = (input.mergeEvents ?? []).some((event) => !event.response) ? null : awaitingProceed ? null : firstUnanswered >= 0 ? people[firstUnanswered] : null;
    const orderedHistory = [
      ...people.map((person, index) => ({ kind: "person" as const, person, personId: person.personId, index, momentCount: person.momentCount })),
      ...mergeEvents.filter(({ personId }) => !people.some((person) => person.personId === personId)).map((event) => ({ kind: "merge" as const, event, personId: event.personId, momentCount: event.momentCount })),
    ];
    orderByProgress(orderedHistory, input);
    for (const entry of orderedHistory) {
      if (entry.kind === "person") {
        if (pendingProceedIndex >= 0 ? entry.index > pendingProceedIndex : firstUnanswered >= 0 && entry.index >= firstUnanswered) continue;
        const { person } = entry;
        add({ kind: "mosae", id: `person-question-${person.personId}`, text: "Who is this?", photos: (person.sampleFaces ?? []).slice(0, 1).map((face) => face.uri), faceSamples: (person.sampleFaces ?? []).slice(0, 1) });
        const personTurns = (input.interpTurns ?? []).filter((turn) => turn.personId === person.personId);
        if (personTurns.length) personTurns.forEach((turn, index) => {
          add({ kind: "you", id: `person-turn-${person.personId}-${index + 1}`, text: turn.question });
          if (turn.reply) add({ kind: "mosae", id: `person-turn-reply-${person.personId}-${index + 1}`, text: turn.reply });
        });
        else if (personAnswer(person).trim()) add({ kind: "you", id: `person-answer-${person.personId}`, text: personAnswer(person) });
        if (!person.skipped && person.name && input.proceededPersonIds?.includes(person.personId)) add(taggedPersonItem(person, false));
        const personMergeEvents = mergeEvents.filter(({ personId }) => personId === person.personId);
        const automaticAck = automaticMergeAcknowledgement(input, person.personId);
        if (automaticAck) add({ kind: "mosae", id: `merge-${person.personId}-ack`, text: automaticAck });
        else for (const event of personMergeEvents) add({ kind: "merge-followup", id: event.id, text: `Same ${event.answer.replace(/^my\s+/i, "")} as before?`, answer: event.targetName, photos: event.sampleFaces.slice(0, 2), faceSamples: event.faceSamples, response: event.response });
      } else {
        const { event } = entry;
        if (event.reconciled) continue;
        add({ kind: "mosae", id: `person-question-${event.personId}`, text: "Who is this?", photos: (event.questionFaces ?? event.sampleFaces).slice(0, 1) });
        add({ kind: "you", id: `person-answer-${event.personId}`, text: event.answer });
        if (event.automatic) add({ kind: "mosae", id: `${event.id}-ack`, text: `Got it — I've added these to ${event.targetName.replace(/^my\s+/i, "")}'s moments.` });
        else add({ kind: "merge-followup", id: event.id, text: `Same ${event.answer.replace(/^my\s+/i, "")} as before?`, answer: event.targetName, photos: event.sampleFaces.slice(0, 2), faceSamples: event.faceSamples, response: event.response });
      }
    }
    if (input.pendingResponse === "person") {
      add({ kind: "typing", id: "person-save-wait", text: "Saving your answer" });
    }
    if (awaitingProceed) {
      add(taggedPersonItem(awaitingProceed));
    }
    if (unanswered) {
      placeholder = "Type a name";
      const mention = people[0]?.personId === unanswered.personId ? mentionedPerson(input.intent.text, people, input.mentionedPeople) : null;
      if (mention && !(input.dismissedPersonSuggestionIds ?? []).includes(unanswered.personId)) {
        add({ kind: "person-confirm", id: `person-confirm-${unanswered.personId}`, personId: unanswered.personId, label: mention.label, text: `Is this ${mention.phrase}?`, momentCount: unanswered.momentCount, sampleFaces: (unanswered.sampleFaces ?? []).slice(0, 2) });
      } else {
        if (input.taggedPerson?.personId === unanswered.personId) {
          add({ kind: "mosae", id: `tagged-person-${unanswered.personId}`, text: `Got it — these are the photos of ${input.taggedPerson.name || "this person"}.`, photos: input.taggedPerson.photos });
        }
        const declinedIdenticalMerge = (input.mergeEvents ?? []).some((event) => event.personId === unanswered.personId && event.response === "No, another person" && event.answer.trim().replace(/^my\s+/i, "").toLocaleLowerCase() === event.targetName.trim().replace(/^my\s+/i, "").toLocaleLowerCase());
        add({ kind: "person", id: `person-${unanswered.personId}`, personId: unanswered.personId, ageBand: unanswered.ageBand, momentCount: unanswered.momentCount, sampleShotIds: unanswered.sampleShotIds, sampleFaces: (unanswered.sampleFaces ?? []).slice(0, 1), days: unanswered.days, questionText: declinedIdenticalMerge ? "What should I call this one?" : "Who is this?", turns: (input.interpTurns ?? []).filter((turn) => turn.personId === unanswered.personId).map(({ question, reply }) => ({ question, ...(reply ? { reply } : {}) })) });
      }
    } else {
      placeholder = "Type a name";
      const hasMissedPeople = (input.missedPeople ?? []).length > 0;
      // This is the one actionable missed-people prompt. The transcript is
      // reconstructed on every render, so never add a second copy alongside
      // clarification turns.
      if (!unanswered && !awaitingProceed && !(input.mergeEvents ?? []).some((event) => !event.response)) {
        add({ kind: "anyone-else", id: "anyone-else", canConfirm: !hasMissedPeople, text: "Did I miss anyone? Enter the names of who were missed in the box below." });
      }
      if (input.missedAnswer) add({ kind: "you", id: "missed-answer", text: input.missedAnswer });
      if (hasMissedPeople) input.interpTurns?.filter((turn) => !turn.personId && (turn.stage === "missed" || !turn.stage)).forEach((turn, index) => {
        add({ kind: "you", id: `missed-clarification-question-${index + 1}`, text: turn.question });
        if (turn.reply) add({ kind: "mosae", id: `missed-clarification-reply-${index + 1}`, text: turn.reply });
      });
      for (const person of (input.missedPeople ?? []).filter((person) => !people.some((known) => known.personId === person.personId))) {
        if (!input.missedAnswer) add({ kind: "you", id: `missed-name-${person.personId}`, text: person.name });
        add({ kind: "mosae", id: `missed-select-${person.personId}`, text: `Help me select photos of ${person.name}.` });
        add({ kind: "missed-person", id: `missed-person-${person.personId}`, personId: person.personId, name: person.name, momentCount: person.momentCount, photos: person.sampleUris?.slice(0, 4) ?? (person.sampleUri ? [person.sampleUri] : []), ...(person.skipped ? { skipped: true } : {}) });
      }
      if (input.missedPersonTagging && !(input.missedPeople ?? []).some(({ personId }) => personId === input.missedPersonTagging!.personId)) {
        add({ kind: "mosae", id: `missed-select-${input.missedPersonTagging.personId}`, text: `Help me select 1 photo of ${input.missedPersonTagging.name}.` });
        add({ kind: "missed-person", id: `missed-tag-${input.missedPersonTagging.personId}`, ...input.missedPersonTagging, momentCount: 0, photos: [] });
      }
      if (!hasMissedPeople) input.interpTurns?.filter((turn) => !turn.personId && (turn.stage === "missed" || !turn.stage)).forEach((turn, index) => {
        add({ kind: "you", id: `missed-clarification-question-${index + 1}`, text: turn.question });
        if (turn.reply) add({ kind: "mosae", id: `missed-clarification-reply-${index + 1}`, text: turn.reply });
      });
    }
    return { items, step, confirmed, placeholder };
  }

  // Sample photo URIs are persisted with the selection action. They can arrive
  // before the flow's aggregate moment count refreshes, so use them as evidence
  // that this missed person has completed photo selection.
  const hasUntaggedMissedPeople = missedPeople.some((person) => !person.skipped && person.momentCount === 0 && !person.sampleUri && !person.sampleUris?.length);
  const collectingMissedPeople = input.peopleConfirmed && input.missedPeopleConfirmed === false && missedPeople.length === 0;
  const taggingMissedPeople = input.peopleConfirmed && missedPeople.length > 0 && hasUntaggedMissedPeople;
  // An explicit answer is required only while the missed-people list is empty.
  // Once names have been supplied, completing or skipping every photo card is
  // the confirmation to continue; waiting for another answer leaves chat stuck.
  const showPeopleSummary = (input.peopleConfirmed || allNamedPeopleProceeded && missedSelectionsResolved) && input.peopleSummaryConfirmed !== true && !hasUntaggedMissedPeople && (input.missedPeopleConfirmed === true || missedPeople.length > 0 || input.missedPeopleConfirmed === undefined && input.peopleSummaryConfirmed === false) && !(hasSummaryHistory && input.flow?.peopleSummaryFollowupActive);
  const keepPeopleSummary = showPeopleSummary || input.peopleSummaryConfirmed === true;
  const mergeEvents = input.mergeEvents ?? [];
  if (showPeopleSummary) {
    step = "people";
    const people = announcedPeople(input);
    const introCount = peopleIntroCount(people, mergeEvents);
    add({ kind: "mosae", id: "people-intro", text: peopleCountText(introCount) });
  }
  if (input.peopleConfirmed && input.peopleSummaryConfirmed === true) {
    const historyPeople = announcedPeople(input);
    const count = peopleIntroCount(historyPeople, mergeEvents);
    add({ kind: "mosae", id: "people-intro", text: peopleCountText(count) });
  }
  const addMissedPeople = (showPrompt: boolean, canConfirm = showPrompt) => {
    const postSummaryFlow = hasSummaryHistory || hasSummaryFollowup;
    if (postSummaryFlow) return;
    if (showPrompt) add({ kind: "anyone-else", id: "anyone-else", canConfirm, text: "Did I miss anyone? Enter the names of who were missed in the box below." });
    input.interpTurns?.filter((turn) => !turn.personId && (turn.stage === "missed" || !turn.stage)).forEach((turn, index) => {
      add({ kind: "you", id: `missed-clarification-question-${index + 1}`, text: turn.question });
      if (turn.reply) add({ kind: "mosae", id: `missed-clarification-reply-${index + 1}`, text: turn.reply });
    });
    if (input.missedAnswer) add({ kind: "you", id: "missed-answer", text: input.missedAnswer });
    if (input.missedReply) add({ kind: "mosae", id: "missed-reply", text: input.missedReply });
    for (const person of input.missedPeople ?? []) {
      if (!input.missedAnswer) add({ kind: "you", id: `missed-name-${person.personId}`, text: person.name });
      add({ kind: "mosae", id: `missed-select-${person.personId}`, text: `Help me select photos of ${person.name}.` });
      add({ kind: "missed-person", id: `missed-person-${person.personId}`, personId: person.personId, name: person.name, momentCount: person.momentCount, photos: person.sampleUris?.slice(0, 4) ?? (person.sampleUri ? [person.sampleUri] : []), ...(person.skipped ? { skipped: true } : {}) });
    }
    if (input.missedPersonTagging && !(input.missedPeople ?? []).some(({ personId }) => personId === input.missedPersonTagging!.personId)) {
      add({ kind: "mosae", id: `missed-select-${input.missedPersonTagging.personId}`, text: `Help me select 1 photo of ${input.missedPersonTagging.name}.` });
      add({ kind: "missed-person", id: `missed-tag-${input.missedPersonTagging.personId}`, ...input.missedPersonTagging, momentCount: 0, photos: [] });
    }
  };
  const addSummaryHistory = () => {
    if (input.missedAnswer) add({ kind: "you", id: "missed-answer", text: input.missedAnswer });
    const history = input.flow?.peopleSummaryHistory ?? [];
    history.forEach((people, index) => {
      const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
      const count = people.length;
      const text = count === 1 ? `Thanks. I've tagged ${people[0]!.name} in your moments.` : `Thanks. I've tagged all ${words[count] ?? count} in your moments.`;
      add({ kind: "mosae", id: `people-summary-history-message-${index + 1}`, text });
      add({ kind: "people-summary", id: `people-summary-history-${index + 1}`, people, canConfirm: false });
    });
  };
  const addPostSummaryTurns = () => {
    postSummaryTurns.forEach((turn, index) => {
      add({ kind: "you", id: `summary-followup-${index + 1}`, text: turn.question });
      if (turn.reply) add({ kind: "mosae", id: `summary-followup-reply-${index + 1}`, text: turn.reply });
    });
  };
  const addPostConfirmationTurns = () => {
    input.interpTurns?.filter((turn) => turn.stage === "post-confirmation").forEach((turn, index) => {
      add({ kind: "you", id: `post-confirmation-question-${index + 1}`, text: turn.question });
      if (turn.reply) add({ kind: "mosae", id: `post-confirmation-reply-${index + 1}`, text: turn.reply });
    });
  };
  const addPostSummaryMissedPeople = () => {
    for (const person of missedPeople) {
      add({ kind: "mosae", id: `missed-select-${person.personId}`, text: `Help me select photos of ${person.name}.` });
      add({ kind: "missed-person", id: `missed-person-${person.personId}`, personId: person.personId, name: person.name, momentCount: person.momentCount, photos: person.sampleUris?.slice(0, 4) ?? (person.sampleUri ? [person.sampleUri] : []), ...(person.skipped ? { skipped: true } : {}) });
    }
    if (input.missedPersonTagging && !(input.missedPeople ?? []).some(({ personId }) => personId === input.missedPersonTagging!.personId)) {
      add({ kind: "mosae", id: `missed-select-${input.missedPersonTagging.personId}`, text: `Help me select 1 photo of ${input.missedPersonTagging.name}.` });
      add({ kind: "missed-person", id: `missed-tag-${input.missedPersonTagging.personId}`, ...input.missedPersonTagging, momentCount: 0, photos: [] });
    }
  };
  const people = announcedPeople(input);
  if ((collectingMissedPeople || taggingMissedPeople) && !showPeopleSummary) {
    add({ kind: "mosae", id: "people-intro", text: peopleIntroText() });
  }
  const orderedHistory = [
    ...people.map((person) => ({ kind: "person" as const, person, personId: person.personId, momentCount: person.momentCount })),
    ...mergeEvents.filter(({ personId }) => !people.some((person) => person.personId === personId)).map((event) => ({ kind: "merge" as const, event, personId: event.personId, momentCount: event.momentCount })),
  ];
  orderByProgress(orderedHistory, input);
  for (const entry of orderedHistory) {
    if (entry.kind === "merge") {
      const { event } = entry;
      add({ kind: "mosae", id: `person-question-${event.personId}`, text: "Who is this?", photos: (event.questionFaces ?? event.sampleFaces).slice(0, 1) });
      add({ kind: "you", id: `person-answer-${event.personId}`, text: event.answer });
      if (event.automatic) add({ kind: "mosae", id: `${event.id}-ack`, text: `Got it — I've added these to ${event.targetName.replace(/^my\s+/i, "")}'s moments.` });
      else add({ kind: "merge-followup", id: event.id, text: `Same ${event.answer.replace(/^my\s+/i, "")} as before?`, answer: event.targetName, photos: event.sampleFaces.slice(0, 2), faceSamples: event.faceSamples, response: event.response });
      continue;
    }
    const { person } = entry;
    if (person.skipped || person.name) {
      add({ kind: "mosae", id: `person-question-${person.personId}`, text: "Who is this?", photos: (person.sampleFaces ?? []).slice(0, 1).map((face) => face.uri), faceSamples: (person.sampleFaces ?? []).slice(0, 1) });
      const personTurns = (input.interpTurns ?? []).filter((turn) => turn.personId === person.personId);
      personTurns.forEach((turn, index) => {
        add({ kind: "you", id: `person-turn-${person.personId}-${index + 1}`, text: turn.question });
        if (turn.reply) add({ kind: "mosae", id: `person-turn-reply-${person.personId}-${index + 1}`, text: turn.reply });
      });
      if (!personTurns.some((turn) => turn.question === person.answerText) && personAnswer(person).trim()) add({ kind: "you", id: `person-answer-${person.personId}`, text: personAnswer(person) });
      if (!person.skipped && person.name && input.proceededPersonIds?.includes(person.personId)) add(taggedPersonItem(person, false));
      if (showPeopleSummary && input.taggedPerson?.personId === person.personId) add({ kind: "mosae", id: `tagged-person-${person.personId}`, text: `Got it — these are the photos of ${input.taggedPerson.name || person.name || "this person"}.`, photos: input.taggedPerson.photos });
      const personMergeEvents = input.mergeEvents?.filter(({ personId }) => personId === person.personId) ?? [];
      const automaticAck = automaticMergeAcknowledgement(input, person.personId);
      if (automaticAck) add({ kind: "mosae", id: `merge-${person.personId}-ack`, text: automaticAck });
      else for (const event of personMergeEvents) add({ kind: "merge-followup", id: event.id, text: `Same ${event.answer.toLocaleLowerCase().replace(/^my\s+/, "")} as before?`, answer: event.targetName, photos: event.sampleFaces.slice(0, 2), faceSamples: event.faceSamples, response: event.response });
    }
  }
  if (hasSummaryHistory && input.flow?.peopleSummaryFollowupActive) {
    step = "people";
    add({ kind: "anyone-else", id: "anyone-else", canConfirm: false, text: "Did I miss anyone? Enter the names of who were missed in the box below." });
    addSummaryHistory();
    addPostSummaryTurns();
    addPostSummaryMissedPeople();
    return { items, step, confirmed, placeholder };
  }
  if (collectingMissedPeople) {
    step = "people";
    if (hasSummaryHistory && hasSummaryFollowup) { addSummaryHistory(); addPostSummaryTurns(); }
    else addMissedPeople(true);
    return { items, step, confirmed, placeholder };
  }
  if (taggingMissedPeople) {
    step = "people";
    if (hasSummaryHistory && hasSummaryFollowup) { addSummaryHistory(); addPostSummaryTurns(); addPostSummaryMissedPeople(); }
    else addMissedPeople(true, false);
    return { items, step, confirmed, placeholder };
  }
  if (keepPeopleSummary) {
    // Keep the single missed-people question before the names and photo-selection
    // turns in the reconstructed transcript, then place the final summary after them.
    if (hasSummaryHistory && hasSummaryFollowup) {
      add({ kind: "anyone-else", id: "anyone-else", canConfirm: false, text: "Did I miss anyone? Enter the names of who were missed in the box below." });
      addSummaryHistory();
      addPostSummaryTurns();
      addPostSummaryMissedPeople();
    } else addMissedPeople(true, false);
    const summarySource = input.flow?.peopleProgress?.askedPersonIds?.length ? announcedPeople(input) : keptPeople(input);
    const summaryPeople = summarySource.filter((person) => !person.skipped && person.name && person.momentCount > 0);
    const asked = announcedPeople(input).filter((person) => !person.skipped && person.name && person.momentCount > 0 && !summaryPeople.some((known) => known.personId === person.personId));
    const announced = orderByProgress([...summaryPeople, ...asked], input);
    const taggedCardFaceByPersonId = new Map(items.flatMap((item) => item.kind === "person-tagged" && item.sampleFace ? [[item.personId, item.sampleFace] as const] : []));
    const peopleById = new Map(announced.map((person) => [person.personId, { personId: person.personId, name: summaryPersonLabel(person.name!), momentCount: person.momentCount, sampleUri: taggedCardFaceByPersonId.get(person.personId)?.uri ?? person.sampleFaces?.[0]?.uri, sampleFace: taggedCardFaceByPersonId.get(person.personId) ?? person.sampleFaces?.[0] }]));
    const taggedMissed = (input.people ?? []).filter((person) => person.personId.startsWith("p-missed-") && !person.skipped && person.name && person.momentCount > 0);
    for (const person of taggedMissed) {
      if (!peopleById.has(person.personId)) peopleById.set(person.personId, { personId: person.personId, name: summaryPersonLabel(person.name!), momentCount: person.momentCount, sampleUri: taggedCardFaceByPersonId.get(person.personId)?.uri ?? person.sampleFaces?.[0]?.uri, sampleFace: taggedCardFaceByPersonId.get(person.personId) ?? person.sampleFaces?.[0] });
    }
    for (const person of missedPeople) {
      const momentCount = Math.max(person.momentCount, person.sampleUris?.length ?? 0, person.sampleUri ? 1 : 0);
      if (!person.skipped && momentCount > 0 && !peopleById.has(person.personId)) peopleById.set(person.personId, { personId: person.personId, name: summaryPersonLabel(person.name), momentCount, sampleUri: undefined, sampleFace: undefined });
    }
    const named = [...peopleById.values()];
    if (hasSummaryHistory && hasSummaryFollowup && !missedSelectionsResolved) return { items, step: "people", confirmed, placeholder };
    const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
    if (named.length === 1) add({ kind: "mosae", id: "people-summary-message", text: `Thanks. I've tagged ${named[0]!.name} in your moments.` });
    else add({ kind: "mosae", id: "people-summary-message", text: `Thanks. I've tagged all ${words[named.length] ?? named.length} in your moments.` });
    add({ kind: "people-summary", id: "people-summary", people: named, ...(input.peopleSummaryConfirmed === true ? { canConfirm: false } : {}) });
    if (input.peopleSummaryConfirmed === true && input.peopleSummaryAnswer) add({ kind: "you", id: "people-summary-answer", text: input.peopleSummaryAnswer });
    if (showPeopleSummary) return { items, step, confirmed, placeholder };
  }
  confirmed = 2;

  if (!input.plan || !input.summary.ready.plan) {
    step = "moments";
    if (!input.planFailed) add({ kind: "typing", id: "plan-wait", text: "Picking the strongest moments" });
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
    add({ kind: "mosae", id: "set-aside-message", text: `Got it. I've set aside ${setAside.blurry} blurry ${setAside.blurry === 1 ? "shot" : "shots"} and ${setAside.duplicates} near-duplicate${setAside.duplicates === 1 ? "" : "s"}, keeping the best of each burst. Your originals are untouched.` });
    add({ kind: "you", id: "moments-answer", text: "Looks good" });
  }
  confirmed = 3;
  if (!input.direction) {
    step = "direction";
    add({ kind: "typing", id: "direction-wait", text: "Putting together a direction for your film" });
    addPostConfirmationTurns();
    return { items, step, confirmed, placeholder };
  }

  if (!input.direction.confirmed) {
    step = "direction";
    add({ kind: "mosae", id: "direction-question", text: input.directionNote ?? "For these moments, I’d suggest this." });
    add({
      kind: "direction", id: "direction", aspect: input.direction.aspect ?? "9:16", ...(input.summary?.orientation ? { orientation: input.summary.orientation } : {}), pace: input.direction.pace, lengthSec: input.direction.lengthSec,
      focus: input.direction.focus, momentCount: input.plan.totalMomentCount ?? input.plan.moments.length,
    });
    addPostConfirmationTurns();
    return { items, step, confirmed, placeholder };
  }

  add({ kind: "mosae", id: "direction-question", text: input.directionNote ?? "For these moments, I’d suggest this." });
  add({
    kind: "direction", id: "direction", aspect: input.direction.aspect ?? "9:16", ...(input.summary?.orientation ? { orientation: input.summary.orientation } : {}), pace: input.direction.pace, lengthSec: input.direction.lengthSec,
    focus: input.direction.focus, momentCount: input.plan.totalMomentCount ?? input.plan.moments.length,
  });
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
    addPostConfirmationTurns();
    return { items, step, confirmed, placeholder };
  }

  step = "shaping";
  if (input.generation) add({ kind: "shaping", id: "shaping", progress: input.generation.progress, stepsDone: input.generation.stepsDone });
  else add({ kind: "typing", id: "shaping-wait", text: "Shaping your film…" });
  addPostConfirmationTurns();
  return { items, step, confirmed, placeholder };
}
