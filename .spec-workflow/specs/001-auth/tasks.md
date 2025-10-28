# 认证与 API 密钥管理开发任务列表

## 1. 概述

本文档将 `.spec-workflow/specs/auth/design.md` 中定义的认证与 API 密钥管理功能分解为具体的开发和测试任务。

## 2. 前置任务 (基础设施)

* **AUTH-TASK-001**: **[DB Setup]** 初始化 Prisma (或选定的 ORM/Query Builder)。
    * **Desc**: 安装依赖 (`prisma`, `@prisma/client` 或对应库)，初始化 Prisma (`npx prisma init`)。
    * **Dev**: Backend Team
    * **Test**: N/A (集成测试覆盖)
* **AUTH-TASK-002**: **[DB Migration]** 根据 Schema 设计创建并执行数据库迁移。
    * **Desc**: 在 `prisma/schema.prisma` 中定义 `User`, `UserIdentity`, `ApiKey` 模型，生成并应用迁移 (`npx prisma migrate dev --name init-auth-models`)。
    * **Dev**: Backend Team
    * **Test**: N/A (集成测试覆盖)
* **AUTH-TASK-003**: **[Backend Setup]** 安装并配置 `bcrypt` (或 `argon2`) 用于哈希。
    * **Dev**: Backend Team
    * **Test**: N/A
* **AUTH-TASK-004**: **[Backend Setup]** 安装并配置 `@fastify/session` 和 `@fastify/cookie` (或 `jsonwebtoken`)。
    * **Desc**: 配置 session secret, cookie 选项等。
    * **Dev**: Backend Team
    * **Test**: N/A
* **AUTH-TASK-005**: **[Backend Setup]** 设置内存缓存 (`lru-cache`) 实例用于缓存 API Key 和配额规则。
    * **Desc**: 创建共享的缓存实例或模块 (`src/utils/cache.ts` 可扩展)。
    * **Dev**: Backend Team
    * **Test**: N/A

## 3. API Key 认证与核心逻辑

* **AUTH-TASK-101**: **[Backend Dev]** 实现 API Key 生成逻辑。
    * **Desc**: 在 `src/auth/apiKey.ts` 中创建函数生成高熵 Key 字符串 (带 `sk-` 前缀) 和前缀 (`key_prefix`)。
    * **Dev**: Backend Team
    * **Test**: AUTH-TASK-151
* **AUTH-TASK-102**: **[Backend Dev]** 实现 API Key 哈希逻辑。
    * **Desc**: 在 `src/auth/apiKey.ts` 中创建函数使用 `bcrypt.hash()` 计算 `key_hash`。
    * **Dev**: Backend Team
    * **Test**: AUTH-TASK-152
* **AUTH-TASK-103**: **[Backend Dev]** 实现 API Key 验证逻辑。
    * **Desc**: 在 `src/auth/apiKey.ts` 中创建函数，接收原始 Key，提取前缀，查询数据库（含缓存），使用 `bcrypt.compare()` 进行验证。返回 `{ isValid: boolean, userId?: number, apiKeyId?: number }`。
    * **Dev**: Backend Team
    * **Test**: AUTH-TASK-153
* **AUTH-TASK-104**: **[Backend Refactor]** 重构 `src/middleware/auth.ts` (`preHandler` 钩子)。
    * **Desc**: 移除旧的全局 APIKEY 检查。集成新的 API Key 验证逻辑 (调用 AUTH-TASK-103)。验证通过后，查询用户信息并附加 `req.user` 和 `req.api_key_id`。处理无效 Key、禁用 Key、禁用用户等情况，返回 401 或 403。
    * **Dev**: Backend Team
    * **Test**: AUTH-TASK-154 (集成测试)
* **AUTH-TASK-105**: **[Backend Dev]** 在 `preHandler` 钩子中集成配额检查逻辑。
    * **Desc**: 在 API Key 验证成功后，调用 `QuotaService` (待实现) 进行用户和 Key 配额检查。超限时返回 429。
    * **Depends**: QUOTA-TASK-101 (QuotaService 实现)
    * **Dev**: Backend Team
    * **Test**: AUTH-TASK-155 (集成测试), QUOTA-TASK-151
* **AUTH-TASK-151**: **[Backend Test]** 单元测试 API Key 生成逻辑。
    * **Desc**: 验证生成的 Key 格式、唯一性（理论上）和前缀。
    * **Dev**: Backend Team
* **AUTH-TASK-152**: **[Backend Test]** 单元测试 API Key 哈希和比较逻辑。
    * **Desc**: 确保 `hash` 和 `compare` 函数按预期工作。
    * **Dev**: Backend Team
* **AUTH-TASK-153**: **[Backend Test]** 单元测试 API Key 验证逻辑。
    * **Desc**: Mock 数据库/缓存，测试有效 Key、无效 Key、错误前缀、不同哈希算法（如果支持多种）等场景。
    * **Dev**: Backend Team
* **AUTH-TASK-154**: **[Backend Test]** 集成测试 `preHandler` 钩子的 API Key 认证部分。
    * **Desc**: 模拟 API 请求（带/不带 Key，有效/无效 Key），验证是否正确处理认证、附加用户信息或返回错误。
    * **Dev**: Backend Team
* **AUTH-TASK-155**: **[Backend Test]** 集成测试 `preHandler` 钩子的配额检查部分（与 AUTH-TASK-105 关联）。
    * **Desc**: 模拟 API 请求，配合 Mock 的配额服务或数据库状态，验证配额检查逻辑是否按预期工作（通过/拒绝 429）。
    * **Dev**: Backend Team

## 4. API Key 管理 API

* **AUTH-TASK-201**: **[Backend Dev]** 实现 `POST /api/keys` 端点 (创建 Key)。
    * **Desc**: 调用 Key 生成和哈希逻辑，存入数据库，返回**完整原始 Key**及元数据。需 Session/JWT 验证用户身份。
    * **Dev**: Backend Team
    * **Test**: AUTH-TASK-251
* **AUTH-TASK-202**: **[Backend Dev]** 实现 `GET /api/keys` 端点 (获取 Keys)。
    * **Desc**: 查询数据库获取当前用户的 Keys 列表（不含 `key_hash`），关联配额信息。需 Session/JWT 验证。
    * **Dev**: Backend Team
    * **Test**: AUTH-TASK-252
* **AUTH-TASK-203**: **[Backend Dev]** 实现 `PUT /api/keys/{keyId}` 端点 (更新 Key)。
    * **Desc**: 更新 Key 的 `name` 或 `is_active` 状态。验证 Key 归属。更新缓存。需 Session/JWT 验证。
    * **Dev**: Backend Team
    * **Test**: AUTH-TASK-253
* **AUTH-TASK-204**: **[Backend Dev]** 实现 `DELETE /api/keys/{keyId}` 端点 (删除 Key)。
    * **Desc**: 删除 Key 记录及关联配额。验证 Key 归属。失效缓存。需 Session/JWT 验证。
    * **Dev**: Backend Team
    * **Test**: AUTH-TASK-254
* **AUTH-TASK-251**: **[Backend Test]** 集成测试 `POST /api/keys`。
    * **Desc**: 模拟请求，验证 Key 是否正确创建、存储（哈希），原始 Key 是否仅返回一次。
    * **Dev**: Backend Team
* **AUTH-TASK-252**: **[Backend Test]** 集成测试 `GET /api/keys`。
    * **Desc**: 模拟请求，验证返回的列表是否正确、是否包含敏感信息。
    * **Dev**: Backend Team
* **AUTH-TASK-253**: **[Backend Test]** 集成测试 `PUT /api/keys/{keyId}`。
    * **Desc**: 模拟请求，验证更新操作是否成功、权限是否控制、缓存是否失效。
    * **Dev**: Backend Team
* **AUTH-TASK-254**: **[Backend Test]** 集成测试 `DELETE /api/keys/{keyId}`。
    * **Desc**: 模拟请求，验证删除操作是否成功、权限是否控制、缓存是否失效。
    * **Dev**: Backend Team

## 5. UI 认证与 Key 管理界面

* **AUTH-TASK-301**: **[Frontend Dev]** 创建登录页面 (`LoginPage.tsx`)。
    * **Desc**: 包含“使用飞书登录”按钮，点击后跳转到 `/auth/feishu`。处理未登录状态的重定向。
    * **Dev**: Frontend Team
    * **Test**: AUTH-TASK-351 (E2E)
* **AUTH-TASK-302**: **[Frontend Dev]** 实现前端路由保护 (`ProtectedRoute.tsx`, `PublicRoute.tsx`)。
    * **Desc**: 根据登录状态（检查 Session Cookie 或 JWT）控制页面访问。
    * **Dev**: Frontend Team
    * **Test**: AUTH-TASK-351 (E2E)
* **AUTH-TASK-303**: **[Frontend Dev]** 实现获取当前用户状态 (`useAuth` hook 或 Context)。
    * **Desc**: 调用 `/api/me` 获取用户信息，管理前端登录状态。
    * **Dev**: Frontend Team
    * **Test**: AUTH-TASK-351 (E2E)
* **AUTH-TASK-304**: **[Frontend Dev]** 创建 API Key 管理页面 (`ApiKeyManagementPage.tsx`)。
    * **Desc**: 展示 Key 列表 (调用 AUTH-TASK-202 API)，包含创建、编辑(名称/状态)、删除按钮。
    * **Dev**: Frontend Team
    * **Test**: AUTH-TASK-352 (E2E)
* **AUTH-TASK-305**: **[Frontend Dev]** 实现创建 API Key 弹窗/流程。
    * **Desc**: 调用 AUTH-TASK-201 API，**一次性**显示生成的 Key 并提示用户保存。
    * **Dev**: Frontend Team
    * **Test**: AUTH-TASK-352 (E2E)
* **AUTH-TASK-306**: **[Frontend Dev]** 实现编辑 API Key 弹窗/流程 (名称/状态)。
    * **Desc**: 调用 AUTH-TASK-203 API。
    * **Dev**: Frontend Team
    * **Test**: AUTH-TASK-352 (E2E)
* **AUTH-TASK-307**: **[Frontend Dev]** 实现删除 API Key 确认流程。
    * **Desc**: 调用 AUTH-TASK-204 API。
    * **Dev**: Frontend Team
    * **Test**: AUTH-TASK-352 (E2E)
* **AUTH-TASK-351**: **[Frontend Test]** E2E 测试 UI 登录/登出流程。
    * **Desc**: 模拟飞书回调，验证登录状态、重定向、用户信息显示。
    * **Dev**: Frontend Team / QA
* **AUTH-TASK-352**: **[Frontend Test]** E2E 测试 API Key 管理界面的 CRUD 操作。
    * **Desc**: 覆盖创建、显示（不显示完整 Key）、编辑、删除 Key 的流程。
    * **Dev**: Frontend Team / QA

## 6. 飞书 OAuth 集成 (待定细节)

* **AUTH-TASK-401**: **[Backend Dev]** 实现 `/auth/feishu` 端点 (重定向)。
    * **Desc**: 生成授权 URL，存储 state。
    * **Dev**: Backend Team
    * **Test**: AUTH-TASK-451 (集成)
* **AUTH-TASK-402**: **[Backend Dev]** 实现 `/auth/feishu/callback` 端点 (回调处理)。
    * **Desc**: 验证 state，获取 token 和用户信息，查找/创建用户，设置 Session/JWT，重定向。
    * **Dev**: Backend Team
    * **Test**: AUTH-TASK-451 (集成)
* **AUTH-TASK-403**: **[Backend Dev]** 实现 `/auth/logout` 端点。
    * **Desc**: 清除 Session/JWT。
    * **Dev**: Backend Team
    * **Test**: AUTH-TASK-451 (集成)
* **AUTH-TASK-451**: **[Backend Test]** 集成测试飞书 OAuth 流程。
    * **Desc**: Mock 飞书 API 响应，测试完整的登录、回调、用户创建/查找、Session/JWT 设置流程。
    * **Dev**: Backend Team

## 7. 依赖关系

* API Key 认证 (AUTH-TASK-104) 依赖 Key 生成/哈希/验证 (AUTH-TASK-101, 102, 103)。
* `preHandler` 配额检查 (AUTH-TASK-105) 依赖配额服务的实现 (QUOTA-TASK-XXX)。
* API Key 管理 API (AUTH-TASK-2xx) 依赖核心 Key 逻辑 (AUTH-TASK-1xx) 和 Session/JWT 验证。
* UI 任务 (AUTH-TASK-3xx) 依赖对应的后端 API 实现。
* 飞书 OAuth (AUTH-TASK-4xx) 依赖 Session/JWT 设置 (AUTH-TASK-004) 和用户数据库模型 (AUTH-TASK-002)。
