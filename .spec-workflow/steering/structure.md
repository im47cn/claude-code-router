# 项目结构文档

## 1. 概述

本文档定义了 `claude-code-router` 项目的目录和文件结构，旨在确保代码库的组织性、可维护性和可扩展性，特别是在引入用户管理、API 密钥、配额和异步日志记录等新功能后。

## 2. 顶层目录结构

```

claude-code-router/
├── .github/             \# GitHub Actions workflows
├── .spec-workflow/               \# Kiro steering and specification documents
│   ├── steering/        \# High-level project guidance
│   │   ├── api-standards.md
│   │   ├── code-conventions.md
│   │   ├── product.md
│   │   ├── structure.md   \# (This file)
│   │   └── tech.md
│   └── specs/           \# Detailed feature specifications
│       ├── auth/          \# Authentication & API Keys
│       │   ├── requirements.md
│       │   └── design.md
│       ├── quota/         \# Quota System
│       │   ├── requirements.md
│       │   └── design.md
│       └── logging/       \# Async Logging
│           ├── requirements.md
│           └── design.md
├── dist/                \# Compiled JavaScript output (from TypeScript)
├── prisma/              \# Prisma schema and migration files (if Prisma is chosen)
│   ├── schema.prisma
│   └── migrations/
├── src/                 \# Backend source code (TypeScript)
│   ├── agents/          \# Agent logic (existing)
│   ├── api/             \# API route handlers (new)
│   ├── auth/            \# Authentication/Authorization logic (new)
│   ├── config/          \# Configuration loading and validation (refactored from utils)
│   ├── db/              \# Database interaction layer (Prisma client, repositories) (new)
│   ├── middleware/      \# Fastify middleware/hooks (auth, logging context)
│   ├── services/        \# Business logic services (quota checking, key generation) (new)
│   ├── utils/           \# Shared utility functions
│   └── workers/         \# Worker thread implementations (logger worker) (new)
│   ├── index.ts         \# Main server entry point
│   ├── server.ts        \# Fastify server setup
│   └── cli.ts           \# Command Line Interface entry point
├── test/                \# Unit and integration tests
├── ui/                  \# Frontend UI application (React + Vite)
│   ├── public/
│   ├── src/
│   ├── components.json
│   ├── index.html
│   ├── package.json
│   ├── pnpm-lock.yaml
│   ├── tsconfig.json
│   └── vite.config.ts
├── .dockerignore
├── .gitignore
├── .npmignore
├── CLAUDE.md            \# Guidance for Claude AI (backend)
├── Dockerfile
├── docker-compose.yml
├── LICENSE
├── package.json
├── pnpm-lock.yaml
├── README.md
├── README\_zh.md
└── tsconfig.json

```

## 3. `src` 目录详解

* **`agents/`**: (现有) 包含特定任务代理（如图像分析）的逻辑。
* **`api/`**: (新增) 包含 Fastify 路由处理函数，按资源组织 (e.g., `api/keys.ts`, `api/users.ts`, `api/admin.ts`)。这些处理函数调用 `services` 层来执行业务逻辑。
* **`auth/`**: (新增) 包含与认证和授权相关的逻辑。
  * `feishu.ts`: 飞书 OAuth 流程实现。
  * `apiKey.ts`: API 密钥生成、哈希、验证逻辑。
  * `session.ts` / `jwt.ts`: UI 登录状态管理。
* **`config/`**: (重构) 从 `utils` 移入，专门负责加载、解析、验证和插值 `config.json` 及环境变量。
* **`db/`**: (新增) 数据库交互层。
  * `client.ts`: Prisma Client 实例或数据库连接配置。
  * `repositories/`: (可选) 数据访问逻辑封装，例如 `userRepository.ts`, `apiKeyRepository.ts`。
* **`middleware/`**: (现有/扩展) Fastify 钩子 (hooks)。
  * `auth.ts`: 实现 API Key 验证和配额检查的 `preHandler` 钩子。
  * `logging.ts`: (新增) `onResponse` 钩子，用于收集日志数据并发送给 Worker。
* **`services/`**: (新增) 包含核心业务逻辑。
  * `quotaService.ts`: 封装配额检查的具体实现（可能调用 `db` 层）。
  * `apiKeyService.ts`: 封装 API Key 创建、管理逻辑。
  * `userService.ts`: 用户查找、创建逻辑。
* **`utils/`**: (现有/精简) 通用辅助函数，如 `router.ts`, `keySelector.ts`, `cache.ts`, `processCheck.ts`。 配置相关逻辑移至 `config/`。
* **`workers/`**: (新增) Worker Thread 实现。
  * `logger.worker.ts`: 异步日志写入 Worker。
* **`index.ts`**: 主程序入口，初始化配置、Worker 和服务器。
* **`server.ts`**: Fastify 实例的创建、插件注册、路由注册和钩子挂载。
* **`cli.ts`**: 命令行接口处理逻辑。

## 4. `ui` 目录结构

保持现有的结构，基于 Vite、React 和 shadcn-ui 的标准布局。可能需要新增：

* `src/pages/`: 存放页面级组件 (e.g., `LoginPage.tsx`, `ApiKeyManagementPage.tsx`, `HistoryPage.tsx`)。
* `src/hooks/`: 自定义 React Hooks (e.g., `useAuth.ts`)。
* `src/contexts/`: React Contexts (e.g., `AuthContext.tsx`)。

## 5. `.spec-workflow` 目录结构

* **`steering/`**: 存放项目级、高层次的指导性文档。
* **`specs/`**: 按功能模块组织详细的需求 (`requirements.md`) 和设计 (`design.md`) 文档。
