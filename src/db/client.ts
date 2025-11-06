import { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger";

// 创建Prisma客户端实例
const prisma = new PrismaClient({
  log: [
    {
      emit: "event",
      level: "query",
    },
    {
      emit: "event",
      level: "error",
    },
    {
      emit: "event",
      level: "info",
    },
    {
      emit: "event",
      level: "warn",
    },
  ],
});

// 数据库查询日志
prisma.$on("query", (e) => {
  logger.debug("Database Query", {
    query: e.query,
    params: e.params,
    duration: `${e.duration}ms`,
    timestamp: e.timestamp,
  });
});

// 数据库错误日志
prisma.$on("error", (e) => {
  logger.error("Database Error", {
    target: e.target,
    message: e.message,
    timestamp: e.timestamp,
  });
});

// 数据库信息日志
prisma.$on("info", (e) => {
  logger.info("Database Info", {
    target: e.target,
    message: e.message,
    timestamp: e.timestamp,
  });
});

// 数据库警告日志
prisma.$on("warn", (e) => {
  logger.warn("Database Warning", {
    target: e.target,
    message: e.message,
    timestamp: e.timestamp,
  });
});

// 数据库连接测试
export async function testDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$connect();
    logger.info("数据库连接成功");
    return true;
  } catch (error) {
    logger.error("数据库连接失败", error);
    return false;
  }
}

// 优雅关闭数据库连接
export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect();
    logger.info("数据库连接已关闭");
  } catch (error) {
    logger.error("关闭数据库连接时出错", error);
  }
}

// 导出Prisma客户端实例
export { prisma as db };

// 默认导出
export default prisma;
