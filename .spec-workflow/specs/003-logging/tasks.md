# 异步日志系统开发任务列表

## 1. 概述

本文档将 `.spec-workflow/specs/logging/design.md` 中定义的异步日志系统功能分解为具体的开发和测试任务。

## 2. 前置任务 (依赖)

* **LOGGING-TASK-001**: **[DB Migration]** 确保 `request_logs` 表已通过数据库迁移创建，包含所有必需的字段和索引 (由 AUTH-TASK-002 覆盖)。
    * **Dev**: Backend Team
    * **Test**: N/A
* **LOGGING-TASK-002**: **[Backend Setup]** 确保 Prisma Client (或选定 ORM/Query Builder) 已配置并可在 Worker Thread 中使用。
    * **Dev**: Backend Team
    * **Test**: N/A
* **LOGGING-TASK-003**: **[Backend Setup]** 确保 API 认证 `preHandler` 钩子能正确附加 `req.user.id` 和 `req.api_key_id` (由 AUTH-TASK-104 覆盖)。
    * **Dev**: Backend Team
    * **Test**: N/A

## 3. 日志 Worker Thread 实现

* **LOGGING-TASK-101**: **[Backend Dev]** 创建日志 Worker 脚本 (`src/workers/logger.worker.ts`)。
    * **Desc**: 设置基本的 Worker 结构，引入 `worker_threads` 模块，处理 `workerData` (数据库连接信息)。
    * **Dev**: Backend Team
    * **Test**: LOGGING-TASK-151
* **LOGGING-TASK-102**: **[Backend Dev]** 在 Worker 中初始化数据库连接。
    * **Desc**: 实例化 Prisma Client (或 DB 库) 并建立连接池。
    * **Dev**: Backend Team
    * **Test**: LOGGING-TASK-151
* **LOGGING-TASK-103**: **[Backend Dev]** 在 Worker 中实现消息监听和内部队列。
    * **Desc**: 使用 `parentPort.on('message', ...)` 接收日志数据，将其推入内存数组 (`logQueue`)。
    * **Dev**: Backend Team
    * **Test**: LOGGING-TASK-152
* **LOGGING-TASK-104**: **[Backend Dev]** 在 Worker 中实现批处理写入数据库逻辑 (`processBatch`)。
    * **Desc**: 实现从队列取出数据，调用 `prisma.request_log.createMany()` (或等效) 批量插入。
    * **Dev**: Backend Team
    * **Test**: LOGGING-TASK-153
* **LOGGING-TASK-105**: **[Backend Dev]** 在 Worker 中实现定时触发批处理。
    * **Desc**: 使用 `setTimeout` 按 `BATCH_INTERVAL` 调用 `processBatch`。确保在队列满或定时器到期时都触发处理。
    * **Dev**: Backend Team
    * **Test**: LOGGING-TASK-154
* **LOGGING-TASK-106**: **[Backend Dev]** 在 Worker 中实现错误处理和重试机制。
    * **Desc**: 捕获数据库写入错误。对可恢复错误进行延时重试。对无法恢复的错误，将失败的批次/记录写入本地 `failed_logs.jsonl` 文件。
    * **Dev**: Backend Team
    * **Test**: LOGGING-TASK-155
* **LOGGING-TASK-107**: **[Backend Dev]** 在 Worker 中实现优雅关闭逻辑。
    * **Desc**: 监听关闭信号，处理剩余队列，断开数据库连接。
    * **Dev**: Backend Team
    * **Test**: LOGGING-TASK-156
* **LOGGING-TASK-151**: **[Backend Test]** 单元测试 Worker 初始化和数据库连接。
    * **Desc**: 验证 Worker 是否能成功启动并建立数据库连接。
    * **Dev**: Backend Team
* **LOGGING-TASK-152**: **[Backend Test]** 单元测试 Worker 消息接收和队列功能。
    * **Desc**: 模拟主线程发送消息，验证 Worker 是否能正确接收并添加到内部队列。
    * **Dev**: Backend Team
* **LOGGING-TASK-153**: **[Backend Test]** 单元测试 Worker 批处理写入逻辑。
    * **Desc**: Mock 数据库写入操作，验证 `processBatch` 是否按预期从队列取数据并调用写入函数。
    * **Dev**: Backend Team
* **LOGGING-TASK-154**: **[Backend Test]** 单元测试 Worker 定时触发逻辑。
    * **Desc**: 使用 `jest.useFakeTimers()` (或类似) 测试定时器是否按预期触发 `processBatch`。
    * **Dev**: Backend Team
* **LOGGING-TASK-155**: **[Backend Test]** 单元测试 Worker 错误处理和重试逻辑。
    * **Desc**: Mock 数据库写入失败，验证重试是否按预期执行，失败日志是否写入文件。
    * **Dev**: Backend Team
* **LOGGING-TASK-156**: **[Backend Test]** 测试 Worker 优雅关闭逻辑。
    * **Desc**: 模拟关闭信号，验证剩余队列是否被处理，连接是否断开。
    * **Dev**: Backend Team

## 4. 主线程日志收集与发送

* **LOGGING-TASK-201**: **[Backend Dev]** 在主线程启动并管理日志 Worker。
    * **Desc**: 在 `src/index.ts` 或 `src/server.ts` 中创建 Worker 实例，传递数据库连接信息，设置错误和退出监听器。
    * **Dev**: Backend Team
    * **Test**: LOGGING-TASK-251 (集成)
* **LOGGING-TASK-202**: **[Backend Dev]** 实现 Fastify `onResponse` 钩子 (`src/middleware/logging.ts`)。
    * **Desc**: 注册钩子，在其中收集非流式响应的日志数据。
    * **Dev**: Backend Team
    * **Test**: LOGGING-TASK-252 (集成)
* **LOGGING-TASK-203**: **[Backend Dev]** 实现日志数据格式化与脱敏逻辑。
    * **Desc**: 创建函数格式化日志对象，移除 `Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key` 等敏感头部。考虑 Body 截断或脱敏（初步只做头部脱敏）。
    * **Dev**: Backend Team
    * **Test**: LOGGING-TASK-253 (单元)
* **LOGGING-TASK-204**: **[Backend Dev]** 在 `onResponse` 钩子中调用 `worker.postMessage()` 发送日志数据。
    * **Desc**: 将格式化和脱敏后的日志对象发送给 Worker。
    * **Dev**: Backend Team
    * **Test**: LOGGING-TASK-252 (集成)
* **LOGGING-TASK-205**: **[Backend Dev]** 在配额检查失败时 (`preHandler`) 发送 `quota_exceeded` 日志。
    * **Desc**: 构造简化的拒绝日志对象并调用 `worker.postMessage()`。
    * **Depends**: QUOTA-TASK-103
    * **Dev**: Backend Team
    * **Test**: AUTH-TASK-155 (集成)
* **LOGGING-TASK-206**: **[Backend Dev]** (难点) 处理流式响应的日志记录。
    * **Desc**: 在 `onSend` 钩子中检测 `ReadableStream`，使用 `tee()` 复制流。启动一个异步任务读取复制流的完整内容。在 `onResponse` 钩子中将其他日志信息与读取到的完整响应体关联（可能通过请求 ID），然后发送给 Worker。需要仔细处理流读取错误和超时。
    * **Dev**: Backend Team
    * **Test**: LOGGING-TASK-254 (集成)
* **LOGGING-TASK-251**: **[Backend Test]** 集成测试 Worker 的启动、通信和关闭。
    * **Desc**: 验证主线程能否成功启动 Worker，发送消息，以及在主线程退出时 Worker 能否优雅关闭。
    * **Dev**: Backend Team
* **LOGGING-TASK-252**: **[Backend Test]** 集成测试 `onResponse` 钩子的日志收集和发送 (非流式)。
    * **Desc**: 模拟 API 请求和响应，验证 `onResponse` 钩子是否触发，日志数据是否正确收集并发送给 Worker (可 Mock `postMessage`)。
    * **Dev**: Backend Team
* **LOGGING-TASK-253**: **[Backend Test]** 单元测试日志数据格式化和脱敏逻辑。
    * **Desc**: 验证敏感头部是否移除，数据结构是否符合预期。
    * **Dev**: Backend Team
* **LOGGING-TASK-254**: **[Backend Test]** 集成测试流式响应的日志记录。
    * **Desc**: 模拟返回流式响应的 API 请求，验证完整的响应体是否能被捕获并与其他日志信息一起正确发送给 Worker。
    * **Dev**: Backend Team

## 5. 日志查询 API (可选，取决于 UI 需求)

* **LOGGING-TASK-301**: **[Backend Dev]** 实现 `GET /api/history` 端点。
    * **Desc**: 验证用户身份 (Session/JWT)，根据 `user_id` 查询 `request_logs` 表，支持按时间 `request_timestamp` 倒序分页，可选按时间范围过滤。**注意**: 返回数据时不应包含完整的请求/响应体，只包含摘要或必要字段。
    * **Dev**: Backend Team
    * **Test**: LOGGING-TASK-351
* **LOGGING-TASK-351**: **[Backend Test]** 集成测试 `GET /api/history` 端点。
    * **Desc**: 模拟用户请求，验证是否能正确返回日志列表、分页是否工作、权限是否控制、是否包含敏感信息。
    * **Dev**: Backend Team

## 6. 依赖关系

* Worker 实现 (LOGGING-TASK-1xx) 依赖数据库模型 (AUTH-TASK-002)。
* 主线程日志收集 (LOGGING-TASK-2xx) 依赖 Worker 初始化 (LOGGING-TASK-201) 和认证钩子 (AUTH-TASK-104)。
* 配额超限日志 (LOGGING-TASK-205) 依赖配额检查逻辑 (QUOTA-TASK-103)。
* 日志查询 API (LOGGING-TASK-3xx) 依赖日志写入流程能正确记录数据。
