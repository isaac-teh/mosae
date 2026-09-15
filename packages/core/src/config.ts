export type CoreConfig = {
  apiBaseUrl: string;
  firebase: { apiKey?: string; authDomain?: string; projectId?: string; storageBucket?: string; appId?: string };
  useEmulators: boolean;
};

let current: CoreConfig | null = null;

export function configureCore(config: CoreConfig): void {
  current = config;
}

export function getCoreConfig(): CoreConfig {
  if (!current) throw new Error("core_not_configured");
  return current;
}
