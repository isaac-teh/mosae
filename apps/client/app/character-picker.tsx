// Figma: "Character Picker" (Step 3) — assign a name + role to every photo-face crop.
import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Href } from "expo-router";
import { useStepBack } from "@/lib/useStepBack";
import { useStoryFlow } from "@/lib/storyFlow";
import { PrimaryButton } from "@/components/PrimaryButton";
import { StepHeader } from "@/components/StepHeader";
import { type FaceAssignment, type ProjectCharacters, assignCharacter, getAssetThumbnailUrl, getProjectCharacters, setFocusCharacters } from "@/lib/characters";

type Role = "MAIN" | "SUPPORTING";

/** Side of the square window a face crop is shown in. */
const CROP_PX = 72;

/**
 * Shows one face by scaling its shot's image so the stored box fills a fixed
 * square, then offsetting it so the box lands in view. Cropping this way needs
 * no server-side face images: the thumbnail the app already signs is enough.
 */
function FaceCrop({ url, bbox }: { url?: string; bbox?: [number, number, number, number] }) {
  if (!url || !bbox) return <View style={{ width: CROP_PX, height: CROP_PX }} className="rounded-[10px] bg-surface-sunken" />;
  const [ymin, xmin, ymax, xmax] = bbox;
  // Pad the box outward so the crop reads as a portrait, not a tight mask.
  const pad = 0.6;
  const halfW = Math.max((xmax - xmin) * (1 + pad), 0.02) / 2;
  const halfH = Math.max((ymax - ymin) * (1 + pad), 0.02) / 2;
  const half = Math.max(halfW, halfH);
  const cx = (xmin + xmax) / 2;
  const cy = (ymin + ymax) / 2;
  // The full image must be this many px wide for the 2*half slice to fill CROP_PX.
  const scaled = CROP_PX / (2 * half);
  return (
    <View style={{ width: CROP_PX, height: CROP_PX, overflow: "hidden" }} className="rounded-[10px] bg-surface-sunken">
      <Image
        source={{ uri: url }}
        accessibilityIgnoresInvertColors
        style={{
          width: scaled,
          height: scaled,
          marginLeft: -(cx * scaled - CROP_PX / 2),
          marginTop: -(cy * scaled - CROP_PX / 2),
        }}
      />
    </View>
  );
}

function ErrorState({ error, retry }: { error: string; retry: () => void }) {
  return <View className="flex-1 items-center justify-center bg-canvas"><Text role="alert" className="text-brand text-sm">{error}</Text><Pressable role="button" aria-label="Retry" onPress={retry} className="mt-4 rounded-full bg-brand px-5 py-3"><Text className="font-sans-semibold text-white">Retry</Text></Pressable></View>;
}

export default function CharacterPickerScreen() {
  const router = useRouter();
  const { planId, projectId } = useLocalSearchParams<{ planId?: string; projectId?: string }>();
  const { route } = useStoryFlow();
  const goBack = useStepBack(route("/tell-story") as Href);

  const [characters, setCharacters] = useState<ProjectCharacters | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingFaceId, setSavingFaceId] = useState<string | null>(null);
  // Signed thumbnail per asset, fetched once and shared by that shot's crops.
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [continuing, setContinuing] = useState(false);
  // Inline editor state for the face being assigned.
  const [editingFace, setEditingFace] = useState<{ shotId: string; face: FaceAssignment } | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftRole, setDraftRole] = useState<Role | undefined>();
  // Guards against surfacing an error from a stale load after navigation.
  const hasLoaded = useRef(false);

  const load = useCallback(() => {
    if (!projectId) return;
    const activeProjectId = projectId;
    void getProjectCharacters(activeProjectId).then((value) => {
      setCharacters(value);
      setError(null);
      hasLoaded.current = true;
    }).catch((cause: Error) => {
      if (!hasLoaded.current) setError(cause.message);
    });
  }, [projectId]);

  useEffect(() => { if (projectId) load(); }, [projectId, load]);

  // Sign each shot's image once the grid is known. A thumbnail that will not
  // sign leaves that crop as a blank tile rather than failing the screen.
  // `requested` is a ref, not state: keying this effect on the thumbnails it
  // writes would restart it on every arrival and refetch the whole grid.
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

  const openEditor = (shotId: string, face: FaceAssignment) => {
    setError(null);
    setEditingFace({ shotId, face });
    setDraftName(face.name ?? "");
    // The read route sends null for an unassigned face; posting that null back
    // is not a role the write route accepts, so normalise it away here.
    setDraftRole(face.role ?? undefined);
  };
  const closeEditor = () => setEditingFace(null);

  const saveAssignment = async (shotId: string, face: FaceAssignment) => {
    if (!draftName.trim()) return;
    if (!projectId) return;
    const activeProjectId = projectId;
    setSavingFaceId(face.faceId);
    try {
      await assignCharacter(activeProjectId, shotId, { faceId: face.faceId, name: draftName.trim(), role: draftRole });
      closeEditor();
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save this character");
    } finally {
      setSavingFaceId(null);
    }
  };

  if (error && !characters) return <ErrorState error={error} retry={load} />;

  const assignedCount = characters?.shots.reduce((total, shot) => total + shot.faces.filter((face) => face.name).length, 0) ?? 0;
  const totalFaces = characters?.shots.reduce((total, shot) => total + shot.faces.length, 0) ?? 0;

  /** Distinct characters marked MAIN — what the film should be built around. */
  const mainCharacterIds = [...new Set(
    (characters?.shots ?? []).flatMap((shot) =>
      shot.faces.filter((face) => face.role === "MAIN" && face.characterId).map((face) => face.characterId as string)),
  )];

  const goForward = async () => {
    const next = route("/review-moments", { planId }) as never;
    // Without a plan to revise there is nothing to focus; just move on.
    if (!projectId || !planId || mainCharacterIds.length === 0) { router.navigate(next); return; }
    setContinuing(true);
    try {
      // Recording the focus revises the proposal, so the next screen must be
      // shown the version that came back — not the one we started from.
      const revisedPlanId = await setFocusCharacters(projectId, planId, mainCharacterIds);
      router.navigate(route("/review-moments", { planId: revisedPlanId }) as never);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save your main characters");
    } finally {
      setContinuing(false);
    }
  };

  return (
    <View className="flex-1 bg-canvas">
      <StepHeader step="CHARACTERS" label="OPTIONAL" progress={0.5} onBack={() => goBack()} backLabel="Go back to your story" />
      <ScrollView className="flex-1" contentContainerClassName="px-5 pb-[112px] pt-4" keyboardShouldPersistTaps="handled">
        <View className="mt-1">
          <Text className="font-serif text-[26px] leading-[32.5px] tracking-[-0.65px] text-ink">Who&apos;s in your film?</Text>
          <Text className="mt-1 font-sans text-sm leading-[22px] text-ink-soft">Name each face to say which crops are the same person. Give two crops the{` `}<Text className="font-sans-semibold text-brand">same name</Text>{` `}to merge them into one character.</Text>
        </View>

        {totalFaces === 0 ? (
          <View className="mt-5 rounded-[16px] bg-white p-6 shadow-[0px_1px_1px_rgba(0,0,0,0.05)]">
            <Text className="font-sans text-sm leading-[20px] text-ink-soft">No faces were detected in your photos yet. Upload more memories and we&apos;ll show their crops here.</Text>
          </View>
        ) : (
          <View className="mt-5">
            {characters!.shots.map((shot, shotIndex) => (
              <View key={shot.shotId} className="mb-5">
                <Text className="font-sans-semibold text-xs leading-4 uppercase tracking-[0.5px] text-ink-soft">Shot {shotIndex + 1}</Text>
                <View className="mt-2 flex-row flex-wrap gap-2">
                  {shot.faces.map((face, faceIndex) => (
                    <Pressable
                      key={face.faceId}
                      role="button"
                      aria-label={face.name ? `Change character for shot ${shotIndex + 1}, face ${faceIndex + 1}` : `Add a person to shot ${shotIndex + 1}, face ${faceIndex + 1}`}
                      onPress={() => openEditor(shot.shotId, face)}
                      className={`w-[48%] rounded-[16px] bg-white p-3 shadow-[0px_1px_1px_rgba(0,0,0,0.05)]`}
                    >
                      <FaceCrop url={thumbnails[shot.assetId]} bbox={face.bbox} />
                      <Text className="mt-2 font-sans text-[10px] leading-3 text-ink-soft">Shot {shotIndex + 1}</Text>
                      {face.name ? (
                        <>
                          <Text className="mt-1 font-serif text-[15px] leading-[20px] text-ink">{face.name}</Text>
                          <Text className="mt-0.5 font-sans-semibold text-[10px] leading-3 uppercase tracking-[0.5px] text-brand">{face.role ?? "Unassigned"}</Text>
                        </>
                      ) : (
                        <Text className="mt-1 font-sans-medium text-sm leading-4 text-ink-soft">+ Add person</Text>
                      )}
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}

        {editingFace && (
          <View className="mt-4 rounded-[16px] bg-white p-4 shadow-[0px_1px_1px_rgba(0,0,0,0.05)]">
            <Text className="font-sans-semibold text-sm leading-5 text-ink">Name this person</Text>
            <TextInput
              value={draftName}
              onChangeText={setDraftName}
              placeholder="e.g. Grandpa"
              placeholderTextColor="#a8321266"
              autoFocus
              className="mt-2 rounded-full border border-brand-dot bg-surface px-3 py-2 font-sans text-sm leading-[20px] text-ink"
            />
            <Text className="mt-3 font-sans text-xs leading-4 text-ink-soft">Give the same name to crops of the same person so they merge into one character.</Text>
            {/* A save that fails once the grid is on screen has nowhere else to
                show: the full-screen error state only covers a failed load. */}
            {error && <Text role="alert" className="mt-2 font-sans text-xs leading-4 text-brand">{error}</Text>}
            <View role="radiogroup" aria-label="Character role" className="mt-2 flex-row items-center gap-2">
              {(["MAIN", "SUPPORTING"] as Role[]).map((role) => (
                <Pressable
                  key={role}
                  role="radio"
                  aria-checked={draftRole === role}
                  aria-label={`Set role to ${role}`}
                  onPress={() => setDraftRole(role)}
                  className={`rounded-full px-3 py-1.5 ${draftRole === role ? "bg-brand" : "bg-surface-sunken"}`}
                >
                  <Text className={`font-sans-semibold text-xs leading-4 uppercase tracking-[0.5px] ${draftRole === role ? "text-white" : "text-ink-soft"}`}>{role}</Text>
                </Pressable>
              ))}
            </View>
            <View className="mt-4 flex-row gap-2">
              <Pressable
                onPress={closeEditor}
                role="button"
                aria-label="Cancel editing character"
                className="flex-1 items-center justify-center rounded-full bg-surface-muted py-3"
              >
                <Text className="font-sans-semibold text-sm leading-5 text-ink">Cancel</Text>
              </Pressable>
              <PrimaryButton
                label="Save"
                compact
                disabled={!draftName.trim() || savingFaceId === editingFace.face.faceId}
                busy={savingFaceId === editingFace.face.faceId}
                busyLabel="Saving…"
                onPress={() => void saveAssignment(editingFace.shotId, editingFace.face)}
              />
            </View>
          </View>
        )}
      </ScrollView>

      <View className="absolute inset-x-0 bottom-0 z-20 bg-canvas px-5">
        {/* A failure while continuing happens with the editor closed, so it
            needs somewhere to show that is not inside the editor card. */}
        {error && !editingFace && <Text role="alert" className="mb-1 text-center font-sans text-xs leading-4 text-brand">{error}</Text>}
        <Pressable
          role="button"
          aria-label={assignedCount === 0 ? "Assign a person to continue" : `Continue to ${totalFaces - assignedCount} unassigned faces`}
          disabled={assignedCount === 0 || continuing}
          onPress={() => void goForward()}
          className="mt-2 flex-row items-center justify-center rounded-full bg-brand py-3.5 shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)]"
        >
          <Text className="font-sans-semibold text-sm leading-5 text-center text-white">
            {continuing ? "Saving your characters…" : assignedCount === 0 ? "Assign a person to continue" : `Continue (${totalFaces - assignedCount} unassigned)`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
