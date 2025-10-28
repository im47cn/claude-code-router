# 异步日志系统设计文档

## 1. 概述

本文档详细描述了 `claude-code-router` 异步请求日志系统的技术设计。该系统采用 Node.js `worker_threads` 将日志写入 MySQL 数据库的操作与主 API 请求处理线程分离，以保证 API 响应的低延迟。设计旨在满足存储完整请求/响应报文的需求，并确保日志记录的可靠性。

## 2. 技术选型

* **异步机制**: Node.js `worker_threads` (内置模块)
* **数据库**: MySQL
* **数据库交互 (Worker)**: Prisma Client (或其他选定的 ORM/Query Builder)
* **数据传递**: `worker.postMessage()` 和 `parentPort.on('message', ...)`
* **数据格式**: JSON 对象

## 3. 架构设计

系统包含两个主要部分：

1. **主线程 (API Server)**: 负责收集日志数据并通过消息通道发送给 Worker Thread。
2. **日志 Worker Thread**: 负责接收日志数据、连接数据库并将数据写入 `request_logs` 表。

```mermaid
sequenceDiagram
    participant Client
    participant MainThread as API Server (Fastify)
    participant WorkerThread as Logger Worker
    participant MySQL

    Client->>+MainThread: 发起 API 请求 (/v1/messages)
    MainThread->>MainThread: API Key 认证 & 配额检查 (preHandler)
    Note over MainThread: 记录 req.user_id, req.api_key_id
    alt 配额超限
        MainThread-->>Client: 返回 429 Too Many Requests
        MainThread-)WorkerThread: 发送 'quota_exceeded' 日志消息
    else 配额通过
        MainThread->>MainThread: 处理请求 (路由, 调用 LLM)
        MainThread-->>Client: 返回 API 响应 (Stream/JSON)
        MainThread-)WorkerThread: 发送 'success'/'error' 日志消息 (onResponse 钩子)
    end

    WorkerThread->>+MySQL: (批量) 写入 request_logs 表
    MySQL-->>-WorkerThread: 写入确认
    opt 写入失败
        WorkerThread->>WorkerThread: 记录失败/重试/备用存储
    end

````

## 4. 主线程实现 (`src/index.ts`, `src/server.ts`)

1. **Worker 初始化**:

      * 在服务器启动时 (`src/index.ts` 或 `src/server.ts` 的启动逻辑中)，创建一个新的 Worker Thread 实例。
      * Worker 脚本路径指向 `src/workers/logger.worker.ts` (或编译后的 JS 文件)。
      * 向 Worker 传递必要的初始化数据，例如数据库连接字符串（通过 `workerData`）。 **注意**: 避免直接传递完整的配置对象，只传递必要信息。
      * 设置 Worker 的错误处理 (`worker.on('error', ...)`), 退出处理 (`worker.on('exit', ...)`), 和消息监听 (`worker.on('message', ...)` - 如果 Worker 需要向主线程发送状态)。

2. **日志数据收集 (`onResponse` 钩子)**:

      * 注册一个 Fastify `onResponse` 钩子。此钩子在响应发送完毕后触发。
      * 在钩子中，收集以下信息:
          * `userId`: 从 `request.user.id` 获取。
          * `apiKeyId`: 从 `request.api_key_id` 获取。
          * `requestTimestamp`: 请求开始时间（可在 `preHandler` 中记录）。
          * `responseTimestamp`: 响应结束时间 ( `new Date()`)。
          * `responseTimeMs`: `responseTimestamp - requestTimestamp`。
          * `requestUrl`: `request.raw.url`。
          * `requestMethod`: `request.raw.method`。
          * `requestHeaders`: `request.headers` (JSON 格式，**需要考虑脱敏**，例如移除 `Authorization`, `Cookie` 等敏感头部)。
          * `requestBody`: `request.body` (需要处理不同 Content-Type，确保获取到**完整的原始请求体**，可能需要自定义 `preHandler` 来存储原始 body)。
          * `routedProvider`: 从 `request` 对象获取 (由 router 模块附加)。
          * `routedModel`: 从 `request` 对象获取 (由 router 模块附加)。
          * `statusCode`: `reply.raw.statusCode`。
          * `status`: 根据 `statusCode` 判断为 `'success'` (2xx) 或 `'error'` (其他)。
          * `errorMessage`: 如果发生错误，从 `reply.error` 或其他地方获取。
          * `responseHeaders`: `reply.getHeaders()` (JSON 格式，**需要考虑脱敏**)。
          * `responseBody`: **完整的响应体**。对于流式响应，需要特殊处理（见下文）。对于非流式响应，从 `payload` 参数（如果 `onSend` 钩子也用于收集）或通过拦截获取。
          * `inputTokens`, `outputTokens`: 从请求处理过程中收集或从响应体中解析。
      * **处理流式响应**:
          * 在 `onSend` 钩子中，如果 `payload` 是 `ReadableStream`，使用 `tee()` 复制流。一个流返回给客户端，另一个流用于读取完整内容。
          * 异步读取复制流的完整内容，完成后将其添加到日志数据对象中。这部分逻辑需要在 `onResponse` 钩子之后完成，但日志消息应包含一个唯一 ID 以便关联。或者，在 `onSend` 中启动读取，在 `onResponse` 中等待读取完成（可能增加 `onResponse` 延迟，需权衡）。**初步选择**: 在 `onResponse` 触发时再启动读取复制流（如果存在），读取完成后再发送给 Worker。
      * **处理配额超限日志**: 在 `preHandler` 配额检查失败时，构造一个简化的日志对象（包含 `userId`, `apiKeyId`, `timestamp`, `status='quota_exceeded'`, `errorMessage`），直接发送给 Worker。

3. **发送日志到 Worker**:

      * 将收集到的完整日志数据对象通过 `worker.postMessage(logData)` 发送给 Worker Thread。
      * **错误处理**: 主线程的 `postMessage` 调用通常不会失败，但需要处理 Worker 意外退出的情况。

## 5. 日志 Worker Thread 实现 (`src/workers/logger.worker.ts`)

1. **初始化**:

      * 引入 `worker_threads` (`parentPort`, `workerData`)。
      * 引入 Prisma Client (或选择的 DB 库)。
      * 从 `workerData` 获取数据库连接信息。
      * **实例化 Prisma Client** (或其他 DB 连接池)。
      * 设置一个内部队列（例如 `Array`) 用于缓冲日志消息。
      * 设置批处理参数（例如 `BATCH_SIZE = 50`, `BATCH_INTERVAL = 1000`ms）。
      * 设置一个定时器 (`batchTimer`) 用于按间隔处理。

2. **消息监听**:

      * `parentPort.on('message', (logData) => { ... })`:
          * 将接收到的 `logData` 添加到内部队列 `logQueue.push(logData)`。
          * 如果队列大小达到 `BATCH_SIZE`，立即触发批处理 `processBatch()`。

3. **批处理函数 (`processBatch`)**:

      * `clearTimeout(batchTimer)` (清除可能存在的定时器)。
      * 如果队列为空，则返回。
      * 从队列中取出最多 `BATCH_SIZE` 条日志 `const batch = logQueue.splice(0, BATCH_SIZE)`。
      * **数据库交互**:
          * 使用 Prisma Client 的 `prisma.request_log.createMany({ data: batch })` (需要适配 Prisma 的数据格式) 批量插入日志。
          * **错误处理**:
              * 捕获 `createMany` 可能抛出的错误 (数据库连接问题、数据格式错误等)。
              * **重试**: 对于可恢复的错误（如连接超时），可以实现简单的延时重试逻辑 (最多 N 次)。
              * **失败记录**: 对于无法写入的批次或单条记录，将其写入本地文件 (`failed_logs.jsonl`) 或发送错误消息回主线程。**避免 Worker 因写入失败而崩溃**。
      * **重置定时器**: 如果队列中仍有日志，设置新的 `batchTimer = setTimeout(processBatch, BATCH_INTERVAL)`。

4. **定时处理**:

      * 在 Worker 初始化时启动第一个定时器 `batchTimer = setTimeout(processBatch, BATCH_INTERVAL)`。
      * `processBatch` 函数在处理完后会根据队列情况重置定时器。

5. **优雅关闭**:

      * 监听 `parentPort.once('close', async () => { ... })` 或主线程发送的特定关闭消息。
      * 在关闭前，调用 `processBatch()` 处理队列中剩余的所有日志。
      * 等待最后的批处理写入完成。
      * 断开数据库连接 `await prisma.$disconnect()`。
      * `process.exit(0)`。

## 6. 数据格式与脱敏

* **数据传递**: 主线程与 Worker 之间传递序列化的 JSON 对象。
* **数据库存储**:
  * `request_headers`, `response_headers`: 存储为 JSON 类型。在存入前，**必须**移除敏感头部，如 `Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key`, 以及任何自定义的敏感头部。
  * `request_body`, `response_body`: 存储为 `LONGTEXT`。需要考虑**截断**过大的报文以控制存储大小，或者在记录前进行脱敏处理（例如移除敏感字段）。**初步决定**: 存储完整报文，依赖数据库分区和定期清理策略管理大小。
* **错误处理**: `error_message` 存储为 TEXT，记录错误堆栈信息或关键错误消息。

## 7. 性能与可靠性

* **性能**: Worker Thread 隔离了数据库写入延迟。批处理写入减少了数据库连接和事务开销。主线程的开销主要在于数据收集和 `postMessage` 调用，应保持较低。
* **可靠性**:
  * Worker 内部队列处理写入失败和重试。
  * 失败日志可记录到文件，便于后续排查或重新导入。
  * 主线程需监控 Worker 状态，在 Worker 意外退出时尝试重启或记录严重错误。
  * 数据库分区有助于 `request_logs` 表的长期维护和查询性能。

## 8. 测试策略

* **单元测试**:
  * Worker Thread 的消息接收、队列管理、批处理逻辑。
  * 数据库写入的错误处理和重试逻辑。
  * 主线程日志数据收集和格式化逻辑。
  * 头部和 Body 的脱敏/截断逻辑。
* **集成测试**:
  * 主线程发送消息 -\> Worker 接收 -\> 数据库成功写入的完整流程。
  * 模拟数据库写入失败，验证 Worker 的重试和失败记录。
  * 测试流式响应的完整 Body 是否能被正确捕获和记录。
  * 测试高并发下系统是否稳定，日志是否丢失（允许少量因进程退出丢失）。
  * 验证优雅关闭时，Worker 是否能处理完剩余队列。
