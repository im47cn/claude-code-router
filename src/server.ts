import Server from "@musistudio/llms";
import { readConfigFile, writeConfigFile, backupConfigFile } from "./utils";
import { checkForUpdates, performUpdate } from "./utils";
import { join } from "path";
import fastifyStatic from "@fastify/static";
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";
import {calculateTokenCount} from "./utils/router";

export const createServer = (config: any): Server => {
  const server = new Server(config);
  const sessionLoggerManager = config.sessionLoggerManager;

  server.app.post("/v1/messages/count_tokens", async (req, reply) => {
    const {messages, tools, system} = req.body;
    const tokenCount = calculateTokenCount(messages, system, tools);
    return { "input_tokens": tokenCount }
  });

  // Add endpoint to read config.json with access control
  server.app.get("/api/config", async (req, reply) => {
    return await readConfigFile();
  });

  server.app.get("/api/transformers", async () => {
    const transformers =
      server.app._server!.transformerService.getAllTransformers();
    const transformerList = Array.from(transformers.entries()).map(
      ([name, transformer]: any) => ({
        name,
        endpoint: transformer.endPoint || null,
      })
    );
    return { transformers: transformerList };
  });

  // Add endpoint to save config.json with access control
  server.app.post("/api/config", async (req, reply) => {
    const newConfig = req.body;

    // Backup existing config file if it exists
    const backupPath = await backupConfigFile();
    if (backupPath) {
      console.log(`Backed up existing configuration file to ${backupPath}`);
    }

    await writeConfigFile(newConfig);
    return { success: true, message: "Config saved successfully" };
  });

  // Add endpoint to restart the service with access control
  server.app.post("/api/restart", async (req, reply) => {
    reply.send({ success: true, message: "Service restart initiated" });

    // Restart the service after a short delay to allow response to be sent
    setTimeout(() => {
      const { spawn } = require("child_process");
      spawn(process.execPath, [process.argv[1], "restart"], {
        detached: true,
        stdio: "ignore",
      });
    }, 1000);
  });

  // Register static file serving with caching
  server.app.register(fastifyStatic, {
    root: join(__dirname, "..", "dist"),
    prefix: "/ui/",
    maxAge: "1h",
  });

  // Redirect /ui to /ui/ for proper static file serving
  server.app.get("/ui", async (_, reply) => {
    return reply.redirect("/ui/");
  });

  // 版本检查端点
  server.app.get("/api/update/check", async (req, reply) => {
    try {
      // 获取当前版本
      const currentVersion = require("../package.json").version;
      const { hasUpdate, latestVersion, changelog } = await checkForUpdates(currentVersion);

      return {
        hasUpdate,
        latestVersion: hasUpdate ? latestVersion : undefined,
        changelog: hasUpdate ? changelog : undefined
      };
    } catch (error) {
      console.error("Failed to check for updates:", error);
      reply.status(500).send({ error: "Failed to check for updates" });
    }
  });

  // 执行更新端点
  server.app.post("/api/update/perform", async (req, reply) => {
    try {
      // 只允许完全访问权限的用户执行更新
      const accessLevel = (req as any).accessLevel || "restricted";
      if (accessLevel !== "full") {
        reply.status(403).send("Full access required to perform updates");
        return;
      }

      // 执行更新逻辑
      const result = await performUpdate();

      return result;
    } catch (error) {
      console.error("Failed to perform update:", error);
      reply.status(500).send({ error: "Failed to perform update" });
    }
  });

  // 获取日志文件列表端点
  server.app.get("/api/logs/files", async (req, reply) => {
    try {
      const logDir = join(homedir(), ".claude-code-router", "logs");
      const logFiles: Array<{ name: string; path: string; size: number; lastModified: string }> = [];

      if (existsSync(logDir)) {
        const files = readdirSync(logDir);

        for (const file of files) {
          if (file.endsWith('.log')) {
            const filePath = join(logDir, file);
            const stats = statSync(filePath);

            logFiles.push({
              name: file,
              path: filePath,
              size: stats.size,
              lastModified: stats.mtime.toISOString()
            });
          }
        }

        // 按修改时间倒序排列
        logFiles.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());
      }

      return logFiles;
    } catch (error) {
      console.error("Failed to get log files:", error);
      reply.status(500).send({ error: "Failed to get log files" });
    }
  });

  // 获取日志内容端点
  server.app.get("/api/logs", async (req, reply) => {
    try {
      const filePath = (req.query as any).file as string;
      let logFilePath: string;

      if (filePath) {
        // 如果指定了文件路径，使用指定的路径
        logFilePath = filePath;
      } else {
        // 如果没有指定文件路径，使用默认的日志文件路径
        logFilePath = join(homedir(), ".claude-code-router", "logs", "app.log");
      }

      if (!existsSync(logFilePath)) {
        return [];
      }

      const logContent = readFileSync(logFilePath, 'utf8');
      const logLines = logContent.split('\n').filter(line => line.trim())

      return logLines;
    } catch (error) {
      console.error("Failed to get logs:", error);
      reply.status(500).send({ error: "Failed to get logs" });
    }
  });

  // 清除日志内容端点
  server.app.delete("/api/logs", async (req, reply) => {
    try {
      const filePath = (req.query as any).file as string;
      let logFilePath: string;

      if (filePath) {
        // 如果指定了文件路径，使用指定的路径
        logFilePath = filePath;
      } else {
        // 如果没有指定文件路径，使用默认的日志文件路径
        logFilePath = join(homedir(), ".claude-code-router", "logs", "app.log");
      }

      if (existsSync(logFilePath)) {
        writeFileSync(logFilePath, '', 'utf8');
      }

      return { success: true, message: "Logs cleared successfully" };
    } catch (error) {
      console.error("Failed to clear logs:", error);
      reply.status(500).send({ error: "Failed to clear logs" });
    }
  });

  // Session log management endpoints (if session logger manager is available)
  if (sessionLoggerManager) {
    // Get session log files list
    server.app.get("/api/logs/sessions", async (req, reply) => {
      try {
        const activeSessions = sessionLoggerManager.getActiveSessions();
        const logDir = join(homedir(), ".claude-code-router", "logs", "sessions");
        
        if (existsSync(logDir)) {
          const files = readdirSync(logDir);
          const sessionFiles = files
            .filter(file => file.endsWith('.log'))
            .map(file => {
              const filePath = join(logDir, file);
              const stats = statSync(filePath);
              return {
                name: file,
                path: filePath,
                size: stats.size,
                lastModified: stats.mtime.toISOString()
              };
            })
            .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

          return {
            activeSessions,
            sessionFiles,
            totalSessions: activeSessions.length,
            totalFiles: sessionFiles.length
          };
        }

        return { activeSessions, sessionFiles: [], totalSessions: 0, totalFiles: 0 };
      } catch (error) {
        console.error("Failed to get session logs:", error);
        reply.status(500).send({ error: "Failed to get session logs" });
      }
    });

    // Get specific session log content
    server.app.get("/api/logs/session/:sessionId", async (req, reply) => {
      try {
        const { sessionId } = req.params as any;
        const { limit = 1000, offset = 0 } = req.query as any;
        
        const sessionInfo = sessionLoggerManager.getSessionInfo(sessionId);
        if (!sessionInfo) {
          return reply.status(404).send({ error: "Session not found" });
        }

        // Find session log file
        const logDir = join(homedir(), ".claude-code-router", "logs", "sessions");
        const sessionFiles = existsSync(logDir) ? readdirSync(logDir) : [];
        const sessionFile = sessionFiles.find(file => file.startsWith(`${sessionId}-`) && file.endsWith('.log'));
        
        if (!sessionFile) {
          return reply.status(404).send({ error: "Session log file not found" });
        }

        const filePath = join(logDir, sessionFile);
        const logContent = readFileSync(filePath, 'utf8');
        const logLines = logContent.split('\n').filter(line => line.trim());
        
        const startIndex = parseInt(offset) || 0;
        const endIndex = startIndex + parseInt(limit);
        const paginatedLines = logLines.slice(startIndex, endIndex);

        return {
          sessionInfo,
          logLines: paginatedLines,
          totalLines: logLines.length,
          startIndex,
          endIndex: Math.min(endIndex, logLines.length),
          hasMore: endIndex < logLines.length
        };
      } catch (error) {
        console.error("Failed to get session log:", error);
        reply.status(500).send({ error: "Failed to get session log" });
      }
    });

    // Delete session log
    server.app.delete("/api/logs/session/:sessionId", async (req, reply) => {
      try {
        const { sessionId } = req.params as any;
        
        // End active session if it exists
        sessionLoggerManager.endSession(sessionId);
        
        // Find and delete session log file
        const logDir = join(homedir(), ".claude-code-router", "logs", "sessions");
        const sessionFiles = existsSync(logDir) ? readdirSync(logDir) : [];
        const sessionFile = sessionFiles.find(file => file.startsWith(`${sessionId}-`) && file.endsWith('.log'));
        
        if (sessionFile) {
          const filePath = join(logDir, sessionFile);
          if (existsSync(filePath)) {
            writeFileSync(filePath, '', 'utf8');
          }
        }

        return { success: true, message: "Session log deleted successfully" };
      } catch (error) {
        console.error("Failed to delete session log:", error);
        reply.status(500).send({ error: "Failed to delete session log" });
      }
    });

    // Get session logger configuration
    server.app.get("/api/logs/session/config", async (req, reply) => {
      try {
        const config = sessionLoggerManager.getConfig();
        return config;
      } catch (error) {
        console.error("Failed to get session log config:", error);
        reply.status(500).send({ error: "Failed to get session log config" });
      }
    });

    // Update session logger configuration
    server.app.put("/api/logs/session/config", async (req, reply) => {
      try {
        const newConfig = req.body;
        sessionLoggerManager.updateConfig(newConfig);
        const updatedConfig = sessionLoggerManager.getConfig();
        return { 
          success: true, 
          message: "Session log configuration updated successfully",
          config: updatedConfig 
        };
      } catch (error) {
        console.error("Failed to update session log config:", error);
        reply.status(500).send({ error: "Failed to update session log config" });
      }
    });
  }

  return server;
};
