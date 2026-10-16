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

/** Keep implementation identifiers out of user-facing clarification and fallback text. */
export function sanitizeEditReply(reply: string): string {
  return reply
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "that item")
    .replace(/\b(?=[A-Za-z0-9_-]*[_-])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9][A-Za-z0-9_-]{15,}(?:[#@][A-Za-z0-9_-]+)*/g, "that item")
    .replace(/\b(?=[A-Za-z0-9]{16,}\b)(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Z])[A-Za-z0-9]+\b/g, "that item")
    .replace(/\s{2,}/g, " ");
}
