# 系统字段日志截断功能

## 概述

此功能允许在日志记录时截断过大的 `system` 字段和 `messages` 字段，避免日志文件变得过大，同时保持API请求的完整性。

## 配置选项

在 `config.json` 文件中添加以下配置选项：

### 系统字段截断配置

```json
{
  "LOG_TRUNCATE_SYSTEM": true,          // 启用系统字段截断（默认：true）
  "LOG_SYSTEM_MAX_LENGTH": 1000,         // 系统字段最大字符数（默认：1000）
  
  "LOG_TRUNCATE_MESSAGES": true,         // 启用消息字段截断（默认：true）
  "LOG_MAX_MESSAGES": 5,                 // 最大消息数量（默认：5）
  "LOG_MAX_MESSAGE_LENGTH": 200          // 单个消息最大字符数（默认：200）
}
```

### 配置说明

- **LOG_TRUNCATE_SYSTEM**: 控制是否截断系统字段，设为 `false` 可完全禁用截断
- **LOG_SYSTEM_MAX_LENGTH**: 系统字段内容保留的最大字符数
- **LOG_TRUNCATE_MESSAGES**: 控制是否截断消息数组，设为 `false` 可完全禁用截断
- **LOG_MAX_MESSAGES**: 日志中记录的最大消息数量
- **LOG_MAX_MESSAGE_LENGTH**: 单个消息内容保留的最大字符数

## 工作原理

1. **安全性**: 截断操作仅在日志记录层面进行，不影响实际的API请求
2. **透明性**: 原始请求保持不变，只有日志中的内容被截断
3. **可配置性**: 所有配置都可以通过环境配置文件控制
4. **智能截断**: 保留截断信息，显示原始内容长度

## 示例

### 截断前的日志
```json
{
  "level": 30,
  "time": 1765245700554,
  "reqId": "req-1",
  "req": {
    "method": "POST",
    "url": "/v1/messages",
    "body": {
      "model": "anthropic/claude-3.5-sonnet",
      "system": [
        {
          "type": "text",
          "text": "这里是完整的系统提示，可能包含数千行内容..."
        }
      ]
    }
  }
}
```

### 截断后的日志
```json
{
  "level": 30,
  "time": 1765245700554,
  "reqId": "req-1",
  "req": {
    "method": "POST",
    "url": "/v1/messages",
    "body": {
      "model": "anthropic/claude-3.5-sonnet",
      "system": [
        {
          "type": "text",
          "text": "这里是前1000个字符的完整系统提示...\n\n... [SYSTEM_CONTENT_TRUNCATED_FOR_LOGGING: original length 15000 characters, 14000 characters omitted] ..."
        }
      ]
    }
  }
}
```

## 使用场景

1. **调试分析**: 快速查看请求结构而不被大量文本淹没
2. **存储优化**: 减少日志文件大小，节省磁盘空间
3. **性能提升**: 加快日志读取和分析速度
4. **隐私保护**: 在日志中避免记录敏感的完整内容

## 注意事项

- 此功能只影响日志记录，不会影响发送给LLM的实际请求
- 截断信息包含原始长度统计，便于了解实际数据规模
- 可以通过配置随时启用或禁用截断功能
- 建议在生产环境中启用此功能以控制日志大小