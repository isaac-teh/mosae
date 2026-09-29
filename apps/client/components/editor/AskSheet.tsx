import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { applyEdits, type EditOp, type Timeline } from "@mosae/contracts";
import type { StoryRepository } from "@mosae/core";
import { EditorPreview } from "./EditorPreview";

export function AskSheet({ visible, projectId, generationId, revision, timeline, sources, repository, initialRequest = "", onApply, onClose }: {
  visible: boolean;
  projectId: string;
  generationId: string;
  revision: number;
  timeline: Timeline;
  sources: Record<string, string>;
  repository: Pick<StoryRepository, "interpretEdit">;
  initialRequest?: string;
  onApply: (ops: EditOp[]) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialRequest);
  const [reply, setReply] = useState<string | null>(null);
  const [proposal, setProposal] = useState<EditOp[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const after = useMemo(() => proposal?.length ? applyEdits(timeline, proposal) : null, [timeline, proposal]);

  if (!visible) return null;
  const ask = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    setProposal(null);
    try {
      const result = await repository.interpretEdit(projectId, generationId, text.trim(), revision);
      setReply(result.reply);
      const applied = result.ops.length ? applyEdits(timeline, result.ops) : null;
      setProposal(applied?.ok ? result.ops : []);
    } catch {
      setError("Could not get an edit suggestion. Try again.");
      setReply(null);
    } finally {
      setBusy(false);
    }
  };

  return <View className="absolute inset-0 z-20 justify-end bg-black/55"><ScrollView className="max-h-[92%] rounded-t-[24px] bg-[#111d26] px-5 pb-8 pt-4">
    <View className="mb-4 flex-row items-center justify-between"><Text className="font-sans-semibold text-[18px] text-on-screen">Ask for an edit</Text><Pressable accessibilityLabel="Close Ask" onPress={onClose}><Text className="text-[24px] text-on-screen">×</Text></Pressable></View>
    <TextInput accessibilityLabel="Ask for an edit" value={text} onChangeText={setText} multiline placeholder="What would you like to change?" placeholderTextColor="#9fb1bc" className="mb-3 min-h-20 rounded-lg border border-[#49606d] bg-[#1a2c38] px-4 py-3 font-sans text-body text-on-screen" />
    <Pressable role="button" accessibilityLabel="Suggest edit" disabled={busy || !text.trim()} onPress={() => void ask()} className="mb-4 min-h-12 items-center justify-center rounded-full bg-[#294655]"><Text className="font-sans-semibold text-button text-on-screen">{busy ? "Thinking…" : "Suggest edit"}</Text></Pressable>
    {error ? <Text className="mb-3 font-sans text-caption text-critical">{error}</Text> : null}
    {reply ? <Text className="mb-3 font-sans text-body text-on-screen">{reply}</Text> : null}
    {proposal?.length && after?.ok ? <>
      <View className="mb-3 flex-row gap-3">
        <View className="min-w-0 flex-1"><Text className="mb-1 font-sans-semibold text-caption text-on-screen">Before</Text><View className="h-40 overflow-hidden rounded-lg"><EditorPreview timeline={timeline} sources={sources} /></View></View>
        <View className="min-w-0 flex-1"><Text className="mb-1 font-sans-semibold text-caption text-on-screen">After</Text><View className="h-40 overflow-hidden rounded-lg"><EditorPreview timeline={after.timeline} sources={sources} /></View></View>
      </View>
      <View className="mb-3 rounded-lg bg-[#1a2c38] px-3 py-2"><Text className="font-sans text-caption text-on-screen">{proposal.length} proposed {proposal.length === 1 ? "edit" : "edits"}</Text></View>
      <Pressable role="button" accessibilityLabel="Apply edits" onPress={() => onApply(proposal)} className="mb-2 min-h-12 items-center justify-center rounded-full bg-[#294655]"><Text className="font-sans-semibold text-button text-on-screen">Apply</Text></Pressable>
      <Pressable role="button" accessibilityLabel="Discard edits" onPress={() => { setProposal(null); setReply(null); }} className="mb-3 min-h-12 items-center justify-center"><Text className="font-sans-medium text-button text-on-screen-muted">Discard</Text></Pressable>
    </> : null}
  </ScrollView></View>;
}
