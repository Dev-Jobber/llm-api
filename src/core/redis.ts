import Redis from "ioredis";
import { config } from "../config/index.js";

let client: Redis | null = null;

function buildRedisClient(): Redis {
  const parsed = new URL(config.redisUrl);
  const isSecure = parsed.protocol === "rediss:";

  const instance = new Redis({
    host: parsed.hostname,
    port: parseInt(parsed.port || "6379", 10),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: parseInt(parsed.pathname?.replace("/", "") || "0", 10),
    tls: isSecure ? {} : undefined,

    maxRetriesPerRequest: 3,
    connectTimeout: 5000,
    commandTimeout: 5000,
    keepAlive: 10000,
    enableReadyCheck: true,
    lazyConnect: false,

    retryStrategy(times: number): number | null {
      if (times > 5) return null;
      return Math.min(times * 200, 2000);
    },

    reconnectOnError(err: Error): boolean {
      return err.message.includes("READONLY") || err.message.includes("ECONNRESET");
    },
  });

  instance.on("error", (err: Error) => {
    console.error("[Redis] error:", err.message);
  });

  instance.on("connect", () => {
    console.log("[Redis] connected successfully");
  });

  instance.on("reconnecting", (ms: number) => {
    console.warn(`[Redis] reconnecting in ${ms}ms...`);
  });

  instance.on("ready", () => {
    console.log("[Redis] ready - can accept commands");
  });

  return instance;
}

export function getRedis(): Redis {
  if (!client) client = buildRedisClient();
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
