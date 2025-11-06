import { existsSync } from "fs";
import { writeFile } from "fs/promises";
import { homedir } from "os";
import path, { join } from "path";
import {
  initConfig,
  initDir,
  cleanupLogFiles,
  interpolateEnvVars,
} from "./utils";
import { createServer } from "./server";
import { router } from "./utils/router";
import { apiKeyAuth } from "./middleware/auth";
import { FastifyRequest, FastifyReply } from "fastify";
import {
  cleanupPidFile,
  isServiceRunning,
  savePid,
} from "./utils/processCheck";
import { CONFIG_FILE } from "./constants";
import { createStream, RotatingFileStream } from "rotating-file-stream";
import { HOME_DIR } from "./constants";
import { sessionUsageCache } from "./utils/cache";
import { SSEParserTransform } from "./utils/SSEParser.transform";
import { SSESerializerTransform } from "./utils/SSESerializer.transform";
import { rewriteStream } from "./utils/rewriteStream";
import JSON5 from "json5";
import { IAgent } from "./agents/type";
import agentsManager from "./agents";
import { EventEmitter } from "node:events";
import { ConfigManager } from "./utils/config";

const event = new EventEmitter();

async function initializeClaudeConfig() {
  const homeDir = homedir();
  const configPath = join(homeDir, ".claude.json");
  if (!existsSync(configPath)) {
    const userID = Array.from(
      { length: 64 },
      () => Math.random().toString(16)[2],
    ).join("");
    const configContent = {
      numStartups: 184,
      autoUpdaterStatus: "enabled",
      userID,
      hasCompletedOnboarding: true,
      lastOnboardingVersion: "1.0.17",
      projects: {},
    };
    await writeFile(configPath, JSON.stringify(configContent, null, 2));
  }
}

interface RunOptions {
  port?: number;
}

interface RequestBody {
  tools?: any[];
  agents?: string[];
  messages?: any[];
  [key: string]: any;
}

declare module "fastify" {
  interface FastifyRequest {
    agents?: string[];
    sessionId?: string;
  }
}

async function run(options: RunOptions = {}) {
  const isRunning = await isServiceRunning();
  if (isRunning) {
    console.log("✅ Service is already running in the background.");
    return;
  }

  await initializeClaudeConfig();
  await initDir();
  await cleanupLogFiles();

  const configPath = join(homedir(), ".claude-code-router", "config.json");
  if (!existsSync(configPath)) {
    await initConfig();
  }
  const configManager = new ConfigManager(configPath);
  let config = configManager.getConfig();
  let HOST = config.HOST || "127.0.0.1";

  if (config.HOST && !config.APIKEY) {
    HOST = "127.0.0.1";
    console.warn("⚠️ API key is not set. HOST is forced to 127.0.0.1.");
  }

  const port = config.PORT || 3456;

  savePid(process.pid);

  process.on("SIGINT", () => {
    console.log("Received SIGINT, cleaning up...");
    cleanupPidFile();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    cleanupPidFile();
    process.exit(0);
  });

  const servicePort = process.env.SERVICE_PORT
    ? parseInt(process.env.SERVICE_PORT)
    : port;

  const pad = (num: number) => (num > 9 ? "" : "0") + num;
  const generator = (time: number | Date, index?: number): string => {
    if (!time) {
      time = new Date();
    } else if (typeof time === "number") {
      time = new Date(time);
    }
    const dateObj = time as Date;
    const month = dateObj.getFullYear() + "" + pad(dateObj.getMonth() + 1);
    const day = pad(dateObj.getDate());
    const hour = pad(dateObj.getHours());
    const minute = pad(dateObj.getMinutes());
    return `./logs/ccr-${month}${day}${hour}${minute}${pad(dateObj.getSeconds())}${index ? `_${index}` : ""}.log`;
  };
  const loggerConfig =
    config.LOG !== false
      ? {
          level: config.LOG_LEVEL || "debug",
          stream: createStream(generator, {
            path: HOME_DIR,
            maxFiles: 3,
            interval: "1d",
            compress: false,
            maxSize: "50M",
          }) as RotatingFileStream,
        }
      : false;

  const server = createServer(CONFIG_FILE, loggerConfig);

  process.on("uncaughtException", (err) => {
    server.logger.error("Uncaught exception:", err);
  });

  process.on("unhandledRejection", (reason, promise) => {
    server.logger.error("Unhandled rejection at:", promise, "reason:", reason);
  });

  server.addHook(
    "preHandler",
    (req: FastifyRequest, reply: FastifyReply, done) => {
      apiKeyAuth(config)(req, reply, (err?: Error) => {
        if (err) {
          return done(err);
        }
        done();
      });
    },
  );

  server.addHook(
    "preHandler",
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (
        req.url.startsWith("/v1/messages") &&
        !req.url.startsWith("/v1/messages/count_tokens")
      ) {
        const useAgents: string[] = [];
        for (const agent of agentsManager.getAllAgents()) {
          if (agent.shouldHandle(req, config)) {
            useAgents.push(agent.name);
            agent.reqHandler(req, config);
            if (agent.tools.size) {
              const body = req.body as RequestBody;
              if (!body.tools?.length) {
                body.tools = [];
              }
              body.tools.unshift(
                ...Array.from(agent.tools.values()).map((item) => ({
                  name: item.name,
                  description: item.description,
                  input_schema: item.input_schema,
                })),
              );
            }
          }
        }
        if (useAgents.length) {
          req.agents = useAgents;
        }
        await router(req, reply, { config, event });
      }
    },
  );

  server.addHook(
    "onError",
    (request: FastifyRequest, reply: FastifyReply, error: Error, done) => {
      event.emit("onError", request, reply, error);
      done();
    },
  );

  server.addHook(
    "onSend",
    (req: FastifyRequest, reply: FastifyReply, payload: any, done) => {
      if (
        req.sessionId &&
        req.url.startsWith("/v1/messages") &&
        !req.url.startsWith("/v1/messages/count_tokens")
      ) {
        if (payload instanceof ReadableStream) {
          if (req.agents) {
            const abortController = new AbortController();
            const eventStream = payload.pipeThrough(new SSEParserTransform());
            let currentAgent: IAgent | undefined;
            let currentToolIndex = -1;
            let currentToolName = "";
            let currentToolArgs = "";
            let currentToolId = "";
            const toolMessages: any[] = [];
            const assistantMessages: any[] = [];
            const rewrittenStream = rewriteStream(
              eventStream,
              async (data, controller) => {
                try {
                  if (
                    data.event === "content_block_start" &&
                    data?.data?.content_block?.name
                  ) {
                    const agent = req.agents?.find((name: string) =>
                      agentsManager
                        .getAgent(name)
                        ?.tools.get(data.data.content_block.name),
                    );
                    if (agent) {
                      currentAgent = agentsManager.getAgent(agent);
                      currentToolIndex = data.data.index;
                      currentToolName = data.data.content_block.name;
                      currentToolId = data.data.content_block.id;
                      return undefined;
                    }
                  }
                  if (
                    currentToolIndex > -1 &&
                    data.data.index === currentToolIndex &&
                    data.data?.delta?.type === "input_json_delta"
                  ) {
                    currentToolArgs += data.data?.delta?.partial_json;
                    return undefined;
                  }
                  if (
                    currentToolIndex > -1 &&
                    data.data.index === currentToolIndex &&
                    data.data.type === "content_block_stop"
                  ) {
                    try {
                      const args = JSON5.parse(currentToolArgs);
                      assistantMessages.push({
                        type: "tool_use",
                        id: currentToolId,
                        name: currentToolName,
                        input: args,
                      });
                      const toolResult = await currentAgent?.tools
                        .get(currentToolName)
                        ?.handler(args, { req, config });
                      toolMessages.push({
                        tool_use_id: currentToolId,
                        type: "tool_result",
                        content: toolResult,
                      });
                      currentAgent = undefined;
                      currentToolIndex = -1;
                      currentToolName = "";
                      currentToolArgs = "";
                      currentToolId = "";
                    } catch (e) {
                      console.log(e);
                    }
                    return undefined;
                  }
                  if (data.event === "message_delta" && toolMessages.length) {
                    const body = req.body as RequestBody;
                    if (body.messages) {
                      body.messages.push({
                        role: "assistant",
                        content: assistantMessages,
                      });
                      body.messages.push({
                        role: "user",
                        content: toolMessages,
                      });
                    }
                    const response = await fetch(
                      `http://127.0.0.1:${config.PORT || 3456}/v1/messages`,
                      {
                        method: "POST",
                        headers: {
                          "x-api-key": config.APIKEY || "",
                          "content-type": "application/json",
                        },
                        body: JSON.stringify(body),
                      },
                    );
                    if (!response.ok) {
                      return undefined;
                    }
                    const stream = response.body!.pipeThrough(
                      new SSEParserTransform(),
                    );
                    const reader = stream.getReader();
                    while (true) {
                      try {
                        const { value, done } = await reader.read();
                        if (done) break;
                        if (
                          ["message_start", "message_stop"].includes(
                            value.event,
                          )
                        )
                          continue;
                        if (!controller.desiredSize) break;
                        controller.enqueue(value);
                      } catch (readError: any) {
                        if (
                          readError.name === "AbortError" ||
                          readError.code === "ERR_STREAM_PREMATURE_CLOSE"
                        ) {
                          abortController.abort();
                          break;
                        }
                        throw readError;
                      }
                    }
                    return undefined;
                  }
                  return data;
                } catch (error: any) {
                  console.error(
                    "Unexpected error in stream processing:",
                    error,
                  );
                  if (error.code === "ERR_STREAM_PREMATURE_CLOSE") {
                    abortController.abort();
                    return undefined;
                  }
                  throw error;
                }
              },
            );
            done(
              null,
              rewrittenStream.pipeThrough(new SSESerializerTransform()),
            );
          } else {
            const [originalStream, clonedStream] = payload.tee();
            const read = async (stream: ReadableStream) => {
              const reader = stream.getReader();
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  const dataStr = new TextDecoder().decode(value);
                  if (dataStr.startsWith("event: message_delta")) {
                    const str = dataStr.slice(27);
                    try {
                      const message = JSON.parse(str);
                      if (req.sessionId) {
                        sessionUsageCache.put(req.sessionId, message.usage);
                      }
                    } catch {}
                  }
                }
              } catch (readError: any) {
                if (
                  readError.name !== "AbortError" &&
                  readError.code !== "ERR_STREAM_PREMATURE_CLOSE"
                ) {
                  console.error(
                    "Error in background stream reading:",
                    readError,
                  );
                }
              } finally {
                reader.releaseLock();
              }
            };
            read(clonedStream);
            done(null, originalStream);
          }
        } else {
          if (req.sessionId) {
            sessionUsageCache.put(req.sessionId, payload.usage);
          }
          done(null, payload);
        }
      } else {
        done(null, payload);
      }
    },
  );

  server.addHook(
    "onSend",
    (req: FastifyRequest, reply: FastifyReply, payload, done) => {
      event.emit("onSend", req, reply, payload);
      done(null, payload);
    },
  );

  server.listen({ port: servicePort, host: HOST }, (err) => {
    if (err) {
      server.log.error(err);
      process.exit(1);
    }
  });
}

export { run };
