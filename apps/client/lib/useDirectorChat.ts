import { useCallback, useEffect, useRef, useState } from "react";
import { deriveChat, getStoryRepository, type ChatInput, type ChatState, type ProjectSummary } from "@mosae/core";
import type { DirectorPerson } from "@mosae/core/src/story/repository";
import { confirmCast } from "./characters";

const EMPTY_INPUT: ChatInput = { summary: null, intent: null, people: null, peopleConfirmed: false, plan: null, momentsConfirmed: false, conflict: null, direction: null, generation: null, notes: [] };
const UNCLEAR = "I didn't catch that. Pick one below, or say it another way.";

export function useDirectorChat(projectId: string) {
  const [input, setInput] = useState<ChatInput>(EMPTY_INPUT);
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingInterpret, setPendingInterpret] = useState<{ reply: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const proposalId = useRef<string | null>(null);
  const planLoad = useRef(false);
  const peopleEdits = useRef(new Map<string, { name: string | null; role: string | null; skipped: boolean }>());
  const skipPeopleForNow = useRef(false);
  const mounted = useRef(true);
  const repository = getStoryRepository();
  const state: ChatState = deriveChat(input);

  const refresh = useCallback(async () => {
    const [nextSummary, people] = await Promise.all([repository.getSummary(projectId), repository.getPeople(projectId)]);
    if (!mounted.current) return;
    setSummary(nextSummary);
    const mapped = people.map((person: DirectorPerson) => {
      const edit = peopleEdits.current.get(person.personId);
      return { ...person, ...(edit ?? (skipPeopleForNow.current ? { name: "Family", role: "parent", skipped: false } : { skipped: false })) };
    });
    setInput((current) => ({ ...current, summary: nextSummary, people: nextSummary.ready.faces ? mapped : null, peopleConfirmed: nextSummary.ready.faces && (skipPeopleForNow.current || mapped.length === 0) }));
    if (proposalId.current && nextSummary.ready.plan && !planLoad.current) {
      planLoad.current = true;
      try {
        const plan = await repository.getPlan(proposalId.current);
        if (mounted.current) setInput((current) => ({ ...current, plan }));
      } finally { planLoad.current = false; }
    }
  }, [projectId, repository]);

  useEffect(() => {
    mounted.current = true;
    void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : "Couldn't load this project."));
    const timer = setInterval(() => { void refresh().catch(() => {}); }, 3000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [refresh]);

  const actions = {
    async confirmOccasion(text?: string) {
      if (saving) return;
      setSaving(true); setError(null);
      const storyText = text ?? pendingInterpret?.text ?? summary?.places.join(", ") ?? "Our story";
      try {
        const result = await repository.createPlan(storyText, []);
        proposalId.current = result.planId;
        setInput((current) => ({ ...current, intent: { text: storyText } }));
        setPendingInterpret(null);
        await refresh();
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't save this. Please try again."); }
      finally { setSaving(false); }
    },
    async setPerson(personId: string, role: string, name?: string) {
      const people = input.people ?? [];
      const roleValue = role === "My daughter" || role === "My son" ? "child" : role === "Skip" ? "other" : "parent";
      const personName = name ?? (role === "Skip" ? undefined : role);
      peopleEdits.current.set(personId, { name: role === "Skip" ? null : personName ?? null, role: roleValue, skipped: role === "Skip" });
      const updated = people.map((person) => person.personId === personId ? { ...person, role: roleValue, name: personName ?? null, skipped: role === "Skip" } : person);
      try {
        await confirmCast(projectId, { people: updated.map((person) => ({ personId: person.personId, role: person.role as "child" | "parent" | "other", name: person.name ?? undefined, excluded: person.skipped })), focus: [], ...(proposalId.current ? { proposalId: proposalId.current } : {}) });
        setInput((current) => ({ ...current, people: updated, peopleConfirmed: updated.every((person) => person.name || person.role || person.skipped) }));
        setError(null);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't save this. Please try again."); }
    },
    async skipPeople() {
      skipPeopleForNow.current = true;
      const people = (input.people ?? []).map((person) => ({ ...person, skipped: true }));
      try {
        await confirmCast(projectId, { people: people.map((person) => ({ personId: person.personId, role: "other" as const, excluded: false })), focus: [], ...(proposalId.current ? { proposalId: proposalId.current } : {}) });
        setInput((current) => ({ ...current, people, peopleConfirmed: true })); setError(null);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't save this. Please try again."); }
    },
    async send(text: string) {
      if (!summary) return;
      try {
        const result = await repository.interpret(projectId, { step: state.step === "people" ? "people" : "occasion", text, context: { summary, people: (input.people ?? []).map(({ personId, name, role }) => ({ personId, name, role })) } });
        if (result.change.kind === "unclear") { setPendingInterpret({ reply: result.reply || UNCLEAR, text }); return; }
        setPendingInterpret({ reply: result.reply, text });
      } catch { setPendingInterpret({ reply: UNCLEAR, text }); }
    },
    confirmInterpret() { if (pendingInterpret) void actions.confirmOccasion(pendingInterpret.text); },
  };
  return { state, actions, error, retry: () => { setError(null); void refresh(); }, pendingInterpret, saving };
}
