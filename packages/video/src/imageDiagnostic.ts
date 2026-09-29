/** Keep a useful failing source path while never writing signed URL secrets to logs. */
export function redactImageSource(source: string): string {
  try {
    const url = new URL(source, "http://mosae.local");
    return url.origin === "http://mosae.local" ? url.pathname : `${url.origin}${url.pathname}`;
  } catch {
    return source.split(/[?#]/, 1)[0] ?? "[invalid-image-source]";
  }
}
