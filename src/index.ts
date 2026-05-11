import "dotenv/config";
import express from "express";
import { config } from "./config";
import { getRedis, closeRedis } from "./core/redis";
import { loadScripts } from "./core/scripts";
import { createChatRouter } from "./routes/chat";
import { createHealthRouter } from "./routes/health";

async function main() {
  const app = express();
  app.use(express.json());

  const redis = getRedis();
  const scripts = await loadScripts(redis);

  app.use("/", createHealthRouter(redis));
  app.use("/", createChatRouter(redis, scripts));

  app.use((req, res) => {
    res.status(404).json({ error: "not_found", message: `Cannot ${req.method} ${req.path}` });
  });

  const server = app.listen(config.port, () => {
    console.log(`[server] listening on port ${config.port}`);
  });

  const shutdown = () => {
    console.log("[server] shutting down...");
    server.close(async () => {
      await closeRedis();
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[server] fatal error:", err);
  process.exit(1);
});
