import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { EditOp } from "@mosae/contracts";
import type { EditScope, StoryRepository } from "@mosae/core";
import { useAiEdits } from "@/lib/useAiEdits";
import { suggestedAskRequests } from "@mosae/core";

export function AskSheet({ visible, projectId, generationId, repository, scope, initialRequest = "", people = [], aspect = "9:16", savePending, getSnapshotKey, getSavedRevision, applyMany, undo, onPlayAt, onApplied, onReplace, onClose }: {
  visible: boolean;
  projectId: string;
  generationId: string;
  repository: Pick<StoryRepository, "interpretEdit" | "getEditConversation" | "acknowledgeEditInterpretation">;
  scope: EditScope;
  initialRequest?: string;
  savePending: () => Promise<boolean>;
  getSnapshotKey: () => string;
  getSavedRevision: () => number;
  applyMany: (ops: EditOp[]) => boolean;
  undo: () => void;
  onPlayAt: (ops: EditOp[]) => void;
  people?: string[];
  aspect?: "9:16" | "16:9";
  onApplied?: (ops: EditOp[], reply: string, requestText: string, scope: EditScope) => void;
  onReplace?: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialRequest);
  const { messages, busy, error, submit, cancel, undoableRequestId, undoAiEdit } = useAiEdits({ projectId, generationId, repository,
    savePending, getSnapshotKey, getSavedRevision, applyMany, undo, onPlayAt, onApplied });
  const scopeLabel = useMemo(() => scope.kind === "film" ? "Whole film" : scope.kind === "slot" ? "Selected collage photo" : "Selected clip", [scope]);
  useEffect(() => { setText(initialRequest); }, [initialRequest]);

  if (!visible) return null;
  const ask = () => void submit(text, scope);
  const suggestions = suggestedAskRequests(scope.kind, people, aspect);
  const lastApplied = undoableRequestId ? [...messages].reverse().find((message) => message.requestId === undoableRequestId && message.status === "applied" && message.ops?.length) : undefined;

  return <View className="absolute inset-0 z-20 justify-end bg-black/55"><ScrollView className="max-h-[92%] rounded-t-[24px] bg-[#111d26] px-5 pb-8 pt-4">
    <View className="mb-4 flex-row items-center justify-between"><Text className="font-sans-semibold text-[18px] text-on-screen">Ask for an edit</Text><Pressable accessibilityLabel="Close Ask" onPress={() => { cancel(); onClose(); }}><Text className="text-[24px] text-on-screen">×</Text></Pressable></View>
    <Text accessibilityLabel="Edit scope" className="mb-2 font-sans text-caption text-on-screen-muted">{scopeLabel}</Text>
    {messages.map((message) => <View key={message.requestId} className="mb-3 rounded-lg bg-[#1a2c38] px-3 py-2"><Text className="mb-1 font-sans-medium text-caption text-on-screen">{message.text}</Text><Text className="font-sans text-body text-on-screen">{message.reply}</Text></View>)}
    {!busy ? <View className="mb-3 flex-row flex-wrap gap-2">{suggestions.map((suggestion) => <Pressable key={suggestion} role="button" accessibilityLabel={suggestion} onPress={() => { if (suggestion === "Replace this photo") { onReplace?.(); return; } setText(suggestion); void submit(suggestion, scope); }} className="min-h-9 justify-center rounded-full border border-[#49606d] px-3"><Text className="font-sans text-caption text-on-screen">{suggestion}</Text></Pressable>)}</View> : null}
    <TextInput accessibilityLabel="Ask for an edit" value={text} onChangeText={setText} multiline placeholder="Tell me what you want to change." placeholderTextColor="#9fb1bc" className="mb-3 min-h-20 rounded-lg border border-[#49606d] bg-[#1a2c38] px-4 py-3 font-sans text-body text-on-screen" />
    <Pressable role="button" accessibilityLabel="Suggest edit" disabled={busy || !text.trim()} onPress={ask} className="mb-4 min-h-12 items-center justify-center rounded-full bg-[#294655]"><Text className="font-sans-semibold text-button text-on-screen">{busy ? "Thinking…" : "Apply edit"}</Text></Pressable>
    {error ? <Text className="mb-3 font-sans text-caption text-critical">{error}</Text> : null}
    {lastApplied ? <View className="flex-row gap-3"><Pressable role="button" accessibilityLabel="Play AI edit" onPress={() => onPlayAt(lastApplied.ops!)} className="mb-3 min-h-11 items-center justify-center rounded-full bg-[#294655] px-5"><Text className="font-sans-medium text-button text-on-screen">Play</Text></Pressable><Pressable role="button" accessibilityLabel="Undo AI edit" onPress={undoAiEdit} className="mb-3 min-h-11 items-center justify-center rounded-full border border-[#49606d] px-5"><Text className="font-sans-medium text-button text-on-screen">Undo</Text></Pressable></View> : null}
  </ScrollView></View>;
}
