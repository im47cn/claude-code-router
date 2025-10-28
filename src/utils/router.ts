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
import { selectRandomKey } from "./keySelector";

const enc = get_encoding("cl100k_base");

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

/**
 * Select a model randomly from a semicolon-separated list of model configurations
 * @param modelString - The model configuration string, e.g., "provider1,model1;provider2,model2"
 * @returns A randomly selected model configuration string, e.g., "provider1,model1"
 */
export const selectRandomModel = (modelString: string): string => {
  if (!modelString) {
    return modelString;  // Return the original string for empty value
  }

  if (!modelString.includes(';')) {
    return modelString;  // 单模型，直接返回
  }

  const models = modelString.split(';').map(m => m.trim()).filter(Boolean);
  if (models.length === 0) {
    return modelString;  // 异常情况，返回原字符串
  }

  if (models.length === 1) {
    // Return the original string if there is only one valid model (preserves semicolon)
    return modelString.trim();
  }

  const randomIndex = Math.floor(Math.random() * models.length);
  return models[randomIndex];
};


/**
 * Parse a model string ("provider,model"), select a random key based on the provider config,
 * and attach the selected key to req.selectedApiKey (without modifying req.body.model for backward compatibility)
 */
export const attachSelectedKeyToReq = (modelString: string, config: any, req: any) => {
  if (!modelString || typeof modelString !== 'string') return;
  const [provRaw] = modelString.split(',');
  if (!provRaw) return;
  const provName = provRaw.trim().toLowerCase();
  const providerConfig = (config.Providers || []).find((p: any) => p.name && p.name.toLowerCase() === provName);
  if (!providerConfig) return;
  const key = selectRandomKey(providerConfig);
  if (key) {
    // Do not log the key in plaintext, attach it directly to the request object
    req.selectedApiKey = key;
  }
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
    const [providerRaw, modelRaw] = req.body.model.split(",");
    const provider = providerRaw?.trim().toLowerCase();
    const model = modelRaw?.trim().toLowerCase();
    const finalProvider = config.Providers.find(
      (p: any) => p.name && p.name.toLowerCase() === provider
    );
    const finalModel = finalProvider?.models?.find(
      (m: any) => m && m.toLowerCase() === model
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
    return selectRandomModel(Router.longContext);
  }
  if (
    req.body?.system?.length > 1 &&
    req.body?.system[1]?.text?.startsWith("<CCR-SUBAGENT-MODEL>")
  ) {
    const model = req.body?.system[1].text.match(
      /<CCR-SUBAGENT-MODEL>(.*?)<\/CCR-SUBAGENT-MODEL>/s
    );
    if (model) {
      req.body.system[1].text = req.body.system[1].text.replace(
        `<CCR-SUBAGENT-MODEL>${model[1]}</CCR-SUBAGENT-MODEL>`,
        ""
      );
      return selectRandomModel(model[1]);
    }
  }
  // Use the background model for any Claude Haiku variant
  if (
    req.body.model?.includes("claude") &&
    req.body.model?.includes("haiku") &&
    config.Router.background
  ) {
    req.log.info(`Using background model for ${req.body.model}`);
    return selectRandomModel(config.Router.background);
  }
  // The priority of websearch must be higher than thinking.
  if (
    Array.isArray(req.body.tools) &&
    req.body.tools.some((tool: any) => tool.type?.startsWith("web_search")) &&
    Router.webSearch
  ) {
    return selectRandomModel(Router.webSearch);
  }
  // if exits thinking, use the think model
  if (req.body.thinking && Router.think) {
    req.log.info(`Using think model for ${req.body.thinking}`);
    return selectRandomModel(Router.think);
  }
  return selectRandomModel(Router!.default);
};

export const router = async (req: any, _res: any, context: any) => {
  const { config, event } = context;

  // Handle null/undefined request body
  if (!req.body) {
    req.log?.error?.('Request body is null or undefined');
    req.body = {};
    // Set default model from config if available
    if (config.Router?.default) {
      req.body.model = config.Router.default;
    }
    return;
  }

  // Handle null/undefined config
  if (!config) {
    req.log?.error?.('Config is null or undefined');
    return;
  }

  // Parse sessionId from metadata.user_id
  if (req.body.metadata?.user_id) {
    const parts = req.body.metadata.user_id.split("_session_");
    if (parts.length > 1) {
      req.sessionId = parts[1];
    }
  }
  const lastMessageUsage = sessionUsageCache.get(req.sessionId);
  const { messages, system = [], tools }: MessageCreateParamsBase = req.body;
  if (
    config.REWRITE_SYSTEM_PROMPT &&
    system.length > 1 &&
    typeof system[1] === 'object' &&
    system[1] !== null &&
    'text' in system[1] &&
    typeof (system[1] as any).text === 'string' &&
    (system[1] as any).text.includes("<env>")
  ) {
    const prompt = await readFile(config.REWRITE_SYSTEM_PROMPT, "utf-8");
    (system[1] as any).text = `${prompt}<env>${(system[1] as any).text.split("<env>").pop()}`;
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

    // 尝试为确定的 model 随机选择 provider key 并挂载到 req.selectedApiKey（不修改 req.body.model）
    try {
      attachSelectedKeyToReq(model, config, req);
    } catch (e: any) {
      // 不让 key 选择失败阻塞主要路由流程，只记录日志
      req.log?.warn?.(`attachSelectedKeyToReq failed: ${e?.message || e}`);
    }
  } catch (error: any) {
    req.log.error(`Error in router middleware: ${error.message}`);
    req.body.model = selectRandomModel(config.Router!.default);
  }
  return;
};

// 内存缓存，存储sessionId到项目名称的映射
// null值表示之前已查找过但未找到项目
// 使用LRU缓存，限制最大1000个条目
const sessionProjectCache = new LRUCache<string, string | null>({
  max: 1000,
  ttl: 1000 * 60 * 10, // 10分钟
  allowStale: false,
  updateAgeOnGet: true,
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
        `${sessionId || 'unknown'}.jsonl`
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
