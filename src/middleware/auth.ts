import { FastifyRequest, FastifyReply } from "fastify";
import { apiKeyService } from "../auth/apiKey";
import { feishuAuthService } from "../auth/feishu";
import { logger } from "../utils/logger";
import { sendErrorResponse, ErrorCode } from "./errorHandler";
import { AuthenticatedRequest, AuthContext } from "../types/auth";
import { db } from "../db/client";


function getApiKeyFromRequest(req: FastifyRequest): string | null {
  const authHeaderValue = req.headers.authorization || req.headers["x-api-key"];
  const authKey: string = Array.isArray(authHeaderValue)
    ? authHeaderValue[0]
    : authHeaderValue || "";

  if (!authKey) {
    return null;
  }

  if (authKey.startsWith("Bearer ")) {
    return authKey.split(" ")[1];
  }
  return authKey;
}

/**
 * API密钥认证中间件
 */
export const apiKeyAuth =
  (config: any) =>
  async (req: AuthenticatedRequest, reply: FastifyReply, done: () => void) => {
    // 公开端点，不需要认证
    if (isPublicEndpoint(req.url)) {
      return done();
    }

    
    // 使用新的API密钥认证系统
    try {
      const apiKey = getApiKeyFromRequest(req);
      if (!apiKey) {
        sendErrorResponse(
          reply,
          ErrorCode.API_KEY_MISSING,
          "API key is required",
          req,
        );
        return;
      }
      const authResult = await apiKeyService.validateApiKey(apiKey);
      if (!authResult.success) {
        logger.warn("API密钥认证失败", {
          url: req.url,
          userAgent: req.headers["user-agent"],
          ipAddress: req.ip,
        });

        sendErrorResponse(
          reply,
          ErrorCode.API_KEY_INVALID,
          "Invalid or inactive API key",
          req,
        );
        return;
      }

      req.authContext = {
        isAuthenticated: true,
        authMethod: "api_key",
        user: authResult.user,
        apiKey: authResult.apiKey,
        userId: authResult.user?.id,
        apiKeyId: authResult.apiKey?.id,
      };

      done();
    } catch (error) {
      logger.error("API密钥认证异常", { error, url: req.url });
      sendErrorResponse(
        reply,
        ErrorCode.INTERNAL_ERROR,
        "Authentication service error",
        req,
        error,
      );
    }
  };

/**
 * 配额检查中间件
 * TODO: 重新实现基于内存的并发安全配额检查
 */
export const quotaCheck = async (
  req: AuthenticatedRequest,
  reply: FastifyReply,
  done: () => void,
) => {
  if (shouldSkipQuotaCheck(req.url)) {
    return done();
  }

  if (req.authContext?.apiKeyId) {
    const quotaResult = await apiKeyService.checkApiKeyQuota(req.authContext.apiKeyId);
    if (!quotaResult.allowed) {
      sendErrorResponse(
        reply,
        ErrorCode.QUOTA_EXCEEDED,
        `API key quota exceeded. Resets in ${quotaResult.resetIn} seconds.`,
        req
      );
      return;
    }
  }

  done();
};

/**
 * 用户会话认证中间件（用于Web UI）
 */
export const userSessionAuth = async (
  req: AuthenticatedRequest,
  reply: FastifyReply,
  done: () => void,
) => {
  // 公开端点不需要认证
  if (isPublicEndpoint(req.url) || isAuthEndpoint(req.url)) {
    return done();
  }

  try {
    // 从Cookie或Authorization头获取token
    const token = getSessionToken(req);
    if (!token) {
      sendErrorResponse(
        reply,
        ErrorCode.UNAUTHORIZED,
        "No session token provided",
        req,
      );
      return;
    }

    // 验证JWT token
    const decoded = feishuAuthService.verifySessionToken(token);
    if (!decoded) {
      sendErrorResponse(
        reply,
        ErrorCode.UNAUTHORIZED,
        "Invalid or expired session token",
        req,
      );
      return;
    }

    const user = await db.user.findUnique({ where: { id: decoded.userId } });

    if (!user || !user.isActive) {
      sendErrorResponse(
        reply,
        ErrorCode.UNAUTHORIZED,
        "User not found or inactive",
        req,
      );
      return;
    }

    req.authContext = {
      isAuthenticated: true,
      authMethod: "session",
      user,
      userId: user.id,
    };

    done();
  } catch (error) {
    logger.error("用户会话认证异常", { error, url: req.url });
    sendErrorResponse(
      reply,
      ErrorCode.INTERNAL_ERROR,
      "Session authentication error",
      req,
      error,
    );
  }
};

/**
 * 管理员权限检查中间件
 */
export const requireAdmin = async (
  req: FastifyRequest,
  reply: FastifyReply,
  done: () => void,
) => {
  if (!req.user?.isAdmin) {
    logger.warn("非管理员用户尝试访问管理员功能", {
      userId: req.userId,
      url: req.url,
    });

    sendErrorResponse(reply, ErrorCode.FORBIDDEN, "Admin access required", req);
    return;
  }

  done();
};

/**
 * 判断是否为公开端点
 */
function isPublicEndpoint(url: string): boolean {
  const publicEndpoints = [
    "/",
    "/health",
    "/auth/feishu/login",
    "/auth/feishu/callback",
    "/auth/feishu/logout",
  ];

  return (
    publicEndpoints.includes(url) ||
    url.startsWith("/ui") ||
    url.startsWith("/static")
  );
}

/**
 * 判断是否为认证端点
 */
function isAuthEndpoint(url: string): boolean {
  return url.startsWith("/auth/");
}

/**
 * 判断是否应该跳过配额检查
 */
function shouldSkipQuotaCheck(url: string): boolean {
  const skipQuotaEndpoints = [
    "/health",
    "/auth/feishu/login",
    "/auth/feishu/callback",
    "/auth/feishu/logout",
  ];

  return (
    skipQuotaEndpoints.includes(url) ||
    url.startsWith("/ui") ||
    url.startsWith("/static")
  );
}

/**
 * 从请求中获取会话令牌
 */
function getSessionToken(req: FastifyRequest): string | null {
  // 尝试从Authorization头获取
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }

  // 尝试从Cookie获取
  const cookies = req.headers.cookie || "";
  const sessionMatch = cookies.match(/session_token=([^;]+)/);
  if (sessionMatch) {
    return sessionMatch[1];
  }

  return null;
}

/**
 * 请求日志中间件
 */
export const requestLogger = async (
  req: FastifyRequest,
  reply: FastifyReply,
  done: () => void,
) => {
  const startTime = Date.now();

  // 记录请求开始
  logger.info("Request started", {
    method: req.method,
    url: req.url,
    userAgent: req.headers["user-agent"],
    ipAddress: req.ip,
    authContext: req.authContext,
      });

  done();
};
