import type { Request, Response, NextFunction } from "express";
import type { ChatMessage } from "../core/balancer.js";
import { MODELS } from "../config/index.js";

export function validateChatRequest(req: Request, res: Response, next: NextFunction): void {
  const { messages, model, return_json, stream } = req.body as { messages?: unknown; model?: unknown; return_json?: unknown; stream?: unknown };

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "Bad Request", message: "messages must be a non-empty array" });
    return;
  }

  for (const msg of messages as ChatMessage[]) {
    if (typeof msg.role !== "string" || typeof msg.content !== "string") {
      res.status(400).json({
        error: "Bad Request",
        message: "Each message must have string role and content fields",
      });
      return;
    }
    if (!["system", "user", "assistant"].includes(msg.role)) {
      res.status(400).json({
        error: "Bad Request",
        message: `Invalid role "${msg.role}". Must be system, user, or assistant`,
      });
      return;
    }
  }

  if (model !== undefined) {
    if (typeof model !== "string" || !MODELS.includes(model as never)) {
      res.status(400).json({
        error: "Bad Request",
        message: `Invalid model "${model}"`,
        available_models: MODELS,
      });
      return;
    }
  }

  if (return_json !== undefined && typeof return_json !== "boolean") {
    res.status(400).json({
      error: "Bad Request",
      message: "return_json must be a boolean",
    });
    return;
  }

  if (stream === true && return_json === true) {
    res.status(400).json({
      error: "Bad Request",
      message: "stream and return_json cannot both be true",
    });
    return;
  }

  next();
}
