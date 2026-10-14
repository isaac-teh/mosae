export type Config = {
  port: number;
  production: boolean;
  storageBucket: string;
  serviceUrl: string;
  /** Token audiences accepted from Eventarc and Cloud Tasks: every URL of this service. */
  serviceAudiences: string[];
  invokerEmails: string[];
  allowedOrigins: string[];
  geminiApiKey: string;
  faceMatchThreshold: number;
  /** Base URL of the `mosae-render` Cloud Run service. */
  renderServiceUrl: string;
  tasks: { project: string; location: string; queue: string; invokerServiceAccount: string } | null;
};

/** Conservative post-confirmation face reconciliation cutoff (Gemini 2 spike: same-person median .8909, different-person median .7814). */
export const FACE_RECONCILE_THRESHOLD = 0.9;

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`missing env ${key}`);
  return value;
}

const TASK_KEYS = ["GCP_PROJECT_ID", "TASKS_LOCATION", "TASKS_QUEUE", "TASKS_INVOKER_SERVICE_ACCOUNT"] as const;

export function faceMatchingThresholds(env: NodeJS.ProcessEnv = process.env): Pick<Config, "faceMatchThreshold"> {
  return {
    faceMatchThreshold: Number(env.FACE_MATCH_THRESHOLD ?? 0.85),
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === "production";
  const invokers = production ? required(env, "INVOKER_SERVICE_ACCOUNTS") : (env.INVOKER_SERVICE_ACCOUNTS ?? "");
  const allowedOrigins = (production ? required(env, "ALLOWED_ORIGINS") : (env.ALLOWED_ORIGINS ?? ""))
    .split(",").map((origin) => origin.trim()).filter(Boolean);
  const hasTasks = TASK_KEYS.every((key) => env[key]);
  if (production && !hasTasks) TASK_KEYS.forEach((key) => required(env, key));

  return {
    port: Number(env.PORT || 8080),
    production,
    storageBucket: required(env, "FIREBASE_STORAGE_BUCKET"),
    geminiApiKey: env.GEMINI_API_KEY ?? "",
    ...faceMatchingThresholds(env),
    // Required in production: without it, saving a film is a task that cannot
    // reach anything. Locally it defaults to the render service's own port.
    renderServiceUrl: production ? required(env, "RENDER_SERVICE_URL") : (env.RENDER_SERVICE_URL ?? "http://127.0.0.1:8081"),
    serviceUrl: required(env, "SERVICE_URL"),
    // Eventarc signs for the full handler URL; accept every configured Cloud
    // Run URL form listed in SERVICE_AUDIENCES as well.
    serviceAudiences: [required(env, "SERVICE_URL"), ...(env.SERVICE_AUDIENCES ?? "").split(",").map((s) => s.trim()).filter(Boolean)],
    invokerEmails: invokers.split(",").map((s) => s.trim()).filter(Boolean),
    allowedOrigins,
    tasks: hasTasks
      ? {
          project: env.GCP_PROJECT_ID!,
          location: env.TASKS_LOCATION!,
          queue: env.TASKS_QUEUE!,
          invokerServiceAccount: env.TASKS_INVOKER_SERVICE_ACCOUNT!,
        }
      : null,
  };
}
