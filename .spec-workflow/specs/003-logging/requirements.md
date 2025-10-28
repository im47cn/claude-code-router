# 异步日志系统需求文档

## 1. 概述

本文档定义了 `claude-code-router` 异步请求日志系统的功能需求。该系统旨在捕获通过 API 密钥认证的请求的详细信息，并将其持久化到 MySQL 数据库中，同时确保日志记录过程不影响 API 响应性能。

## 2. 功能需求

### 2.1 日志记录触发

* **FR-LOG-TRIG-001**: 系统 **必须** 为每一个通过有效 API 密钥认证并经过配额检查的 API 请求（特指 `/v1/messages` 等核心路由接口，不包括认证、管理类接口）记录日志。
* **FR-LOG-TRIG-002**: 即使请求因配额超限而被拒绝 (HTTP 429)，也 **必须** 记录一条相应的日志条目。
* **FR-LOG-TRIG-003**: 即使请求在处理过程中发生错误（例如，上游 LLM 访问失败，导致非 2xx 响应），也 **必须** 记录一条相应的日志条目。

### 2.2 记录内容

* **FR-LOG-DATA-001**: 每条日志记录 **必须** 包含以下核心信息：
    * 关联的用户 ID (`user_id`)
    * 使用的 API Key ID (`api_key_id`)
    * 请求到达时间戳 (`request_timestamp`)，精确到毫秒
    * 请求 URL (`request_url`)
    * 请求方法 (`request_method`)
    * 路由决策后的 Provider 名称 (`routed_provider`)
    * 路由决策后的 Model 名称 (`routed_model`)
    * 最终 HTTP 响应状态码 (`status_code`)
    * 请求处理状态 (`status`: 'success', 'error', 'quota_exceeded')
    * 响应完成时间戳 (`response_timestamp`)，精确到毫秒
    * 总响应时间 (`response_time_ms`)
* **FR-LOG-DATA-002**: 每条日志记录 **必须** 包含完整的请求头 (`request_headers`)，存储为 JSON 格式。**必须** 对敏感信息（如 `Authorization`, `Cookie`, `X-Api-Key` 等）进行脱敏处理。
* **FR-LOG-DATA-003**: 每条日志记录 **必须** 包含完整的请求体 (`request_body`)，存储为 TEXT 或 LONGTEXT 格式。
* **FR-LOG-DATA-004**: 每条日志记录 **必须** 包含完整的响应头 (`response_headers`)，存储为 JSON 格式。**必须** 对敏感信息（如 `Set-Cookie` 等）进行脱敏处理。
* **FR-LOG-DATA-005**: 每条日志记录 **必须** 包含完整的响应体 (`response_body`)，存储为 TEXT 或 LONGTEXT 格式。对于流式响应，需要记录拼接后的完整内容。
* **FR-LOG-DATA-006**: 如果请求处理过程中发生错误 (`status = 'error'`)，日志 **必须** 包含错误信息或堆栈跟踪 (`error_message`)。
* **FR-LOG-DATA-007**: 如果请求涉及 LLM 调用，日志 **应** 包含输入 Token 数 (`input_tokens`) 和输出 Token 数 (`output_tokens`)。
* **FR-LOG-DATA-008**: 如果请求因配额超限被拒绝 (`status = 'quota_exceeded'`)，日志 **必须** 包含相应的错误信息 (`error_message`)。

### 2.3 异步处理

* **FR-LOG-ASYNC-001**: 日志数据的写入过程 **必须** 与主 API 请求处理线程解耦。
* **FR-LOG-ASYNC-002**: API 响应的返回 **不得** 等待日志写入数据库完成。
* **FR-LOG-ASYNC-003**: 系统 **必须** 采用 `worker_threads` 来实现异步日志写入。

### 2.4 可靠性与错误处理

* **FR-LOG-RELY-001**: 日志系统 **应** 具备一定的容错能力。如果数据库暂时不可用，Worker Thread **不应** 崩溃，并 **应** 尝试重试写入。
* **FR-LOG-RELY-002**: 对于持续无法写入数据库的日志，系统 **应** 将其记录到备用存储（例如，本地文件系统中的 `failed_logs.jsonl`），以便后续排查或手动恢复。
* **FR-LOG-RELY-003**: 主线程 **应** 监控日志 Worker Thread 的状态，并在其意外退出时尝试重启或记录关键错误。
* **FR-LOG-RELY-004**: 系统 **应** 实现优雅关闭机制，在服务停止时，尝试将 Worker 内部队列中剩余的日志写入数据库或备用存储。

### 2.5 存储与查询

* **FR-LOG-STORE-001**: 所有日志记录 **必须** 持久化存储在 MySQL 数据库的 `request_logs` 表中。
* **FR-LOG-STORE-002**: `request_logs` 表 **应** 设计合适的索引（基于 `user_id`, `api_key_id`, `request_timestamp`, `status` 等常用查询字段）以优化查询性能。
* **FR-LOG-STORE-003**: `request_logs` 表 **应** 考虑按时间进行分区，以方便数据管理（查询、归档、删除）。
* **FR-LOG-QUERY-001**: 系统 **必须** 提供 API 接口，允许用户查询自己的请求历史记录（基于 `user_id`），支持按时间范围过滤和分页。
* **FR-LOG-QUERY-002**: (未来) 系统 **应** 支持更复杂的数据分析查询需求。

## 3. 非功能性需求

* **NFR-LOG-001**: 异步日志记录对主线程 API 请求处理的性能影响应极小。
* **NFR-LOG-002**: 日志记录应尽量完整，允许在进程异常退出时丢失少量（例如，最多一个批次）正在处理的日志。
* **NFR-LOG-003**: 日志写入 Worker Thread 的资源消耗（CPU, 内存）应在合理范围内。
* **NFR-LOG-004**: 存储完整的请求和响应体可能会消耗大量存储空间，需要有明确的数据保留策略和清理机制（例如，定期删除 N 天前的日志）。

## 4. 假设与约束

* **A-LOG-001**: API 请求和响应体的大小在 `LONGTEXT` (MySQL) 的存储限制内。
* **C-LOG-001**: 初始版本不要求实现复杂的日志查询或可视化界面，仅需支持用户按时间范围查询自己的历史记录。
* **C-LOG-002**: 日志脱敏规则需要根据实际部署环境和安全要求进行配置。
