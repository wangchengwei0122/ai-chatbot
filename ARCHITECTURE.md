# 整体架构文档

## 架构概述

本系统采用前后端分离架构，前端 SDK 通过 Proxy Server 与 MCP 服务器和 LLM API 通信。

```
┌─────────────┐
│  前端 SDK   │
│ (Browser)   │
└──────┬──────┘
       │ HTTP POST (REST API)
       │ { provider, model, messages, mcp }
       ↓
┌─────────────────┐
│  Proxy Server   │
│ (Node + Fastify)│
└──────┬──────────┘
       │
       ├─→ 根据 provider 从 LLM_CONFIG 查找 apiKey
       │
       ├─→ 根据 mcp 动态路由到对应 MCP Client
       │
       ├─→ LLM API (使用 Node 端管理的 apiKey)
       │   ├─ OpenAI
       │   ├─ DeepSeek
       │   ├─ Gemini
       │   ├─ Qwen
       │   └─ Ollama
       │
       └─→ MCP Server (企查查)
           ├─ basic
           ├─ risk
           └─ ... (无限扩展)
```

## 多 MCP 流程架构图

```
前端 → Proxy（带 mcpID）→ MCP Instance → LLM → 回复前端

详细流程：
┌─────────────┐
│  前端 SDK   │
└──────┬──────┘
       │ POST /mcp/send-message
       │ { mcp: "basic", provider: "openai", model: "gpt-4", messages: [...] }
       ↓
┌─────────────────┐
│  Proxy Server   │
│                 │
│  1. 根据 mcp 路由到 basic MCP Client
│  2. 根据 provider 从 LLM_CONFIG 查找 apiKey
│  3. 调用 LLM API
│  4. LLM 返回 function_call
│  5. 调用 MCP Server 执行工具
│  6. 递归调用 LLM（如果需要）
│  7. 通过 SSE 流式返回最终答案
└──────┬──────────┘
       │ SSE Stream
       ↓
┌─────────────┐
│  前端 SDK   │
│ (实时显示)  │
└─────────────┘
```

## 序列图

### 完整对话流程（含工具调用）

```
用户         前端 SDK        Proxy Server      MCP Server      LLM API
 │              │                 │                 │             │
 │──输入消息──→│                 │                 │             │
 │              │──POST /send──→│                 │             │
 │              │  -message      │                 │             │
 │              │  -mcp           │                 │             │
 │              │                 │──根据 mcp 路由→│             │
 │              │                 │                 │             │
 │              │                 │──根据 provider │             │
 │              │                 │   查找 apiKey   │             │
 │              │                 │                 │             │
 │              │                 │──────────调用 LLM API──────→│
 │              │                 │                 │             │
 │              │                 │←────function_call───────────│
 │              │                 │                 │             │
 │              │                 │──调用工具────→│             │
 │              │                 │  -name         │             │
 │              │                 │  -args         │             │
 │              │                 │                 │             │
 │              │                 │←──工具结果─────│             │
 │              │                 │                 │             │
 │              │                 │──────────再次调用 LLM──────→│
 │              │                 │                 │             │
 │              │←──SSE Stream────│                 │             │
 │              │  (token by token)│                 │             │
 │              │                 │                 │             │
 │←──显示答案───│                 │                 │             │
```

## 数据流说明

### 1. 前端发送消息

```typescript
// 前端只传递非敏感信息
{
  proxyUrl: "https://api.example.com",
  mcp: "basic",           // MCP 服务器 ID
  provider: "openai",     // LLM 提供商
  model: "gpt-4.1-mini",  // 模型名称
  messages: [
    { role: "user", content: "查询企业信息" }
  ]
}
```

### 2. Proxy Server 处理

1. **动态选择 MCP**：根据 `mcp` 参数路由到对应的 MCP Client
2. **查找 API Key**：根据 `provider` 从 `LLM_CONFIG` 查找对应的 `apiKey`
3. **调用 LLM**：使用 Node 端管理的 `apiKey` 调用 LLM API
4. **处理工具调用**：如果 LLM 返回 `function_call`，调用 MCP 工具
5. **递归处理**：继续调用 LLM，直到没有更多工具调用
6. **流式返回**：通过 SSE 将最终答案流式返回给前端

### 3. 前端接收流式响应

```typescript
// SSE 事件类型
{
  type: "token",      // LLM 返回的文本 token
  data: "Hello"
}

{
  type: "tool_call",  // 工具调用事件
  data: {
    name: "query_company",
    arguments: {...}
  }
}

{
  type: "finish",     // 完成事件
  data: {
    reason: "stop"
  }
}
```

## 多 MCP 动态路由说明

### MCP 服务器配置（环境变量）

```bash
MCP_SERVERS_JSON='[
  {"id":"basic","url":"https://mcp.qcc.com/basic/stream?key=xxxx"},
  {"id":"risk","url":"https://mcp.qcc.com/risk/stream?key=xxxx"},
  {"id":"finance","url":"https://finance.com/api/mcp?key=xxx"}
]'
MCP_DEFAULT="basic"
```

### Proxy Server 自动加载

```typescript
// Proxy Server 启动时自动解析
Map<mcpId, MCPClient> = {
  "basic": MCPClient("https://mcp.qcc.com/basic/stream?key=xxxx"),
  "risk": MCPClient("https://mcp.qcc.com/risk/stream?key=xxxx"),
  "finance": MCPClient("https://finance.com/api/mcp?key=xxx")
}
```

### 请求路由

```typescript
// 前端请求
POST /mcp/send-message
{
  "mcp": "risk",  // 动态选择 MCP
  "provider": "openai",
  "model": "gpt-4",
  "messages": [...]
}

// Proxy Server 路由
const mcpClient = mcpManager.getClient("risk");
// 使用 risk MCP Client 处理请求
```

### 工具缓存隔离

```typescript
// 每个 MCP 独立缓存
cache = {
  basic: {
    tools: [...],
    schema: {...}
  },
  risk: {
    tools: [...],
    schema: {...}
  },
  finance: {
    tools: [...],
    schema: {...}
  }
}
```

## 安全架构

### 前端与 Node 的分工

```
┌─────────────┐                    ┌─────────────┐
│  前端 SDK   │                    │ Proxy Server│
│             │                    │             │
│ ✅ provider │                    │ ✅ apiKey   │
│ ✅ model    │                    │ ✅ baseUrl  │
│ ✅ mcp      │                    │ ✅ mcpUrl   │
│ ✅ messages │                    │ ✅ LLM_CONFIG│
│             │                    │ ✅ MCP_SERVERS│
│ ❌ apiKey   │                    │             │
│ ❌ baseUrl  │                    │             │
│ ❌ mcpUrl   │                    │             │
└─────────────┘                    └─────────────┘
```

### API Key 管理流程

```
1. 前端传递: { provider: "openai", model: "gpt-4" }
   ↓
2. Proxy Server 查找: LLM_CONFIG["openai"].apiKey
   ↓
3. Proxy Server 调用: LLM API (使用 Node 端管理的 apiKey)
   ↓
4. 前端接收: 流式响应（不包含任何 API Key）
```

## 扩展机制

### 添加新的 MCP 服务器

**无需修改代码**，只需修改环境变量：

```bash
# 1. 在 .env 中添加
MCP_SERVERS_JSON='[
  {"id":"basic","url":"..."},
  {"id":"risk","url":"..."},
  {"id":"new_ai","url":"https://new.ai/mcp?token=123"}
]'

# 2. 前端使用
sendMessage("测试", { mcp: "new_ai" });
```

### 添加新的 LLM Provider

1. 在 `packages/server/src/llm/client.ts` 中添加 provider 支持
2. 在 `LLM_CONFIG` 中添加配置：
```bash
LLM_CONFIG='{
  "openai": {"apiKey": "..."},
  "new_provider": {"apiKey": "...", "baseUrl": "..."}
}'
```

## 部署架构

### 本地开发

```
前端 (localhost:5173) → Proxy Server (localhost:3000) → MCP Server
```

### Docker 部署

```
┌─────────────┐
│  前端应用   │
│  (Nginx)    │
└──────┬──────┘
       │
       ↓
┌─────────────┐
│ Proxy Server│
│  (Docker)   │
└──────┬──────┘
       │
       ├─→ MCP Server
       └─→ LLM API
```

### 云服务部署（多实例）

```
┌─────────────┐
│  Load       │
│  Balancer   │
└──────┬──────┘
       │
       ├─→ Proxy Server Instance 1
       ├─→ Proxy Server Instance 2
       └─→ Proxy Server Instance N
              │
              ├─→ MCP Server
              └─→ LLM API
```

每个实例独立运行，MCP 连接和工具缓存不共享。

## 技术栈

### 前端 SDK
- TypeScript
- React (可选)
- Web Components
- EventEmitter (轻量级事件系统)

### Proxy Server
- Node.js
- Fastify
- @modelcontextprotocol/sdk
- dotenv

### 通信协议
- REST API (HTTP POST)
- SSE (Server-Sent Events) 流式响应

## 性能优化

1. **工具缓存**：每个 MCP 的工具列表和 schema 按 ID 隔离缓存
2. **连接池**：每个 MCP 服务器独立连接管理
3. **自动重连**：MCP 连接断开时自动重连（指数退避）
4. **消息截断**：自动截断旧消息，避免无限增长

## 错误处理

### 前端错误
- 网络错误：Proxy Server 连接失败
- 配置错误：缺少必需参数
- 流解析错误：SSE 解析失败

### Proxy Server 错误
- MCP 连接错误：自动重连
- LLM API 错误：返回错误信息给前端
- 工具调用错误：记录错误，继续处理

## 监控和日志

### 前端日志
- 启用 `debug: true` 查看详细日志
- 日志包括：请求、响应、工具调用、错误

### Proxy Server 日志
- 日志级别由 `LOG_LEVEL` 环境变量控制
- 日志包括：MCP 连接、LLM 调用、工具调用、错误

