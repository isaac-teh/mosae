import { Text, View } from "react-native";
import { FocusChip } from "../ds";

type Reply = { id: string; label: string };
type ChatProposalProps = { label?: string; question: string; detail?: string; replies: Reply[]; onReply: (id: string) => void };

export function ChatProposal({ label, question, detail, replies, onReply }: ChatProposalProps) {
  return <View className="w-full flex-col gap-3 rounded-md border border-line bg-surface-raised p-4">
    {label ? <Text className="text-caption font-sans-semibold tracking-wider text-ink-muted">{label.toUpperCase()}</Text> : null}
    <Text className="text-heading font-sans-semibold text-ink">{question}</Text>
    {detail ? <Text className="text-label font-sans text-ink-muted">{detail}</Text> : null}
    <View className="flex-row flex-wrap gap-2">{replies.map((reply) => <FocusChip key={reply.id} label={reply.label} onPress={() => onReply(reply.id)} />)}</View>
  </View>;
}
