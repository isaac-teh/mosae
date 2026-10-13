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

export async function savePersonMoments(projectId: string, personId: string, name: string | null, addShots: string[], removeShots: string[], sampleUris: string[] = []): Promise<void> {
  const cast = await getCast(projectId);
  const current = cast ?? { people: [], core: [], focus: [], source: "none" as const };
  const existing = current.people.find((person) => person.personId === personId);
  const people: ConfirmCastInput["people"] = current.people.map((person) => ({ personId: person.personId, role: person.role, name: person.name, excluded: person.excluded }));
  if (!existing) people.push({ personId, role: "other", ...(name ? { name } : {}), excluded: false });
  await confirmCast(projectId, { people: people.map((person) => person.personId === personId ? { ...person, ...(name ? { name } : {}), addShots, removeShots } : person), focus: current.focus });
  await Promise.all([
    mutateProjectFlow(projectId, { type: "person", personId, name: name ?? existing?.name ?? null, role: existing?.role ?? "other", confirmed: Boolean(name ?? existing?.name), skipped: false }),
    ...addShots.map((shotId) => mutateProjectFlow(projectId, { type: "manual-shot", personId, shotId, included: true })),
    ...removeShots.map((shotId) => mutateProjectFlow(projectId, { type: "manual-shot", personId, shotId, included: false })),
    ...(sampleUris.length ? [mutateProjectFlow(projectId, { type: "sample-photos", personId, uris: sampleUris.slice(0, 4) })] : []),
  ]);
}
