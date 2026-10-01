import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import type { AlternativeShot, StoryRepository } from "@mosae/core";
import type { EditOp } from "@mosae/contracts";
import { Asset } from "expo-asset";
import { demoImage } from "@/lib/demoAssets";

function uri(value: string) { return value.startsWith("demo:") ? Asset.fromModule(demoImage(value.slice(5))).uri : value; }

export function SwapSheet({ visible, clipId, planId, momentId, repository, onApply, onSource, onClose }: {
  visible: boolean; clipId: string; planId: string | null; momentId: string | null;
  repository: StoryRepository; onApply: (op: EditOp) => void; onSource: (shotId: string, path: string) => void; onClose: () => void;
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
  const shots = result?.key === key ? result.shots : [];
  const error = result?.key === key ? result.error : null;
  return <View className="absolute inset-0 z-20 justify-end bg-black/55">
    <View className="max-h-[72%] rounded-t-[24px] bg-[#111d26] px-5 pb-8 pt-4">
      <View className="mb-4 flex-row items-center justify-between"><Text className="font-sans-semibold text-[18px] text-on-screen">Replace moment</Text><Pressable accessibilityLabel="Close swap" onPress={onClose}><Text className="text-[24px] text-on-screen">×</Text></Pressable></View>
      {error ? <Text className="font-sans text-caption text-on-screen">{error}</Text> : shots.length === 0 ? <Text className="font-sans text-caption text-on-screen-muted">No alternatives from this moment yet.</Text> : <ScrollView className="max-h-[420px]">
        {shots.map((shot) => <Pressable key={shot.shotId} role="button" accessibilityLabel={`Use alternative ${shot.shotId}`} onPress={() => { onSource(shot.shotId, shot.thumbnailUrl); onApply({ op: "swapShot", clipId, shotId: shot.shotId }); onClose(); }} className="mb-2 h-[74px] flex-row items-center gap-3 rounded-xl bg-[#1a2c38] p-2">
          {shot.thumbnailUrl ? <Image source={{ uri: uri(shot.thumbnailUrl) }} resizeMode="cover" className="size-[58px] rounded-md" /> : <View className="size-[58px] rounded-md bg-tide-tile" />}
          <Text className="font-sans text-button text-on-screen">Use this moment</Text>
        </Pressable>)}
      </ScrollView>}
    </View>
  </View>;
}
