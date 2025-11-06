export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  context?: any;
}

class Logger {
  private logLevel: LogLevel;

  constructor() {
    // 从环境变量读取日志级别
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    const logLevel = LogLevel[envLevel as keyof typeof LogLevel];
    if (logLevel === undefined && envLevel) {
      console.warn(
        `[Logger] Invalid LOG_LEVEL: ${envLevel}. Defaulting to INFO.`,
      );
      this.logLevel = LogLevel.INFO;
    } else {
      this.logLevel = logLevel ?? LogLevel.INFO;
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.logLevel;
  }

  private formatMessage(entry: LogEntry): string {
    const timestamp = entry.timestamp.toISOString();
    const level = LogLevel[entry.level].padEnd(5);
    const message = entry.message;
    const context = entry.context ? ` ${JSON.stringify(entry.context)}` : "";

    return `[${timestamp}] ${level} ${message}${context}`;
  }

  private write(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) {
      return;
    }

    const formattedMessage = this.formatMessage(entry);

    // 根据日志级别选择输出方式
    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(formattedMessage);
        break;
      case LogLevel.INFO:
        console.info(formattedMessage);
        break;
      case LogLevel.WARN:
        console.warn(formattedMessage);
        break;
      case LogLevel.ERROR:
        console.error(formattedMessage);
        break;
    }
  }

  debug(message: string, context?: any): void {
    this.write({
      level: LogLevel.DEBUG,
      message,
      timestamp: new Date(),
      context,
    });
  }

  info(message: string, context?: any): void {
    this.write({
      level: LogLevel.INFO,
      message,
      timestamp: new Date(),
      context,
    });
  }

  warn(message: string, context?: any): void {
    this.write({
      level: LogLevel.WARN,
      message,
      timestamp: new Date(),
      context,
    });
  }

  error(message: string, context?: any): void {
    this.write({
      level: LogLevel.ERROR,
      message,
      timestamp: new Date(),
      context,
    });
  }
}

// 导出日志器实例
export const logger = new Logger();

// 导出默认实例
export default logger;
