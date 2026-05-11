import type { Request, Response, NextFunction } from "express";
import { config } from "../config/index.js";

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers["x-api-key"] ?? req.headers["authorization"];
  const bearer = typeof key === "string" && key.startsWith("Bearer ") ? key.slice(7) : key;

  if (!bearer || bearer !== config.proxyAuthKey) {
    res.status(401).json({ error: "Unauthorized", message: "Invalid or missing API key" });
    return;
  }

  next();
}
