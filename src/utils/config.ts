import { z } from "zod";
import { readFileSync, watch } from "fs";
import { interpolateEnvVars } from "./index";
import JSON5 from "json5";
import { logger } from "./logger";

const configSchema = z.object({
  PORT: z.number().optional(),
  HOST: z.string().optional(),
  APIKEY: z.string().optional(),
  LOG_FILE: z.string().optional(),
  LOG: z.any().optional(),
  LOG_LEVEL: z.string().optional(),
  providers: z.any().optional(),
  Providers: z.any().optional(),
  // ...其他配置项
  router: z
    .object({
      rules: z
        .array(
          z.object({
            condition: z.string(),
            action: z.string(),
          }),
        )
        .optional(),
      longContextThreshold: z.number().optional(),
    })
    .optional(),
});

type Config = z.infer<typeof configSchema>;

export class ConfigManager {
  private config: Config;
  private configPath: string;

  constructor(configPath: string) {
    this.configPath = configPath;
    this.config = this.loadConfig();
    this.watchConfig();
  }

  private loadConfig(): Config {
    try {
      const fileContent = readFileSync(this.configPath, "utf8");
      const rawConfig = JSON5.parse(fileContent);
      const interpolatedConfig = interpolateEnvVars(rawConfig);
      return configSchema.parse(interpolatedConfig);
    } catch (error) {
      logger.error("Failed to load or parse config file", { error });
      throw new Error("Configuration error");
    }
  }

  private watchConfig() {
    watch(this.configPath, (eventType) => {
      if (eventType === "change") {
        logger.info("Config file changed, reloading...");
        this.config = this.loadConfig();
      }
    });
  }

  public getConfig(): Config {
    return this.config;
  }
}
