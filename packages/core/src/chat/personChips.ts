export type PersonAgeBand = "child" | "teen" | "adult" | "senior";

/** People shown in the director flow: foreground clusters matching the existing 2-shot threshold or 10% of photos. */
export function mainPeople<T extends { personId: string; momentCount: number; backgroundOnly?: boolean }>(clusters: readonly T[], shotCount: number): T[] {
  return clusters
    .filter((person) => !person.backgroundOnly && (person.momentCount >= 2 || (shotCount > 0 && person.momentCount / shotCount >= 0.1)))
    .sort((a, b) => b.momentCount - a.momentCount)
    .slice(0, 5);
}

const ANSWERS: Record<PersonAgeBand, string[]> = {
  child: ["My son", "My daughter", "Friend", "Type a name"],
  teen: ["My son", "My daughter", "Friend", "Type a name"],
  adult: ["Me", "My partner", "Friend", "Type a name"],
  senior: ["My mum", "My dad", "Friend", "Type a name"],
};

/** Answer suggestions for one face group; relationship and family labels may repeat. */
export function personAnswerChips(ageBand: PersonAgeBand | null | undefined, assignedAnswers: readonly string[] = []): string[] {
  const answers = ageBand ? [...ANSWERS[ageBand]] : ["Me", "Family", "Friend", "Type a name"];
  void assignedAnswers;
  return answers;
}

export function matchExistingPersonAnswer(answer: string, people: readonly { personId: string; name: string | null }[]): { personId: string; mode: "automatic" | "confirm"; answer: string } | null {
  const normalized = answer.trim().replace(/^my\s+/i, "").toLocaleLowerCase();
  if (!normalized || /^(friend|family)$/.test(normalized)) return null;
  const match = people.find((person) => person.name?.trim().replace(/^my\s+/i, "").toLocaleLowerCase() === normalized);
  if (!match) return null;
  return { personId: match.personId, mode: /^(me|partner)$/.test(normalized) ? "automatic" : "confirm", answer: answer.trim() };
}

export function orderPeopleByMergeSimilarity<T extends { personId: string; momentCount: number; similarPersonId?: string; similarity?: number }>(people: readonly T[]): T[] {
  const remaining = new Map(people.map((person) => [person.personId, person]));
  const ordered: T[] = [];
  while (remaining.size) {
    const next = [...remaining.values()].sort((a, b) => b.momentCount - a.momentCount)[0]!;
    remaining.delete(next.personId);
    ordered.push(next);
    const related = next.similarity !== undefined && next.similarity >= 0.7 ? remaining.get(next.similarPersonId ?? "") : undefined;
    if (related) { ordered.push(related); remaining.delete(related.personId); }
  }
  return ordered;
}
