# 认证与 API 密钥管理设计文档

## 1. 概述

本文档详细描述了 `claude-code-router` 用户认证（基于飞书 OAuth）、API 密钥认证以及 API 密钥管理功能的技术设计方案。设计遵循 `.spec-workflow/specs/auth/requirements.md` 中定义的需求。

## 2. 技术选型

* **数据库**: MySQL (Schema 见 Schema 设计文档)
* **ORM/Query Builder**: Prisma (推荐)
* **后端框架**: Fastify
* **异步日志**: Node.js Worker Threads
* **API Key 哈希**: bcrypt
* **UI 认证状态**: Fastify Session (`@fastify/session` + `@fastify/cookie`) - 假设部署环境支持 Session 存储，如果需要无状态或分布式部署，可改为 JWT。
* **缓存**: `lru-cache` (内存缓存)

## 3. 核心流程设计

### 3.1 UI 用户认证流程 (飞书 OAuth)

1.  **前端**: 用户点击“使用飞书登录”按钮。
2.  **前端**: 重定向到后端 `/auth/feishu` 端点。
3.  **后端 (`/auth/feishu`)**:
    * 生成飞书 OAuth2 授权请求 URL（包含 App ID, Redirect URI, Scope, State）。
    * 将 `state` 参数存储在 Session 中以防止 CSRF。
    * 重定向用户到飞书授权页面。
4.  **飞书**: 用户授权。
5.  **飞书**: 重定向用户到后端回调 URL `/auth/feishu/callback`，附带 `code` 和 `state` 参数。
6.  **后端 (`/auth/feishu/callback`)**:
    * 验证 `state` 参数与 Session 中存储的是否一致。
    * 使用 `code` 向飞书请求 Access Token。
    * 使用 Access Token 向飞书请求用户信息（用户 ID, 姓名, 头像等）。
    * **数据库交互**:
        * 根据 `feishu_user_id` 在 `user_identities` 表中查找记录。
        * **如果找到**: 获取关联的 `user_id`。查询 `users` 表获取用户信息。
        * **如果未找到**:
            * 在 `users` 表中创建新用户记录（设置 `name`, `avatar_url`, `is_active=true`, `is_admin=false`）。
            * 在 `user_identities` 表中创建新记录，关联新用户的 `id` 和飞书信息 (`provider='feishu'`, `provider_user_id`)。
        * **更新用户信息 (可选)**: 可以根据飞书返回的最新信息更新 `users` 表中的 `name` 和 `avatar_url`。
    * **Session/JWT**: 将用户 `id`, `name`, `is_admin`, `is_active` 等必要信息存储在 Session (或生成 JWT)。
    * 重定向用户到前端 UI 主页 (`/ui/` 或 `/dashboard`)。
7.  **前端**: 接收到重定向，应用根据 Session/JWT 状态识别为已登录用户。

### 3.2 API 密钥认证流程 (`preHandler` 钩子)

1.  **提取 Key**: 从 `Authorization: Bearer <KEY>` 或 `X-Api-Key: <KEY>` 请求头获取原始 API Key 字符串。如果都缺失，返回 401。
2.  **基本校验**: 检查 Key 格式是否符合预期（例如，必须以 `sk-` 开头，长度符合要求）。
3.  **提取前缀**: 获取 Key 的前缀 `key_prefix` (例如，`sk-` 加上随后的 4-6 位字符)。
4.  **缓存查询**: 尝试从内存缓存中根据 `key_prefix` 查找可能的 Key 列表 `CacheEntry = { id, user_id, key_hash, is_active }[]`。
5.  **数据库查询 (缓存未命中或需验证)**:
    * 如果缓存未命中，查询 `api_keys` 表 `WHERE key_prefix = ? AND is_active = true`。
    * 将查询结果（`id`, `user_id`, `key_hash`, `is_active`）存入缓存。
6.  **哈希比较**:
    * 遍历缓存或数据库查询结果中的 Key 记录。
    * 对传入的原始 API Key 使用 `bcrypt.compare()` (或 Argon2 对应函数) 与每个记录的 `key_hash` 进行比较。**必须使用库提供的比较函数以实现恒定时间比较**。
    * 如果找到匹配的哈希且 `is_active` 为 true，则认证成功。记录 `api_key_id` 和 `user_id`。
    * 如果遍历完所有前缀匹配的 Key 仍未找到匹配项，返回 401。
7.  **用户信息与配额查询**:
    * 使用 `user_id` 从缓存或数据库 (`users` 表) 获取用户信息 (`is_active`, `is_admin`)。如果用户 `is_active` 为 false，返回 403 Forbidden。
    * **用户配额检查**:
        * 从缓存或数据库 (`user_quotas` 表) 获取用户配额规则 (`limit`, `interval_minutes`)。
        * 如果规则存在，查询 `request_logs` 表 `COUNT(*) WHERE user_id = ? AND status = 'success' AND request_timestamp >= NOW() - INTERVAL ? MINUTE`。
        * 如果计数 `>= limit`，记录拒绝日志（通过 Worker Thread），返回 429。
    * **API Key 配额检查**:
        * 从缓存或数据库 (`api_key_quotas` 表) 获取 Key 配额规则 (`limit`, `interval_minutes`)。
        * 如果规则存在，查询 `request_logs` 表 `COUNT(*) WHERE api_key_id = ? AND status = 'success' AND request_timestamp >= NOW() - INTERVAL ? MINUTE`。
        * 如果计数 `>= limit`，记录拒绝日志（通过 Worker Thread），返回 429。
8.  **附加信息**: 将用户信息 (`req.user = { id: user_id, is_admin: ... }`) 和 `req.api_key_id = api_key_id` 附加到 Fastify 请求对象。
9.  **更新 `last_used_at` (可选)**: 可以考虑异步更新 `api_keys` 表的 `last_used_at` 字段（例如通过日志 Worker 或单独的低优先级任务），以避免阻塞认证流程。
10. **调用 `done()`**: 继续处理请求。

### 3.3 API 密钥管理流程 (UI -> 后端 API)

* **创建 Key (`POST /api/keys`)**:
    1.  后端接收用户 ID (从 Session/JWT) 和可选的 Key 名称。
    2.  生成一个新的、唯一的、高熵的 API Key 字符串 (例如，使用 `crypto.randomBytes` 生成 32 字节，然后 Base64 编码，加上 `sk-` 前缀)。
    3.  提取 `key_prefix`。
    4.  使用 `bcrypt.hash()` 计算 `key_hash`。
    5.  **数据库交互**: 在 `api_keys` 表中插入新记录 (`user_id`, `key_hash`, `key_prefix`, `name`, `is_active=true`)。
    6.  **返回**: 将**完整的、原始的** API Key 字符串**仅在此次响应中**返回给前端，同时返回 Key 的 ID 和其他元数据（如前缀、名称、创建时间）。前端必须明确提示用户立即保存 Key。
* **获取 Keys (`GET /api/keys`)**:
    1.  后端接收用户 ID。
    2.  **数据库交互**: 查询 `api_keys` 表 `WHERE user_id = ?`，连接 `api_key_quotas` 表获取配额信息。
    3.  **返回**: 返回 Key 列表，包含 `id`, `name`, `key_prefix`, `is_active`, `created_at`, `last_used_at`, `quota_limit`, `quota_interval_minutes`。**绝不返回 `key_hash` 或原始 Key**。
* **更新 Key (`PUT /api/keys/{keyId}`)**:
    1.  后端接收用户 ID 和 `keyId`，以及要更新的字段（`name`, `is_active`）。
    2.  **数据库交互**: 验证 Key 是否属于该用户。更新 `api_keys` 表中对应 `id` 的记录。
    3.  **缓存**: 如果更新了 `is_active`，需要使相关缓存失效。
    4.  **返回**: 返回更新后的 Key 信息（不含敏感数据）。
* **删除 Key (`DELETE /api/keys/{keyId}`)**:
    1.  后端接收用户 ID 和 `keyId`。
    2.  **数据库交互**: 验证 Key 是否属于该用户。从 `api_keys` 表中删除对应记录 (或标记为已删除)。同时删除关联的 `api_key_quotas` 记录。
    3.  **缓存**: 使相关缓存失效。
    4.  **返回**: 返回 204 No Content。
* **设置/更新 Key 配额 (`PUT /api/keys/{keyId}/quota`)**:
    1.  后端接收用户 ID, `keyId`, `limit`, `interval_minutes`。
    2.  **数据库交互**: 验证 Key 是否属于该用户。在 `api_key_quotas` 表中 `INSERT ... ON DUPLICATE KEY UPDATE limit = ?, interval_minutes = ?`。
    3.  **缓存**: 使对应的 Key 配额缓存失效。
    4.  **返回**: 返回 200 OK 或更新后的配额信息。

## 4. API 接口设计

(详细的 OpenAPI/Swagger 规范将在阶段 3 定义，此处为高级设计)

* **UI 认证**:
    * `GET /auth/feishu`: 重定向到飞书。
    * `GET /auth/feishu/callback`: 处理回调，设置 Session/JWT。
    * `POST /auth/logout`: 清除 Session/JWT。
* **API 密钥管理**:
    * `GET /api/me`: 获取当前登录用户信息。
    * `GET /api/keys`: 获取用户的所有 API Keys (元数据)。
    * `POST /api/keys`: 创建新的 API Key (请求体可选 `{ "name": "..." }`)。
    * `PUT /api/keys/{keyId}`: 更新 Key 信息 (请求体 `{ "name": "...", "is_active": true/false }`)。
    * `DELETE /api/keys/{keyId}`: 删除 Key。
    * `PUT /api/keys/{keyId}/quota`: 设置 Key 的配额 (请求体 `{ "limit": 100, "interval_minutes": 60 }`)。
    * `DELETE /api/keys/{keyId}/quota`: 移除 Key 的配额。
* **核心路由 (需 API Key 认证)**:
    * `POST /v1/messages`: (现有接口，认证逻辑修改)。
    * `GET /v1/models`: (可能需要，用于列出可用模型)。
* **历史记录**:
    * `GET /api/history`: 获取当前用户的请求日志 (支持分页、过滤)。
* **管理员接口 (需 `is_admin` 权限)**:
    * `GET /admin/users`: 获取用户列表。
    * `PUT /admin/users/{userId}/quota`: 设置用户配额。
    * `PUT /admin/users/{userId}/status`: 启用/禁用用户。

## 5. 测试与验收策略

* **单元测试**:
    * API Key 生成、哈希、验证逻辑。
    * 配额检查 SQL 查询或逻辑。
    * Worker Thread 消息处理和数据库写入逻辑。
* **集成测试**:
    * 完整的飞书 OAuth 登录流程 (可能需要 Mock 飞书 API)。
    * API Key 认证 `preHandler` 钩子，覆盖有效、无效、禁用、过期 Key 的情况。
    * 配额检查 `preHandler` 钩子，覆盖未超限、刚好超限、已超限的情况。
    * API Key 管理接口的 CRUD 操作及配额设置。
    * 异步日志记录流程（主线程发送 -> Worker 接收 -> 数据库写入）。
* **端到端测试 (UI)**:
    * 用户通过飞书登录、登出。
    * 用户创建、查看、禁用/启用、删除 API Key。
    * 用户设置 API Key 配额。
    * (待历史记录 UI 实现后) 用户查看请求历史。
* **安全测试**:
    * 检查 API Key 是否有泄露风险（日志、响应）。
    * 测试配额限制是否能有效阻止超额请求。
    * CSRF 防护（如果使用 Session）。
    * 检查管理员接口是否有权限控制。
