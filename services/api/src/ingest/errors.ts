/**
 * The file itself is the problem: it is corrupt, unsupported or too large. A
 * retry cannot help, so the asset is marked failed with this reason. Every
 * other error (a network blip, a timeout) is transient and is rethrown so the
 * task queue retries it.
 */
export class PermanentIngestError extends Error {
  readonly reason: string;

  constructor(reason: string, message?: string) {
    super(message ?? reason);
    this.name = "PermanentIngestError";
    this.reason = reason;
  }
}
