# 设计文档 - 认证与 API 密钥管理系统

## 基本信息

**规范名称**: 20251028-01-auth-system
**功能描述**: 认证与 API 密钥管理系统
**创建日期**: 2025-10-28
**版本**: 1.0
**负责人**: 开发团队

## 1. 系统架构设计

### 1.1 整体架构图

```mermaid
graph TB
    subgraph "前端层"
        A[登录页面] --> B[API密钥管理页面]
        B --> C[用户仪表板]
    end

    subgraph "认证层"
        D[飞书OAuth服务] --> E[Session管理]
        E --> F[JWT服务]
    end

    subgraph "业务逻辑层"
        G[用户服务] --> H[API密钥服务]
        H --> I[认证中间件]
        I --> J[配额服务]
    end

    subgraph "数据层"
        K[(MySQL数据库)] --> L[缓存层 Redis/LRU]
    end

    A --> D
    B --> G
    C --> G
    D --> E
    E --> F
    F --> G
    G --> H
    H --> I
    I --> J
    J --> K
    I --> L
    H --> L
```

### 1.2 技术栈选择

| 组件类型 | 技术选择 | 理由 |
|---------|---------|------|
| **后端框架** | Fastify | 高性能、类型安全、插件生态丰富 |
| **数据库** | MySQL | 事务支持、成熟稳定、团队熟悉 |
| **ORM/查询构建器** | Prisma | 类型安全、自动生成、迁移管理 |
| **认证存储** | Fastify Session | 支持分布式部署、安全性好 |
| **密码哈希** | bcrypt | 行业标准、安全性高、抗彩虹表 |
| **缓存** | lru-cache (内存) | 简单高效、减少数据库压力 |
| **前端框架** | React + TypeScript | 现有技术栈、组件化开发 |

## 2. 数据库设计

### 2.1 数据模型

```mermaid
erDiagram
    users ||--o{ api_keys : creates
    users ||--o{ user_identities : has
    users ||--o{ user_quotas : has
    api_keys ||--o{ api_key_quotas : has
    api_keys ||--o{ request_logs : generates
    users ||--o{ request_logs : makes

    users {
        int id PK
        string name
        string avatar_url
        boolean is_active
        boolean is_admin
        datetime created_at
        datetime updated_at
    }

    user_identities {
        int id PK
        int user_id FK
        string provider
        string provider_user_id
        json provider_data
        datetime created_at
        datetime updated_at
    }

    api_keys {
        int id PK
        int user_id FK
        string key_hash
        string key_prefix
        string name
        boolean is_active
        datetime last_used_at
        datetime created_at
        datetime updated_at
    }

    api_key_quotas {
        int id PK
        int api_key_id FK
        int limit
        int interval_minutes
        datetime created_at
        datetime updated_at
    }

    user_quotas {
        int id PK
        int user_id FK
        int limit
        int interval_minutes
        datetime created_at
        datetime updated_at
    }

    request_logs {
        int id PK
        int user_id FK
        int api_key_id FK
        string endpoint
        string method
        int status_code
        string status 'success|error|rate_limited'
        json request_metadata
        datetime request_timestamp
    }
```

### 2.2 索引设计

```sql
-- 用户表索引
CREATE INDEX idx_users_is_active ON users(is_active);
CREATE INDEX idx_users_is_admin ON users(is_admin);

-- 用户身份表索引
CREATE UNIQUE INDEX idx_user_identities_provider_user_id ON user_identities(provider, provider_user_id);
CREATE INDEX idx_user_identities_user_id ON user_identities(user_id);

-- API密钥表索引
CREATE UNIQUE INDEX idx_api_keys_key_prefix ON api_keys(key_prefix);
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_is_active ON api_keys(is_active);
CREATE INDEX idx_api_keys_last_used_at ON api_keys(last_used_at);

-- 配额表索引
CREATE UNIQUE INDEX idx_api_key_quotas_api_key_id ON api_key_quotas(api_key_id);
CREATE UNIQUE INDEX idx_user_quotas_user_id ON user_quotas(user_id);

-- 请求日志表索引
CREATE INDEX idx_request_logs_user_id ON request_logs(user_id);
CREATE INDEX idx_request_logs_api_key_id ON request_logs(api_key_id);
CREATE INDEX idx_request_logs_timestamp ON request_logs(request_timestamp);
CREATE INDEX idx_request_logs_status ON request_logs(status);
```

## 3. 核心流程设计

### 3.1 飞书 OAuth 认证流程

```mermaid
sequenceDiagram
    participant U as 用户
    participant F as 前端
    participant B as 后端
    participant Feishu as 飞书服务
    participant DB as 数据库

    U->>F: 点击"使用飞书登录"
    F->>B: GET /auth/feishu
    B->>B: 生成OAuth授权URL
    B->>B: 存储state到session
    B->>F: 重定向到飞书授权页面
    F->>Feishu: 显示授权页面
    U->>Feishu: 确认授权
    Feishu->>B: 重定向到 /auth/feishu/callback?code=xxx&state=yyy
    B->>B: 验证state参数
    B->>Feishu: 使用code换取access_token
    Feishu->>B: 返回access_token和用户信息
    B->>DB: 查询/创建用户记录
    DB->>B: 返回用户信息
    B->>B: 设置session/JWT
    B->>F: 重定向到仪表板
    F->>U: 显示登录成功状态
```

### 3.2 API 密钥认证流程

```mermaid
flowchart TD
    A[API请求] --> B{提取API密钥}
    B -->|缺失| C[返回401错误]
    B -->|存在| D{验证密钥格式}
    D -->|无效| C
    D -->|有效| E[提取密钥前缀]
    E --> F{查询缓存}
    F -->|命中| G[验证密钥哈希]
    F -->|未命中| H[查询数据库]
    H --> I[更新缓存]
    I --> G
    G -->|匹配成功| J{检查用户状态}
    G -->|匹配失败| C
    J -->|用户禁用| K[返回403错误]
    J -->|用户正常| L{检查配额}
    L -->|超限| M[返回429错误]
    L -->|未超限| N[附加用户信息到请求]
    N --> O[继续处理请求]
```

### 3.3 API 密钥管理流程

```mermaid
stateDiagram-v2
    [*] --> 生成密钥
    生成密钥 --> 存储哈希
    存储哈希 --> 返回完整密钥
    返回完整密钥 --> 活跃状态
    活跃状态 --> 禁用密钥: 用户操作
    禁用密钥 --> 活跃状态: 用户操作
    活跃状态 --> 删除密钥: 用户确认
    禁用密钥 --> 删除密钥: 用户确认
    删除密钥 --> [*]
```

## 4. API 接口设计

### 4.1 认证相关接口

#### 4.1.1 飞书登录
```typescript
// GET /auth/feishu
// 重定向到飞书OAuth授权页面

// GET /auth/feishu/callback
// 处理飞书OAuth回调
interface CallbackQuery {
  code: string;
  state: string;
}

// POST /auth/logout
// 用户登出
interface LogoutResponse {
  success: boolean;
  message: string;
}
```

#### 4.1.2 用户信息接口
```typescript
// GET /api/me
// 获取当前登录用户信息
interface UserInfo {
  id: number;
  name: string;
  avatar_url: string;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
}
```

### 4.2 API 密钥管理接口

#### 4.2.1 创建密钥
```typescript
// POST /api/keys
interface CreateKeyRequest {
  name?: string; // 可选的密钥名称
}

interface CreateKeyResponse {
  id: number;
  key: string; // 完整的API密钥，仅返回一次
  name: string;
  key_prefix: string;
  created_at: string;
}
```

#### 4.2.2 获取密钥列表
```typescript
// GET /api/keys
interface KeyInfo {
  id: number;
  name: string;
  key_prefix: string;
  is_active: boolean;
  last_used_at?: string;
  created_at: string;
  quota?: {
    limit: number;
    interval_minutes: number;
  };
}

interface GetKeysResponse {
  keys: KeyInfo[];
  total: number;
}
```

#### 4.2.3 更新密钥
```typescript
// PUT /api/keys/{keyId}
interface UpdateKeyRequest {
  name?: string;
  is_active?: boolean;
}

interface UpdateKeyResponse {
  id: number;
  name: string;
  key_prefix: string;
  is_active: boolean;
  updated_at: string;
}
```

#### 4.2.4 删除密钥
```typescript
// DELETE /api/keys/{keyId}
// 返回 204 No Content
```

#### 4.2.5 设置密钥配额
```typescript
// PUT /api/keys/{keyId}/quota
interface SetQuotaRequest {
  limit: number;
  interval_minutes: number;
}

interface SetQuotaResponse {
  api_key_id: number;
  limit: number;
  interval_minutes: number;
  updated_at: string;
}

// DELETE /api/keys/{keyId}/quota
// 返回 204 No Content
```

### 4.3 管理员接口

```typescript
// GET /admin/users
// 获取用户列表（管理员专用）
interface AdminUserInfo {
  id: number;
  name: string;
  avatar_url: string;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
  api_keys_count: number;
}

// PUT /admin/users/{userId}/quota
interface SetUserQuotaRequest {
  limit: number;
  interval_minutes: number;
}

// PUT /admin/users/{userId}/status
interface UpdateUserStatusRequest {
  is_active: boolean;
  is_admin?: boolean;
}
```

## 5. 安全设计

### 5.1 API 密钥安全

#### 5.1.1 密钥生成算法
```typescript
function generateApiKey(): { key: string; prefix: string } {
  // 生成32字节随机数据
  const randomBytes = crypto.randomBytes(32);
  // Base64编码
  const base64Key = randomBytes.toString('base64url');
  // 添加前缀
  const fullKey = `sk-${base64Key}`;
  // 提取前缀（前缀+前6位字符）
  const prefix = fullKey.substring(0, 9); // sk- + 6 chars

  return { key: fullKey, prefix };
}
```

#### 5.1.2 密钥存储和验证
```typescript
// 存储时使用bcrypt哈希
const saltRounds = 12;
const keyHash = await bcrypt.hash(apiKey, saltRounds);

// 验证时使用恒定时间比较
const isValid = await bcrypt.compare(providedKey, storedKeyHash);
```

### 5.2 Session 安全

```typescript
// Fastify Session 配置
await server.register(fastifySession, {
  secret: process.env.SESSION_SECRET, // 从环境变量获取
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only
    httpOnly: true, // 防止XSS
    sameSite: 'strict', // CSRF防护
    maxAge: 24 * 60 * 60 * 1000, // 24小时过期
  },
});
```

### 5.3 CSRF 防护

```typescript
// 在需要保护的端点添加CSRF令牌验证
await server.register(csrfProtection);

// 前端在请求头中包含CSRF令牌
headers: {
  'X-CSRF-Token': getCsrfToken()
}
```

## 6. 性能优化设计

### 6.1 缓存策略

#### 6.1.1 API 密钥缓存
```typescript
interface CacheEntry {
  id: number;
  user_id: number;
  key_hash: string;
  is_active: boolean;
  user_is_active: boolean;
  user_is_admin: boolean;
}

// 使用LRU缓存，最大1000个条目，5分钟过期
const apiKeyCache = new LRUCache<string, CacheEntry[]>({
  max: 1000,
  ttl: 5 * 60 * 1000, // 5分钟
});
```

#### 6.1.2 配额缓存
```typescript
interface QuotaCacheEntry {
  limit: number;
  interval_minutes: number;
  request_count: number;
  window_start: number;
}

// 配额计数缓存，1分钟过期
const quotaCache = new LRUCache<string, QuotaCacheEntry>({
  max: 10000,
  ttl: 1 * 60 * 1000, // 1分钟
});
```

### 6.2 数据库优化

#### 6.2.1 连接池配置
```typescript
// Prisma数据源配置
datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")

  // 连接池配置
  connection_limit = 20
  pool_timeout = 30
}
```

#### 6.2.2 查询优化
```typescript
// 使用索引优化的查询
async function findApiKeyByPrefix(prefix: string) {
  return await prisma.apiKey.findMany({
    where: {
      key_prefix: prefix,
      is_active: true,
    },
    select: {
      id: true,
      user_id: true,
      key_hash: true,
      user: {
        select: {
          is_active: true,
          is_admin: true,
        },
      },
    },
  });
}
```

## 7. 错误处理设计

### 7.1 错误码定义

```typescript
enum AuthErrorCode {
  // 认证错误 (401)
  MISSING_API_KEY = 'AUTH_001',
  INVALID_API_KEY = 'AUTH_002',
  INACTIVE_API_KEY = 'AUTH_003',

  // 权限错误 (403)
  USER_INACTIVE = 'AUTH_101',
  INSUFFICIENT_PERMISSIONS = 'AUTH_102',

  // 配额错误 (429)
  QUOTA_EXCEEDED = 'AUTH_201',

  // 业务逻辑错误 (400)
  KEY_NAME_TOO_LONG = 'AUTH_301',
  INVALID_QUOTA_SETTINGS = 'AUTH_302',
}
```

### 7.2 错误响应格式

```typescript
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
    timestamp: string;
    request_id: string;
  };
}
```

## 8. 监控和日志设计

### 8.1 关键指标监控

```typescript
// 性能指标
interface Metrics {
  auth_latency_p99: number;      // 认证延迟P99
  auth_success_rate: number;     // 认证成功率
  key_creation_rate: number;     // 密钥创建率
  quota_exceeded_rate: number;   // 配额超限率
  active_sessions: number;       // 活跃会话数
  cache_hit_rate: number;        // 缓存命中率
}
```

### 8.2 日志记录策略

```typescript
// 结构化日志格式
interface AuthLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  event: string;
  user_id?: number;
  api_key_id?: number;
  ip_address?: string;
  user_agent?: string;
  duration_ms?: number;
  error?: {
    code: string;
    message: string;
    stack?: string;
  };
}

// 敏感信息过滤
function sanitizeLog(log: any): any {
  const { key_hash, session_data, ...sanitized } = log;
  return sanitized;
}
```

## 9. 部署和运维设计

### 9.1 环境变量配置

```bash
# 数据库配置
DATABASE_URL="mysql://user:password@localhost:3306/router_auth"

# 安全配置
SESSION_SECRET="your-session-secret-key"
FEISHU_APP_ID="your-feishu-app-id"
FEISHU_APP_SECRET="your-feishu-app-secret"

# 缓存配置
CACHE_TTL_MINUTES=5
CACHE_MAX_SIZE=1000

# 性能配置
BCRYPT_ROUNDS=12
MAX_LOGIN_ATTEMPTS=5
LOGIN_ATTEMPT_WINDOW_MINUTES=15
```

### 9.2 健康检查

```typescript
// GET /health/auth
interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    database: 'pass' | 'fail';
    cache: 'pass' | 'fail';
    external_services: {
      feishu_api: 'pass' | 'fail';
    };
  };
  timestamp: string;
}
```

## 10. 测试策略

### 10.1 单元测试覆盖

- API 密钥生成、哈希、验证逻辑
- 配额计算和检查逻辑
- Session 管理功能
- 错误处理逻辑

### 10.2 集成测试场景

- 完整的 OAuth 登录流程
- API 密钥认证中间件
- 配额限制执行
- 缓存读写操作

### 10.3 端到端测试

- 用户登录、密钥管理全流程
- API 调用认证流程
- 权限控制验证
- 错误场景处理

### 10.4 安全测试

- 时序攻击防护测试
- CSRF 攻击防护测试
- SQL 注入防护测试
- XSS 防护测试

## 11. 迁移策略

### 11.1 数据迁移

```sql
-- 从现有auth系统迁移数据的SQL脚本
-- 1. 创建新表结构（如上述设计）
-- 2. 迁移现有用户数据
-- 3. 迁移现有API密钥数据
-- 4. 验证数据完整性
```

### 11.2 代码迁移

1. **渐进式替换**: 保持现有API兼容性的同时，逐步引入新功能
2. **功能开关**: 使用配置开关控制新旧功能的启用
3. **回滚计划**: 准备快速回滚到原有系统的方案

### 11.3 风险控制

- 在测试环境充分验证后再部署生产
- 准备数据备份和恢复方案
- 监控系统性能和错误率
- 准备应急响应预案