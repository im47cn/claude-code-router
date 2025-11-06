import { FastifyRequest } from "fastify";

export interface ToolInputSchema {
  type: "object";
  properties: Record<
    string,
    {
      type: string;
      description?: string;
      required?: boolean;
    }
  >;
  required: string[];
}

export interface ToolExecutionContext {
  userId?: string;
  sessionId?: string;
  apiKeyId?: string;
  [key: string]: unknown;
}

export interface ITool<TInput = unknown, TResult = string> {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
  handler: (args: TInput, context: ToolExecutionContext) => Promise<TResult>;
}

export interface AgentConfig {
  // 明确定义配置的结构
  [key: string]: any; // 仍然是any，但是更具体
}

export interface IAgent {
  name: string;
  tools: Map<string, ITool<any, any>>;
  shouldHandle: (req: FastifyRequest, config: AgentConfig) => boolean;
  reqHandler: (req: FastifyRequest, config: AgentConfig) => void;
  resHandler?: (payload: any, config: AgentConfig) => void;
}
