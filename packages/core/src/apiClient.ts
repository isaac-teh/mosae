import { ensureSignedIn } from "./auth";
import { getCoreConfig } from "./config";

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const user = await ensureSignedIn();
  const res = await fetch(`${getCoreConfig().apiBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, typeof json.error === "string" ? json.error : "request_failed");
  return json as T;
}
