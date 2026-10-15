import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import type { AlternativeShot, Moment, StoryRepository, UploadProgress } from "@mosae/core";
import type { EditOp } from "@mosae/contracts";
import { DeviceUploadControl } from "./DeviceUploadControl";
import { MediaGridPicker } from "./MediaGridPicker";

export function SwapSheet({ visible, clipId, planId, momentId, kind = "photo", clipDurationSec = 3, moments = [], sources = {}, personTagsByShot = {}, repository, uploading = false, uploadProgress, uploadError = null, onUploadFile, onApply, onSource, onThumbnail, onDimensions, onClose }: {
  visible: boolean; clipId: string; planId: string | null; momentId: string | null;
  clipDurationSec?: number;
  kind?: "photo" | "video"; moments?: Moment[]; sources?: Record<string, string>;
  personTagsByShot?: Record<string, string[]>;
  uploading?: boolean; uploadProgress?: UploadProgress | null; uploadError?: string | null; onUploadFile?: (file: File) => void;
  repository: StoryRepository; onApply: (op: EditOp) => void; onSource: (shotId: string, path: string) => void; onThumbnail?: (shotId: string, path: string) => void; onDimensions?: (shotId: string, width: number, height: number) => void; onClose: () => void;
}) {
  const [result, setResult] = useState<{ key: string; shots: AlternativeShot[]; error: string | null } | null>(null);
  const key = `${planId ?? ""}/${momentId ?? ""}`;
  useEffect(() => {
    let active = true;
    if (!visible || !planId || !momentId) return () => { active = false; };
    void repository.getAlternatives(planId, momentId).then((shots) => { if (active) setResult({ key, shots, error: null }); })
      .catch((cause: unknown) => { if (active) setResult({ key, shots: [], error: cause instanceof Error ? cause.message : "Could not load alternatives" }); });
    return () => { active = false; };
  }, [visible, planId, momentId, repository, key]);
  if (!visible) return null;
  const shots = (result?.key === key ? result.shots : []).filter((shot) => (!shot.kind || shot.kind === kind) && (shot.kind !== "video" || moments.some((moment) => moment.shotId === shot.shotId && moment.kind === "video")));
  const error = result?.key === key ? result.error : null;
  const libraryMoments = moments.filter((moment) => moment.shotId);
  const libraryShotIds = new Set(libraryMoments.map(moment => moment.shotId));
  const alternativeMoments: Moment[] = shots.filter(shot => !libraryShotIds.has(shot.shotId) && shot.thumbnailUrl && (!shot.kind || shot.kind === "photo")).map(shot => ({
    id: `alternative-${shot.shotId}`, shotId: shot.shotId, title: "Alternative photo", meta: "From this moment",
    tag: { emoji: "📷", label: "Photo" }, imageKey: shot.thumbnailUrl, kind: "photo", selected: false, favorite: false,
  }));
  const choices = [...libraryMoments, ...alternativeMoments];
  const applyMoment = (moment: Moment) => {
    const shotId = moment.shotId!;
    const preview = sources[shotId] ?? (moment.kind === "photo" ? moment.imageKey : "");
    if (!preview) return;
    onSource(shotId, preview);
    onThumbnail?.(shotId, moment.imageKey);
    if (moment.width !== undefined && moment.height !== undefined) onDimensions?.(shotId, moment.width, moment.height);
    if (moment.kind === "video") {
      const rangeStart = Math.max(0, moment.sourceInSec ?? 0);
      const rangeEnd = Math.max(rangeStart, moment.sourceOutSec ?? moment.sourceDurationSec ?? rangeStart + clipDurationSec);
      const length = Math.min(clipDurationSec, rangeEnd - rangeStart);
      if (!(length > 0)) return;
      const sourceInSec = rangeStart + Math.max(0, (rangeEnd - rangeStart - length) / 2);
      const sourceOutSec = sourceInSec + length;
      onApply({ op: "swapShot", clipId, shotId, kind: "video", sourceInSec, sourceOutSec, durationSec: length, ...(moment.sourceDurationSec !== undefined ? { sourceDurationSec: moment.sourceDurationSec } : {}), ...(moment.width !== undefined ? { width: moment.width } : {}), ...(moment.height !== undefined ? { height: moment.height } : {}), sourceStartSec: rangeStart, sourceEndSec: rangeEnd });
    } else {
      onApply({ op: "swapShot", clipId, shotId, kind: "photo", ...(moment.width !== undefined ? { width: moment.width } : {}), ...(moment.height !== undefined ? { height: moment.height } : {}) });
    }
    onClose();
  };
  return <View className="absolute inset-0 z-20 justify-end bg-black/55">
    <View className="max-h-[72%] rounded-t-[24px] bg-[#111d26] px-5 pb-8 pt-4">
      <View className="mb-4 flex-row items-center justify-between"><Text className="font-sans-semibold text-[18px] text-on-screen">Replace moment</Text><Pressable accessibilityLabel="Close swap" onPress={onClose}><Text className="text-[24px] text-on-screen">×</Text></Pressable></View>
      {Platform.OS === "web" && onUploadFile ? <DeviceUploadControl uploading={uploading} uploadProgress={uploadProgress} uploadError={uploadError} onFiles={(files) => { if (files[0]) onUploadFile(files[0]); }} /> : null}
      {error ? <Text className="font-sans text-caption text-on-screen">{error}</Text> : null}
      {choices.length > 0 ? <><Text className="mb-2 mt-2 font-sans-medium text-caption text-on-screen-muted">Project photos</Text><MediaGridPicker moments={choices} labelFor={(moment) => `Replace with ${moment.title}`} tagsFor={(moment) => moment.shotId ? personTagsByShot[moment.shotId] ?? [] : []} disabled={(moment) => moment.kind === "video" && !sources[moment.shotId!]} onSelect={applyMoment} /></> : <Text className="mt-3 font-sans text-caption text-on-screen-muted">No project photos are available. Upload a photo from your phone.</Text>}
    </View>
  </View>;
}
