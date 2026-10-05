export class PendingPreviewUrls {
  private readonly urls = new Map<File, string>();
  private readonly keys = new WeakMap<File, string>();
  private nextKey = 0;

  constructor(
    private readonly createUrl: (file: File) => string = (file) => URL.createObjectURL(file),
    private readonly revokeUrl: (url: string) => void = (url) => URL.revokeObjectURL(url),
  ) {}

  get(file: File) {
    let url = this.urls.get(file);
    if (!url) {
      url = this.createUrl(file);
      this.urls.set(file, url);
    }
    return url;
  }

  key(file: File) {
    let key = this.keys.get(file);
    if (!key) {
      key = `pending-file-${++this.nextKey}`;
      this.keys.set(file, key);
    }
    return key;
  }

  retain(files: readonly File[]) {
    const active = new Set(files);
    for (const [file, url] of this.urls) {
      if (active.has(file)) continue;
      this.revokeUrl(url);
      this.urls.delete(file);
    }
  }

  dispose() {
    for (const url of this.urls.values()) this.revokeUrl(url);
    this.urls.clear();
  }
}
