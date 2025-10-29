# Requirements Document

## Introduction

此功能旨在为 `claude-code-router` 添加一个新的"自定义转换器" (Custom Transformer)。该转换器将利用 `toon` 库，自动将出站请求（Request）报文中的大型 JSON 对象转换为 token 效率更高的 TOON 格式。主要目的是显著减少发送给下游 LLM 的 token 数量，从而降低 API 调用成本并更有效地利用模型的上下文窗口。

## Alignment with Product Vision

此功能通过增强 `claude-code-router` 的核心价值（即作为高级、可定制的请求路由和修改代理），直接支持其（假定的）产品目标。它为用户提供了强大的成本优化工具，并强化了 `claude-code-router` 作为 LLM 网关的专业能力。

## Requirements

### Requirement 1

**User Story:** 作为一个 `claude-code-router` 用户，我想要**将请求中的特定 JSON 文本转换为 TOON 格式**，以便**在将其发送到 LLM 之前减少 token 数量**。

#### Acceptance Criteria

1. WHEN 用户在 `config.json` 的 `transformers` 数组中注册一个新的自定义转换器脚本 THEN 系统 SHALL 加载该脚本。
2. WHEN 用户将此转换器（例如，名为 "toon-encoder"）添加到一个 `Provider` 的 `transformer.use` 列表中。
3. WHEN 一个请求通过该 `Provider`。
4. THEN 该转换器 SHALL 检查请求体 `req.body.messages` 数组中的内容。
5. IF 消息内容（`contentBlock.text`）是一个有效的 JSON 字符串（例如，通过 `string.trim().startsWith('{')` 和 `JSON.parse` 检查）。
6. THEN 系统 SHALL 使用 `@byjohann/toon` 的 `encode` 函数 将该 JSON 对象编码为 TOON 字符串。
7. THEN 系统 SHALL 将原始的 JSON 文本替换为 TOON 字符串，并按照 `toon` 建议的最佳实践，将其包裹在 `\x60\x60\x60toon\n...\n\x60\x60\x60` 代码块中。

### Requirement 2

**User Story:** 作为一个**高级用户**，我想要**在 `config.json` 中配置 TOON 编码选项**（例如分隔符），以便**针对我的特定数据结构进一步优化 token**。

#### Acceptance Criteria

1. WHEN 用户在 `config.json` 的 `transformers` 数组中注册该脚本时。
2. THEN 系统 SHALL 允许传递一个 `options` 对象（例如：`"options": { "delimiter": "\t" }`）。
3. IF 提供了 `options` 对象。
4. THEN 转换器在调用 `toon.encode` 函数时 SHALL 将这些选项传递进去。

## Non-Functional Requirements

### Code Architecture and Modularity

- **Single Responsibility Principle**: 该功能必须实现为 `claude-code-router` 的自定义转换器，使其与核心路由逻辑分离。
- **Modular Design**: 组件、工具和服务应该隔离且可重用
- **Dependency Management**: 该转换器将引入一个新的外部依赖：`@byjohann/toon`。这需要在使用此转换器的环境中（或全局）安装。
- **Clear Interfaces**: 定义组件和层之间的清晰契约

### Performance

- TOON 编码过程增加的延迟必须最小化。对于一个 50KB 的 JSON 负载，编码所增加的额外延迟不应超过 50 毫秒。

### Security

- <!-- No content for this section in the original document -->

### Reliability

- **优雅降级**: IF `JSON.parse` 失败（即文本不是有效的 JSON），OR `toon.encode` 失败。
- THEN 转换器 SHALL 捕获该异常，记录一个警告 (WARN) 日志。
- AND 转换器 SHALL **必须**返回*原始的*、未修改的请求体，允许请求继续（而不是失败）。

### Usability

- 该功能的配置应完全通过 `config.json` 完成，无需修改 `claude-code-router` 的核心代码。
- 需要在文档中清楚地说明如何（1）安装 `@byjohann/toon` 依赖，（2）创建转换器 .js 文件，以及（3）在 `config.json` 中注册它。
