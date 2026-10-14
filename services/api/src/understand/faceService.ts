import { GoogleAuth } from "google-auth-library";

export const FACE_EMBEDDING_MODEL = "arcface-buffalo_l-v1";
export type ArcFaceResult = { bbox: [number, number, number, number]; detScore: number; embedding: number[] };
export type FaceService = (jpeg: Buffer) => Promise<ArcFaceResult[]>;

export function createFaceService(baseUrl = process.env.FACE_SERVICE_URL ?? "", bearerToken = process.env.FACE_SERVICE_ACCESS_TOKEN ?? ""): FaceService | null {
  if (!baseUrl) return null;
  const auth = bearerToken ? null : new GoogleAuth();
  return async (jpeg) => {
    const client = auth ? await auth.getIdTokenClient(baseUrl) : null;
    const headers = bearerToken ? { Authorization: `Bearer ${bearerToken}` } : await client!.getRequestHeaders(baseUrl);
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/faces`, { method: "POST", headers: { ...headers, "content-type": "image/jpeg" }, body: new Uint8Array(jpeg), signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`face service failed: ${response.status}`);
    const payload = await response.json() as { modelVersion: string; faces: ArcFaceResult[] };
    if (payload.modelVersion !== FACE_EMBEDDING_MODEL) throw new Error(`unexpected face model version: ${payload.modelVersion}`);
    return payload.faces.filter((face) => face.embedding.length === 512 && face.embedding.every(Number.isFinite));
  };
}

export function boxIou(a: number[], b: number[]): number {
  const y = Math.max(0, Math.min(a[2]!, b[2]!) - Math.max(a[0]!, b[0]!));
  const x = Math.max(0, Math.min(a[3]!, b[3]!) - Math.max(a[1]!, b[1]!));
  const intersection = x * y;
  const areaA = (a[2]! - a[0]!) * (a[3]! - a[1]!);
  const areaB = (b[2]! - b[0]!) * (b[3]! - b[1]!);
  return intersection / Math.max(1e-9, areaA + areaB - intersection);
}
