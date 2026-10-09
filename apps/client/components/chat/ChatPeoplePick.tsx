import { Pressable, Text, View } from "react-native";
import { StableUriImage } from "../StableUriImage";
import { Button } from "../ds";

type Person = { personId: string; uri: string; name: string };
type ChatPeoplePickProps = { people: Person[]; selected: string[]; onToggle: (personId: string) => void; onAddName: () => void; onDone: () => void };

export function ChatPeoplePick({ people, selected, onToggle, onAddName, onDone }: ChatPeoplePickProps) {
  return <View className="w-full flex-col gap-4 rounded-md border border-line bg-surface-raised p-4">
    <View className="flex-col gap-1"><Text className="text-heading font-sans-semibold text-ink">Who must be in the film?</Text><Text className="text-label font-sans text-ink-muted">Tap everyone who should appear. Add names to help tell them apart.</Text></View>
    <View className="flex-row flex-wrap gap-x-3 gap-y-4">{people.map((person) => {
      const active = selected.includes(person.personId);
      return <View key={person.personId} className="w-[72px] items-center gap-1">
        <StableUriImage uri={person.uri} accessibilityLabel={person.name} resizeMode="cover" className={`h-[72px] w-[72px] rounded-md ${active ? "border-2 border-action" : ""}`} />
        <Pressable accessibilityRole="checkbox" accessibilityLabel={person.name} accessibilityState={{ selected: active }} role="checkbox" aria-label={person.name} aria-checked={active} onPress={() => onToggle(person.personId)} style={({ pressed }) => ({ opacity: pressed ? 0.8 : undefined, transform: [{ scale: pressed ? 0.97 : 1 }] })} className={`min-h-11 max-w-full justify-center active:scale-[0.97] active:opacity-80 ${active ? "text-ink" : "text-ink-muted"}`}><Text className="truncate text-caption font-sans-medium underline">{person.name}</Text></Pressable>
      </View>;
    })}
    <Pressable accessibilityRole="button" accessibilityLabel="Add name" role="button" aria-label="Add name" onPress={onAddName} style={({ pressed }) => ({ opacity: pressed ? 0.8 : undefined, transform: [{ scale: pressed ? 0.97 : 1 }] })} className="min-h-11 w-[72px] items-center justify-center self-start active:scale-[0.97] active:bg-surface-sunken"><Text className="text-caption font-sans-medium text-ink underline">Add name</Text></Pressable></View>
    <View className="flex-row justify-end"><Button label="Done" onPress={onDone} /></View>
  </View>;
}
