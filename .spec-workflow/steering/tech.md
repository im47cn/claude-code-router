# 技术栈文档 (.spec-workflow/steering/tech.md)

## 概述

本文档定义了 `claude-code-router` 项目及其新增功能（用户管理、API 密钥、会话历史、请求记录）所使用的核心技术栈。

## 后端

* **运行时**: Node.js (>= v20.0.0, 基于 `package.json` 和 `Dockerfile` 推断)
* **Web 框架**: Fastify (通过 `@musistudio/llms` 引入)
* **核心 LLM 路由/转换库**: `@musistudio/llms`
* **数据库**: MySQL (版本 >= 5.7 或 >= 8.0 推荐)
* **数据库交互**: Prisma (推荐，提供类型安全和迁移管理) 或 Sequelize / Knex.js
* **异步处理 (日志)**: Node.js `worker_threads` (内置)
* **API Key 哈希**: `bcrypt` (推荐) 或 `argon2`
* **UI 认证会话/状态管理**: `@fastify/session` (用于 Session) 或 `jsonwebtoken` (用于 JWT)
* **配置解析**: `json5`
* **Token 计算**: `tiktoken`
* **命令行参数解析**: `minimist`
* **日志**: `pino` (通过 `@musistudio/llms` 或 Fastify 默认集成) 和 `rotating-file-stream`
* **构建工具**: `esbuild`
* **语言**: TypeScript

## 前端 UI (位于 `/ui` 目录)

* **框架**: React.js (v19)
* **构建工具**: Vite
* **UI 库**: shadcn-ui (基于 Radix UI 和 Tailwind CSS)
* **样式**: Tailwind CSS
* **语言**: TypeScript
* **状态管理**: React Context (通过 `ConfigProvider`)
* **路由**: React Router (Memory Router)
* **国际化**: i18next
* **编辑器**: Monaco Editor (`@monaco-editor/react`)
* **打包**: `vite-plugin-singlefile` (用于生成单 HTML 文件)
* **包管理器**: pnpm

## 部署与运维

* **容器化**: Docker (Dockerfile 和 docker-compose.yml 已提供)
* **进程管理**: Node.js 内建 (`child_process`)

## 决策依据

* **MySQL**: 根据用户要求选定，提供了成熟的关系型数据存储能力。
* **Worker Threads**: 根据用户要求选定，用于异步处理日志写入，避免阻塞主线程，且无需引入外部依赖。
* **Prisma (推荐)**: 提供了优秀的类型安全、自动迁移和简洁的 API，能显著提高开发效率和代码质量。
* **bcrypt (推荐)**: 业界标准的密码哈希库，安全性高。
* **Fastify Session/JWT**: 根据具体需求选择，Session 易于使用，JWT 更适用于无状态场景或跨服务认证。
* **内存缓存**: 简单高效，适用于单实例部署下的配额规则和 API Key 缓存。

## 未来可能引入的技术

* **Redis**: 如果需要更强的配额实时性、分布式锁或分布式缓存。
* **消息队列 (RabbitMQ, Kafka, Redis Streams)**: 如果 Worker Thread 成为瓶颈或需要更可靠的日志处理。
* **专门的日志收集/分析系统 (ELK Stack, Grafana Loki)**: 如果需要对大量日志进行高级查询和可视化。
