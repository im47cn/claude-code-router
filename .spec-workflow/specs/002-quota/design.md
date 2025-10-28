# 配额系统设计文档

## 1. 概述

本文档描述了 `claude-code-router` 配额系统的技术设计，该系统旨在限制用户和 API 密钥在特定时间窗口内的请求次数。设计遵循 `.spec-workflow/specs/quota/requirements.md` 中定义的需求，并基于已确认的技术栈（MySQL, Worker Threads, 内存缓存）。

## 2. 数据模型

相关数据库表（已在 Schema 设计文档中定义）：

* **`users`**: 存储用户基本信息。
* **`api_keys`**: 存储 API 密钥信息。
* **`user_quotas`**: 存储管理员为用户设置的配额规则 (`user_id`, `limit`, `interval_minutes`)。
* **`api_key_quotas`**: 存储用户为其 API Key 设置的配额规则 (`api_key_id`, `limit`, `interval_minutes`)。
* **`request_logs`**: 存储请求记录，用于配额检查计数。

## 3. 配额检查逻辑 (集成于 API 认证 `preHandler` 钩子)

配额检查在 API 密钥认证成功之后、实际路由执行之前进行。

**流程**:

1.  **获取标识**: 从 `req.user` 获取 `user_id`，从 `req.api_key_id` 获取 `api_key_id`。
2.  **获取用户配额规则**:
    * 尝试从内存缓存 (`userQuotaCache`) 中读取 `user_id` 对应的规则 `{ limit, interval_minutes }`。
    * 若缓存未命中，查询 `user_quotas` 表 `WHERE user_id = ?`。
    * 将查询结果（包括规则不存在的情况，可以缓存一个特殊标记如 `null` 或 `{ limit: null }`）存入缓存，设置 TTL（例如 5 分钟）。
3.  **检查用户配额**:
    * 如果从缓存或数据库获取到有效的用户配额规则 (`limit` 和 `interval_minutes` 均大于 0)：
        * 计算时间窗口的起始时间 `startTime = NOW() - INTERVAL interval_minutes MINUTE`。
        * 执行数据库查询: `SELECT COUNT(*) FROM request_logs WHERE user_id = ? AND status = 'success' AND request_timestamp >= ?` (参数: `user_id`, `startTime`)。
        * **注意**: 索引 `(user_id, status, request_timestamp)` 对此查询非常重要。
        * 如果 `COUNT(*)` >= `limit`，则配额超限。**立即**向日志 Worker 发送拒绝日志（包含 `user_id`, `api_key_id`, `status='quota_exceeded'`, `error_message='User quota exceeded'`），并返回 `HTTP 429 Too Many Requests` 错误给客户端。
4.  **获取 Key 配额规则**:
    * 尝试从内存缓存 (`apiKeyQuotaCache`) 中读取 `api_key_id` 对应的规则 `{ limit, interval_minutes }`。
    * 若缓存未命中，查询 `api_key_quotas` 表 `WHERE api_key_id = ?`。
    * 将查询结果存入缓存，设置 TTL。
5.  **检查 Key 配额**:
    * 如果从缓存或数据库获取到有效的 Key 配额规则 (`limit` 和 `interval_minutes` 均大于 0)：
        * 计算时间窗口的起始时间 `startTime = NOW() - INTERVAL interval_minutes MINUTE`。
        * 执行数据库查询: `SELECT COUNT(*) FROM request_logs WHERE api_key_id = ? AND status = 'success' AND request_timestamp >= ?` (参数: `api_key_id`, `startTime`)。
        * **注意**: 索引 `(api_key_id, status, request_timestamp)` 对此查询非常重要。
        * 如果 `COUNT(*)` >= `limit`，则配额超限。**立即**向日志 Worker 发送拒绝日志（包含 `user_id`, `api_key_id`, `status='quota_exceeded'`, `error_message='API key quota exceeded'`），并返回 `HTTP 429 Too Many Requests` 错误给客户端。
6.  **通过**: 如果所有配额检查都通过，则请求继续处理。

**缓存实现**:

* 使用 `lru-cache` 或 `node-cache` 实现两个内存缓存实例：`userQuotaCache` 和 `apiKeyQuotaCache`。
* 缓存 Key 为 `user_id` 或 `api_key_id`，Value 为配额规则对象 `{ limit, interval_minutes }` 或表示无规则的 `null`。
* 设置合理的 TTL（例如 5 分钟），避免数据陈旧。
* 在更新或删除配额规则时，需要主动清除相应的缓存条目。

**并发与精度**:

* 此设计依赖于已写入 `request_logs` 的**成功**请求计数。由于日志是异步写入的，配额检查可能会有轻微延迟（在 Worker 写入数据库之前，新的请求可能已经开始处理）。
* 在高并发下，短时间内（Worker 处理延迟期间）可能允许少量超过配额的请求。对于基于分钟的时间窗口，这种误差通常是可接受的。
* 如果需要严格的实时限制，未来可以引入 Redis 原子计数器 (`INCR`, `EXPIRE`)，但这会增加系统复杂性和外部依赖。**当前阶段，接受基于日志表的轻微延迟**。

## 4. 配额管理 API

### 4.1 用户配额 (管理员权限)

* **`PUT /admin/users/{userId}/quota`**: 设置或更新用户的配额规则。
    * **权限**: `req.user.is_admin === true`。
    * **请求体**: `{ "limit": number, "interval_minutes": number }` (`limit` 和 `interval_minutes` 必须 > 0)。
    * **操作**:
        1.  验证 `userId` 是否存在。
        2.  在 `user_quotas` 表中 `INSERT ... ON DUPLICATE KEY UPDATE limit = ?, interval_minutes = ?`。
        3.  清除 `userQuotaCache` 中对应 `userId` 的缓存。
    * **响应**: `200 OK` 或 `201 Created`，返回更新后的配额规则。

* **`DELETE /admin/users/{userId}/quota`**: 移除用户的配额规则。
    * **权限**: `req.user.is_admin === true`。
    * **操作**:
        1.  验证 `userId` 是否存在。
        2.  从 `user_quotas` 表中删除 `WHERE user_id = ?` 的记录。
        3.  清除 `userQuotaCache` 中对应 `userId` 的缓存（或设置为 `null`）。
    * **响应**: `204 No Content`。

* **`GET /admin/users/{userId}/quota`**: 获取用户的配额规则。
    * **权限**: `req.user.is_admin === true`。
    * **操作**: 查询 `user_quotas` 表。
    * **响应**: `200 OK`，返回 `{ limit, interval_minutes }` 或 `404 Not Found`。

### 4.2 API 密钥配额 (用户权限)

* **`PUT /api/keys/{keyId}/quota`**: 设置或更新指定 API Key 的配额规则。
    * **权限**: Key 必须属于当前登录用户 (`req.user.id`)。
    * **请求体**: `{ "limit": number, "interval_minutes": number }` (`limit` 和 `interval_minutes` 必须 > 0)。
    * **操作**:
        1.  验证 `api_keys` 表中 `id = keyId` 的记录是否存在且 `user_id` 匹配。
        2.  在 `api_key_quotas` 表中 `INSERT ... ON DUPLICATE KEY UPDATE limit = ?, interval_minutes = ?`。
        3.  清除 `apiKeyQuotaCache` 中对应 `keyId` 的缓存。
    * **响应**: `200 OK` 或 `201 Created`，返回更新后的配额规则。

* **`DELETE /api/keys/{keyId}/quota`**: 移除指定 API Key 的配额规则。
    * **权限**: Key 必须属于当前登录用户。
    * **操作**:
        1.  验证 `api_keys` 表中 `id = keyId` 的记录是否存在且 `user_id` 匹配。
        2.  从 `api_key_quotas` 表中删除 `WHERE api_key_id = ?` 的记录。
        3.  清除 `apiKeyQuotaCache` 中对应 `keyId` 的缓存（或设置为 `null`）。
    * **响应**: `204 No Content`。

* **`GET /api/keys/{keyId}/quota`**: 获取指定 API Key 的配额规则。
    * **权限**: Key 必须属于当前登录用户。
    * **操作**: 查询 `api_key_quotas` 表。
    * **响应**: `200 OK`，返回 `{ limit, interval_minutes }` 或 `404 Not Found`。

## 5. 错误处理

* 当配额超限时，API `preHandler` **必须** 返回 `HTTP 429 Too Many Requests`。
* 响应体 **可以** 包含 `Retry-After` 头部，指示客户端何时可以重试（例如，计算到当前时间窗口结束的秒数）。
* 配额超限的请求 **仍应** 被异步记录到 `request_logs` 表，`status` 设为 `'quota_exceeded'`，并包含相应的错误消息。

## 6. 测试策略

* **单元测试**:
    * 配额规则缓存的读写和失效逻辑。
    * 配额检查的 SQL 查询语句构建。
* **集成测试**:
    * 模拟请求，测试 `preHandler` 中的配额检查逻辑（未超限、刚好超限、已超限）。
    * 测试用户配额和 Key 配额的独立性。
    * 测试配额管理 API 的 CRUD 操作及其对缓存的影响。
    * 验证配额超限时是否正确返回 429 并记录日志。
* **性能测试**: (可选) 在高并发下测试配额检查的性能，评估 `request_logs` 查询是否成为瓶颈。
