/**
 * 认证系统相关的类型定义
 *
 * 这个文件定义了整个认证系统使用的所有类型和接口，
 * 包括用户、API密钥、认证结果等核心类型。
 */

// ============================================================================
// 基础用户类型
// ============================================================================

/**
 * 用户基本信息
 */
export interface User {
  id: string;
  name: string;
  avatarUrl?: string;
  isActive: boolean;
  isAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 用户身份信息（用于第三方登录）
 */
export interface UserIdentity {
  id: string;
  userId: string;
  provider: 'feishu' | 'github' | 'email';
  providerId: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 用户配额信息
 */
export interface UserQuota {
  id: string;
  userId: string;
  requestLimit: number;
  timeWindow: number; // 时间窗口，单位：秒
  currentCount: number;
  windowStartAt: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// API密钥类型
// ============================================================================

/**
 * API密钥基本信息
 */
export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  keyHash: string;
  keyPrefix: string; // sk-xxxxxxxx 格式，用于前端显示
  isActive: boolean;
  lastUsedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * API密钥配额信息
 */
export interface ApiKeyQuota {
  id: string;
  apiKeyId: string;
  requestLimit: number;
  timeWindow: number; // 时间窗口，单位：秒
  currentCount: number;
  windowStartAt: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 创建API密钥的请求参数
 */
export interface CreateApiKeyRequest {
  name: string;
  requestLimit?: number;
  timeWindow?: number;
}

/**
 * 创建API密钥的响应（包含一次性的完整密钥）
 */
export interface CreateApiKeyResponse {
  apiKey: ApiKey;
  quota?: ApiKeyQuota;
  // 完整密钥只在创建时返回一次
  fullKey: string;
}

/**
 * 更新API密钥的请求参数
 */
export interface UpdateApiKeyRequest {
  name?: string;
  isActive?: boolean;
  requestLimit?: number;
  timeWindow?: number;
}

// ============================================================================
// 认证结果和事件类型
// ============================================================================

/**
 * 认证结果
 */
export interface AuthResult {
  success: boolean;
  user?: User;
  apiKey?: ApiKey;
  error?: string;
  errorCode?: AuthErrorCode;
}

/**
 * 认证错误代码
 */
export enum AuthErrorCode {
  INVALID_API_KEY = 'INVALID_API_KEY',
  INACTIVE_API_KEY = 'INACTIVE_API_KEY',
  EXPIRED_API_KEY = 'EXPIRED_API_KEY',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  INACTIVE_USER = 'INACTIVE_USER',
  INVALID_TOKEN = 'INVALID_TOKEN',
  OAUTH_ERROR = 'OAUTH_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR'
}

/**
 * 认证事件类型
 */
export interface AuthEvent {
  type: 'login' | 'logout' | 'api_key_created' | 'api_key_deleted' | 'rate_limit_exceeded';
  userId?: string;
  apiKeyId?: string;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

// ============================================================================
// OAuth相关类型
// ============================================================================

/**
 * OAuth提供商配置
 */
export interface OAuthProvider {
  name: 'feishu' | 'github';
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

/**
 * OAuth用户信息
 */
export interface OAuthUserInfo {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  raw: Record<string, any>; // 原始响应数据
}

/**
 * OAuth令牌响应
 */
export interface OAuthTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
  scope?: string;
}

// ============================================================================
// 请求和响应类型（API接口）
// ============================================================================

/**
 * 飞书OAuth重定向请求
 */
export interface FeishuAuthRedirectRequest {
  // 重定向不需要请求体，参数在URL中
}

/**
 * 飞书OAuth回调请求
 */
export interface FeishuAuthCallbackRequest {
  code: string;
  state: string;
}

/**
 * 当前用户信息响应
 */
export interface CurrentUserResponse {
  user: User;
  identities: UserIdentity[];
  apiKeys: ApiKey[];
}

/**
 * 登出请求
 */
export interface LogoutRequest {
  // 登出不需要请求体
}

/**
 * 登出响应
 */
export interface LogoutResponse {
  success: boolean;
  message: string;
}

// ============================================================================
// 会话管理类型
// ============================================================================

/**
 * 会话数据（存储在服务端）
 */
export interface SessionData {
  userId: string;
  isAuthenticated: boolean;
  loginAt: Date;
  expiresAt: Date;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * JWT Payload
 */
export interface JWTPayload {
  userId: string;
  sessionId: string;
  iat: number; // 签发时间
  exp: number; // 过期时间
  sub: string; // 主题
}

// ============================================================================
// 认证中间件类型
// ============================================================================

/**
 * 认证中间件上下文
 */
export interface AuthContext {
  user?: User;
  apiKey?: ApiKey;
  isAuthenticated: boolean;
  authMethod: 'api_key' | 'session' | 'none';
  userId?: string;
  apiKeyId?: string;
}

/**
 * Fastify请求扩展（添加认证信息）
 */
export interface AuthenticatedRequest {
  user?: User;
  apiKey?: ApiKey;
  authContext: AuthContext;
}

// ============================================================================
// 配额管理类型
// ============================================================================

/**
 * 配额检查结果
 */
export interface QuotaCheckResult {
  allowed: boolean;
  remainingRequests: number;
  windowStartAt: Date;
  windowEndAt: Date;
  resetIn?: number; // 距离重置的秒数
}

/**
 * 配额使用情况
 */
export interface QuotaUsage {
  limit: number;
  used: number;
  remaining: number;
  windowStartAt: Date;
  windowEndAt: Date;
  percentage: number; // 使用百分比
}

// ============================================================================
// 日志和审计类型
// ============================================================================

/**
 * 请求日志（扩展版）
 */
export interface RequestLog {
  id: string;
  userId?: string;
  apiKeyId?: string;
  requestId?: string;
  method: string;
  path: string;
  statusCode: number;
  responseTime: number; // 毫秒
  requestSize?: number; // 字节
  responseSize?: number; // 字节
  userAgent?: string;
  ipAddress?: string;
  errorMessage?: string;
  createdAt: Date;
}

// ============================================================================
// 类型守卫和验证函数
// ============================================================================

/**
 * 检查是否为有效的OAuth提供商
 */
export function isValidOAuthProvider(provider: string): provider is 'feishu' | 'github' {
  return ['feishu', 'github'].includes(provider);
}

/**
 * 检查是否为认证错误
 */
export function isAuthError(error: any): error is { code: AuthErrorCode; message: string } {
  return error && typeof error === 'object' && 'code' in error && Object.values(AuthErrorCode).includes(error.code);
}

/**
 * 检查用户是否处于活跃状态
 */
export function isUserActive(user: User): boolean {
  return user.isActive;
}

/**
 * 检查API密钥是否处于活跃状态
 */
export function isApiKeyActive(apiKey: ApiKey): boolean {
  return apiKey.isActive;
}

/**
 * 检查是否为管理员用户
 */
export function isAdminUser(user: User): boolean {
  return user.isAdmin;
}

/**
 * 检查是否为有效的API密钥前缀
 */
export function isValidApiKeyPrefix(prefix: string): boolean {
  return /^sk-[a-zA-Z0-9]{8}$/.test(prefix);
}

/**
 * 检查是否为有效的API密钥格式
 */
export function isValidApiKeyFormat(key: string): boolean {
  return /^sk-[a-zA-Z0-9]{48}$/.test(key);
}