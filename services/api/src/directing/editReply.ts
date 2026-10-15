export { describeApplied } from "@mosae/contracts";

/** One plain sentence for a request part that could not be done, ending with an alternative where we have one. */
export function describeSkipped(part: string, reply: string, kind: string, peopleNames: string[]): string {
  if (/\b(?:focus|feature|emphasize)\b/i.test(part) && kind === "clarify") {
    const target = /\b(?:focus|feature|emphasize)\s+(?:on\s+)?([^,.;]+?)(?=\s+(?:and|with)\b|[,.;]|$)/i.exec(part)?.[1]?.trim();
    const list = peopleNames.slice(0, 5);
    const options = list.length ? list.join(", ").replace(/, ([^,]+)$/, " or $1") : "";
    if (target && options) return `I couldn't find ${target}. Did you mean ${options}?`;
  }
  const cleaned = reply.replace(/^Who should I focus on\? Choose Everyone or a confirmed person: /, "Did you mean ").trim();
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}
