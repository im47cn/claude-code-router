import fastify, { FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import { readConfigFile, writeConfigFile, backupConfigFile } from "./utils";
import { checkForUpdates, performUpdate } from "./utils/update";
import { join } from "path";
import fastifyStatic from "@fastify/static";
import {
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "fs";
import { homedir } from "os";
import { calculateTokenCount } from "./utils/router";
import { RuleEngine } from "./utils/ruleEngine";
import {
  apiKeyAuth,
  quotaCheck,
  userSessionAuth,
  requireAdmin,
} from "./middleware/auth";
import { authRoutes } from "./api/auth";
import { apiKeyRoutes } from "./api/keys";
import { testDatabaseConnection, disconnectDatabase } from "./db/client";
import { ConfigManager } from "./utils/config";

declare module "fastify" {
  interface FastifyInstance {
    apiKeyAuth: any;
    quotaCheck: any;
    userSessionAuth: any;
    requireAdmin: any;
    ruleEngine: RuleEngine;
  }
}

export const createServer = (
  configPath: string,
  loggerConfig: any,
): FastifyInstance => {
  const configManager = new ConfigManager(configPath);
  const config = configManager.getConfig();

  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET must be set in the environment variables.");
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set in the environment variables.");
  }

  const app = fastify({ logger: loggerConfig });
  app.register(fastifyCookie);
  const ruleEngine = new RuleEngine(config);

  app.decorate("ruleEngine", ruleEngine);
  app.decorate("apiKeyAuth", apiKeyAuth(config));
  app.decorate("quotaCheck", quotaCheck);
  app.decorate("userSessionAuth", userSessionAuth);
  app.decorate("requireAdmin", requireAdmin);

  testDatabaseConnection();

  authRoutes(app);
  apiKeyRoutes(app);

  app.addHook("preHandler", app.apiKeyAuth);
  app.addHook("preHandler", app.quotaCheck);

  app.addHook("onClose", async (instance) => {
    await disconnectDatabase();
  });

  app.post("/v1/messages/count_tokens", async (req, reply) => {
    const { messages, tools, system } = req.body as any;
    const tokenCount = calculateTokenCount(messages, system, tools);
    return { input_tokens: tokenCount };
  });

  app.get("/api/config", async (req, reply) => {
    return await readConfigFile();
  });

  app.get("/api/transformers", async () => {
    // This needs to be reimplemented, as server.app._server is not available with this new structure.
    return { transformers: [] };
  });

  app.post("/api/config", async (req, reply) => {
    const newConfig = req.body;
    const backupPath = await backupConfigFile();
    if (backupPath) {
      console.log(`Backed up existing configuration file to ${backupPath}`);
    }
    await writeConfigFile(newConfig);
    return { success: true, message: "Config saved successfully" };
  });

  app.post("/api/restart", async (req, reply) => {
    reply.send({ success: true, message: "Service restart initiated" });
    setTimeout(() => {
      const { spawn } = require("child_process");
      spawn(process.execPath, [process.argv[1], "restart"], {
        detached: true,
        stdio: "ignore",
      });
    }, 1000);
  });

  app.register(fastifyStatic, {
    root: join(__dirname, "..", "dist"),
    prefix: "/ui/",
    maxAge: "1h",
  });

  app.get("/ui", async (_, reply) => {
    return reply.redirect("/ui/");
  });

  app.get("/api/update/check", async (req, reply) => {
    try {
      const currentVersion = require("../package.json").version;
      const { hasUpdate, latestVersion, changelog } =
        await checkForUpdates(currentVersion);
      return {
        hasUpdate,
        latestVersion: hasUpdate ? latestVersion : undefined,
        changelog: hasUpdate ? changelog : undefined,
      };
    } catch (error) {
      console.error("Failed to check for updates:", error);
      reply.status(500).send({ error: "Failed to check for updates" });
    }
  });

  app.post("/api/update/perform", async (req, reply) => {
    try {
      const accessLevel = (req as any).accessLevel || "restricted";
      if (accessLevel !== "full") {
        reply.status(403).send("Full access required to perform updates");
        return;
      }
      const result = await performUpdate();
      return result;
    } catch (error) {
      console.error("Failed to perform update:", error);
      reply.status(500).send({ error: "Failed to perform update" });
    }
  });

  app.get("/api/logs/files", async (req, reply) => {
    try {
      const logDir = join(homedir(), ".claude-code-router", "logs");
      const logFiles: Array<{
        name: string;
        path: string;
        size: number;
        lastModified: string;
      }> = [];
      if (existsSync(logDir)) {
        const files = readdirSync(logDir);
        for (const file of files) {
          if (file.endsWith(".log")) {
            const filePath = join(logDir, file);
            const stats = statSync(filePath);
            logFiles.push({
              name: file,
              path: filePath,
              size: stats.size,
              lastModified: stats.mtime.toISOString(),
            });
          }
        }
        logFiles.sort(
          (a, b) =>
            new Date(b.lastModified).getTime() -
            new Date(a.lastModified).getTime(),
        );
      }
      return logFiles;
    } catch (error) {
      console.error("Failed to get log files:", error);
      reply.status(500).send({ error: "Failed to get log files" });
    }
  });

  app.get("/api/logs", async (req, reply) => {
    try {
      const filePath = (req.query as any).file as string;
      let logFilePath: string;
      if (filePath) {
        logFilePath = filePath;
      } else {
        logFilePath = join(homedir(), ".claude-code-router", "logs", "app.log");
      }
      if (!existsSync(logFilePath)) {
        return [];
      }
      const logContent = readFileSync(logFilePath, "utf8");
      const logLines = logContent.split("\n").filter((line) => line.trim());
      return logLines;
    } catch (error) {
      console.error("Failed to get logs:", error);
      reply.status(500).send({ error: "Failed to get logs" });
    }
  });

  app.delete("/api/logs", async (req, reply) => {
    try {
      const filePath = (req.query as any).file as string;
      let logFilePath: string;
      if (filePath) {
        logFilePath = filePath;
      } else {
        logFilePath = join(homedir(), ".claude-code-router", "logs", "app.log");
      }
      if (existsSync(logFilePath)) {
        writeFileSync(logFilePath, "", "utf8");
      }
      return { success: true, message: "Logs cleared successfully" };
    } catch (error) {
      console.error("Failed to clear logs:", error);
      reply.status(500).send({ error: "Failed to clear logs" });
    }
  });

  return app;
};
