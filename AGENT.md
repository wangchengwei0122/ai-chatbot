## Agent 概览

**名称**：ai-chatbot MCP Proxy Agent  
**角色**：统一的对话 + 工具编排代理。  
**核心能力**：
- **LLM 调用编排**：通过 `provider` / `model` 动态调用不同 LLM（OpenAI、DeepSeek、Gemini、Qwen、Ollama 等）。
- **MCP 工具网关**：通过 MCP 协议动态发现和调用多个 MCP Server 暴露的工具（如企查查 basic / risk / finance）。
- **自动多轮工具调用**：支持 LLM function_call，多轮递归调用工具，并以 SSE 流式返回最终回答。

调用方（前端、其他后端服务、外部 Agent / 工具）只需与本 Agent 暴露的 HTTP 接口交互，无需直接对接各 MCP Server 和 LLM。

---

## 系统架构要点

- **调用方（前端 / 其他服务 / 外部 Agent）**：
  - 只掌握：`proxyUrl`、`provider`、`model`、`mcp`、`messages` 等非敏感参数
  - 不掌握：任何 `apiKey`、LLM baseUrl、MCP URL
- **本 Agent（Proxy Server）**：
  - 技术栈：Node.js + Fastify（见 `packages/server`）
  - 使用 `McpClientManager` 管理多个 MCP 连接
  - 使用 `ToolEngine` 管理 LLM + 工具调用的递归流程（流式）
- **MCP Server**：
  - 使用 `@modelcontextprotocol/sdk` 的 `StreamableHTTPClientTransport` 连接
  - 通过环境变量 `MCP_SERVERS_JSON` 动态配置，无需改代码即可新增/删除

更完整的整体架构说明见 `ARCHITECTURE.md`。

---

## 前端 SDK 接入指引

本项目提供两层前端能力：

- **核心 SDK（TypeScript）**：`packages/frontend-sdk` 中的 `MCPClient`，适合 React / 任意 JS 应用直接调用。
- **Web Components 组件**：`packages/frontend-sdk-wc` 中的 `chat-widget`，适合“零侵入”集成到任意网页。

下面从“其他前端项目 / AI 工具”视角说明如何使用。

### 1. 使用核心 SDK：`MCPClient`

**类路径**：`packages/frontend-sdk/src/core/MCPClient.ts`  
**用途**：在浏览器或 Node 环境中，通过 Proxy Server 调用 MCP 工具和获取工具 schema。

#### 构造参数

```ts
new MCPClient({
  proxyUrl: string;        // 必填：指向本 Agent 的 HTTP 服务根地址，例如 https://api.xxx.com
  mcp?: string;            // 可选：默认 MCP ID，不传则由服务端默认值决定
  maxRetries?: number;     // 可选：网络重试次数，默认 5
  toolCallTimeout?: number;// 可选：单次工具调用超时时间（毫秒），默认 30000
  onDisconnect?: () => void;
  onReconnect?: () => void;
});
```

#### 典型用法

```ts
import { MCPClient } from '@ai-chatbot/frontend-sdk';

const client = new MCPClient({
  proxyUrl: 'https://api.example.com', // 指向本 Agent
  mcp: 'basic'
});

// 1）获取 MCP 工具列表（带缓存）
const tools = await client.listTools();          // 使用默认 mcp
// 或者
const toolsForRisk = await client.listTools('risk');

// 2）直接调用 MCP 工具（走 Proxy Server 的 /mcp/call-tool）
const result = await client.callTool('query_company_basic', {
  company_name: 'xxx科技有限公司'
});

// 3）将 MCP 工具转换为 OpenAI function schema（给上层 LLM 使用）
const functionSchemas = await client.getFunctionSchemas(); // 返回 FunctionDefinition[]
```

**缓存策略**：

- 工具列表缓存：按 `mcp` 维度隔离（key: `tools:${mcpId || 'default'}`）。
- schema 缓存：按工具名缓存转换后的 `FunctionDefinition`。
- 调用 `client.clearCache()` 可清理所有前端缓存。

### 2. 使用 Web Components 聊天组件：`<ai-chat-widget>`

**文件**：`packages/frontend-sdk-wc/src/components/chat-widget.ts`  
**样式**：`packages/frontend-sdk-wc/src/styles/chatbot.css`

该组件封装了：

- 与本 Agent 的 SSE 流通信；
- 利用 SDK 进行 MCP 工具调用；
- 聊天 UI（消息列表、工具调用提示、输入框等）。

#### 快速接入（HTML）

在页面中引入打包后的脚本，然后直接使用 Web Component（具体构建/发布方式参考前端包文档，这里仅示例属性约定）：

```html
<ai-chat-widget
  proxy-url="https://api.example.com"
  provider="openai"
  model="gpt-4.1-mini"
  mcp="basic"
></ai-chat-widget>
```

建议属性含义（以实际实现为准）：

- `proxy-url`：指向本 Agent 的 HTTP 地址，对应 SDK 中 `proxyUrl`。
- `provider` / `model`：默认使用的 LLM 配置。
- `mcp`：默认 MCP Server ID。

组件内部会：

- 使用 SDK 与 `/mcp/send-message` 建立 SSE 连接；
- 显示 `type: "token"` 的增量内容；
- 在有工具调用时，根据 `type: "tool_call"` 事件展示工具调用过程。

> 如果你在其他页面里想完全自定义 UI，可以直接使用 `packages/frontend-sdk` 提供的 `MCPClient`，自己处理 SSE 和渲染逻辑，而不是使用 `chat-widget`。

---

## 对外 HTTP 接口

### 1. 对话接口：`POST /mcp/send-message`

**用途**：发起一次对话，由本 Agent 自动判断是否调用 MCP 工具，返回 **SSE 流式响应**。  
**典型调用方**：浏览器前端、后端服务、编排其他 Agent 的“上层大模型”。

**请求体示例**：

```json
{
  "provider": "openai",
  "model": "gpt-4.1-mini",
  "mcp": "basic",
  "messages": [
    { "role": "user", "content": "查询某个企业的风险信息" }
  ]
}
```

**字段说明**：

- **provider**：LLM 提供商 ID，需在服务端 `LLM_CONFIG` 中配置。
- **model**：模型名称，需由对应 provider 支持。
- **mcp**：MCP Server ID，可选；不传则使用 `MCP_DEFAULT`。
- **messages**：OpenAI 风格消息数组：
  - `role` ∈ `["system", "user", "assistant", "tool"]`
  - `content`：字符串
  - `tool_calls` / `tool_call_id` 等内部字段由本 Agent 管理，上层通常无需自行填充。

**SSE 响应事件**（统一格式：`{ type, data }`）：

- **token**

  ```json
  {
    "type": "token",
    "data": "部分回答内容..."
  }
  ```

- **tool_call**

  ```json
  {
    "type": "tool_call",
    "data": {
      "name": "query_company_risk",
      "arguments": {
        "company_name": "xxx科技有限公司"
      }
    }
  }
  ```

- **finish**

  ```json
  {
    "type": "finish",
    "data": {
      "reason": "stop"     // 也可能是 "tool_calls" / "max_depth"
    }
  }
  ```

调用方只需按 SSE 标准解析，按顺序拼接所有 `type === "token"` 的 `data` 即可得到完整回答。

---

### 2. 工具发现：`POST /mcp/list-tools`

**用途**：列出指定 MCP Server 暴露的所有工具及其参数 schema。  
**典型场景**：
- 其他 Agent 想把 MCP 工具注册为自己的 function / tool schema。
- 前端 UI 需要展示可用工具列表。

**请求体示例**：

```json
{
  "mcp": "basic"
}
```

**返回示例**：

```json
{
  "success": true,
  "data": {
    "tools": [
      {
        "name": "query_company_basic",
        "description": "查询企业基础信息",
        "inputSchema": {
          "type": "object",
          "properties": {
            "company_name": {
              "type": "string",
              "description": "企业名称"
            }
          },
          "required": ["company_name"]
        }
      }
    ]
  }
}
```

本 Agent 会按 MCP ID 做工具列表缓存，避免频繁远程 `listTools`。

---

### 3. 直接工具调用：`POST /mcp/call-tool`

**用途**：在不走 LLM 推理的情况下，**直接调用 MCP 工具**。  
**典型场景**：
- 上层 Agent 已有自己的推理/决策逻辑，只需把 MCP 工具当成普通 API 使用。
- Debug / 手工测试 MCP 工具。

**请求体示例**：

```json
{
  "mcp": "basic",
  "name": "query_company_basic",
  "args": {
    "company_name": "xxx科技有限公司"
  }
}
```

**返回示例**：

```json
{
  "success": true,
  "data": {
    "tool_call_id": "optional-id",
    "name": "query_company_basic",
    "content": [
      {
        "type": "text",
        "text": "工具返回内容（原始 MCP content 数组）"
      }
    ],
    "isError": false
  }
}
```

---

## MCP 与多 Agent 能力

### MCP 动态路由

**环境变量配置示例**：

```bash
MCP_SERVERS_JSON='[
  {"id":"basic","url":"https://mcp.qcc.com/basic/stream?key=xxxx"},
  {"id":"risk","url":"https://mcp.qcc.com/risk/stream?key=xxxx"},
  {"id":"finance","url":"https://finance.com/api/mcp?key=xxx"}
]'
MCP_DEFAULT="basic"
```

启动时，`McpClientManager` 会：

- 解析 `MCP_SERVERS_JSON`，为每个 `{id, url}` 创建一个 `McpClientInstance`。
- 提供：
  - `listTools(mcpId?)`：按 ID 获取工具列表
  - `callTool(mcpId, name, args)`：调用指定 MCP 的指定工具

因此，调用方只需在请求体中设置 `mcp` 字段即可完成路由，无需管理真实 URL 或鉴权。

### LLM + 工具调用内部流程（给高级 Agent/开发者）

**核心类**：`ToolEngine`（见 `packages/server/src/engine/toolEngine.ts`）

1. `processMessageStream(provider, model, messages, mcpId?)`：
   - 拉取指定 MCP 的工具列表：`getMcpClientManager().listTools(mcpId)`。
   - 通过 `mapMcpToolsToFunctions` 转为 LLM function schema。
   - 创建 `LLMClient`，调用 `chatStream(messages, functionDefinitions)` 获取 SSE 流。
2. 解析 SSE：
   - 按行解析 `data: ...`，累积 `delta.content` 为自然语言回答，并流式向调用方输出 `type: "token"`。
   - 当出现 `delta.tool_calls` 时，累计每个 tool_call 的 `id` / `name` / `arguments`。
   - 记录 `finish_reason`，当其为 `"tool_calls"` 时，表示需要真正调用工具。
3. 工具执行与递归：
   - 将当前模型输出整理为一条 `role: "assistant"` + `tool_calls` 的消息。
   - 对每个工具：
     - 派发 SSE：`type: "tool_call"`，方便调用方日志/可视化。
     - 调用 `McpClientManager.callTool(mcpId, toolName, args)`。
     - 生成对应的 `role: "tool"` 消息，追加到对话历史。
   - 完成所有工具调用后，带上新产生的 `assistant` + `tool` 消息，递归调用 `processWithToolsStream(..., depth + 1)`。
   - 深度超过 `maxDepth` 时返回 `type: "finish"`，`reason: "max_depth"`。

上层 Agent 如果不想自己写完整的工具循环逻辑，可以直接把本服务当成「带自动工具调用能力的 LLM Agent」来用。

---

## 环境变量与安全

**主要环境变量**（参见 `ARCHITECTURE.md` 与服务部署文档）：

- **LLM_CONFIG**：按 provider 存储 `apiKey` / `baseUrl` 等敏感信息的 JSON 字符串。
- **MCP_SERVERS_JSON**：所有 MCP Server 的 `{ id, url }` 列表。
- **MCP_DEFAULT**：默认 MCP ID。
- **CORS_ORIGIN**：允许的前端域名（逗号分隔），用于 Fastify CORS 插件。
- **LOG_LEVEL**：日志级别。

**安全约束**：

- 调用方 **绝不能** 也 **不需要** 传入任何 `apiKey` / 真实 LLM baseUrl / MCP URL。
- 所有密钥仅存在服务端环境变量中，从不通过 HTTP/SSE 返回。
- SSE 中的内容仅包含模型输出与工具调用元信息，不包含任何敏感配置。

---

## 上层 Agent 使用建议

- **作为对话 Agent 使用**：
  - 像调用 OpenAI 的 Chat Completions 一样构造 `messages`，额外指定 `provider` / `model` / `mcp`。
  - 由本 Agent 自动判断是否调用工具、调用哪些工具，并通过 SSE 返回完整过程。
- **作为 MCP 工具网关使用**：
  - 使用 `/mcp/list-tools` → 获取工具定义。
  - 使用 `/mcp/call-tool` → 直接调用具体工具。
  - 你可以在自己系统内将这些工具映射为 OpenAI function / JSON schema。
- **多 MCP 场景**：
  - 把不同 `mcp` 看作不同“工具域”（如企业基础信息、风险信息、财务信息等）。
  - 通过在请求中动态设置 `mcp`，在不同域之间进行路由。

---

## 快速接入示例

### 对话示例（伪代码）

```ts
async function chatWithAgent(proxyUrl: string, question: string) {
  const resp = await fetch(`${proxyUrl}/mcp/send-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      mcp: 'basic',
      messages: [{ role: 'user', content: question }]
    })
  });

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();

  let answer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    // 解析 SSE，将所有 type === "token" 的 data 拼接到 answer
  }

  return answer;
}
```

### 作为工具网关使用（伪代码）

```ts
// 发现工具
const listResp = await fetch(`${proxyUrl}/mcp/list-tools`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ mcp: 'basic' })
});
const tools = (await listResp.json()).data.tools;

// 直接调用某个工具
const callResp = await fetch(`${proxyUrl}/mcp/call-tool`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    mcp: 'risk',
    name: 'query_company_risk',
    args: { company_name: 'xxx科技有限公司' }
  })
});
const result = (await callResp.json()).data;
```

---

## 给其他 LLM/Agent 的简短 System Prompt（可选）

当你把本服务接入到其他大模型时，可以使用如下 System Prompt 作为接入说明：

> 你正在调用一个「MCP Proxy Agent」。  
> - 你可以通过 HTTP 接口向它发送 `provider`、`model`、`mcp` 和对话 `messages`，它会自动完成：  
>   1）根据 `mcp` 从对应 MCP Server 动态获取工具列表；  
>   2）在 LLM 推理过程中使用 function_call 自动调用这些工具；  
>   3）递归多轮调用工具，直到得到足够信息；  
>   4）以 SSE 流的形式返回回答内容与工具调用过程。  
> - 你也可以通过它的 `/mcp/list-tools` 和 `/mcp/call-tool` 把 MCP 工具当成普通 API 使用。  
> - 绝不要尝试自行管理任何 API Key 或 MCP URL，这些都由 Proxy Agent 在服务端安全管理。


