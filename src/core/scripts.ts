import fs from "fs";
import path from "path";
import type Redis from "ioredis";

const LUA_DIR = path.resolve(__dirname, "../../lua");

function loadLua(filename: string): string {
  return fs.readFileSync(path.join(LUA_DIR, filename), "utf-8");
}

export interface LoadedScripts {
  acquireSlotSha: string;
  lockKeySha: string;
}

export async function loadScripts(redis: Redis): Promise<LoadedScripts> {
  const [acquireSlotSha, lockKeySha] = await Promise.all([
    redis.script("LOAD", loadLua("acquire_slot.lua")) as Promise<string>,
    redis.script("LOAD", loadLua("lock_key.lua")) as Promise<string>,
  ]);
  console.log("[scripts] Lua scripts loaded");
  return { acquireSlotSha, lockKeySha };
}
