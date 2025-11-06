import { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { logger } from "../utils/logger";

/**
 * 标准化错误响应接口
 */
export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
  path: string;
  requestId?: string;
}

/**
 * 标准化成功响应接口
 */
export interface SuccessResponse<T = any> {
  success: true;
  data: T;
  timestamp: string;
  path: string;
  requestId?: string;
}

/**
 * 错误代码枚举
 */
export enum ErrorCode {
  // 认证相关
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  API_KEY_MISSING = "API_KEY_MISSING",
  API_KEY_INVALID = "API_KEY_INVALID",
  API_KEY_INACTIVE = "API_KEY_INACTIVE",

  // 配额相关
  QUOTA_EXCEEDED = "QUOTA_EXCEEDED",
  QUOTA_SYSTEM_ERROR = "QUOTA_SYSTEM_ERROR",

  // 验证相关
  VALIDATION_FAILED = "VALIDATION_FAILED",
  INVALID_REQUEST = "INVALID_REQUEST",

  // 资源相关
  RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND",
  RESOURCE_CONFLICT = "RESOURCE_CONFLICT",

  // 系统相关
  INTERNAL_ERROR = "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
  DATABASE_ERROR = "DATABASE_ERROR",
  EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR",
}

/**
 * 错误代码到HTTP状态码的映射
 */
const statusCodeMap: Record<ErrorCode, number> = {
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.API_KEY_MISSING]: 401,
  [ErrorCode.API_KEY_INVALID]: 401,
  [ErrorCode.API_KEY_INACTIVE]: 403,

  [ErrorCode.QUOTA_EXCEEDED]: 429,
  [ErrorCode.QUOTA_SYSTEM_ERROR]: 503,

  [ErrorCode.VALIDATION_FAILED]: 400,
  [ErrorCode.INVALID_REQUEST]: 400,

  [ErrorCode.RESOURCE_NOT_FOUND]: 404,
  [ErrorCode.RESOURCE_CONFLICT]: 409,

  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.DATABASE_ERROR]: 500,
  [ErrorCode.EXTERNAL_SERVICE_ERROR]: 502,
};

/**
 * 创建标准化错误响应
 */
export function createErrorResponse(
  code: ErrorCode,
  message: string,
  req: FastifyRequest,
  details?: any,
): ErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      details: process.env.NODE_ENV === "development" ? details : undefined,
    },
    timestamp: new Date().toISOString(),
    path: req.url,
    requestId: (req as any).requestId,
  };
}

/**
 * 创建标准化成功响应
 */
export function createSuccessResponse<T>(
  data: T,
  req: FastifyRequest,
): SuccessResponse<T> {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
    path: req.url,
    requestId: (req as any).requestId,
  };
}

/**
 * 发送错误响应
 */
export function sendErrorResponse(
  reply: FastifyReply,
  code: ErrorCode,
  message: string,
  req: FastifyRequest,
  details?: any,
): void {
  const statusCode = statusCodeMap[code] || 500;
  const errorResponse = createErrorResponse(code, message, req, details);

  logger.warn("API错误响应", {
    code,
    message,
    statusCode,
    path: req.url,
    requestId: (req as any).requestId,
    details: details ? JSON.stringify(details).substring(0, 500) : undefined,
  });

  reply.status(statusCode).send(errorResponse);
}

/**
 * 发送成功响应
 */
export function sendSuccessResponse<T>(
  reply: FastifyReply,
  data: T,
  req: FastifyRequest,
): void {
  const successResponse = createSuccessResponse(data, req);
  reply.send(successResponse);
}

/**
 * 全局错误处理中间件
 */
export function errorHandler(
  error: FastifyError,
  req: FastifyRequest,
  reply: FastifyReply,
): void {
  // 记录错误
  logger.error("未处理的API错误", {
    error: error.message,
    stack: error.stack,
    code: error.code,
    statusCode: error.statusCode,
    path: req.url,
    method: req.method,
    requestId: (req as any).requestId,
    body: req.body,
    headers: req.headers,
  });

  // 根据错误类型返回标准化响应
  if (error.validation) {
    // 验证错误
    sendErrorResponse(
      reply,
      ErrorCode.VALIDATION_FAILED,
      "请求参数验证失败",
      req,
      error.validation,
    );
    return;
  }

  // 根据状态码映射错误类型
  if (error.statusCode) {
    let code: ErrorCode;
    let message: string;

    switch (error.statusCode) {
      case 400:
        code = ErrorCode.INVALID_REQUEST;
        message = error.message || "请求无效";
        break;
      case 401:
        code = ErrorCode.UNAUTHORIZED;
        message = error.message || "未授权访问";
        break;
      case 403:
        code = ErrorCode.FORBIDDEN;
        message = error.message || "禁止访问";
        break;
      case 404:
        code = ErrorCode.RESOURCE_NOT_FOUND;
        message = error.message || "资源未找到";
        break;
      case 429:
        code = ErrorCode.QUOTA_EXCEEDED;
        message = error.message || "请求频率超限";
        break;
      case 502:
        code = ErrorCode.EXTERNAL_SERVICE_ERROR;
        message = error.message || "外部服务错误";
        break;
      case 503:
        code = ErrorCode.SERVICE_UNAVAILABLE;
        message = error.message || "服务暂时不可用";
        break;
      default:
        code = ErrorCode.INTERNAL_ERROR;
        message =
          process.env.NODE_ENV === "development"
            ? error.message
            : "服务器内部错误";
    }

    sendErrorResponse(reply, code, message, req);
    return;
  }

  // 未知错误
  sendErrorResponse(
    reply,
    ErrorCode.INTERNAL_ERROR,
    process.env.NODE_ENV === "development" ? error.message : "服务器内部错误",
    req,
    { stack: error.stack },
  );
}
