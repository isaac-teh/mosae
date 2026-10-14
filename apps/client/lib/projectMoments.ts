import { ensureSignedIn, getCoreConfig } from "@mosae/core";
import { confirmCast, getCast, mutateProjectFlow, type ConfirmCastInput } from "./characters";

export type ProjectMoment = { shotId: string; thumbnailUrl: string; kind: "photo" | "video"; durationSec: number | null; dayIndex: number; personIds: string[] };

export async function getProjectMoments(projectId: string): Promise<ProjectMoment[]> {
  const user = await ensureSignedIn();
  const response = await fetch(`${getCoreConfig().apiBaseUrl}/api/projects/${encodeURIComponent(projectId)}/moments`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Unable to load your moments");
  return body.moments as ProjectMoment[];
}

export async function savePersonMoments(projectId: string, personId: string, name: string | null, addShots: string[], removeShots: string[], sampleUris: string[] = [], source: "missed" | "cast" = "cast"): Promise<string> {
  const cast = await getCast(projectId);
  const current = cast ?? { people: [], core: [], focus: [], source: "none" as const };
  const sameName = name?.trim().toLocaleLowerCase();
  const nameMatches = sameName ? current.people.filter((person) => person.name?.trim().toLocaleLowerCase() === sameName) : [];
  const resolvedPersonId = current.people.some((person) => person.personId === personId) ? personId : source !== "missed" && nameMatches.length === 1 ? nameMatches[0]!.personId : personId;
  const existing = current.people.find((person) => person.personId === resolvedPersonId);
  const peopleById = new Map(current.people.map((person) => [person.personId, person]));
  const people: ConfirmCastInput["people"] = [...peopleById.values()].map((person) => ({ personId: person.personId, role: person.role, name: person.name, excluded: person.excluded }));
  if (!existing) people.push({ personId: resolvedPersonId, role: "other", ...(name ? { name } : {}), excluded: false });
  const livePersonIds = new Set(people.map(({ personId }) => personId));
  const focus = [...new Set(current.focus.filter((id) => livePersonIds.has(id)))];
  await confirmCast(projectId, { people: people.map((person) => person.personId === resolvedPersonId ? { ...person, ...(name ? { name } : {}), addShots, removeShots } : person), focus });
  await Promise.all([
    mutateProjectFlow(projectId, { type: "person", personId: resolvedPersonId, name: name ?? existing?.name ?? null, role: existing?.role ?? "other", confirmed: Boolean(name ?? existing?.name), skipped: false }),
    ...addShots.map((shotId) => mutateProjectFlow(projectId, { type: "manual-shot", personId: resolvedPersonId, shotId, included: true })),
    ...removeShots.map((shotId) => mutateProjectFlow(projectId, { type: "manual-shot", personId: resolvedPersonId, shotId, included: false })),
    ...(sampleUris.length ? [mutateProjectFlow(projectId, { type: "sample-photos", personId: resolvedPersonId, uris: sampleUris.slice(0, 4) })] : []),
  ]);
  return resolvedPersonId;
}
