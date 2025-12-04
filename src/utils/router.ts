import {
  MessageCreateParamsBase,
  MessageParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages";
import { get_encoding } from "tiktoken";
import { sessionUsageCache, Usage } from "./cache";
import { readFile, access } from "fs/promises";
import { opendir, stat } from "fs/promises";
import { join } from "path";
import { CLAUDE_PROJECTS_DIR, HOME_DIR } from "../constants";
import { LRUCache } from "lru-cache";

const enc = get_encoding("cl100k_base");

/**
 * 安全地将值转换为字符串用于日志记录
 */
function safeStringifyForLog(value: any): string {
  if (value === null || value === undefined) {
    return 'undefined';
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (typeof value === 'object') {
    try {
      // 防止 [object Object] 问题：如果对象已经被转换为字符串，直接返回
      if (typeof value.toString === 'function' && value.toString() === '[object Object]') {
        // 对于有问题的对象，尝试提取关键属性
        if (value.type !== undefined) {
          return `thinking: ${value.type}`;
        }
        if (value.enabled !== undefined) {
          return `thinking: ${value.enabled ? 'enabled' : 'disabled'}`;
        }
        if (value.budget_tokens !== undefined) {
          return `thinking: budget=${value.budget_tokens}`;
        }
        // 如果没有关键属性，返回通用描述
        return 'thinking: object';
      }

      // 对于正常对象，提取关键信息而不是完整 JSON
      if (value && typeof value === 'object' && value.type) {
        return `thinking: ${value.type}`;
      }
      if (value && typeof value === 'object' && value.enabled !== undefined) {
        return `thinking: ${value.enabled ? 'enabled' : 'disabled'}`;
      }
      if (value && typeof value === 'object' && value.budget_tokens !== undefined) {
        return `thinking: budget=${value.budget_tokens}`;
      }
      // 回退到 JSON 字符串，但限制长度
      const json = JSON.stringify(value);
      return json.length > 50 ? json.substring(0, 47) + '...' : json;
    } catch {
      return 'thinking: [Object]';
    }
  }

  return String(value);
}

/**
 * Detects if the request is a ClaudeMem request based on message content
 * ClaudeMem requests contain specific system prompt patterns
 *
 * Uses precise patterns to avoid false positives from casual mentions
 */
export const isClaudeMemRequest = (messages: MessageParam[]): boolean => {
  if (!Array.isArray(messages) || messages.length === 0) {
    return false;
  }

  // ClaudeMem system prompt pattern (case-insensitive)
  // Based on actual ClaudeMem system prompt: "You are a Claude-Mem, a specialized observer tool..."
  const claudeMemPattern = 'you are a claude-mem';

  for (const message of messages) {
    if (typeof message.content === 'string') {
      if (message.content.toLowerCase().includes(claudeMemPattern)) {
        return true;
      }
    } else if (Array.isArray(message.content)) {
      for (const contentPart of message.content) {
        if (contentPart.type === 'text' &&
            typeof (contentPart as any).text === 'string') {
          if ((contentPart as any).text.toLowerCase().includes(claudeMemPattern)) {
            return true;
          }
        }
      }
    }
  }

  return false;
};

/**
 * OAuth Router marker detection functions
 */
const detectOAuthRouterMarker = (system: any[]): string | null => {
  if (!Array.isArray(system) || system.length <= 1) return null;

  const systemText = system[1]?.text;
  if (typeof systemText !== 'string') return null;

  const routerMatch = systemText.match(/<CCR-SUBAGENT-ROUTER>(.*?)<\/CCR-SUBAGENT-ROUTER>/s);
  return routerMatch ? routerMatch[1] : null;
};

const isValidRouter = (routerName: string, config: any): boolean => {
  return config && config.Router && typeof config.Router[routerName] === 'string';
};

const cleanRouterMarker = (system: any[], routerName: string): void => {
  if (system.length > 1 && typeof system[1]?.text === 'string') {
    system[1].text = system[1].text.replace(
      `<CCR-SUBAGENT-ROUTER>${routerName}</CCR-SUBAGENT-ROUTER>`,
      ""
    );
    // Also clean any CCR-SUBAGENT-MODEL markers since OAuth routing takes priority
    system[1].text = system[1].text.replace(
      /<CCR-SUBAGENT-MODEL>.*?<\/CCR-SUBAGENT-MODEL>/gs,
      ""
    );
  }
};


export const calculateTokenCount = (
  messages: MessageParam[],
  system: any,
  tools: Tool[]
) => {
  let tokenCount = 0;
  if (Array.isArray(messages)) {
    messages.forEach((message) => {
      if (typeof message.content === "string") {
        tokenCount += enc.encode(message.content).length;
      } else if (Array.isArray(message.content)) {
        message.content.forEach((contentPart: any) => {
          if (contentPart.type === "text") {
            tokenCount += enc.encode(contentPart.text).length;
          } else if (contentPart.type === "tool_use") {
            tokenCount += enc.encode(JSON.stringify(contentPart.input)).length;
          } else if (contentPart.type === "tool_result") {
            tokenCount += enc.encode(
              typeof contentPart.content === "string"
                ? contentPart.content
                : JSON.stringify(contentPart.content)
            ).length;
          }
        });
      }
    });
  }
  if (typeof system === "string") {
    tokenCount += enc.encode(system).length;
  } else if (Array.isArray(system)) {
    system.forEach((item: any) => {
      if (item.type !== "text") return;
      if (typeof item.text === "string") {
        tokenCount += enc.encode(item.text).length;
      } else if (Array.isArray(item.text)) {
        item.text.forEach((textPart: any) => {
          tokenCount += enc.encode(textPart || "").length;
        });
      }
    });
  }
  if (tools) {
    tools.forEach((tool: Tool) => {
      if (tool.description) {
        tokenCount += enc.encode(tool.name + tool.description).length;
      }
      if (tool.input_schema) {
        tokenCount += enc.encode(JSON.stringify(tool.input_schema)).length;
      }
    });
  }
  return tokenCount;
};

const readConfigFile = async (filePath: string) => {
  try {
    await access(filePath);
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    return null; // 文件不存在或读取失败时返回null
  }
};

const getProjectSpecificRouter = async (req: any) => {
  // 检查是否有项目特定的配置
  if (req.sessionId) {
    const project = await searchProjectBySession(req.sessionId);
    if (project) {
      const projectConfigPath = join(HOME_DIR, project, "config.json");
      const sessionConfigPath = join(
        HOME_DIR,
        project,
        `${req.sessionId}.json`
      );

      // 首先尝试读取sessionConfig文件
      const sessionConfig = await readConfigFile(sessionConfigPath);
      if (sessionConfig && sessionConfig.Router) {
        return sessionConfig.Router;
      }
      const projectConfig = await readConfigFile(projectConfigPath);
      if (projectConfig && projectConfig.Router) {
        return projectConfig.Router;
      }
    }
  }
  return undefined; // 返回undefined表示使用原始配置
};

const getUseModel = async (
  req: any,
  tokenCount: number,
  config: any,
  lastUsage?: Usage | undefined
) => {
  const projectSpecificRouter = await getProjectSpecificRouter(req);
  const Router = projectSpecificRouter || config.Router;

  if (req.body.model.includes(",")) {
    const [provider, model] = req.body.model.split(",");
    const finalProvider = config.Providers.find(
      (p: any) => p.name.toLowerCase() === provider
    );
    const finalModel = finalProvider?.models?.find(
      (m: any) => m.toLowerCase() === model
    );
    if (finalProvider && finalModel) {
      return `${finalProvider.name},${finalModel}`;
    }
    return req.body.model;
  }

  // if tokenCount is greater than the configured threshold, use the long context model
  const longContextThreshold = Router.longContextThreshold || 60000;
  const lastUsageThreshold =
    lastUsage &&
    lastUsage.input_tokens > longContextThreshold &&
    tokenCount > 20000;
  const tokenCountThreshold = tokenCount > longContextThreshold;
  if ((lastUsageThreshold || tokenCountThreshold) && Router.longContext) {
    req.log.info(
      `Using long context model due to token count: ${tokenCount}, threshold: ${longContextThreshold}`
    );
    return Router.longContext;
  }
  // Only process CCR-SUBAGENT-MODEL if OAuth routing hasn't already set the model
  // This gives OAuth Router markers priority over SUBAGENT-MODEL specifications
  if (
    req.body?.system?.length > 1 &&
    req.body?.system[1]?.text?.includes("<CCR-SUBAGENT-MODEL>") &&
    !req.isOAuthRequest
  ) {
    const model = req.body?.system[1].text.match(
      /<CCR-SUBAGENT-MODEL>(.*?)<\/CCR-SUBAGENT-MODEL>/s
    );
    if (model) {
      req.body.system[1].text = req.body.system[1].text.replace(
        `<CCR-SUBAGENT-MODEL>${model[1]}</CCR-SUBAGENT-MODEL>`,
        ""
      );
      return model[1];
    }
  }
  // Use the background model for any Claude Haiku variant
  if (
    req.body.model?.includes("claude") &&
    req.body.model?.includes("haiku") &&
    config.Router.background
  ) {
    req.log.info(`Using background model for ${safeStringifyForLog(req.body.model)}`);
    return config.Router.background;
  }
  // The priority of websearch must be higher than thinking.
  if (
    Array.isArray(req.body.tools) &&
    req.body.tools.some((tool: any) => tool.type?.startsWith("web_search")) &&
    Router.webSearch
  ) {
    return Router.webSearch;
  }
  // if exits thinking, use the think model
  if (req.body.thinking && Router.think) {
    req.log.info(`Using think model for ${safeStringifyForLog(req.body.thinking)}`);
    return Router.think;
  }


  return Router?.default || 'openrouter,anthropic/claude-3.5-sonnet';
};

export const router = async (req: any, _res: any, context: any) => {
  const { config, event } = context;

  // Router marker detection and conditional routing (applies to all requests, not just OAuth)
  const routerName = detectOAuthRouterMarker(req.body?.system);

  if (routerName) {
    // Request with router marker - apply model routing
    if (isValidRouter(routerName, config)) {
      if (req.isOAuthRequest) {
        req.log?.info({
          url: req.url,
          method: req.method,
          oauthRequestType: req.oauthRequestType,
          routerName: routerName,
          targetModel: config.Router[routerName]
        }, 'OAuth request with router marker - applying model routing');
      } else {
        req.log?.info({
          url: req.url,
          method: req.method,
          routerName: routerName,
          targetModel: config.Router[routerName]
        }, 'Request with router marker - applying model routing');
      }

      // Clean router marker from system message
      cleanRouterMarker(req.body.system, routerName);

      // Set target model and continue with normal processing
      req.body.model = config.Router[routerName];
    } else {
      req.log?.warn({
        routerName: routerName,
        availableRouters: Object.keys(config?.Router || {}),
        isOAuthRequest: req.isOAuthRequest
      }, 'Router marker references non-existent router - cleaning marker and falling back to default routing');

      // Clean invalid router marker and fall back to default routing
      cleanRouterMarker(req.body.system, routerName);
    }
  } else if (req.isOAuthRequest) {
    // OAuth request without router marker - transparent forwarding
    // Log detailed information for transparent forwarding requests
    const originalModel = req.body?.model;
    const hasThinking = !!req.body?.thinking;
    const messageCount = Array.isArray(req.body?.messages) ? req.body.messages.length : 0;
    const toolCount = Array.isArray(req.body?.tools) ? req.body.tools.length : 0;

    req.log?.info({
      url: req.url,
      method: req.method,
      oauthRequestType: req.oauthRequestType,
      oauthConfidence: req.oauthConfidence,
      model: originalModel,
      hasThinking: hasThinking,
      thinkingBudget: hasThinking ? req.body.thinking.budget_tokens : undefined,
      messageCount: messageCount,
      toolCount: toolCount,
      maxTokens: req.body?.max_tokens,
      stream: req.body?.stream,
      isTransparent: true
    }, 'Transparent forwarding - OAuth request bypassing model routing');
    return;
  }

  // Parse sessionId from metadata.user_id (client-generated, no validation needed)
  if (req.body.metadata?.user_id) {
    const parts = req.body.metadata.user_id.split("_session_");
    if (parts.length > 1) {
      req.sessionId = parts[1];
    }
  }
  const lastMessageUsage = sessionUsageCache.get(req.sessionId);
  const { messages, system = [], tools }: MessageCreateParamsBase = req.body;

  // Store original auth type for logging (now handled in auth middleware)
  const originalAuthType = req.authType;
  if (
    config.REWRITE_SYSTEM_PROMPT &&
    system.length > 1 &&
    system[1] &&
    typeof system[1].text === 'string' &&
    system[1].text.includes("<env>")
  ) {
    const prompt = await readFile(config.REWRITE_SYSTEM_PROMPT, "utf-8");
    const envPart = system[1].text.split("<env>").pop() || "";
    system[1].text = `${prompt}<env>${envPart}`;
  }

  try {
    const tokenCount = calculateTokenCount(
      messages as MessageParam[],
      system,
      tools as Tool[]
    );

    let model;
    if (config.CUSTOM_ROUTER_PATH) {
      try {
        const customRouter = require(config.CUSTOM_ROUTER_PATH);
        req.tokenCount = tokenCount; // Pass token count to custom router
        model = await customRouter(req, config, {
          event,
        });
      } catch (e: any) {
        req.log.error(`failed to load custom router: ${e.message}`);
      }
    }
    if (!model) {
      model = await getUseModel(req, tokenCount, config, lastMessageUsage);
    }

    req.body.model = model;
  } catch (error: any) {
    req.log.error(`Error in router middleware: ${error.message}`);
    req.body.model = config.Router?.default || 'openrouter,anthropic/claude-3.5-sonnet';
  }

  // Request summary log
  const authMethod = (!req.authToken && !req.authType) ? 'provider-api-key' : (originalAuthType || 'none');
  req.log?.info({
    originalAuthType: originalAuthType,
    finalAuthType: authMethod,
    model: req.body.model,
    sessionId: req.sessionId,
    hasClientToken: !!originalAuthType,
    oauthRequest: req.isOAuthRequest || false
  }, 'Request processed with authentication strategy');

  return;
};

// 内存缓存，存储sessionId到项目名称的映射
// null值表示之前已查找过但未找到项目
// 使用LRU缓存，限制最大1000个条目
const sessionProjectCache = new LRUCache<string, string | null>({
  max: 1000,
});

export const searchProjectBySession = async (
  sessionId: string
): Promise<string | null> => {
  // 首先检查缓存
  if (sessionProjectCache.has(sessionId)) {
    return sessionProjectCache.get(sessionId)!;
  }

  try {
    const dir = await opendir(CLAUDE_PROJECTS_DIR);
    const folderNames: string[] = [];

    // 收集所有文件夹名称
    for await (const dirent of dir) {
      if (dirent.isDirectory()) {
        folderNames.push(dirent.name);
      }
    }

    // 并发检查每个项目文件夹中是否存在sessionId.jsonl文件
    const checkPromises = folderNames.map(async (folderName) => {
      const sessionFilePath = join(
        CLAUDE_PROJECTS_DIR,
        folderName,
        `${sessionId}.jsonl`
      );
      try {
        const fileStat = await stat(sessionFilePath);
        return fileStat.isFile() ? folderName : null;
      } catch {
        // 文件不存在，继续检查下一个
        return null;
      }
    });

    const results = await Promise.all(checkPromises);

    // 返回第一个存在的项目目录名称
    for (const result of results) {
      if (result) {
        // 缓存找到的结果
        sessionProjectCache.set(sessionId, result);
        return result;
      }
    }

    // 缓存未找到的结果（null值表示之前已查找过但未找到项目）
    sessionProjectCache.set(sessionId, null);
    return null; // 没有找到匹配的项目
  } catch (error) {
    console.error("Error searching for project by session:", error);
    // 出错时也缓存null结果，避免重复出错
    sessionProjectCache.set(sessionId, null);
    return null;
  }
};
