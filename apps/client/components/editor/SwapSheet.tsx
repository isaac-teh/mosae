import { useEffect, useState } from "react";
import { Image, Platform, Pressable, ScrollView, Text, View } from "react-native";
import type { AlternativeShot, Moment, StoryRepository, UploadProgress } from "@mosae/core";
import type { EditOp } from "@mosae/contracts";
import { Asset } from "expo-asset";
import { demoImage } from "@/lib/demoAssets";
import { DeviceUploadControl } from "./DeviceUploadControl";

function uri(value: string) { return value.startsWith("demo:") ? Asset.fromModule(demoImage(value.slice(5))).uri : value; }

export function SwapSheet({ visible, clipId, planId, momentId, kind = "photo", clipDurationSec = 3, moments = [], sources = {}, repository, uploading = false, uploadProgress, uploadError = null, onUploadFile, onApply, onSource, onThumbnail, onDimensions, onClose }: {
  visible: boolean; clipId: string; planId: string | null; momentId: string | null;
  clipDurationSec?: number;
  kind?: "photo" | "video"; moments?: Moment[]; sources?: Record<string, string>;
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
      {libraryMoments.length > 0 ? <><Text className="mb-2 mt-2 font-sans-medium text-caption text-on-screen-muted">Other project media</Text><ScrollView className="max-h-[210px]">
        {libraryMoments.map((moment) => { const thumbnail = uri(moment.imageKey); const playable = moment.kind !== "video" || Boolean(sources[moment.shotId!]); return <Pressable key={moment.id} role="button" disabled={!playable} accessibilityLabel={`Replace with ${moment.title}`} onPress={() => applyMoment(moment)} className="mb-2 h-[68px] flex-row items-center gap-3 rounded-xl bg-[#1a2c38] p-2">
          <Image source={{ uri: thumbnail }} resizeMode="cover" className="size-[52px] rounded-md" />
          <View className="min-w-0 flex-1"><Text numberOfLines={1} className="font-sans text-button text-on-screen">{moment.title}</Text><Text numberOfLines={1} className="font-sans text-caption text-on-screen-muted">{moment.meta}</Text></View>
        </Pressable>; })}
      </ScrollView></> : null}
      {shots.length === 0 && libraryMoments.length === 0 ? <Text className="mt-3 font-sans text-caption text-on-screen-muted">No alternatives from this moment yet.</Text> : null}
      {shots.length > 0 ? <ScrollView className="max-h-[210px]">
        {shots.map((shot) => <Pressable key={shot.shotId} role="button" accessibilityLabel={`Use alternative ${shot.shotId}`} onPress={() => { const media = libraryMoments.find((moment) => moment.shotId === shot.shotId); if (media) { applyMoment(media); return; } onSource(shot.shotId, shot.thumbnailUrl); onThumbnail?.(shot.shotId, shot.thumbnailUrl); onApply({ op: "swapShot", clipId, shotId: shot.shotId }); onClose(); }} className="mb-2 h-[68px] flex-row items-center gap-3 rounded-xl bg-[#1a2c38] p-2">
          {shot.thumbnailUrl ? <Image source={{ uri: uri(shot.thumbnailUrl) }} resizeMode="cover" className="size-[52px] rounded-md" /> : <View className="size-[52px] rounded-md bg-tide-tile" />}
          <Text className="font-sans text-button text-on-screen">Use this moment</Text>
        </Pressable>)}
      </ScrollView> : null}
    </View>
  </View>;
}
