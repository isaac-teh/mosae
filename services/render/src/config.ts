export type Config = {
  production: boolean;
  outputDir: string;
  serviceCaller: { audience: string; allowedEmails: string[] } | null;
  apiServiceUrl: string | null;
};

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`missing env ${key}`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === "production";
  const outputDir = env.RENDER_OUTPUT_DIR ?? "/tmp/mosae-renders";
  if (!production) return { production, outputDir, serviceCaller: null, apiServiceUrl: null };

  return {
    production,
    outputDir,
    apiServiceUrl: required(env, "API_SERVICE_URL"),
    serviceCaller: {
      audience: required(env, "SERVICE_URL"),
      allowedEmails: required(env, "INVOKER_SERVICE_ACCOUNTS").split(",").map((email) => email.trim()).filter(Boolean),
    },
  };
}
