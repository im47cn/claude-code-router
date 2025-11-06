import { FastifyReply, FastifyRequest } from "fastify";
import { logger } from "./logger";

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
  requestId?: string;
}

export enum HttpStatusCode {
  OK = 200,
  CREATED = 201,
  NO_CONTENT = 204,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  CONFLICT = 409,
  TOO_MANY_REQUESTS = 429,
  INTERNAL_SERVER_ERROR = 500,
  SERVICE_UNAVAILABLE = 503,
  GATEWAY_TIMEOUT = 504,
}

export function successResponse<T>(data: T, message: string | null = null): Omit<ApiResponse<T>, 'requestId'> {
  return {
    success: true,
    data,
    message,
    error: null,
    timestamp: new Date().toISOString(),
  };
}

export function errorResponse(error: string, code?: string, details?: any): Omit<ApiResponse, 'requestId'> {
  return {
    success: false,
    data: null,
    error,
    code,
    details,
    timestamp: new Date().toISOString(),
  };
}

export function paginatedResponse<T>(data: T[], pagination: any, message: string | null = null): Omit<ApiResponse<T[]>, 'requestId'> {
  return {
    success: true,
    data,
    pagination,
    message,
    error: null,
    timestamp: new Date().toISOString(),
  };
}

export class ValidationError extends Error {
  public details?: any;
  constructor(message: string, details?: any) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      details: this.details,
      stack: this.stack,
    };
  }
}

export class APIError extends Error {
  public code: string;
  public statusCode: number;
  constructor(message: string, code: string, statusCode = 500) {
    super(message);
    this.name = 'APIError';
    this.code = code;
    this.statusCode = statusCode;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      stack: this.stack,
    };
  }
}
