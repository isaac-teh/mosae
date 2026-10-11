// Figma: "Character Picker" (Step 3) — check who the director found, fix
// mistakes, leave people out, and choose who the film centres on.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { FocusChip } from "@/components/ds";
import type { FlowAction } from "@mosae/contracts";
import type { Href } from "expo-router";
import { useStepBack } from "@/lib/useStepBack";
import { useStoryFlow } from "@/lib/storyFlow";
import { StepHeader } from "@/components/StepHeader";
import { type Cast, type CastRole, type ProjectCharacters, confirmCast, getAssetThumbnailUrl, getCast, getProjectCharacters, mutateProjectFlow } from "@/lib/characters";
import { faceCropGeometry, imageSizeFromLoadEvent, type FaceBbox } from "@/lib/faceCrop";
import { StableUriImage } from "@/components/StableUriImage";

/** Side of the square window a face crop is shown in. */
const CROP_PX = 64;

const ROLES: CastRole[] = ["parent", "child", "other"];
const ROLE_LABEL: Record<CastRole, string> = { parent: "Parent", child: "Child", other: "Other" };
const DEFAULT_NAME: Record<CastRole, string> = { parent: "A parent", child: "Your child", other: "Someone" };

/**
 * An unnamed person's label. When two people share a role, they're numbered so
 * the chips and cards can be told apart ("Parent 1", "Parent 2").
 */
function labelFor(person: { personId: string; role: CastRole; name: string }, everyone: { personId: string; role: CastRole }[]): string {
  if (person.name.trim()) return person.name.trim();
  const sameRole = everyone.filter((other) => other.role === person.role);
  if (sameRole.length < 2) return DEFAULT_NAME[person.role];
  return `${ROLE_LABEL[person.role]} ${sameRole.findIndex((other) => other.personId === person.personId) + 1}`;
}

/**
 * Shows one face by scaling its shot's image so the stored box fills a fixed
 * square, then offsetting it so the box lands in view. Cropping this way needs
 * no server-side face images: the thumbnail the app already signs is enough.
 */
function FaceCrop({ url, bbox, size = CROP_PX }: { url?: string; bbox?: FaceBbox; size?: number }) {
  const CROP = size;
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  if (!url || !bbox) return <View style={{ width: CROP, height: CROP }} className="rounded-[10px] bg-surface-sunken" />;
  const crop = sourceSize ? faceCropGeometry(bbox, sourceSize.width, sourceSize.height, CROP) : null;
  return (
    <View style={{ width: CROP, height: CROP, overflow: "hidden" }} className="rounded-[10px] bg-surface-sunken">
      <StableUriImage
        uri={url}
        accessibilityIgnoresInvertColors
        resizeMode={crop ? "stretch" : "cover"}
        onLoad={(event: any) => {
          // The crop restyles the image, which fires onLoad again on web; measure once.
          if (sourceSize) return;
          const dimensions = imageSizeFromLoadEvent(event);
          if (dimensions) setSourceSize(dimensions);
          else Image.getSize(url, (width, height) => setSourceSize((current) => current ?? { width, height }), () => {});
        }}
        style={crop
          ? { position: "absolute", width: crop.width, height: crop.height, left: crop.left, top: crop.top }
          : { width: CROP, height: CROP }}
      />
    </View>
  );
}

function ErrorState({ error, retry }: { error: string; retry: () => void }) {
  return <View className="flex-1 items-center justify-center bg-surface"><Text role="alert" className="text-action text-label">{error}</Text><Pressable role="button" aria-label="Retry" onPress={retry} className="mt-4 rounded-full bg-action px-4 py-3"><Text className="font-sans-semibold text-on-action">Retry</Text></Pressable></View>;
}

/** `fallback` is fixed when the screen loads, so tapping a role never renames anyone. */
type DraftPerson = { personId: string; role: CastRole; name: string; excluded: boolean; fallback: string };
type Face = { faceId: string; shotId: string; assetId: string; bbox?: [number, number, number, number] };

export default function CharacterPickerScreen() {
  const router = useRouter();
  const { planId, projectId, afterFilm } = useLocalSearchParams<{ planId?: string; projectId?: string; afterFilm?: string }>();
  const { route } = useStoryFlow();
  // Opened from Review, so back returns there with the plan on screen.
  const goBack = useStepBack(route("/review-moments", { planId }) as Href);

  const [characters, setCharacters] = useState<ProjectCharacters | null>(null);
  const [cast, setCast] = useState<Cast | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Signed thumbnail per asset, fetched once and shared by that shot's crops.
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // The user's edits, applied over what the director found.
  const [people, setPeople] = useState<DraftPerson[]>([]);
  const [focus, setFocus] = useState<string[]>([]);
  const [assignment, setAssignment] = useState<Record<string, string | null>>({});
  const [original, setOriginal] = useState<Record<string, string | null>>({});
  const [movingFaceId, setMovingFaceId] = useState<string | null>(null);
  const [undoDraft, setUndoDraft] = useState<{ people: DraftPerson[]; focus: string[]; assignment: Record<string, string | null>; merges: { fromPersonId: string; toPersonId: string }[] } | null>(null);
  const [merges, setMerges] = useState<{ fromPersonId: string; toPersonId: string }[]>([]);
  const [remakeOffer, setRemakeOffer] = useState(false);
  const [remakePlanId, setRemakePlanId] = useState<string | undefined>(planId);
  // Guards against surfacing an error from a stale load after navigation.
  const hasLoaded = useRef(false);

  const load = useCallback(() => {
    if (!projectId) return;
    const activeProjectId = projectId;
    void Promise.all([getProjectCharacters(activeProjectId), getCast(activeProjectId)]).then(([faces, found]) => {
      setCharacters(faces);
      setCast(found);
      const known = new Set(found?.people.map((person) => person.personId) ?? []);
      const byFace: Record<string, string | null> = {};
      for (const shot of faces.shots) for (const face of shot.faces) {
        byFace[face.faceId] = face.characterId && known.has(face.characterId) ? face.characterId : null;
      }
      setAssignment(byFace);
      setOriginal(byFace);
      const foundPeople = found?.people ?? [];
      setPeople(foundPeople.map((person) => ({
        personId: person.personId, role: person.role, name: person.name ?? "", excluded: person.excluded ?? false,
        fallback: labelFor({ ...person, name: "" }, foundPeople),
      })));
      setFocus(found?.focus ?? []);
      setError(null);
      hasLoaded.current = true;
    }).catch((cause: Error) => {
      if (!hasLoaded.current) setError(cause.message);
    });
  }, [projectId]);

  useEffect(() => { if (projectId) load(); }, [projectId, load]);

  // Sign each shot's image once the faces are known. A thumbnail that will not
  // sign leaves that crop as a blank tile rather than failing the screen.
  // `requested` is a ref, not state: keying this effect on the thumbnails it
  // writes would restart it on every arrival and refetch every crop.
  const requested = useRef(new Set<string>());
  useEffect(() => {
    if (!projectId || !characters) return;
    let active = true;
    for (const shot of characters.shots) {
      if (!shot.assetId || requested.current.has(shot.assetId)) continue;
      requested.current.add(shot.assetId);
      void getAssetThumbnailUrl(projectId, shot.assetId)
        .then((url) => { if (active) setThumbnails((prev) => ({ ...prev, [shot.assetId]: url })); })
        .catch(() => { requested.current.delete(shot.assetId); });
    }
    return () => { active = false; };
  }, [projectId, characters]);

  const allFaces = useMemo<Face[]>(() => (characters?.shots ?? []).flatMap((shot) =>
    shot.faces.map((face) => ({ faceId: face.faceId, shotId: shot.shotId, assetId: shot.assetId, bbox: face.bbox }))), [characters]);
  const facesOf = (personId: string | null) => allFaces.filter((face) => (assignment[face.faceId] ?? null) === personId);

  // Focus first, then parents, children and everyone else; stable within a group.
  const ordered = [...people].sort((a, b) => {
    const rank = (person: DraftPerson) => (focus.includes(person.personId) ? 0 : 1 + ROLES.indexOf(person.role));
    return rank(a) - rank(b);
  });

  const updatePerson = (personId: string, change: Partial<DraftPerson>) => {
    setUndoDraft({ people, focus, assignment, merges });
    setPeople((prev) => prev.map((person) => (person.personId === personId ? { ...person, ...change } : person)));
    // Someone left out can't be who the film centres on.
    if (change.excluded) setFocus((prev) => prev.filter((id) => id !== personId));
  };
  const toggleFocus = (personId: string) =>
    (setUndoDraft({ people, focus, assignment, merges }), setFocus((prev) => (prev.includes(personId) ? prev.filter((id) => id !== personId) : [...prev, personId])));
  const moveFace = (faceId: string, personId: string | "new" | "remove") => {
    setUndoDraft({ people, focus, assignment, merges });
    let target: string | null = personId === "remove" ? null : personId;
    if (personId === "new") {
      const newPersonId = `p-new-${people.length + 1}`;
      target = newPersonId;
      setPeople((prev) => [...prev, { personId: newPersonId, role: "other", name: "", excluded: false, fallback: `New person ${prev.filter((person) => person.personId.startsWith("p-new-")).length + 1}` }]);
    }
    setAssignment((prev) => ({ ...prev, [faceId]: target }));
    setMovingFaceId(null);
  };

  const proceed = (nextPlanId: string | undefined) =>
    router.navigate(route("/review-moments", { planId: nextPlanId }) as never);

  const confirm = async () => {
    if (!projectId) return;
    setSaving(true);
    setError(null);
    try {
      const moves = Object.entries(assignment)
        .filter(([faceId, personId]) => personId !== original[faceId])
        .map(([faceId, personId]) => ({ faceId, personId }));
      // A person the user emptied of every crop is dropped rather than kept as a ghost.
      const kept = people.filter((person) => Object.values(assignment).includes(person.personId));
      const result = await confirmCast(projectId, {
        people: kept.map((person) => ({
          personId: person.personId, role: person.role, excluded: person.excluded,
          ...(person.name.trim() ? { name: person.name.trim() } : {}),
        })),
        focus: focus.filter((id) => kept.some((person) => person.personId === id)),
        moves,
        ...(merges.length ? { merges } : {}),
        ...(planId ? { proposalId: planId } : {}),
      });
      const flowActions: Exclude<FlowAction, { type: "batch" }>[] = kept.map((person) => ({ type: "person", personId: person.personId, name: person.name.trim() || null, role: person.role, confirmed: true, skipped: person.excluded }));
      for (const merge of merges) {
        const source = cast?.people.find((person) => person.personId === merge.fromPersonId);
        flowActions.push({ type: "person", personId: merge.fromPersonId, name: source?.name ?? null, role: source?.role ?? "other", confirmed: true });
        flowActions.push({ type: "merge", personId: merge.fromPersonId, targetPersonId: merge.toPersonId });
      }
      for (const move of moves) flowActions.push({ type: "move-photo", faceId: move.faceId, personId: move.personId });
      if (flowActions.length) await mutateProjectFlow(projectId, { type: "batch", actions: flowActions });
      // Confirming revises the plan, so the next screen must be shown the
      // version that came back — not the one we started from.
      if (afterFilm === "true") { setRemakePlanId(result.proposalId ?? planId); setRemakeOffer(true); }
      else proceed(result.proposalId ?? planId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save who is in your film");
    } finally {
      setSaving(false);
    }
  };

  if (error && !characters) return <ErrorState error={error} retry={load} />;

  const others = facesOf(null);
  const moveTargets = (faceId: string) => people.filter((person) => person.personId !== assignment[faceId]);
  const mergePerson = (fromPersonId: string, toPersonId: string) => {
    setUndoDraft({ people, focus, assignment, merges });
    setMerges((current) => [...current.filter(({ fromPersonId: from }) => from !== fromPersonId), { fromPersonId, toPersonId }]);
    setAssignment((current) => Object.fromEntries(Object.entries(current).map(([faceId, owner]) => [faceId, owner === fromPersonId ? toPersonId : owner])));
    setFocus((current) => current.map((id) => id === fromPersonId ? toPersonId : id).filter((id, index, all) => all.indexOf(id) === index));
    setPeople((current) => current.filter((person) => person.personId !== fromPersonId));
  };
  const undoLastChange = () => {
    if (!undoDraft) return;
    setPeople(undoDraft.people); setFocus(undoDraft.focus); setAssignment(undoDraft.assignment); setMerges(undoDraft.merges); setUndoDraft(null);
  };

  const cropRow = (faces: Face[], ownerLabel: string) => (
    <View className="mt-3 flex-row flex-wrap gap-2">
      {faces.map((face, index) => (
        <View key={face.faceId}>
          <Pressable
            role="button"
            aria-label={`Move ${ownerLabel} photo ${index + 1} to someone else`}
            onPress={() => setMovingFaceId(movingFaceId === face.faceId ? null : face.faceId)}
            className={`rounded-[12px] p-0.5 ${movingFaceId === face.faceId ? "bg-action" : ""}`}
          >
            <FaceCrop url={thumbnails[face.assetId]} bbox={face.bbox} />
          </Pressable>
        </View>
      ))}
    </View>
  );

  // The move menu is a popup over the whole screen, so the bottom bar never
  // hides it and it reads the same wherever the tapped crop sits.
  const movingFace = allFaces.find((face) => face.faceId === movingFaceId);
  const movePopup = movingFace ? (
    <View className="absolute inset-0 z-30 items-center justify-center px-4">
      <Pressable role="button" aria-label="Close" onPress={() => setMovingFaceId(null)} className="absolute inset-0 bg-black/40" />
      <View role="dialog" aria-label="Who is this really?" className="w-full max-w-[420px] rounded-[20px] bg-surface-raised p-5 shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.2)]">
        <View className="items-center">
          <FaceCrop url={thumbnails[movingFace.assetId]} bbox={movingFace.bbox} size={120} />
        </View>
        <Text className="mt-4 text-center font-title text-[20px] leading-[26px] text-ink">Who is this really?</Text>
        <View className="mt-4 gap-2">
          {moveTargets(movingFace.faceId).map((person) => (
            <Pressable key={person.personId} role="button" aria-label={`Move to ${person.name.trim() || person.fallback}`} onPress={() => moveFace(movingFace.faceId, person.personId)} className="items-center rounded-full bg-surface-sunken py-3">
              <Text className="font-sans-semibold text-button leading-5 text-ink">{person.name.trim() || person.fallback}</Text>
            </Pressable>
          ))}
          <Pressable role="button" aria-label="Move to a new person" onPress={() => moveFace(movingFace.faceId, "new")} className="items-center rounded-full bg-surface-sunken py-3">
            <Text className="font-sans-semibold text-button leading-5 text-action">+ Someone else</Text>
          </Pressable>
          {assignment[movingFace.faceId] !== null && <Pressable role="button" aria-label="Remove photo from person" onPress={() => moveFace(movingFace.faceId, "remove")} className="items-center rounded-full bg-surface-sunken py-3"><Text className="font-sans-semibold text-button leading-5 text-action">Remove from this person</Text></Pressable>}
          <Pressable role="button" aria-label="Cancel" onPress={() => setMovingFaceId(null)} className="items-center py-2">
            <Text className="font-sans-medium text-label leading-5 text-ink-muted">Cancel</Text>
          </Pressable>
        </View>
      </View>
    </View>
  ) : null;

  return (
    <View className="flex-1 bg-surface">
      <StepHeader step="CHARACTERS" label="OPTIONAL" progress={0.5} onBack={() => goBack()} backLabel="Go back to your story" />
      <ScrollView className="flex-1" contentContainerClassName="px-4 pb-[140px] pt-4" keyboardShouldPersistTaps="handled">
        <View className="mt-1">
          <Text className="font-title text-[26px] leading-[32.5px] tracking-[-0.65px] text-ink">Who&apos;s in your film?</Text>
          <Text className="mt-1 font-sans text-body leading-[22px] text-ink-muted">
            {people.length > 0
              ? `We found ${people.length} ${people.length === 1 ? "person" : "people"}. Fix anything we got wrong, or leave someone out.`
              : "We didn't find anyone to build the film around yet."}
          </Text>
        </View>

        {people.length > 0 && (
          <View className="mt-5">
            <Text className="font-sans-semibold text-caption leading-4 uppercase tracking-[0.5px] text-ink-muted">Who&apos;s the star?</Text>
            <Text className="mt-0.5 font-sans text-caption leading-4 text-ink-muted">Tap who the film should be mostly about. You can pick more than one.</Text>
            <View role="group" aria-label="Film centres on" className="mt-2 flex-row flex-wrap gap-2">
              {ordered.filter((person) => !person.excluded).map((person) => {
                const on = focus.includes(person.personId);
                return (
                  <FocusChip
                    key={person.personId}
                    label={person.name.trim() || person.fallback}
                    accessibilityLabel={`Centre the film on ${person.name.trim() || person.fallback}`}
                    role="checkbox"
                    selected={on}
                    onPress={() => toggleFocus(person.personId)}
                  />
                );
              })}
            </View>
            {focus.length === 0 && <Text className="mt-1 font-sans text-caption leading-4 text-ink-muted">Nobody picked — we&apos;ll centre on whoever the photos are most about.</Text>}
          </View>
        )}

        {ordered.map((person, index) => {
          const faces = facesOf(person.personId);
          const label = (person.name.trim() || person.fallback);
          return (
            <View key={person.personId} className={`mt-4 rounded-[16px] bg-surface-raised p-4 shadow-[0px_1px_1px_rgba(0,0,0,0.05)] ${person.excluded ? "opacity-50" : ""}`}>
              <TextInput
                value={person.name}
                onChangeText={(name) => updatePerson(person.personId, { name })}
                placeholder={person.fallback}
                placeholderTextColor="rgb(var(--color-accent) / 0.4)"
                aria-label={`Name person ${index + 1}`}
                className="rounded-[10px] border border-line-strong bg-surface px-3 py-1.5 font-sans text-[18px] leading-[24px] text-ink"
              />
              <View role="radiogroup" aria-label={`${label}'s role`} className="mt-2 flex-row items-center gap-2">
                {ROLES.map((role) => (
                  <Pressable key={role} role="radio" aria-checked={person.role === role} aria-label={`${label} is ${ROLE_LABEL[role].toLowerCase()}`} onPress={() => updatePerson(person.personId, { role })} className={`rounded-full px-3 py-1 ${person.role === role ? "bg-action" : "bg-surface-sunken"}`}>
                    <Text className={`font-sans-semibold text-[11px] leading-4 uppercase tracking-[0.5px] ${person.role === role ? "text-on-action" : "text-ink-muted"}`}>{ROLE_LABEL[role]}</Text>
                  </Pressable>
                ))}
              </View>
              <Text className="mt-3 font-sans text-caption leading-4 text-ink-muted">{`Photos of ${label}. Not them? Tap the photo to move it.`}</Text>
              {cropRow(faces, label)}
              {ordered.filter((other) => other.personId !== person.personId).length > 0 && <View className="mt-2 flex-row flex-wrap gap-2">{ordered.filter((other) => other.personId !== person.personId).map((other) => <Pressable key={other.personId} role="button" aria-label={`Same person as ${other.name.trim() || other.fallback}`} onPress={() => mergePerson(person.personId, other.personId)} className="rounded-full bg-surface-sunken px-3 py-2"><Text className="font-sans-semibold text-caption text-ink">Same person as {other.name.trim() || other.fallback}</Text></Pressable>)}</View>}
              <Pressable role="switch" aria-checked={person.excluded} aria-label={`Leave ${label} out`} onPress={() => updatePerson(person.personId, { excluded: !person.excluded })} className="mt-3 self-start rounded-full bg-surface-sunken px-3 py-1.5">
                <Text className="font-sans-semibold text-caption leading-4 text-ink">{person.excluded ? "Bring back into the film" : "Leave out of the film"}</Text>
              </Pressable>
              {person.excluded && <Text className="mt-1 font-sans text-caption leading-4 text-ink-muted">Photos where they&apos;re the main subject won&apos;t be used.</Text>}
            </View>
          );
        })}

        {others.length > 0 && (
          <View className="mt-4 rounded-[16px] bg-surface-raised p-4 shadow-[0px_1px_1px_rgba(0,0,0,0.05)]">
            <Text className="font-sans-semibold text-button leading-5 text-ink">Others in your photos</Text>
            <Text className="mt-0.5 font-sans text-caption leading-4 text-ink-muted">Not in the film unless you add them. Tap one to say who it is.</Text>
            {cropRow(others, "unknown")}
          </View>
        )}
      </ScrollView>

      <View className="absolute inset-x-0 bottom-0 z-20 bg-surface px-4 pb-2">
        {error && <Text role="alert" className="mb-1 text-center font-sans text-caption leading-4 text-action">{error}</Text>}
        {undoDraft && <Pressable role="button" aria-label="Undo last change" disabled={saving} onPress={undoLastChange} className="mt-2 items-center py-2"><Text className="font-sans-semibold text-caption text-action">Undo last change</Text></Pressable>}
        <Pressable
          role="button"
          aria-label="Looks right"
          disabled={saving || !cast}
          onPress={() => void confirm()}
          className="mt-2 flex-row items-center justify-center rounded-full bg-action py-3.5 shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)]"
        >
          <Text className="font-sans-semibold text-button leading-5 text-center text-on-action">{saving ? "Saving…" : "Looks right"}</Text>
        </Pressable>
        <Pressable role="button" aria-label="Skip" disabled={saving} onPress={() => proceed(planId)} className="mt-1 items-center py-2">
          <Text className="font-sans-medium text-caption leading-4 text-ink-muted">Skip — let Mosaé decide</Text>
        </Pressable>
      </View>
      {remakeOffer && <View role="dialog" aria-label="Remake film" className="absolute inset-x-4 bottom-24 z-30 rounded-[18px] bg-surface-raised p-4 shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.2)]"><Text className="font-sans-semibold text-label text-ink">Remake the film with these changes?</Text><View className="mt-3 flex-row gap-2"><Pressable role="button" aria-label="Remake the film with these changes" onPress={() => { setRemakeOffer(false); proceed(remakePlanId); }} className="flex-1 items-center rounded-full bg-action py-3"><Text className="font-sans-semibold text-on-action">Review changes</Text></Pressable><Pressable role="button" aria-label="Not now" onPress={() => { setRemakeOffer(false); router.back(); }} className="items-center rounded-full bg-surface-sunken px-4 py-3"><Text className="font-sans-semibold text-ink">Not now</Text></Pressable></View><Text className="mt-2 font-sans text-caption text-ink-muted">Your current film will stay as it is until you choose to make another.</Text></View>}
      {movePopup}
    </View>
  );
}
