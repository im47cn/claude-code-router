declare module "@musistudio/llms" {
  import { FastifyInstance } from "fastify";

  interface ServerConfig {
    providers?: any;
    HOST?: string;
    PORT?: number;
    LOG_FILE?: string;
    LOG?: any;
    LOG_LEVEL?: string;
    Providers?: any;
    providers?: any;
  }

  interface Usage {
    input_tokens: number;
    output_tokens: number;
  }

  function createServer(config: any): FastifyInstance;
  function parseSSE(stream: any): any;

  export { createServer, parseSSE };
  export type { ServerConfig, Usage };
}
