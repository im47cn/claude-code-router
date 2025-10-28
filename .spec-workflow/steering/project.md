# 项目概述文档

## 1. 项目目标

`claude-code-router` (CCR) 是一个代理服务，旨在增强 Anthropic 的 Claude Code 命令行工具。其核心目标是：

* **解除地域限制**: 允许在中国大陆等无法直接访问 Anthropic 服务的地区使用 Claude Code 功能。
* **模型路由与成本优化**: 将 Claude Code 发出的 LLM 请求智能路由到用户配置的、可能更具成本效益或性能更优的第三方 LLM 服务（如 DeepSeek, Gemini, Ollama 等）。
* **兼容性适配**: 通过可插拔的 `Transformers` 机制，适配不同 LLM 提供商的 API 接口差异。
* **用户管理与访问控制**: 提供用户认证（飞书 OAuth）、多 API 密钥管理和基于请求次数的配额控制。
* **请求日志与分析**: 记录详细的 API 请求/响应日志到 MySQL 数据库，为未来的使用情况分析和审计提供数据基础。
* **易用性**: 提供 Web UI (`ccr ui`) 和命令行工具 (`ccr model`) 简化配置管理。
* **可扩展性**: 允许通过自定义 `Transformers` 和自定义路由脚本 扩展功能。

## 2. 核心组件

1.  **CCR 代理服务器**:
    * 基于 Fastify 的 Node.js 服务。
    * 监听来自 Claude Code (或其他客户端) 的请求。
    * 实现 `/v1/messages` 等核心 API 端点。
    * 包含认证、配额检查、路由、请求/响应转换等中间件/钩子。
    * 管理 Worker Thread 池（目前只有一个用于日志）。
    * 提供用于 UI 配置和管理的 `/api/*` 端点。
    * 提供 UI 认证的 `/auth/*` 端点。
2.  **配置系统**:
    * 核心服务配置存储在 `~/.claude-code-router/config.json`。
    * 支持环境变量插值。
3.  **LLM 路由模块 (`@musistudio/llms`)**:
    * 处理到不同 LLM 提供商的请求路由。
    * 包含内置的 `Transformers` 用于 API 格式适配。
    * 支持加载用户自定义 `Transformers`。
4.  **数据库 (MySQL)**:
    * 存储用户信息 (`users`, `user_identities`)。
    * 存储 API 密钥信息 (`api_keys`)。
    * 存储配额规则 (`user_quotas`, `api_key_quotas`)。
    * 存储详细请求日志 (`request_logs`)。
5.  **异步日志 Worker**:
    * 独立的 Node.js Worker Thread。
    * 负责从主线程接收日志数据并将其写入 MySQL。
6.  **Web UI**:
    * 基于 React, Vite, shadcn-ui, Tailwind CSS 的单页面应用。
    * 提供服务配置、Provider 管理、Router 配置、API Key 管理、用户配额管理（管理员）、历史记录查看等功能。
    * 通过 `/api/*` 与后端交互。
    * 支持飞书登录。
7.  **命令行接口 (CLI)**:
    * `ccr start|stop|restart|status`: 服务管理。
    * `ccr code`: 通过 CCR 运行 Claude Code。
    * `ccr model`: 交互式模型配置。
    * `ccr ui`: 启动服务（如果未运行）并打开 Web UI。
    * `ccr statusline`: (内部使用) 为 Claude Code 提供状态行数据。

## 3. 架构原则

* **模块化**: 功能应尽可能解耦，例如认证、配额、日志记录、路由应作为独立的模块或服务。
* **可配置性**: 核心行为（如路由规则、Provider 定义）应通过配置文件或数据库进行管理，而不是硬编码。
* **性能**: API 代理的核心路径应保持低延迟。耗时操作（如日志写入）必须异步处理。
* **安全性**: API 密钥必须安全存储（哈希），用户认证需遵循 OAuth2 最佳实践，敏感信息需脱敏。
* **可维护性**: 代码结构清晰，遵循一致的编码规范，并有适当的文档和测试。
* **可扩展性**: 架构应允许未来轻松添加新的认证方式、配额类型、LLM Provider 或日志存储方案。

## 4. 范围

* **当前范围**: 实现上述所有核心组件和功能需求，包括飞书认证、API Key 管理、基于请求次数的配额、异步 MySQL 日志记录。
* **未来可能**:
    * 支持更多认证提供商 (GitHub, Email/Password)。
    * 更复杂的配额类型 (Token 消耗, 并发请求数)。
    * 基于日志的数据分析仪表盘。
    * 更高级的路由策略（负载均衡、基于延迟的路由）。
    * UI 主题定制。
    * 插件系统 (超越 Transformers 的更广泛扩展)。
