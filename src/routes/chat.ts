import { Router, type Request, type Response } from "express";
import type Redis from "ioredis";
import { callAi, type CompletionRequest } from "../core/balancer.js";
import type { LoadedScripts } from "../core/scripts.js";
import { authenticate } from "../middleware/auth.js";
import { validateChatRequest } from "../middleware/validate.js";

export function createChatRouter(redis: Redis, scripts: LoadedScripts): Router {
  const router = Router();

  router.post(
    "/v1/chat/completions",
    authenticate,
    validateChatRequest,
    async (req: Request, res: Response): Promise<void> => {
      const startTime = Date.now();
      const requestId = Math.random().toString(36).substring(7);
      
      console.log(`[chat] Request ${requestId}: ${req.method} ${req.path}`);
      console.log(`[chat] Request ${requestId}: messages=${(req.body as CompletionRequest).messages?.length}, stream=${(req.body as CompletionRequest).stream}`);
      
      try {
        const data = await callAi(redis, scripts, req.body as CompletionRequest);
        const upstreamContentType = (data as Record<string, unknown>)?.["content-type"];
        if (typeof upstreamContentType === "string") {
          res.setHeader("Content-Type", upstreamContentType);
        }
        
        const duration = Date.now() - startTime;
        console.log(`[chat] Response ${requestId}: success in ${duration}ms`);
        const { model, ...filtered } = data as Record<string, unknown>;
        res.json(filtered);

      } catch (err) {
        const e = err as Error & { status?: number; upstream?: unknown; code?: string };
        const duration = Date.now() - startTime;

        if (e.code === "ELOCKED") {
          console.log(`[chat] Response ${requestId}: service_unavailable in ${duration}ms`);
          res.status(503).json({
            error: "service_unavailable",
            message: "All API keys are currently locked. Retry after a few minutes.",
          });
          return;
        }

        console.log(`[chat] Response ${requestId}: upstream_error (${e.status ?? 502}) in ${duration}ms`);
        res.status(e.status ?? 502).json({
          error: "upstream_error",
          message: e.message,
          ...(e.upstream !== undefined ? { upstream: e.upstream } : {}),
        });
      }
    }
  );

  return router;
}