import { QuotaCheckResult, QuotaInfo } from "../types/quota";
import { logger } from "../utils/logger";

interface QuotaRecord {
  count: number;
  windowStart: number;
  limit: number;
  windowSize: number;
}

interface QuotaWindow {
  timestamps: number[];
  count: number;
}

export class MemoryQuotaManager {
  private userQuotas = new Map<string, QuotaRecord>();
  private apiKeyQuotas = new Map<string, QuotaRecord>();
  private slidingWindows = new Map<string, QuotaWindow>();

  // 清理定时器，每小时清理过期数据
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // 每小时清理一次过期数据
    this.cleanupInterval = setInterval(
      () => {
        this.cleanupExpiredData();
      },
      60 * 60 * 1000,
    );
  }

  /**
   * 检查用户配额 - 使用内存滑动窗口算法
   */
  checkUserQuota(
    userId: string,
    limit: number,
    windowSize: number,
  ): QuotaCheckResult {
    try {
      return this.checkMemoryQuota(`user:${userId}`, limit, windowSize);
    } catch (error) {
      logger.error("检查用户配额失败", { error, userId });
      return { allowed: false, reason: "quota_system_error" };
    }
  }

  /**
   * 检查API密钥配额 - 使用内存滑动窗口算法
   */
  checkApiKeyQuota(
    apiKeyId: string,
    limit: number,
    windowSize: number,
  ): QuotaCheckResult {
    try {
      return this.checkMemoryQuota(`apikey:${apiKeyId}`, limit, windowSize);
    } catch (error) {
      logger.error("检查API密钥配额失败", { error, apiKeyId });
      return { allowed: false, reason: "quota_system_error" };
    }
  }

  /**
   * 核心配额检查逻辑 - 内存滑动窗口
   */
  private checkMemoryQuota(
    key: string,
    limit: number,
    windowSize: number,
  ): QuotaCheckResult {
    const now = Date.now();
    const windowStart = now - windowSize * 1000;

    let window = this.slidingWindows.get(key);

    // 如果没有窗口记录，创建新窗口
    if (!window) {
      window = { timestamps: [], count: 0 };
      this.slidingWindows.set(key, window);
    }

    // 清理窗口外的过期请求
    window.timestamps = window.timestamps.filter(
      (timestamp) => timestamp > windowStart,
    );
    window.count = window.timestamps.length;

    // 检查是否超过限制
    if (window.count >= limit) {
      // 计算窗口重置时间（最早请求的时间 + 窗口大小）
      const oldestRequest = Math.min(...window.timestamps);
      const windowResetAt = new Date(oldestRequest + windowSize * 1000);

      return {
        allowed: false,
        remainingRequests: 0,
        windowResetAt,
        reason: "quota_exceeded",
      };
    }

    // 允许请求，记录当前请求
    window.timestamps.push(now);
    window.count++;

    const remainingRequests = limit - window.count;
    const windowResetAt = new Date(now + windowSize * 1000);

    return {
      allowed: true,
      remainingRequests,
      windowResetAt,
    };
  }

  /**
   * 获取用户配额信息
   */
  getUserQuotaInfo(userId: string): QuotaInfo | null {
    const record = this.userQuotas.get(userId);
    if (!record) return null;

    return this.buildQuotaInfo(`user:${userId}`, record);
  }

  /**
   * 获取API密钥配额信息
   */
  getApiKeyQuotaInfo(apiKeyId: string): QuotaInfo | null {
    const record = this.apiKeyQuotas.get(apiKeyId);
    if (!record) return null;

    return this.buildQuotaInfo(`apikey:${apiKeyId}`, record);
  }

  /**
   * 构建配额信息对象
   */
  private buildQuotaInfo(key: string, record: QuotaRecord): QuotaInfo {
    const now = Date.now();
    const windowStart = now - record.windowSize * 1000;
    const window = this.slidingWindows.get(key);

    let currentCount = 0;
    if (window) {
      // 清理过期请求并计算当前计数
      window.timestamps = window.timestamps.filter(
        (timestamp) => timestamp > windowStart,
      );
      currentCount = window.timestamps.length;
    }

    const windowStartAt = new Date(now - record.windowSize * 1000);
    const windowEndAt = new Date(now);
    const remainingRequests = Math.max(0, record.limit - currentCount);
    const resetIn = record.windowSize;

    return {
      currentCount,
      limit: record.limit,
      windowSize: record.windowSize,
      windowStartAt,
      windowEndAt,
      remainingRequests,
      resetIn,
    };
  }

  /**
   * 设置用户配额限制
   */
  setUserQuota(userId: string, limit: number, windowSize: number): void {
    this.userQuotas.set(userId, {
      limit,
      windowSize,
      count: 0,
      windowStart: Date.now(),
    });
  }

  /**
   * 设置API密钥配额限制
   */
  setApiKeyQuota(apiKeyId: string, limit: number, windowSize: number): void {
    this.apiKeyQuotas.set(apiKeyId, {
      limit,
      windowSize,
      count: 0,
      windowStart: Date.now(),
    });
  }

  /**
   * 重置用户配额
   */
  resetUserQuota(userId: string): void {
    this.slidingWindows.delete(`user:${userId}`);
    logger.info("用户配额重置成功", { userId });
  }

  /**
   * 重置API密钥配额
   */
  resetApiKeyQuota(apiKeyId: string): void {
    this.slidingWindows.delete(`apikey:${apiKeyId}`);
    logger.info("API密钥配额重置成功", { apiKeyId });
  }

  /**
   * 清理过期数据
   */
  private cleanupExpiredData(): void {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    for (const [key, window] of this.slidingWindows.entries()) {
      // 清理一小时前的过期请求
      window.timestamps = window.timestamps.filter(
        (timestamp) => timestamp > oneHourAgo,
      );
      window.count = window.timestamps.length;

      // 如果窗口为空，删除记录
      if (window.count === 0) {
        this.slidingWindows.delete(key);
      }
    }

    logger.debug("配额数据清理完成", {
      activeWindows: this.slidingWindows.size,
    });
  }

  /**
   * 获取当前状态统计
   */
  getStats() {
    return {
      userQuotas: this.userQuotas.size,
      apiKeyQuotas: this.apiKeyQuotas.size,
      activeWindows: this.slidingWindows.size,
      memoryUsage: process.memoryUsage(),
    };
  }

  /**
   * 销毁管理器，清理定时器
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.slidingWindows.clear();
    this.userQuotas.clear();
    this.apiKeyQuotas.clear();
  }
}

// 导出单例实例
export const memoryQuotaManager = new MemoryQuotaManager();

// 优雅退出时清理
process.on("SIGTERM", () => {
  memoryQuotaManager.destroy();
});

process.on("SIGINT", () => {
  memoryQuotaManager.destroy();
});
