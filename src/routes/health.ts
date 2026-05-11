import { Router, type Request, type Response } from "express";
import type Redis from "ioredis";
import { MODELS, config } from "../config";

const PREFIX = "ai_lb";

export function createHealthRouter(redis: Redis): Router {
  const router = Router();

  router.get("/health", (_req: Request, res: Response): void => {
    res.json({ status: "ok", uptime: Math.floor(process.uptime()) });
  });

  router.get("/status", async (_req: Request, res: Response): Promise<void> => {
    try {
      const keyIds = config.apiKeys.map((_, i) => `k${i}`);
      console.log(`[health] Fetching status for ${keyIds.length} keys, ${MODELS.length} models each`);
      
      const pipeline = redis.pipeline();

      for (const keyId of keyIds) {
        pipeline.exists(`${PREFIX}:key:${keyId}:lock`);
        pipeline.get(`${PREFIX}:key:${keyId}:midx`);
        for (let m = 0; m < MODELS.length; m++) {
          pipeline.get(`${PREFIX}:key:${keyId}:m${m}:rounds`);
          pipeline.get(`${PREFIX}:key:${keyId}:m${m}:failed`);
        }
      }

      pipeline.get(`${PREFIX}:rr_ptr`);

      console.log(`[health] Executing Redis pipeline with ${keyIds.length * (2 + MODELS.length * 2) + 1} commands`);
      const results = await pipeline.exec();
      if (!results) {
        console.error("[health] Redis pipeline failed - no results returned");
        res.status(500).json({ error: "Redis pipeline failed" });
        return;
      }
      
      console.log(`[health] Redis pipeline executed successfully, ${results.length} results returned`);

      let cursor = 0;
      const keys = keyIds.map((keyId, ki) => {
        const locked = (results[cursor++]?.[1] as number) === 1;
        const activeModelIdx = parseInt((results[cursor++]?.[1] as string | null) ?? "0", 10);
        const models = MODELS.map((model, mi) => ({
          model,
          rounds: parseInt((results[cursor++]?.[1] as string | null) ?? "0", 10),
          failed: (results[cursor++]?.[1] as string | null) === "1",
          active: mi === activeModelIdx,
        }));
        return { id: `k${ki}`, keyId, locked, activeModelIdx, models };
      });

      const rrPtr = parseInt((results[cursor]?.[1] as string | null) ?? "0", 10);

      const lockedCount = keys.filter((k) => k.locked).length;
      const freeCount = keys.filter((k) => !k.locked).length;
      const failedModels = keys.flatMap(k => k.models.filter(m => m.failed)).length;
      
      console.log(`[health] Status summary: rrPtr=${rrPtr}, locked=${lockedCount}, free=${freeCount}, failedModels=${failedModels}`);
      
      res.json({
        roundRobinPointer: rrPtr,
        totalKeys: keyIds.length,
        totalModels: MODELS.length,
        lockedKeys: lockedCount,
        freeKeys: freeCount,
        keys,
      });
    } catch (err) {
      console.error("[health] Status fetch failed:", (err as Error).message);
      res.status(500).json({ error: "Status fetch failed", message: (err as Error).message });
    }
  });

  return router;
}
