# MCP Proxy Server

MCP Proxy Server 是一个 Node.js + Fastify 服务器，用于代理前端与 MCP 服务器之间的通信。由于浏览器无法直接连接 MCP（Streamable HTTP），因此需要通过此 Proxy Server 进行中转。

## 架构设计

```
前端 SDK → Proxy Server (REST API) → MCP Server (企查查)
                              ↓
                         LLM API (OpenAI/DeepSeek/etc)
```

### 核心特性

- ✅ **完全动态配置**：支持无限扩展多个 MCP 服务器，无需修改代码
- ✅ **API Key 安全**：所有 API Key 仅存放在 Node 端，前端永远不允许传递
- ✅ **SSE 流式响应**：支持 Server-Sent Events 流式返回给前端
- ✅ **递归工具调用**：自动处理多轮工具调用链
- ✅ **工具缓存隔离**：每个 MCP 服务器的工具缓存按 ID 隔离
- ✅ **自动重连机制**：MCP 连接断开时自动重连（指数退避）

## 安全设计

### 前端与 Node 的分工

- **前端可以传递**（非敏感信息）：
  - `provider`: LLM 提供商（如 "openai"、"deepseek"）
  - `model`: 模型名称（如 "gpt-4.1-mini"）
  - `mcp`: MCP 服务器 ID（如 "basic"、"risk"）

- **前端永远不允许传递**（敏感信息）：
  - ❌ `apiKey`: 所有 API Key 由 Node 端管理
  - ❌ `baseUrl`: 前端不需要知道
  - ❌ `mcpUrl`: 前端不需要知道 MCP URL

- **Node 端管理**：
  - 所有 LLM API Key（通过 `LLM_CONFIG` 环境变量）
  - 所有 MCP URL 和 Key（通过 `MCP_SERVERS_JSON` 环境变量）

## 环境变量配置

创建 `.env` 文件（参考 `.env.example`）：

```bash
# 服务器配置
PORT=3000

# CORS 配置（允许的源，多个用逗号分隔）
CORS_ORIGIN=http://localhost:5173,http://localhost:3000

# 日志级别
LOG_LEVEL=info

# MCP 服务器配置（JSON 格式）
# 支持多个 MCP 服务器，完全动态配置
MCP_SERVERS_JSON='[{"id":"basic","url":"https://mcp.qcc.com/basic/stream?key=xxxx"},{"id":"risk","url":"https://mcp.qcc.com/risk/stream?key=xxxx"}]'

# 默认 MCP 服务器 ID（如果请求中未指定 mcp 参数时使用）
MCP_DEFAULT="basic"

# LLM 配置（JSON 格式）
# 所有 API Key 存放在这里，前端永远不允许传递
LLM_CONFIG='{"openai":{"apiKey":"sk-xxx"},"deepseek":{"apiKey":"sk-xxx"},"gemini":{"apiKey":"xxx"},"qwen":{"apiKey":"sk-xxx"},"ollama":{"apiKey":""}}'
```

### 环境变量说明

- **MCP_SERVERS_JSON**: MCP 服务器列表，JSON 数组格式
  - `id`: MCP 服务器标识符（如 "basic"、"risk"）
  - `url`: MCP 服务器 URL（包含 API Key，如 `https://mcp.qcc.com/basic/stream?key=xxxx`）

- **MCP_DEFAULT**: 默认 MCP 服务器 ID，如果请求中未指定 `mcp` 参数时使用

- **LLM_CONFIG**: LLM 提供商配置，JSON 对象格式
  - 每个 provider 包含 `apiKey` 和可选的 `baseUrl`

## API 接口文档

### 1. 获取工具列表

**POST** `/mcp/list-tools`

**请求体**:
```json
{
  "mcp": "basic"  // 可选，未指定时使用默认 MCP
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "tools": [
      {
        "name": "tool_name",
        "description": "工具描述",
        "inputSchema": {
          "type": "object",
          "properties": {...},
          "required": [...]
        }
      }
    ],
    "mcp": "basic"
  }
}
```

### 2. 调用单个工具

**POST** `/mcp/call-tool`

**请求体**:
```json
{
  "mcp": "basic",  // 可选
  "name": "tool_name",
  "args": {
    "param1": "value1"
  }
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "tool_call_id": "...",
    "name": "tool_name",
    "content": {...},
    "isError": false
  }
}
```

### 3. 发送消息（完整对话接口，支持 SSE 流式返回）

**POST** `/mcp/send-message`

**请求体**:
```json
{
  "mcp": "basic",  // 可选
  "provider": "openai",
  "model": "gpt-4.1-mini",
  "messages": [
    {
      "role": "user",
      "content": "查询企业信息"
    }
  ]
}
```

**响应**（SSE 流式）:
```
data: {"type":"token","data":"Hello"}
data: {"type":"token","data":" World"}
data: {"type":"tool_call","data":{"name":"query_company","arguments":{...}}}
data: {"type":"finish","data":{"reason":"stop"}}
```

**SSE 事件类型**:
- `token`: LLM 返回的文本 token
- `tool_call`: 工具调用事件
- `finish`: 完成事件
- `error`: 错误事件

### 4. 获取可用的 MCP 服务器列表

**GET** `/mcp/servers`

**响应**:
```json
{
  "success": true,
  "data": {
    "servers": ["basic", "risk"],
    "default": "basic"
  }
}
```

## 多 MCP 服务器扩展机制

### 通用动态配置（无硬编码）

Proxy Server **完全不内置任何 MCP 名称/类型映射表**，所有配置通过环境变量动态加载。

### 添加新的 MCP 服务器

只需修改 `.env` 文件，无需修改任何代码：

```bash
# 1. 在 MCP_SERVERS_JSON 中添加新项
MCP_SERVERS_JSON='[
  {"id":"basic","url":"https://mcp.qcc.com/basic/stream?key=xxxx"},
  {"id":"risk","url":"https://mcp.qcc.com/risk/stream?key=xxxx"},
  {"id":"new_ai","url":"https://new.ai/mcp?token=123"}
]'
```

前端使用：
```javascript
// 前端只需要传 mcp ID
sendMessage("测试", { mcp: "new_ai" });
```

### MCP 工具缓存隔离

每个 MCP 服务器的工具缓存按 `mcpId` 单独隔离：

```
cache = {
  basic: { tools: [...], schema: {...} },
  risk: { tools: [...], schema: {...} },
  new_ai: { tools: [...], schema: {...} }
}
```

避免不同 MCP 工具表混乱和工具冲突。

## 启动和部署

### 本地开发

1. 安装依赖：
```bash
cd packages/server
pnpm install
```

2. 配置环境变量：
```bash
cp .env.example .env
# 编辑 .env 文件，填入实际的配置
```

3. 启动开发服务器：
```bash
pnpm run dev
```

服务器将在 `http://localhost:3000` 启动。

### Docker 部署

创建 `Dockerfile`：

```dockerfile
FROM node:20-alpine

WORKDIR /app

# 复制 package 文件
COPY package*.json ./
COPY pnpm-lock.yaml ./

# 安装 pnpm
RUN npm install -g pnpm

# 安装依赖
RUN pnpm install --frozen-lockfile

# 复制源代码
COPY . .

# 构建
RUN pnpm run build:ts

# 暴露端口
EXPOSE 3000

# 启动
CMD ["pnpm", "start"]
```

创建 `docker-compose.yml`：

```yaml
version: '3.8'

services:
  mcp-proxy:
    build: .
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - CORS_ORIGIN=${CORS_ORIGIN}
      - MCP_SERVERS_JSON=${MCP_SERVERS_JSON}
      - MCP_DEFAULT=${MCP_DEFAULT}
      - LLM_CONFIG=${LLM_CONFIG}
    env_file:
      - .env
```

启动：
```bash
docker-compose up -d
```

### 云服务部署（多实例）

支持多实例部署，每个实例独立运行，通过负载均衡器分发请求。

**环境变量配置**：
- 在云服务平台（如 AWS、阿里云）配置环境变量
- 确保所有实例使用相同的 `MCP_SERVERS_JSON` 和 `LLM_CONFIG`

**注意事项**：
- 每个实例的 MCP 连接是独立的
- 工具缓存不会在实例间共享（每个实例独立缓存）

## 调试

### 查看日志

日志级别由 `LOG_LEVEL` 环境变量控制：
- `info`: 基本信息
- `debug`: 详细调试信息
- `error`: 仅错误信息

### 测试 API

使用 curl 测试：

```bash
# 获取工具列表
curl -X POST http://localhost:3000/mcp/list-tools \
  -H "Content-Type: application/json" \
  -d '{"mcp":"basic"}'

# 发送消息（流式）
curl -X POST http://localhost:3000/mcp/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "mcp": "basic",
    "provider": "openai",
    "model": "gpt-4.1-mini",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## 常见问题

### 1. MCP 连接失败

**错误**: `Failed to connect to MCP server`

**解决方案**:
- 检查 `MCP_SERVERS_JSON` 中的 URL 是否正确
- 检查 API Key 是否有效
- 检查网络连接

### 2. LLM API 调用失败

**错误**: `LLM API error: 401`

**解决方案**:
- 检查 `LLM_CONFIG` 中的 `apiKey` 是否正确
- 检查 provider 和 model 是否匹配

### 3. CORS 错误

**错误**: `CORS policy blocked`

**解决方案**:
- 检查 `CORS_ORIGIN` 环境变量是否包含前端域名
- 确保 Proxy Server 已注册 CORS 插件

## 架构图

```
┌─────────────┐
│  前端 SDK   │
└──────┬──────┘
       │ POST /mcp/send-message
       │ { provider, model, messages, mcp }
       ↓
┌─────────────────┐
│  Proxy Server   │
│  (Node + Fastify)│
└──────┬──────────┘
       │
       ├─→ 根据 provider 从 LLM_CONFIG 查找 apiKey
       │
       ├─→ 根据 mcp 动态路由到对应 MCP Client
       │
       ├─→ LLM API (使用 Node 端管理的 apiKey)
       │
       ├─→ MCP Server (企查查)
       │
       └─→ SSE 流式返回给前端
```

## 多 MCP 流程架构图

```
前端 → Proxy（带 mcpID）→ MCP Instance → LLM → 回复前端

详细流程：
1. 前端发送: { mcp: "basic", provider: "openai", model: "gpt-4", messages: [...] }
2. Proxy 根据 mcp 路由到 basic MCP Client
3. Proxy 根据 provider 从 LLM_CONFIG 查找 apiKey
4. Proxy 调用 LLM API
5. LLM 返回 function_call
6. Proxy 调用 MCP Server 执行工具
7. Proxy 递归调用 LLM（如果需要）
8. Proxy 通过 SSE 流式返回最终答案给前端
```
