// Figma: "Character Picker" (Step 3) — check who the director found, fix
// mistakes, leave people out, and choose who the film centres on.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Href } from "expo-router";
import { useStepBack } from "@/lib/useStepBack";
import { useStoryFlow } from "@/lib/storyFlow";
import { StepHeader } from "@/components/StepHeader";
import { type Cast, type CastRole, type ProjectCharacters, confirmCast, getAssetThumbnailUrl, getCast, getProjectCharacters } from "@/lib/characters";

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
function FaceCrop({ url, bbox, size = CROP_PX }: { url?: string; bbox?: [number, number, number, number]; size?: number }) {
  const CROP = size;
  if (!url || !bbox) return <View style={{ width: CROP, height: CROP }} className="rounded-[10px] bg-surface-sunken" />;
  const [ymin, xmin, ymax, xmax] = bbox;
  // Pad the box outward so the crop reads as a portrait, not a tight mask.
  const pad = 0.6;
  const halfW = Math.max((xmax - xmin) * (1 + pad), 0.02) / 2;
  const halfH = Math.max((ymax - ymin) * (1 + pad), 0.02) / 2;
  const half = Math.max(halfW, halfH);
  const cx = (xmin + xmax) / 2;
  const cy = (ymin + ymax) / 2;
  // The full image must be this many px wide for the 2*half slice to fill CROP.
  const scaled = CROP / (2 * half);
  return (
    <View style={{ width: CROP, height: CROP, overflow: "hidden" }} className="rounded-[10px] bg-surface-sunken">
      <Image
        source={{ uri: url }}
        accessibilityIgnoresInvertColors
        style={{
          width: scaled,
          height: scaled,
          marginLeft: -(cx * scaled - CROP / 2),
          marginTop: -(cy * scaled - CROP / 2),
        }}
      />
    </View>
  );
}

function ErrorState({ error, retry }: { error: string; retry: () => void }) {
  return <View className="flex-1 items-center justify-center bg-canvas"><Text role="alert" className="text-brand text-sm">{error}</Text><Pressable role="button" aria-label="Retry" onPress={retry} className="mt-4 rounded-full bg-brand px-5 py-3"><Text className="font-sans-semibold text-white">Retry</Text></Pressable></View>;
}

/** `fallback` is fixed when the screen loads, so tapping a role never renames anyone. */
type DraftPerson = { personId: string; role: CastRole; name: string; excluded: boolean; fallback: string };
type Face = { faceId: string; shotId: string; assetId: string; bbox?: [number, number, number, number] };

export default function CharacterPickerScreen() {
  const router = useRouter();
  const { planId, projectId } = useLocalSearchParams<{ planId?: string; projectId?: string }>();
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
    setPeople((prev) => prev.map((person) => (person.personId === personId ? { ...person, ...change } : person)));
    // Someone left out can't be who the film centres on.
    if (change.excluded) setFocus((prev) => prev.filter((id) => id !== personId));
  };
  const toggleFocus = (personId: string) =>
    setFocus((prev) => (prev.includes(personId) ? prev.filter((id) => id !== personId) : [...prev, personId]));
  const moveFace = (faceId: string, personId: string | "new") => {
    let target = personId;
    if (personId === "new") {
      target = `p-new-${people.length + 1}`;
      setPeople((prev) => [...prev, { personId: target, role: "other", name: "", excluded: false, fallback: `New person ${prev.filter((person) => person.personId.startsWith("p-new-")).length + 1}` }]);
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
        .filter(([faceId, personId]) => personId !== null && personId !== original[faceId])
        .map(([faceId, personId]) => ({ faceId, personId: personId as string }));
      // A person the user emptied of every crop is dropped rather than kept as a ghost.
      const kept = people.filter((person) => Object.values(assignment).includes(person.personId));
      const result = await confirmCast(projectId, {
        people: kept.map((person) => ({
          personId: person.personId, role: person.role, excluded: person.excluded,
          ...(person.name.trim() ? { name: person.name.trim() } : {}),
        })),
        focus: focus.filter((id) => kept.some((person) => person.personId === id)),
        moves,
        ...(planId ? { proposalId: planId } : {}),
      });
      // Confirming revises the plan, so the next screen must be shown the
      // version that came back — not the one we started from.
      proceed(result.proposalId ?? planId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save who is in your film");
    } finally {
      setSaving(false);
    }
  };

  if (error && !characters) return <ErrorState error={error} retry={load} />;

  const others = facesOf(null);
  const moveTargets = (faceId: string) => people.filter((person) => person.personId !== assignment[faceId]);

  const cropRow = (faces: Face[], ownerLabel: string) => (
    <View className="mt-3 flex-row flex-wrap gap-2">
      {faces.map((face, index) => (
        <View key={face.faceId}>
          <Pressable
            role="button"
            aria-label={`Move ${ownerLabel} photo ${index + 1} to someone else`}
            onPress={() => setMovingFaceId(movingFaceId === face.faceId ? null : face.faceId)}
            className={`rounded-[12px] p-0.5 ${movingFaceId === face.faceId ? "bg-brand" : ""}`}
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
    <View className="absolute inset-0 z-30 items-center justify-center px-5">
      <Pressable role="button" aria-label="Close" onPress={() => setMovingFaceId(null)} className="absolute inset-0 bg-black/40" />
      <View role="dialog" aria-label="Who is this really?" className="w-full max-w-[420px] rounded-[20px] bg-white p-5 shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.2)]">
        <View className="items-center">
          <FaceCrop url={thumbnails[movingFace.assetId]} bbox={movingFace.bbox} size={120} />
        </View>
        <Text className="mt-4 text-center font-serif text-[20px] leading-[26px] text-ink">Who is this really?</Text>
        <View className="mt-4 gap-2">
          {moveTargets(movingFace.faceId).map((person) => (
            <Pressable key={person.personId} role="button" aria-label={`Move to ${person.name.trim() || person.fallback}`} onPress={() => moveFace(movingFace.faceId, person.personId)} className="items-center rounded-full bg-surface-sunken py-3">
              <Text className="font-sans-semibold text-sm leading-5 text-ink">{person.name.trim() || person.fallback}</Text>
            </Pressable>
          ))}
          <Pressable role="button" aria-label="Move to a new person" onPress={() => moveFace(movingFace.faceId, "new")} className="items-center rounded-full bg-surface-sunken py-3">
            <Text className="font-sans-semibold text-sm leading-5 text-brand">+ Someone else</Text>
          </Pressable>
          <Pressable role="button" aria-label="Cancel" onPress={() => setMovingFaceId(null)} className="items-center py-2">
            <Text className="font-sans-medium text-sm leading-5 text-ink-soft">Cancel</Text>
          </Pressable>
        </View>
      </View>
    </View>
  ) : null;

  return (
    <View className="flex-1 bg-canvas">
      <StepHeader step="CHARACTERS" label="OPTIONAL" progress={0.5} onBack={() => goBack()} backLabel="Go back to your story" />
      <ScrollView className="flex-1" contentContainerClassName="px-5 pb-[140px] pt-4" keyboardShouldPersistTaps="handled">
        <View className="mt-1">
          <Text className="font-serif text-[26px] leading-[32.5px] tracking-[-0.65px] text-ink">Who&apos;s in your film?</Text>
          <Text className="mt-1 font-sans text-sm leading-[22px] text-ink-soft">
            {people.length > 0
              ? `We found ${people.length} ${people.length === 1 ? "person" : "people"}. Fix anything we got wrong, or leave someone out.`
              : "We didn't find anyone to build the film around yet."}
          </Text>
        </View>

        {people.length > 0 && (
          <View className="mt-5">
            <Text className="font-sans-semibold text-xs leading-4 uppercase tracking-[0.5px] text-ink-soft">Who&apos;s the star?</Text>
            <Text className="mt-0.5 font-sans text-xs leading-4 text-ink-soft">Tap who the film should be mostly about. You can pick more than one.</Text>
            <View role="group" aria-label="Film centres on" className="mt-2 flex-row flex-wrap gap-2">
              {ordered.filter((person) => !person.excluded).map((person) => {
                const on = focus.includes(person.personId);
                return (
                  <Pressable key={person.personId} role="checkbox" aria-checked={on} aria-label={`Centre the film on ${(person.name.trim() || person.fallback)}`} onPress={() => toggleFocus(person.personId)} className={`rounded-full px-3 py-1.5 ${on ? "bg-brand" : "bg-surface-sunken"}`}>
                    <Text className={`font-sans-semibold text-xs leading-4 ${on ? "text-white" : "text-ink-soft"}`}>{(person.name.trim() || person.fallback)}</Text>
                  </Pressable>
                );
              })}
            </View>
            {focus.length === 0 && <Text className="mt-1 font-sans text-xs leading-4 text-ink-soft">Nobody picked — we&apos;ll centre on whoever the photos are most about.</Text>}
          </View>
        )}

        {ordered.map((person, index) => {
          const faces = facesOf(person.personId);
          const label = (person.name.trim() || person.fallback);
          return (
            <View key={person.personId} className={`mt-4 rounded-[16px] bg-white p-4 shadow-[0px_1px_1px_rgba(0,0,0,0.05)] ${person.excluded ? "opacity-50" : ""}`}>
              <TextInput
                value={person.name}
                onChangeText={(name) => updatePerson(person.personId, { name })}
                placeholder={person.fallback}
                placeholderTextColor="#a8321266"
                aria-label={`Name person ${index + 1}`}
                className="rounded-[10px] border border-brand-dot bg-surface px-3 py-1.5 font-serif text-[18px] leading-[24px] text-ink"
              />
              <View role="radiogroup" aria-label={`${label}'s role`} className="mt-2 flex-row items-center gap-2">
                {ROLES.map((role) => (
                  <Pressable key={role} role="radio" aria-checked={person.role === role} aria-label={`${label} is ${ROLE_LABEL[role].toLowerCase()}`} onPress={() => updatePerson(person.personId, { role })} className={`rounded-full px-3 py-1 ${person.role === role ? "bg-brand" : "bg-surface-sunken"}`}>
                    <Text className={`font-sans-semibold text-[11px] leading-4 uppercase tracking-[0.5px] ${person.role === role ? "text-white" : "text-ink-soft"}`}>{ROLE_LABEL[role]}</Text>
                  </Pressable>
                ))}
              </View>
              <Text className="mt-3 font-sans text-xs leading-4 text-ink-soft">{`Photos of ${label}. Not them? Tap the photo to move it.`}</Text>
              {cropRow(faces, label)}
              <Pressable role="switch" aria-checked={person.excluded} aria-label={`Leave ${label} out`} onPress={() => updatePerson(person.personId, { excluded: !person.excluded })} className="mt-3 self-start rounded-full bg-surface-muted px-3 py-1.5">
                <Text className="font-sans-semibold text-xs leading-4 text-ink">{person.excluded ? "Bring back into the film" : "Leave out of the film"}</Text>
              </Pressable>
              {person.excluded && <Text className="mt-1 font-sans text-xs leading-4 text-ink-soft">Photos where they&apos;re the main subject won&apos;t be used.</Text>}
            </View>
          );
        })}

        {others.length > 0 && (
          <View className="mt-4 rounded-[16px] bg-white p-4 shadow-[0px_1px_1px_rgba(0,0,0,0.05)]">
            <Text className="font-sans-semibold text-sm leading-5 text-ink">Others in your photos</Text>
            <Text className="mt-0.5 font-sans text-xs leading-4 text-ink-soft">Not in the film unless you add them. Tap one to say who it is.</Text>
            {cropRow(others, "unknown")}
          </View>
        )}
      </ScrollView>

      <View className="absolute inset-x-0 bottom-0 z-20 bg-canvas px-5 pb-2">
        {error && <Text role="alert" className="mb-1 text-center font-sans text-xs leading-4 text-brand">{error}</Text>}
        <Pressable
          role="button"
          aria-label="Looks right"
          disabled={saving || !cast}
          onPress={() => void confirm()}
          className="mt-2 flex-row items-center justify-center rounded-full bg-brand py-3.5 shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)]"
        >
          <Text className="font-sans-semibold text-sm leading-5 text-center text-white">{saving ? "Saving…" : "Looks right"}</Text>
        </Pressable>
        <Pressable role="button" aria-label="Skip" disabled={saving} onPress={() => proceed(planId)} className="mt-1 items-center py-2">
          <Text className="font-sans-medium text-xs leading-4 text-ink-soft">Skip — let Mosaé decide</Text>
        </Pressable>
      </View>
      {movePopup}
    </View>
  );
}
