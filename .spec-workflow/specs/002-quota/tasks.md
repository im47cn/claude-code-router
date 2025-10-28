# 配额系统开发任务列表

## 1. 概述

本文档将 `.spec-workflow/specs/quota/design.md` 中定义的配额系统功能分解为具体的开发和测试任务。

## 2. 前置任务 (依赖)

* **QUOTA-TASK-001**: **[DB Migration]** 确保 `user_quotas` 和 `api_key_quotas` 表已通过数据库迁移创建 (由 AUTH-TASK-002 覆盖)。
    * **Dev**: Backend Team
    * **Test**: N/A
* **QUOTA-TASK-002**: **[Backend Setup]** 确保内存缓存 (`lru-cache`) 实例已初始化并可用于配额规则缓存 (由 AUTH-TASK-005 覆盖)。
    * **Dev**: Backend Team
    * **Test**: N/A
* **QUOTA-TASK-003**: **[Backend Setup]** 确保日志 Worker Thread (`logger.worker.ts`) 及其消息传递机制已建立 (由 LOGGING-TASK-XXX 覆盖)。
    * **Dev**: Backend Team
    * **Test**: N/A

## 3. 配额检查逻辑

* **QUOTA-TASK-101**: **[Backend Dev]** 实现 `QuotaService` (`src/services/quotaService.ts`)。
    * **Desc**: 创建包含 `checkUserQuota` 和 `checkApiKeyQuota` 方法的服务类。这些方法接收 `userId` 或 `apiKeyId`，从缓存/数据库获取规则，执行 `request_logs` 查询计数，并返回是否超限。
    * **Dev**: Backend Team
    * **Test**: QUOTA-TASK-151
* **QUOTA-TASK-102**: **[Backend Dev]** 实现配额规则缓存逻辑。
    * **Desc**: 在 `QuotaService` 中实现 `userQuotaCache` 和 `apiKeyQuotaCache` 的读取、写入和失效逻辑。
    * **Dev**: Backend Team
    * **Test**: QUOTA-TASK-152
* **QUOTA-TASK-103**: **[Backend Refactor]** 在 `src/middleware/auth.ts` (`preHandler`) 中集成 `QuotaService` 调用 (关联 AUTH-TASK-105)。
    * **Desc**: 在 API Key 验证成功后，注入并调用 `QuotaService.checkUserQuota` 和 `QuotaService.checkApiKeyQuota`。处理超限情况（发送日志给 Worker，返回 429）。
    * **Dev**: Backend Team
    * **Test**: AUTH-TASK-155 (集成测试)
* **QUOTA-TASK-151**: **[Backend Test]** 单元测试 `QuotaService` 的检查逻辑。
    * **Desc**: Mock 数据库查询和缓存，测试不同配额规则（存在、不存在）、不同请求计数（低于、等于、高于限制）下的检查结果。
    * **Dev**: Backend Team
* **QUOTA-TASK-152**: **[Backend Test]** 单元测试配额规则缓存逻辑。
    * **Desc**: 测试缓存的命中、未命中、写入、失效（TTL 和手动清除）。
    * **Dev**: Backend Team

## 4. 配额管理 API

* **QUOTA-TASK-201**: **[Backend Dev]** 实现 `PUT /admin/users/{userId}/quota` 端点。
    * **Desc**: 验证管理员权限，接收 `limit` 和 `interval_minutes`，写入/更新 `user_quotas` 表，清除 `userQuotaCache`。
    * **Dev**: Backend Team
    * **Test**: QUOTA-TASK-251
* **QUOTA-TASK-202**: **[Backend Dev]** 实现 `DELETE /admin/users/{userId}/quota` 端点。
    * **Desc**: 验证管理员权限，删除 `user_quotas` 记录，清除 `userQuotaCache`。
    * **Dev**: Backend Team
    * **Test**: QUOTA-TASK-252
* **QUOTA-TASK-203**: **[Backend Dev]** 实现 `GET /admin/users/{userId}/quota` 端点。
    * **Desc**: 验证管理员权限，查询 `user_quotas` 表。
    * **Dev**: Backend Team
    * **Test**: QUOTA-TASK-253
* **QUOTA-TASK-204**: **[Backend Dev]** 实现 `PUT /api/keys/{keyId}/quota` 端点。
    * **Desc**: 验证 Key 归属，接收 `limit` 和 `interval_minutes`，写入/更新 `api_key_quotas` 表，清除 `apiKeyQuotaCache`。
    * **Dev**: Backend Team
    * **Test**: QUOTA-TASK-254
* **QUOTA-TASK-205**: **[Backend Dev]** 实现 `DELETE /api/keys/{keyId}/quota` 端点。
    * **Desc**: 验证 Key 归属，删除 `api_key_quotas` 记录，清除 `apiKeyQuotaCache`。
    * **Dev**: Backend Team
    * **Test**: QUOTA-TASK-255
* **QUOTA-TASK-206**: **[Backend Dev]** 实现 `GET /api/keys/{keyId}/quota` 端点。
    * **Desc**: 验证 Key 归属，查询 `api_key_quotas` 表。
    * **Dev**: Backend Team
    * **Test**: QUOTA-TASK-256
* **QUOTA-TASK-251**: **[Backend Test]** 集成测试 `PUT /admin/users/{userId}/quota`。
    * **Desc**: 模拟管理员请求，验证配额设置/更新是否成功，缓存是否清除。
    * **Dev**: Backend Team
* **QUOTA-TASK-252**: **[Backend Test]** 集成测试 `DELETE /admin/users/{userId}/quota`。
    * **Desc**: 模拟管理员请求，验证配额删除是否成功，缓存是否清除。
    * **Dev**: Backend Team
* **QUOTA-TASK-253**: **[Backend Test]** 集成测试 `GET /admin/users/{userId}/quota`。
    * **Desc**: 模拟管理员请求，验证是否能正确获取配额规则。
    * **Dev**: Backend Team
* **QUOTA-TASK-254**: **[Backend Test]** 集成测试 `PUT /api/keys/{keyId}/quota`。
    * **Desc**: 模拟用户请求，验证配额设置/更新是否成功，权限是否控制，缓存是否清除。
    * **Dev**: Backend Team
* **QUOTA-TASK-255**: **[Backend Test]** 集成测试 `DELETE /api/keys/{keyId}/quota`。
    * **Desc**: 模拟用户请求，验证配额删除是否成功，权限是否控制，缓存是否清除。
    * **Dev**: Backend Team
* **QUOTA-TASK-256**: **[Backend Test]** 集成测试 `GET /api/keys/{keyId}/quota`。
    * **Desc**: 模拟用户请求，验证是否能正确获取配额规则，权限是否控制。
    * **Dev**: Backend Team

## 5. UI 集成

* **QUOTA-TASK-301**: **[Frontend Dev]** 在 API Key 管理页面显示 Key 的配额信息。
    * **Desc**: 修改 `ApiKeyManagementPage.tsx`，从 `GET /api/keys` 响应中读取并展示 `quota_limit` 和 `quota_interval_minutes`。
    * **Depends**: AUTH-TASK-202
    * **Dev**: Frontend Team
    * **Test**: QUOTA-TASK-351 (E2E)
* **QUOTA-TASK-302**: **[Frontend Dev]** 实现设置/编辑 API Key 配额的弹窗/表单。
    * **Desc**: 添加按钮触发弹窗，包含 `limit` 和 `interval_minutes` 输入框，调用 `PUT /api/keys/{keyId}/quota` API。
    * **Depends**: AUTH-TASK-204
    * **Dev**: Frontend Team
    * **Test**: QUOTA-TASK-351 (E2E)
* **QUOTA-TASK-303**: **[Frontend Dev]** 实现移除 API Key 配额的功能。
    * **Desc**: 添加按钮或选项，调用 `DELETE /api/keys/{keyId}/quota` API。
    * **Depends**: AUTH-TASK-205
    * **Dev**: Frontend Team
    * **Test**: QUOTA-TASK-351 (E2E)
* **QUOTA-TASK-304**: **[Frontend Dev]** (管理员功能) 创建用户配额管理界面。
    * **Desc**: 新增管理员页面，列出用户，提供设置/编辑/移除用户配额的功能，调用 `/admin/users/{userId}/quota` 相关 API。
    * **Depends**: QUOTA-TASK-201, QUOTA-TASK-202, QUOTA-TASK-203
    * **Dev**: Frontend Team
    * **Test**: QUOTA-TASK-352 (E2E)
* **QUOTA-TASK-351**: **[Frontend Test]** E2E 测试用户管理其 API Key 配额的功能。
    * **Desc**: 覆盖设置、更新、查看、移除 Key 配额的流程。
    * **Dev**: Frontend Team / QA
* **QUOTA-TASK-352**: **[Frontend Test]** E2E 测试管理员管理用户配额的功能。
    * **Desc**: 覆盖设置、更新、查看、移除用户配额的流程。
    * **Dev**: Frontend Team / QA

## 6. 数据库索引

* **QUOTA-TASK-401**: **[DB Task]** 确保 `request_logs` 表上存在 `(user_id, status, request_timestamp)` 和 `(api_key_id, status, request_timestamp)` 索引。
    * **Desc**: 在 Prisma schema 或数据库迁移文件中定义这些索引。
    * **Dev**: Backend Team
    * **Test**: 通过性能测试验证查询效率。

## 7. 依赖关系

* 配额检查逻辑 (QUOTA-TASK-101, 103) 依赖于 API Key 认证 (AUTH-TASK-104) 和日志记录 (LOGGING-TASK-XXX - 需要 `request_logs` 表结构和基本写入)。
* 配额管理 API (QUOTA-TASK-2xx) 依赖于用户认证 (Session/JWT) 和 API Key/User 数据库模型。
* UI 任务 (QUOTA-TASK-3xx) 依赖对应的后端 API 实现。
