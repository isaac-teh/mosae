export type PersonAgeBand = "child" | "teen" | "adult" | "senior";

const ANSWERS: Record<PersonAgeBand, string[]> = {
  child: ["My son", "My daughter", "Friend", "Type a name"],
  teen: ["My son", "My daughter", "Friend", "Type a name"],
  adult: ["Me", "My partner", "Friend", "Type a name"],
  senior: ["My mum", "My dad", "Friend", "Type a name"],
};

/** Answer suggestions for one face group; relationship and family labels may repeat. */
export function personAnswerChips(ageBand: PersonAgeBand | null | undefined, assignedAnswers: readonly string[] = []): string[] {
  const answers = ageBand ? [...ANSWERS[ageBand]] : ["Me", "Family", "Friend", "Type a name"];
  const assigned = new Set(assignedAnswers);
  return answers.filter((answer) => (answer !== "Me" || !assigned.has("Me")) && (answer !== "My partner" || !assigned.has("My partner")));
}
