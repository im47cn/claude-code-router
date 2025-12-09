import { existsSync } from "fs";
import { writeFile } from "fs/promises";
import { homedir } from "os";
import path, { join } from "path";
import { initConfig, initDir, cleanupLogFiles } from "./utils";
import { createServer } from "./server";
import { router } from "./utils/router";
import { apiKeyAuth } from "./middleware/auth";
import { createSubagentHeaders } from "./utils/authHeaders";
import {
  cleanupPidFile,
  isServiceRunning,
  savePid,
} from "./utils/processCheck";
import { CONFIG_FILE } from "./constants";
import { createStream } from 'rotating-file-stream';
import { HOME_DIR } from "./constants";
import { sessionUsageCache } from "./utils/cache";
import {SSEParserTransform} from "./utils/SSEParser.transform";
import {SSESerializerTransform} from "./utils/SSESerializer.transform";
import {rewriteStream} from "./utils/rewriteStream";
import JSON5 from "json5";
import { IAgent } from "./agents/type";
import agentsManager from "./agents";
import { EventEmitter } from "node:events";
import { SessionLoggerManager, DEFAULT_SESSION_LOG_CONFIG } from "./utils/sessionLogger";

const event = new EventEmitter()

async function initializeClaudeConfig() {
  const homeDir = homedir();
  const configPath = join(homeDir, ".claude.json");
  if (!existsSync(configPath)) {
    const userID = Array.from(
      { length: 64 },
      () => Math.random().toString(16)[2]
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

async function run(options: RunOptions = {}) {
  // Check if service is already running
  const isRunning = await isServiceRunning()
  if (isRunning) {
    console.log("✅ Service is already running in the background.");
    return;
  }

  await initializeClaudeConfig();
  await initDir();
  // Clean up old log files, keeping only the 10 most recent ones
  await cleanupLogFiles();
  const config = await initConfig();


  let HOST = config.HOST || "127.0.0.1";

  if (config.HOST && !config.APIKEY) {
    HOST = "127.0.0.1";
    console.warn("⚠️ API key is not set. HOST is forced to 127.0.0.1.");
  }

  const port = config.PORT || 3456;

  // Save the PID of the background process
  await savePid(process.pid);

  // Graceful shutdown flag to prevent duplicate handling
  let isShuttingDown = false;

  // 强制清理所有资源
  const forceCleanup = async () => {
    try {
      // 关闭所有活动连接
      if (server) {
        server.removeAllListeners();
      }
      // 清理PID文件
      cleanupPidFile();
    } catch (err) {
      console.error("Error during force cleanup:", err);
    }
  };

  // 关闭所有连接
  const closeAllConnections = async () => {
    if (server) {
      // 在关闭前关闭所有现有连接
      server.closeAllConnections();
    }
  };

  // Graceful shutdown handler
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) {
      console.log("Already shutting down, forcing cleanup and exit...");
      await forceCleanup();
      process.exit(1);
    }

    isShuttingDown = true;
    console.log(`Received ${signal}, shutting down gracefully...`);

    try {
      // 关闭所有活动连接
      await closeAllConnections();

      // 关闭服务器并等待现有连接
      await server.close();
      console.log("Server closed successfully");

      // 清理PID文件
      cleanupPidFile();

      console.log("Shutdown complete");
      process.exit(0);
    } catch (err) {
      console.error("Error during shutdown:", err);
      await forceCleanup();
      process.exit(1);
    }
  };

  // Handle SIGINT (Ctrl+C) and SIGTERM
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

  // Use port from environment variable if set (for background process)
  const servicePort = process.env.SERVICE_PORT
    ? parseInt(process.env.SERVICE_PORT)
    : port;

  // Function to truncate system field for logging
  const truncateSystemForLog = (system: any): any => {
    if (!system) return system;
    
    const maxLength = (config as any).LOG_SYSTEM_MAX_LENGTH || 1000;
    const enableTruncation = (config as any).LOG_TRUNCATE_SYSTEM !== false;
    
    if (!enableTruncation) return system;
    
    if (Array.isArray(system)) {
      // Handle system array format: [{ type: 'text', text: '...' }]
      return system.map(item => {
        if (item?.type === 'text' && typeof item?.text === 'string' && item.text.length > maxLength) {
          const originalLength = item.text.length;
          return {
            ...item,
            text: item.text.substring(0, maxLength) + 
              `\n\n... [SYSTEM_CONTENT_TRUNCATED_FOR_LOGGING: original length ${originalLength} characters, ${originalLength - maxLength} characters omitted] ...`
          };
        }
        return item;
      });
    } else if (typeof system === 'string' && system.length > maxLength) {
      const originalLength = system.length;
      return system.substring(0, maxLength) + 
        `\n\n... [SYSTEM_CONTENT_TRUNCATED_FOR_LOGGING: original length ${originalLength} characters, ${originalLength - maxLength} characters omitted] ...`;
    }
    
    return system;
  };

  // Function to truncate messages field for logging to prevent huge log entries
  const truncateMessagesForLog = (messages: any): any => {
    if (!Array.isArray(messages)) return messages;
    
    const maxMessages = (config as any).LOG_MAX_MESSAGES || 5;
    const maxMessageLength = (config as any).LOG_MAX_MESSAGE_LENGTH || 200;
    const enableTruncation = (config as any).LOG_TRUNCATE_MESSAGES !== false;
    
    if (!enableTruncation) return messages;
    
    const truncatedMessages = messages.slice(0, maxMessages).map((msg: any) => {
      if (msg?.content) {
        if (typeof msg.content === 'string' && msg.content.length > maxMessageLength) {
          const originalLength = msg.content.length;
          return {
            ...msg,
            content: msg.content.substring(0, maxMessageLength) + 
              `\n\n... [MESSAGE_CONTENT_TRUNCATED: original length ${originalLength} characters, ${originalLength - maxMessageLength} characters omitted] ...`
          };
        } else if (Array.isArray(msg.content)) {
          // Handle content array format
          return {
            ...msg,
            content: msg.content.map((item: any) => {
              if (item?.type === 'text' && typeof item?.text === 'string' && item.text.length > maxMessageLength) {
                const originalLength = item.text.length;
                return {
                  ...item,
                  text: item.text.substring(0, maxMessageLength) + 
                    `\n\n... [MESSAGE_CONTENT_TRUNCATED: original length ${originalLength} characters, ${originalLength - maxMessageLength} characters omitted] ...`
                };
              }
              return item;
            })
          };
        }
      }
      return msg;
    });

    // Add indicator if messages were truncated
    if (messages.length > maxMessages) {
      truncatedMessages.push({
        role: 'system',
        content: `[... ${messages.length - maxMessages} additional messages omitted for logging ...]`
      });
    }

return truncatedMessages;
  };

  // Initialize session logger manager
  const sessionLogConfig = {
    enabled: config.SESSION_LOG_ENABLED !== false,
    retentionDays: config.SESSION_LOG_RETENTION_DAYS || 7,
    maxFilesPerSession: config.SESSION_LOG_MAX_FILES_PER_SESSION || 5,
    maxSizePerFile: config.SESSION_LOG_MAX_SIZE || '10M',
    includeCommandName: config.SESSION_LOG_INCLUDE_COMMAND_NAME !== false
  };
  
  const sessionLoggerManager = new SessionLoggerManager(sessionLogConfig);

  // Configure logger based on config settings
  const pad = (num: number) => (num > 9 ? "" : "0") + num;
  const generator = (time: number | Date, index?: number) => {
    const date = typeof time === 'number' ? new Date(time) : (time || new Date());
    
    var month = date.getFullYear() + "" + pad(date.getMonth() + 1);
    var day = pad(date.getDate());

    // For daily rotation, use daily format without time components
    // Include index only when there are multiple files for the same day
    return `./logs/ccr-${month}${day}${index ? `_${index}` : ''}.log`;
  };
  const loggerConfig =
    config.LOG !== false
      ? {
          level: config.LOG_LEVEL || "debug",
          stream: createStream(generator, {
            path: HOME_DIR,
            maxFiles: 7, // Keep 7 days of daily logs
            interval: "1d",
            compress: false,
            maxSize: "50M",
            immutable: false // Allow rotation when size limit is reached
          }),
          serializers: {
            req: (req: any) => ({
              method: req.method,
              url: req.url,
              headers: req.headers,
              // Truncate large fields for logging while preserving request integrity
              body: req.body ? {
                model: req.body.model,
                max_tokens: req.body.max_tokens,
                messages: req.body.messages ? truncateMessagesForLog(req.body.messages) : undefined,
                system: req.body.system ? truncateSystemForLog(req.body.system) : undefined,
                tools: req.body.tools ? req.body.tools.length : undefined,
                stream: req.body.stream,
                temperature: req.body.temperature
              } : undefined
            }),
            res: (res: any) => ({
              statusCode: res.statusCode,
              headers: res.headers
            })
          }
        }
      : false;

  const server = createServer({
    jsonPath: CONFIG_FILE,
    initialConfig: {
      // ...config,
      providers: config.Providers || config.providers,
      HOST: HOST,
      PORT: servicePort,
      LOG_FILE: join(
        homedir(),
        ".claude-code-router",
        "claude-code-router.log"
      ),
    },
    logger: loggerConfig,
    sessionLoggerManager,
  });

  // Add global error handlers
  process.on("uncaughtException", (err) => {
    if (server && server.logger) {
      server.logger.error("Uncaught exception:", err);
    } else {
      console.error("Uncaught exception:", err);
    }
    // Process is in undefined state after uncaughtException, should exit
    // Give logger time to flush before exiting
    setTimeout(() => {
      cleanupPidFile();
      process.exit(1);
    }, 1000);
  });

  process.on("unhandledRejection", (reason, promise) => {
    if (server && server.logger) {
      server.logger.error("Unhandled rejection at:", promise, "reason:", reason);
    } else {
      console.error("Unhandled rejection at:", promise, "reason:", reason);
    }
    // Note: In Node.js 15+, unhandled rejections are warnings by default
    // We log but don't exit for these
  });
  // Add async preHandler hook for authentication
  server.addHook("preHandler", async (req, reply) => {
    try {
      await apiKeyAuth(config)(req, reply);
    } catch (err) {
      reply.code(401).send({ error: "Authentication failed" });
      return;
    }
  });
  server.addHook("preHandler", async (req, reply) => {
    if (req.url.startsWith("/v1/messages") && !req.url.startsWith("/v1/messages/count_tokens")) {
      const useAgents = []

      for (const agent of agentsManager.getAllAgents()) {
        if (agent.shouldHandle(req, config)) {
          // 设置agent标识
          useAgents.push(agent.name)

          // change request body
          agent.reqHandler(req, config);

          // append agent tools
          if (agent.tools.size) {
            if (!req.body?.tools?.length) {
              req.body.tools = []
            }
            req.body.tools.unshift(...Array.from(agent.tools.values()).map(item => {
              return {
                name: item.name,
                description: item.description,
                input_schema: item.input_schema
              }
            }))
          }
        }
      }

      if (useAgents.length) {
        req.agents = useAgents;
      }
      await router(req, reply, {
        config,
        event,
        sessionLoggerManager
      });
    }
  });
  server.addHook("onError", async (request, reply, error) => {
    event.emit('onError', request, reply, error);
  })
  server.addHook("onSend", async (req, reply, payload) => {
    if (req.sessionId && req.url.startsWith("/v1/messages") && !req.url.startsWith("/v1/messages/count_tokens")) {
      if (payload instanceof ReadableStream) {
        if (req.agents) {
          const abortController = new AbortController();
          // AbortController状态跟踪
          let isAborted = false;
          const safeAbort = () => {
            if (!isAborted) {
              abortController.abort();
              isAborted = true;
            }
          };
          const eventStream = payload.pipeThrough(new SSEParserTransform())
          let currentAgent: undefined | IAgent;
          let currentToolIndex = -1
          let currentToolName = ''
          let currentToolArgs = ''
          let currentToolId = ''
          const toolMessages: any[] = []
          const assistantMessages: any[] = []
          // 存储Anthropic格式的消息体，区分文本和工具类型
          return rewriteStream(eventStream, async (data, controller) => {
            try {
              // 检测工具调用开始
              if (data.event === 'content_block_start' && data?.data?.content_block?.name) {
                const agent = req.agents.find((name: string) => agentsManager.getAgent(name)?.tools.get(data.data.content_block.name))
                if (agent) {
                  currentAgent = agentsManager.getAgent(agent)
                  currentToolIndex = data.data.index
                  currentToolName = data.data.content_block.name
                  currentToolId = data.data.content_block.id
                  return undefined;
                }
              }

              // 收集工具参数
              if (currentToolIndex > -1 && data.data.index === currentToolIndex && data.data?.delta?.type === 'input_json_delta') {
                currentToolArgs += data.data?.delta?.partial_json;
                return undefined;
              }

              // 工具调用完成，处理agent调用
              if (currentToolIndex > -1 && data.data.index === currentToolIndex && data.data.type === 'content_block_stop') {
                try {
                  const args = JSON5.parse(currentToolArgs);
                  assistantMessages.push({
                    type: "tool_use",
                    id: currentToolId,
                    name: currentToolName,
                    input: args
                  })
                  const toolResult = await currentAgent?.tools.get(currentToolName)?.handler(args, {
                    req,
                    config
                  });
                  toolMessages.push({
                    "tool_use_id": currentToolId,
                    "type": "tool_result",
                    "content": toolResult
                  })
                  currentAgent = undefined
                  currentToolIndex = -1
                  currentToolName = ''
                  currentToolArgs = ''
                  currentToolId = ''
                } catch (e) {
                  server.logger.error('Agent tool execution failed:', e);
                  toolMessages.push({
                    "tool_use_id": currentToolId,
                    "type": "tool_result",
                    "content": `Error: ${(e as Error).message}`,
                    "is_error": true
                  })
                  currentAgent = undefined
                  currentToolIndex = -1
                  currentToolName = ''
                  currentToolArgs = ''
                  currentToolId = ''
                }
                return undefined;
              }

              if (data.event === 'message_delta' && toolMessages.length) {
                req.body.messages.push({
                  role: 'assistant',
                  content: assistantMessages
                })
                req.body.messages.push({
                  role: 'user',
                  content: toolMessages
                })
                const headers = await createSubagentHeaders(req, config);
                // 改进的超时处理
                let response: Response;
                const subagentAbortController = new AbortController();
                const subagentTimeout = setTimeout(() => {
                  if (!subagentAbortController.signal.aborted) {
                    subagentAbortController.abort();
                  }
                }, 60000);
                try {
                  // Safe JSON stringify to handle circular references
                  const safeJsonStringify = (obj: any, space?: number): string => {
                    const cache = new Set();
                    return JSON.stringify(obj, (key, value) => {
                      if (typeof value === 'object' && value !== null) {
                        if (cache.has(value)) {
                          // Circular reference detected, skip this property
                          return '[Circular]';
                        }
                        cache.add(value);
                      }
                      return value;
                    }, space);
                  };

                  response = await fetch(`http://127.0.0.1:${config.PORT || 3456}/v1/messages`, {
                    method: "POST",
                    headers,
                    body: safeJsonStringify(req.body),
                    signal: subagentAbortController.signal,
                  });
                } catch (fetchError: any) {
                  if (fetchError.name === 'AbortError') {
                    server.logger.error('Subagent request timeout after 60 seconds');
                  } else {
                    server.logger.error(`Subagent fetch error: ${fetchError.message}`);
                  }
                  return undefined;
                } finally {
                  clearTimeout(subagentTimeout);
                }
                if (!response.ok) {
                  const errorText = await response.text().catch(() => 'Unknown error');
                  server.logger.error(`Subagent request failed: ${response.status} ${errorText}`);
                  return undefined;
                }
                if (!response.body) {
                  server.logger.error('Subagent response has no body');
                  return undefined;
                }
                const stream = response.body.pipeThrough(new SSEParserTransform())
                const reader = stream.getReader()
                try {
                  while (true) {
                    const {value, done: streamDone} = await reader.read();
                    if (streamDone) {
                      break;
                    }
                    if (['message_start', 'message_stop'].includes(value.event)) {
                      continue
                    }

                    // 更可靠的流状态检测和错误处理
                    try {
                      // 检查流状态
                      const stream = controller as any;
                      if (stream?.state === 'closed' || stream?.locked) {
                        server.logger.debug('Stream is closed or locked, breaking loop');
                        break;
                      }

                      // 尝试入队，处理流关闭异常
                      controller.enqueue(value);
                    } catch (error: any) {
                      if (error.code === 'ERR_STREAM_PREMATURE_CLOSE' || error.code === 'ERR_INVALID_STATE') {
                        server.logger.debug(`Stream operation failed: ${error.message}, breaking loop`);
                        break;
                      }
                      throw error;
                    }
                  }
                } catch (readError: any) {
                  // 增强的错误处理
                  if (readError.name === 'AbortError') {
                    server.logger.debug('Stream reading was aborted');
                    return;
                  }
                  if (readError.code === 'ERR_STREAM_PREMATURE_CLOSE') {
                    server.logger.debug('Stream closed prematurely by client');
                    safeAbort();
                    return;
                  }
                  if (readError.code === 'ECONNRESET' || readError.code === 'ENOTFOUND' || readError.code === 'ETIMEDOUT') {
                    server.logger.warn(`Network error during stream read: ${readError.message}`);
                    safeAbort();
                    return;
                  }
                  if (readError.name === 'TimeoutError') {
                    server.logger.warn(`Stream read timeout: ${readError.message}`);
                    safeAbort();
                    return;
                  }
                  throw readError;
                } finally {
                  reader.releaseLock();
                }
                return undefined
              }
              return data
            } catch (error: any) {
              server.logger.error('Unexpected error in stream processing:', error);

              // 处理流提前关闭的错误
              if (error.code === 'ERR_STREAM_PREMATURE_CLOSE') {
                server.logger.debug('Stream closed prematurely in main processing');
                safeAbort();
                return undefined;
              }

              // 其他错误仍然抛出
              throw error;
            }
          }).pipeThrough(new SSESerializerTransform())
        }

        const [originalStream, clonedStream] = payload.tee();
        const read = async (stream: ReadableStream) => {
          const reader = stream.getReader();
          try {
            while (true) {
              const { done: streamDone, value } = await reader.read();
              if (streamDone) break;
              // Process the value if needed
              const dataStr = new TextDecoder().decode(value);
              if (!dataStr.startsWith("event: message_delta")) {
                continue;
              }
              const str = dataStr.slice(27);
              try {
                const message = JSON.parse(str);
                sessionUsageCache.put(req.sessionId, message.usage);
              } catch {
                // Silently ignore parse errors for usage data
              }
            }
          } catch (readError: any) {
            if (readError.name === 'AbortError' || readError.code === 'ERR_STREAM_PREMATURE_CLOSE') {
              server.logger.debug('Background read stream closed prematurely');
            } else {
              server.logger.error('Error in background stream reading:', readError);
            }
          } finally {
            reader.releaseLock();
          }
        }
        read(clonedStream);
        return originalStream
      }
      sessionUsageCache.put(req.sessionId, payload.usage);
      if (typeof payload === 'object') {
        if (payload.error) {
          throw payload.error
        }
        return payload
      }
    }
    if (typeof payload === 'object' && payload.error) {
      throw payload.error
    }
    return payload
  });
  server.addHook("onSend", async (req, reply, payload) => {
    event.emit('onSend', req, reply, payload);
    return payload;
  })


  server.start();
}

// Test helper function to create app instance without starting the server
export function buildApp(testConfig: any = {}) {
  const config = {
    PORT: 0, // Use random port for testing
    HOST: "127.0.0.1",
    APIKEY: "test-api-key",
    ...testConfig
  };

  // Import fastify directly to avoid the complex Server creation
  const fastify = require('fastify');

  const app = fastify({
    logger: false // Disable logging for tests
  });

  // Add mock routes for testing
  app.post('/v1/messages', async (request: any, reply: any) => {
    // For testing, return 400 if there's a client OAuth token (simulating failed auth)
    if ((request as any).authType === 'client-oauth') {
      return reply.code(400).send({
        error: 'Client OAuth not supported in test environment'
      });
    }

    // Return success for other cases
    return {
      id: 'test-response',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Test response' }]
    };
  });

  app.post('/v1/messages/count_tokens', async (request: any, reply: any) => {
    return { input_tokens: 100 };
  });

  app.get('/health', async (request: any, reply: any) => {
    return { status: 'ok' };
  });

  app.get('/', async (request: any, reply: any) => {
    return { status: 'ok' };
  });

  // Simplified authentication middleware - no complex logic
  app.addHook('preHandler', async (req: any, reply: any) => {
    // Minimal mock setup
    (req as any).server = {
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {}
      }
    };

    // Basic auth detection
    const authHeader = req.headers['authorization'];
    const apiKeyHeader = req.headers['x-api-key'];

    if (authHeader?.startsWith('Bearer ')) {
      (req as any).authToken = authHeader.substring(7);
      (req as any).authType = 'client-oauth';
    } else if (apiKeyHeader === config.APIKEY) {
      (req as any).authToken = apiKeyHeader;
      (req as any).authType = 'api-key';
    }

    (req as any).config = config;
    (req as any).log = (req as any).server.logger;
  });

  // Add ready method for compatibility with tests
  (app as any).ready = async () => {
    // Fastify ready method - no-op for testing
  };

  (app as any).close = async () => {
    // Mock close method for testing
  };

  return app;
}

export { run };
// run();
