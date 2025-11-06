import { FastifyRequest } from "fastify";
import { calculateTokenCount } from "./router"; // 保持token计算逻辑

export interface RoutingContext {
  tokenCount: number;
  modelType: string;
  isStreaming: boolean;
  hasTools: boolean;
}

export interface Rule {
  condition: (context: RoutingContext) => boolean;
  action: string; // model name
}

export class RuleEngine {
  private rules: Rule[];

  constructor(config: any) {
    this.rules = this.buildRules(config.router?.rules || []);
  }

  private buildRules(ruleConfigs: any[]): Rule[] {
    return ruleConfigs.map((cfg) => ({
      condition: this.createCondition(cfg.condition),
      action: cfg.action,
    }));
  }

  private createCondition(
    conditionStr: string,
  ): (context: RoutingContext) => boolean {
    try {
      return new Function("context", `return ${conditionStr}`) as (
        context: RoutingContext,
      ) => boolean;
    } catch (e) {
      console.error(`Invalid rule condition: ${conditionStr}`, e);
      return () => false;
    }
  }

  public selectModel(req: FastifyRequest): string | null {
    const context = this.buildContext(req);
    for (const rule of this.rules) {
      if (rule.condition(context)) {
        return rule.action;
      }
    }
    return null;
  }

  private buildContext(req: FastifyRequest): RoutingContext {
    const body = req.body as any;
    return {
      tokenCount: calculateTokenCount(body.messages, body.system, body.tools),
      modelType: body.model || "unknown",
      isStreaming: body.stream || false,
      hasTools: !!body.tools && body.tools.length > 0,
    };
  }
}
