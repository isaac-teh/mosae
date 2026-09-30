export function createBundleSource(options: {
  serveUrl?: string;
  production: boolean;
  bundle: () => Promise<string>;
}): () => Promise<string> {
  if (options.serveUrl) return async () => options.serveUrl!;
  if (options.production) throw new Error("MOSAE_REMOTION_SERVE_URL must point to the image's prebuilt Remotion bundle in production");
  return options.bundle;
}
