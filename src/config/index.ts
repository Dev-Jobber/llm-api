import "dotenv/config";

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw ?? String(fallback), 10);
  return isNaN(n) || n <= 0 ? fallback : n;
}

export const MODELS = [
  "meganova-ai/manta-flash-1.0",
  "meganova-ai/manta-mini-1.0",
  "FallenMerick/MN-Violet-Lotus-12B",
  "mistralai/Mistral-Small-3.2-24B-Instruct-2506",
  "Sao10K/L3-70B-Euryale-v2.1",
  "Sao10K/L3-8B-Stheno-v3.2",
] as const;

export type Model = (typeof MODELS)[number];

export const API_BASE_URL = "https://api.meganova.ai";
export const API_CHAT_PATH = "/v1/chat/completions";

export const DEFAULTS = {
  max_tokens: 1024,
  temperature: 0.7,
  top_p: 0.9,
  stream: false,
} as const;

function buildConfig() {
  const rawKeys = requireEnv("AI_API_KEYS");
  const apiKeys = rawKeys.split(",").map((k) => k.trim()).filter(Boolean);
  if (apiKeys.length === 0) throw new Error("AI_API_KEYS must contain at least one key");

  return {
    port: parsePositiveInt(process.env["PORT"], 3000),
    nodeEnv: process.env["NODE_ENV"] ?? "development",
    redisUrl: requireEnv("REDIS_URL"),
    proxyAuthKey: requireEnv("PROXY_AUTH_KEY"),
    apiKeys,
    keyLockTtl: parsePositiveInt(process.env["KEY_LOCK_TTL_SECONDS"], 600),
    roundsPerModel: parsePositiveInt(process.env["ROUNDS_PER_MODEL"], 50),
    requestTimeoutMs: parsePositiveInt(process.env["REQUEST_TIMEOUT_MS"], 30000),
  };
}

export const config = buildConfig();
export type Config = typeof config;
