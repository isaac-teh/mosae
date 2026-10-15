import type { ChatInput } from "./types";

/** Resolve focus using the confirmed, included cast and a valid explicit choice. */
export function directionFocus(people: ChatInput["people"], selectedFocus?: string, explicitlySelected = false): { options: { id: string; label: string }[]; selected: string; label: string } {
  const included = (people ?? []).filter(person => !person.skipped && person.momentCount > 0 && !(person as { excluded?: boolean }).excluded);
  const aggregate = { id: "family", label: included.length ? "Everyone" : "The moments" };
  const options = [aggregate, ...included.map(person => ({ id: person.personId, label: person.name?.trim() || (person.role && person.role !== "other" ? person.role[0]!.toUpperCase() + person.role.slice(1) : "This person") }))];
  const selectedIds = (selectedFocus ?? "").split(",").filter(Boolean);
  const validSelection = selectedIds.length > 0 && selectedIds.every(id => options.some(option => option.id === id));
  const selected = explicitlySelected && validSelection ? [...new Set(selectedIds)].join(",") : included.length === 1 ? included[0]!.personId : "family";
  const label = selected === "family" ? options[0]!.label : selected.split(",").map(id => options.find(option => option.id === id)!.label).join(", ");
  return { options, selected, label };
}
