const ENV_CODES = new Set(["ENOMEM", "ENOSPC", "EMFILE", "ENFILE", "EAGAIN", "EPIPE", "ETIMEDOUT", "ECONNRESET", "ENOENT", "EACCES"]);
const ENV_MESSAGE = /out of memory|cannot allocate|no space left|too many open files|resource temporarily unavailable|SIGKILL|SIGSEGV|SIGABRT/i;
const DECODE_MESSAGE = /unsupported image format|unsupported (feature|codec)|corrupt|premature end|bad seek|truncated|not a valid|invalid (image|data|file)|unknown file type|file format error|no decode delegate|heif:|VipsForeign|Input (file|buffer)|end of file/i;

type ProcessError = { killed?: unknown; signal?: unknown; code?: unknown; message?: unknown };
const shape = (error: unknown): ProcessError => error && typeof error === "object" ? error as ProcessError : {};

export function isEnvironmental(error: unknown): boolean {
  const value = shape(error);
  return value.killed === true || Boolean(value.signal) || (typeof value.code === "string" && ENV_CODES.has(value.code)) || ENV_MESSAGE.test(typeof value.message === "string" ? value.message : String(error));
}

export function isToolRejection(error: unknown): boolean {
  const value = shape(error);
  return !isEnvironmental(error) && typeof value.code === "number" && value.code !== 0 && !value.killed && !value.signal;
}

export function isDecodeFailure(error: unknown): boolean {
  const value = shape(error);
  return !isEnvironmental(error) && DECODE_MESSAGE.test(typeof value.message === "string" ? value.message : String(error));
}
