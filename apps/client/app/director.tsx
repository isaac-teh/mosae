import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChatComposer, ChatHeader, ChatMessage, ChatPersonQuestion, ChatProposal, ChatTyping } from "@/components/chat";
import { Button } from "@/components/ds";
import { useDirectorChat } from "@/lib/useDirectorChat";

export default function DirectorScreen() {
  const params = useLocalSearchParams<{ projectId?: string }>();
  const projectId = params.projectId ?? "";
  const { state, actions, error, retry, pendingInterpret, saving } = useDirectorChat(projectId);
  const router = useRouter();
  const [name, setName] = useState("");
  const [namingPerson, setNamingPerson] = useState<string | null>(null);
  const summary = (state.items.find((item) => item.kind === "mosae") as { text?: string } | undefined)?.text;

  return <View className="flex-1 bg-surface">
    <ChatHeader title="Your story" confirmed={state.confirmed} ready={state.step === "ready"} onBack={() => router.back()} />
    <ScrollView className="flex-1 px-5" contentContainerClassName="gap-5 py-6" keyboardShouldPersistTaps="handled">
      {state.items.map((item) => {
        if (item.kind === "mosae") return <ChatMessage key={item.id} from="mosae" text={item.text} />;
        if (item.kind === "you") return <ChatMessage key={item.id} from="you" text={item.text} />;
        if (item.kind === "typing") return <ChatTyping key={item.id} text={item.text} />;
        if (item.kind === "occasion") return <ChatProposal key={item.id} question="Is that the story?" replies={[{ id: "yes", label: "Yes, that's our story" }]} onReply={() => void actions.confirmOccasion()} />;
        if (item.kind === "person") return <View key={item.id} className="gap-3">
          <ChatPersonQuestion momentCount={item.momentCount} sampleUris={[]} days={item.days} chips={["My daughter", "My wife", "Me", "Type a name"]} onPick={(role) => void actions.setPerson(item.personId, role)} onTypeName={() => setNamingPerson(item.personId)} onSkip={() => void actions.setPerson(item.personId, "Skip")} />
          {namingPerson === item.personId && <View className="flex-row gap-2"><TextInput accessibilityLabel="Person name" value={name} onChangeText={setName} className="min-h-11 flex-1 rounded-md border border-line-strong px-3 font-sans text-ink" /><Pressable role="button" onPress={() => { if (name.trim()) void actions.setPerson(item.personId, "Type a name", name.trim()); setName(""); setNamingPerson(null); }} className="min-h-11 justify-center px-3"><Text className="font-sans-semibold text-action">Save name</Text></Pressable></View>}
          <Button label="Skip for now" variant="quiet" onPress={() => void actions.skipPeople()} />
        </View>;
        if (item.kind === "anyone-else") return <View key={item.id} className="gap-3"><ChatProposal question="Anyone else?" replies={[{ id: "no", label: "No, that's everyone" }]} onReply={() => void actions.skipPeople()} /></View>;
        return null;
      })}
      {state.step === "people" && !state.items.some((item) => item.kind === "person" || item.kind === "anyone-else") && <Button label="Skip for now" variant="quiet" onPress={() => void actions.skipPeople()} />}
      {pendingInterpret && <View className="gap-3"><ChatMessage from="mosae" text={pendingInterpret.reply} /><ChatMessage from="you" text={pendingInterpret.text} /><ChatProposal question="Did I get that right?" replies={[{ id: "confirm", label: "Yes, that's right" }]} onReply={() => actions.confirmInterpret()} /></View>}
      {error && <View className="gap-2"><ChatMessage from="mosae" text={error} /><Pressable role="button" onPress={() => { retry(); if (state.step === "occasion") void actions.confirmOccasion(); }} className="min-h-11 self-start justify-center"><Text className="font-sans-semibold text-action">Try again</Text></Pressable></View>}
    </ScrollView>
    {summary && <ChatComposer placeholder={state.placeholder} confirmed={state.confirmed} disabled={saving} onSend={(text) => void actions.send(text)} />}
  </View>;
}
