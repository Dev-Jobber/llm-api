import type { Request, Response, NextFunction } from "express";
import type { ChatMessage } from "../core/balancer";

export function validateChatRequest(req: Request, res: Response, next: NextFunction): void {
  const { messages } = req.body as { messages?: unknown };

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

  next();
}
