import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { FocusChip } from "../ds";
import { ChatMessage } from "./ChatMessage";
import { ChatTyping } from "./ChatTyping";

type Reply = { id: string; label: string };
type ChatProposalProps = { label?: string; question?: string; detail?: string; replies: Reply[]; onReply: (id: string) => void | Promise<unknown> };

export function ChatProposal({ label, question, detail, replies, onReply }: ChatProposalProps) {
  const locked = useRef(false);
  const [pendingReply, setPendingReply] = useState<Reply | null>(null);
  const reply = (selected: Reply) => {
    if (locked.current) return;
    locked.current = true;
    setPendingReply(selected);
    try {
      void Promise.resolve(onReply(selected.id)).catch(() => {}).finally(() => {
        locked.current = false;
        setPendingReply(null);
      });
    } catch {
      locked.current = false;
      setPendingReply(null);
    }
  };
  return <View className="w-full flex-col gap-3">
    {label ? <Text className="text-caption font-sans-semibold tracking-wider text-ink-muted">{label.toUpperCase()}</Text> : null}
    {question ? <Text className="text-heading font-sans-semibold text-ink">{question}</Text> : null}
    {detail ? <Text className="text-label font-sans text-ink-muted">{detail}</Text> : null}
    {pendingReply ? <><ChatMessage from="you" text={pendingReply.label} /><ChatTyping text="One moment…" /></>
      : <View className="flex-row flex-wrap gap-2">{replies.map((item) => <FocusChip key={item.id} label={item.label} onPress={() => reply(item)} />)}</View>}
  </View>;
}
