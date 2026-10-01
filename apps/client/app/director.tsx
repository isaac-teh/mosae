import { useCallback, useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChatComposer, ChatDirectionCard, ChatHeader, ChatMessage, ChatPersonQuestion, ChatProposal, ChatSetAsideCard, ChatShaping, ChatTyping } from "@/components/chat";
import { FilmPlayer } from "@/components/FilmPlayer";
import { Button } from "@/components/ds";
import { useDirectorChat } from "@/lib/useDirectorChat";
import { useStoryFlow } from "@/lib/storyFlow";
import { EditorPreview } from "@/components/editor/EditorPreview";
import type { Timeline } from "@mosae/contracts";
import { personAnswerChips } from "@mosae/core";

function titleFromSummary(summary: { country: string | null; season: string | null; places: string[] } | null): string {
  if (!summary) return "Your film";
  const season = summary.season?.toLowerCase() ?? "";
  const monthName = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/.exec(season)?.[0];
  const seasonName = /spring|summer|autumn|fall|winter/.exec(season)?.[0]?.replace("fall", "autumn")
    ?? (/(january|february)/.test(season) ? "winter"
      : /march|april|may/.test(season) ? "spring"
        : /june|july|august/.test(season) ? "summer"
          : /september|october|november/.test(season) ? "autumn"
            : /december/.test(season) ? "winter" : null);
  if (summary.country && (monthName || seasonName)) return `${summary.country}, ${monthName ? monthName[0]!.toUpperCase() + monthName.slice(1) : seasonName}`;
  return summary.places[0] || "Your film";
}

export default function DirectorScreen() {
  const params = useLocalSearchParams<{ projectId?: string }>();
  const projectId = params.projectId ?? "";
  const story = useStoryFlow();
  const { state, actions, error, retry, pendingInterpret, saving, summary: projectSummary, plan, directionOptions, directionSelection, people } = useDirectorChat(projectId, story.repository, story.flow);
  const router = useRouter();
  const [name, setName] = useState("");
  const [namingPerson, setNamingPerson] = useState<string | null>(null);
  const [filmTimeline, setFilmTimeline] = useState<{ filmId: string; timeline: Timeline; sources: Record<string, string> } | null>(null);
  const [filmPlayerFailed, setFilmPlayerFailed] = useState(false);
  const filmItem = state.items.find((item) => item.kind === "film");
  const film = filmItem?.kind === "film" ? filmItem.film : null;
  const onFilmPlayerError = useCallback(() => setFilmPlayerFailed(true), []);
  useEffect(() => {
    let active = true;
    setFilmPlayerFailed(false);
    if (!film) { setFilmTimeline(null); return () => { active = false; }; }
    setFilmTimeline(null);
    void story.repository.getFilmTimeline(projectId, film.filmId).then((result) => {
      if (active) setFilmTimeline({ filmId: film.filmId, ...result });
    }).catch(() => { if (active) setFilmPlayerFailed(true); });
    return () => { active = false; };
  }, [film?.filmId, projectId, story.repository]);
  return <View className="flex-1 bg-surface">
    <ChatHeader title={titleFromSummary(projectSummary)} confirmed={state.confirmed} ready={state.step === "ready"} onBack={() => router.back()} />
    <ScrollView accessibilityLabel="Director chat history" className="min-h-0 flex-1 px-5" contentContainerClassName="gap-5 py-6" contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" style={{ flex: 1, minHeight: 0 }}>
      {state.items.map((item) => {
        if (item.kind === "mosae" && item.id === "moments-conflict") return <ChatProposal key={item.id} question={item.text.endsWith("?") ? item.text : `${item.text} What would you like to do?`} replies={[{ id: "keep", label: "Keep it" }, { id: "leave", label: "Leave it out" }]} onReply={(choice) => actions.resolveConflict(choice as "keep" | "leave")} />;
        if (item.kind === "mosae") return <ChatMessage key={item.id} from="mosae" text={item.text} />;
        if (item.kind === "you") return <ChatMessage key={item.id} from="you" text={item.text} />;
        if (item.kind === "typing") return <ChatTyping key={item.id} text={item.text} />;
        if (item.kind === "shaping") return <ChatShaping key={item.id} progress={item.progress} stepsDone={item.stepsDone} />;
        if (item.kind === "set-aside") {
          const blurryLabel = `${item.blurry} blurry ${item.blurry === 1 ? "shot" : "shots"}`;
          const duplicateLabel = `${item.duplicates} near-duplicate${item.duplicates === 1 ? "" : "s"}`;
          const message = `I've set aside ${blurryLabel} and ${duplicateLabel}, keeping the best of each burst. Your originals are untouched.`;
          return <View key={item.id} className="gap-3">
            <ChatMessage from="mosae" text={message} />
            <ChatSetAsideCard blurryCount={item.blurry} blurryPhotos={item.blurryPhotos} blurryMore={item.blurryMore} duplicateCount={item.duplicates} duplicatePhotos={item.duplicatePhotos} duplicateMore={item.duplicateMore} onOpen={actions.seeSetAside} />
            <ChatProposal replies={[{ id: "confirm", label: "Looks fine" }]} onReply={() => void actions.confirmMoments()} />
          </View>;
        }
        if (item.kind === "direction") {
          const focusOptions = [{ id: "family", label: "Whole family" }, ...people.filter((person) => person.name).map((person) => ({ id: person.personId, label: person.name as string }))];
          const focusLabel = focusOptions.find((option) => option.id === item.focus)?.label ?? "Whole family";
          const durationMinutes = item.lengthSec / 60;
          const durationLabel = item.lengthSec < 60 ? `${item.lengthSec} seconds` : `${durationMinutes} ${durationMinutes === 1 ? "minute" : "minutes"}`;
          const maximumDurationSec = directionOptions?.maximumDurationSecByCadence?.[directionSelection.cadenceId] ?? directionOptions?.maximumDurationSec ?? Infinity;
          const durationChoices = directionOptions?.durations.filter(({ seconds }) => seconds <= maximumDurationSec) ?? [];
          const maximumDurationLabel = durationChoices.at(-1)?.label ?? (Number.isFinite(maximumDurationSec) ? `about ${Math.round(maximumDurationSec)} sec` : undefined);
          const focusText = focusLabel === "Whole family" ? "your family moments" : `${focusLabel}'s reactions`;
          const explanation = durationChoices.length === 0 && Number.isFinite(maximumDurationSec)
            ? `These moments can make about ${Math.round(maximumDurationSec)} seconds. Add more photos for a longer film.`
            : item.lengthSec > maximumDurationSec
            ? `With these moments, I can make up to ${maximumDurationLabel ?? "the available length"}. I've selected that achievable length.`
            : `For ${durationLabel}, I'll keep ${focusText} and the strongest scenery, and tell you what I left out.`;
          return <View key={item.id} className="gap-4"><ChatMessage from="mosae" text={`For a ${projectSummary?.days ?? 1}-day trip I'd suggest this. ${directionOptions?.note ?? "Change anything that doesn't feel right."}`} /><ChatDirectionCard pace={item.pace as "gentle" | "lively"} lengthSec={item.lengthSec} durations={durationChoices} maximumDurationLabel={maximumDurationLabel} focus={item.focus} collageAmount={directionSelection.collageAmount} motionFeel={directionSelection.motionFeel} focusOptions={focusOptions} onChange={actions.setDirection} /><ChatMessage from="mosae" text={explanation} /><Button label="Sounds good. Shape it." disabled={saving || !directionOptions || durationChoices.length === 0} onPress={() => void actions.shapeIt()} /></View>;
        }
        if (item.kind === "film") return <View key={item.id} className="gap-4">
          <Text accessibilityRole="header" className="font-title text-heading text-positive">Film ready</Text>
          <ChatMessage from="mosae" text="Here's your first cut. Tap to watch." />
          <View className="aspect-[0.8] overflow-hidden rounded-[23px] bg-ink">
            {filmTimeline?.filmId === item.film.filmId && !filmPlayerFailed
              ? <EditorPreview timeline={filmTimeline.timeline} sources={filmTimeline.sources} poster={item.film.posterKey || undefined} onError={onFilmPlayerError} />
              : filmPlayerFailed && item.film.videoUrl
                ? <FilmPlayer source={item.film.videoUrl} poster={{ uri: item.film.posterKey }} durationSec={item.film.durationSec} aspect="portrait" />
                : item.film.posterKey
                  ? <Image source={{ uri: item.film.posterKey }} resizeMode="cover" className="size-full" />
                  : <View className="flex-1 items-center justify-center"><Text className="font-sans text-body text-on-screen">Loading your film…</Text></View>}
          </View>
          <View className="gap-1"><Text className="font-title text-heading text-ink">{item.film.title}</Text><Text className="font-sans text-caption text-ink-muted">{plan?.chapters.length ?? 0} chapters</Text></View>
          <View className="gap-2"><Text className="font-sans-semibold text-button text-ink">How I directed it</Text>{item.film.reasons.slice(0, 3).map((reason, index) => <Text key={`${item.id}-reason-${index}`} className="font-sans text-body text-ink">• {reason}</Text>)}</View>
          <View className="flex-row gap-2"><Button label="Open in editor" variant="secondary" onPress={() => router.push({ pathname: "/editor", params: { projectId: projectId || "fixture", planId: item.film.planId, generationId: item.film.filmId, request: "", ...story.flow } } as any)} /><Button label={item.film.generationStatus === "saved" ? "Saved" : "Save film"} disabled={saving || item.film.generationStatus === "saved"} onPress={() => void actions.saveFilm()} /></View>
        </View>;
        if (item.kind === "occasion") {
          const country = projectSummary?.country;
          const answer = country ? `Yes, our ${country} trip` : "Yes, that's our story";
          const storyText = country ? `${country} trip` : projectSummary?.places[0] ?? "Our story";
          // The occasion chip is only an available answer until the user has
          // typed a free-text answer; then the confirmation card owns the turn.
          if (saving || pendingInterpret) return null;
          return <Pressable key={item.id} role="button" aria-label={answer} onPress={() => void actions.confirmOccasion(answer, storyText)} className="max-w-[80%] self-end rounded-md bg-bubble-you px-4 py-3"><Text className="font-sans text-body text-ink">{answer}</Text></Pressable>;
        }
        if (item.kind === "person") return <View key={item.id} className="gap-3">
          <ChatPersonQuestion momentCount={item.momentCount} samples={item.sampleFaces} days={item.days} chips={personAnswerChips(item.ageBand, people.filter((person) => person.personId !== item.personId).map((person) => person.name ?? ""))} onPick={(role) => void actions.setPerson(item.personId, role)} onTypeName={() => setNamingPerson(item.personId)} onSkip={() => void actions.setPerson(item.personId, "Skip")} />
          {namingPerson === item.personId && <View className="flex-row gap-2"><TextInput accessibilityLabel="Person name" value={name} onChangeText={setName} className="min-h-11 flex-1 rounded-md border border-line-strong px-3 font-sans text-ink" /><Pressable role="button" onPress={() => { if (name.trim()) void actions.setPerson(item.personId, "Type a name", name.trim()); setName(""); setNamingPerson(null); }} className="min-h-11 justify-center px-3"><Text className="font-sans-semibold text-action">Save name</Text></Pressable></View>}
        </View>;
        if (item.kind === "anyone-else") return <View key={item.id} className="gap-3"><ChatProposal question="Anyone else?" replies={[{ id: "no", label: "No, that's everyone" }]} onReply={() => void actions.skipPeople()} /></View>;
        return null;
      })}
      {state.step === "people" && !state.items.some((item) => item.kind === "person" || item.kind === "anyone-else") && <Button label="Skip for now" variant="quiet" onPress={() => void actions.skipPeople()} />}
      {pendingInterpret && <View className="gap-3"><ChatMessage from="you" text={pendingInterpret.text} /><ChatMessage from="mosae" text={pendingInterpret.reply} /><ChatProposal replies={[{ id: "confirm", label: "Yes, that's right" }, { id: "discard", label: "Not quite" }]} onReply={(choice) => choice === "confirm" ? actions.confirmInterpret() : actions.discardInterpret()} /></View>}
      {error && <View className="gap-2"><ChatMessage from="mosae" text={error} /><Pressable role="button" onPress={() => { retry(); if (state.step === "occasion") void actions.confirmOccasion(); }} className="min-h-11 self-start justify-center"><Text className="font-sans-semibold text-action">Try again</Text></Pressable></View>}
    </ScrollView>
    {projectSummary && <ChatComposer placeholder={state.placeholder} disabled={saving} onSend={(text) => state.step === "ready" ? actions.askForChange(text) : void actions.send(text)} />}
  </View>;
}
