# AI 助手 SDK 使用指南（最终版）

## 概述

这是一个完整的浏览器端 AI 助手 SDK，支持通过 Proxy Server 调用 MCP 工具和多个 LLM 提供商。SDK 实现了类似 Cursor 的完整函数调用工作流：LLM → function_call → MCP tool → LLM → 最终答案（流式）。

## 核心特性

1. **多 LLM 提供商支持**
   - OpenAI
   - DeepSeek
   - Gemini
   - Qwen (DashScope)
   - Ollama (本地模型)

2. **通过 Proxy Server 调用 MCP**
   - 前端不再直接连接 MCP（浏览器无法完成 MCP 握手）
   - 所有 MCP 调用通过 Proxy Server 进行
   - 支持多个 MCP 服务器（通过 `mcp` 参数选择）

3. **递归多轮工具调用**
   - 支持 tool A → tool B → tool C → 最终答案
   - 最大工具调用深度限制（默认 5 层）

4. **SSE 流式输出**
   - 支持 Server-Sent Events 流式返回
   - 实时显示 LLM 生成的内容

5. **框架无关**
   - 可在 React、Vue、Svelte、Web Components 中使用
   - 提供 React Hook 包装器

## 安全设计

### ⚠️ 重要：前端永远不允许传递敏感信息

- ❌ **禁止传递**：`apiKey`、`baseUrl`、`mcpUrl` 等敏感字段
- ✅ **可以传递**：`provider`、`model`、`mcp`（非敏感信息）

所有 API Key 和 MCP URL 由 Node Proxy Server 管理，前端只需要知道：
- `proxyUrl`: Proxy Server 的地址
- `mcp`: MCP 服务器 ID（如 "basic"、"risk"）
- `provider`: LLM 提供商（如 "openai"、"deepseek"）
- `model`: 模型名称（如 "gpt-4.1-mini"）

## 安装

```bash
npm install
# 或
pnpm install
```

## 基本使用

### Web Component 使用

```html
<qcc-ai-chatbot
  proxy-url="https://your-server.com"
  mcp="basic"
  provider="openai"
  model="gpt-4.1-mini"
  title="AI 智能客服"
  theme-color="#1677ff"
  debug="false"
></qcc-ai-chatbot>
```

**属性说明**：
- `proxy-url`: Proxy Server URL（必需）
- `mcp`: MCP 服务器 ID（可选，未指定时使用默认）
- `provider`: LLM 提供商（必需）
- `model`: 模型名称（必需）
- `title`: 聊天窗口标题（可选）
- `theme-color`: 主题色（可选）
- `debug`: 是否启用调试日志（可选）

### React 中使用

```typescript
import { useMcpClient } from './lib/useMcpClient';

function MyComponent() {
  const { messages, sendMessage, clear } = useMcpClient({
    proxyUrl: 'https://your-server.com',
    mcp: 'basic',  // 可选
    provider: 'openai',
    model: 'gpt-4.1-mini',
    debug: true, // 启用调试日志
  });

  return (
    <div>
      {messages.map((msg, i) => (
        <div key={i}>{msg.content}</div>
      ))}
      <button onClick={() => sendMessage('Hello!')}>发送</button>
    </div>
  );
}
```

### ChatWidget 组件使用

```typescript
import ChatWidget from './components/ChatWidget';

function App() {
  return (
    <ChatWidget
      proxyUrl="https://your-server.com"
      mcp="risk"  // 可选
      provider="openai"
      model="gpt-4.1-mini"
      title="AI 智能客服"
      themeColor="#1677ff"
      debug={true}
    />
  );
}
```

### 框架无关使用

```typescript
import { useAiAssistant } from './useAiAssistant';

const { messages, sendMessage, clear } = useAiAssistant({
  proxyUrl: 'https://your-server.com',
  mcp: 'basic',  // 可选
  provider: 'openai',
  model: 'gpt-4.1-mini',
  onMessage: (message) => {
    console.log('New message:', message);
  },
  onToken: (token) => {
    console.log('Token:', token);
  },
  onToolCall: (toolName, args) => {
    console.log('Tool called:', toolName, args);
  },
  onError: (error) => {
    console.error('Error:', error);
  },
});
```

### JS 调用示例（支持动态选择 MCP）

```typescript
// 使用默认 MCP
await sendMessage("查询企业信息");

// 使用指定的 MCP
await sendMessage("查询企业信息", { mcp: "risk" });

// 使用第三方 MCP
await sendMessage("测试", { mcp: "thirdparty_ai" });
```

## 配置选项

```typescript
interface AiAssistantConfig {
  proxyUrl: string;  // Proxy Server URL（必需）
  mcp?: string;      // MCP 服务器 ID（可选，未指定时使用默认）
  provider: 'openai' | 'deepseek' | 'gemini' | 'qwen' | 'ollama';  // LLM 提供商（必需）
  model: string;      // 模型名称（必需）
  debug?: boolean;    // 是否启用调试日志，默认 false
  maxToolCallDepth?: number;  // 最大工具调用深度，默认 5
  maxRetries?: number;        // MCP 重连最大次数，默认 5
  toolCallTimeout?: number;   // 工具调用超时（毫秒），默认 30000
  llmTimeout?: number;        // LLM 调用超时（毫秒），默认 60000
  maxMessages?: number;       // 最大消息数量，默认 50
  // 事件回调
  onMessage?: (message: Message) => void;
  onToken?: (token: string) => void;
  onToolCall?: (toolName: string, args: any) => void;
  onError?: (error: Error) => void;
  onFinish?: () => void;
  onReconnect?: () => void;
  onDisconnect?: () => void;
}
```

## 前端传递模型示例

前端只需要传递非敏感信息：

```json
{
  "provider": "openai",
  "model": "gpt-4.1-mini"
}
```

所有 API Key 由 Node Proxy Server 管理，前端永远不需要知道。

## 消息格式

SDK 使用统一的消息格式：

```typescript
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_call?: {
    id?: string;
    name: string;
    arguments: any;
  };
  tool_result?: {
    tool_call_id?: string;
    name: string;
    content: any;
  };
  createdAt: number;
}
```

## 工具调用工作流

1. 前端发送消息到 Proxy Server
2. Proxy Server 调用 LLM（携带工具列表）
3. 如果 LLM 返回 function_call：
   - Proxy Server 调用 MCP 工具
   - 将工具结果作为 assistant 消息添加
4. Proxy Server 递归调用 LLM 生成最终答案
5. Proxy Server 通过 SSE 流式返回最终答案给前端

支持递归多轮工具调用，直到达到最大深度或没有更多工具调用。

## 多 MCP 支持

### 选择不同的 MCP 服务器

```typescript
// 使用 basic MCP
const { sendMessage } = useMcpClient({
  proxyUrl: 'https://your-server.com',
  mcp: 'basic',
  provider: 'openai',
  model: 'gpt-4.1-mini',
});

// 使用 risk MCP
await sendMessage("查询风险信息", { mcp: "risk" });

// 使用第三方 MCP（无需修改代码，只需 Proxy Server 配置）
await sendMessage("测试", { mcp: "thirdparty_ai" });
```

### Web Component 中指定 MCP

```html
<qcc-ai-chatbot
  proxy-url="https://your-server.com"
  mcp="finance"
  provider="openai"
  model="gpt-4.1-mini"
></qcc-ai-chatbot>
```

## 错误处理

SDK 提供统一的错误处理：

```typescript
import { ErrorType } from './types';

// 错误类型
- ProviderConfigError: 配置错误
- McpToolError: 工具调用错误
- ApiCallError: API 调用错误
- StreamParseError: 流解析错误
- TimeoutError: 超时错误
- NetworkError: 网络错误
```

## 调试模式

启用调试模式可以查看详细的日志：

```typescript
const { messages, sendMessage } = useMcpClient({
  proxyUrl: 'https://your-server.com',
  provider: 'openai',
  model: 'gpt-4.1-mini',
  debug: true, // 启用调试日志
});
```

日志会输出：
- Proxy Server 请求和响应
- MCP 工具调用
- 流式解析过程
- 错误信息

## 架构说明

### 核心模块

1. **MCPClient** - 通过 Proxy Server 调用 MCP（不再直接连接）
2. **AiEngine** - 通过 Proxy Server 处理完整对话流程
3. **EventEmitter** - 轻量级事件系统
4. **Logger** - 日志模块
5. **errorHandler** - 统一错误处理和超时机制
6. **configNormalizer** - 配置规范化

### 文件结构

```
src/
  core/
    MCPClient.ts              # MCP 客户端（通过 Proxy Server）
    AiEngine.ts               # AI 引擎（通过 Proxy Server）
    EventEmitter.ts           # 事件系统
    Logger.ts                 # 日志模块
    errorHandler.ts           # 错误处理
    configNormalizer.ts       # 配置规范化
  lib/
    useMcpClient.ts           # React Hook
    useAiAssistantReact.ts    # React Hook 包装器
  useAiAssistant.ts           # 框架无关的 hook API
  types.ts                     # 类型定义
  components/
    ChatWidget.tsx            # React 组件
  chatbot-webcomp.tsx         # Web Component
```

## 与 Proxy Server 通信

### 前端传递的参数

```json
{
  "mcp": "basic",           // 可选，MCP 服务器 ID
  "provider": "openai",     // LLM 提供商
  "model": "gpt-4.1-mini",  // 模型名称
  "messages": [...]         // 消息列表
}
```

### Proxy Server 处理流程

1. 根据 `provider` 从 `LLM_CONFIG` 查找对应的 `apiKey`
2. 根据 `mcp` 动态路由到对应的 MCP Client
3. 调用 LLM API（使用 Node 端管理的 apiKey）
4. 如果产生 function_call，调用 MCP 工具
5. 递归处理工具调用链
6. 通过 SSE 流式返回最终答案

## 常见问题

### 1. Proxy Server 连接失败

**错误**: `Failed to connect to Proxy Server`

**解决方案**:
- 检查 `proxyUrl` 是否正确
- 检查 Proxy Server 是否运行
- 检查 CORS 配置

### 2. MCP 服务器不存在

**错误**: `MCP server "xxx" not found`

**解决方案**:
- 检查 `mcp` 参数是否正确
- 检查 Proxy Server 的 `MCP_SERVERS_JSON` 配置

### 3. 模型不支持

**错误**: `Provider xxx does not support function calling`

**解决方案**:
- 检查 `provider` 是否支持 function calling
- 检查 `model` 是否支持工具调用

## 注意事项

1. **安全要求**：前端永远不允许传递 `apiKey`、`baseUrl`、`mcpUrl` 等敏感字段
2. **Proxy Server 必需**：前端必须通过 Proxy Server 调用 MCP，无法直接连接
3. **MCP ID 选择**：前端只需要知道 MCP ID（如 "basic"），不需要知道实际 URL
4. **流式响应**：所有响应通过 SSE 流式返回，提供实时体验

## 示例代码

### React 完整示例

```typescript
import { useMcpClient } from './lib/useMcpClient';

function ChatApp() {
  const { messages, sendMessage, clear, isProcessing } = useMcpClient({
    proxyUrl: 'https://api.example.com',
    mcp: 'basic',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    debug: true,
    onMessage: (msg) => console.log('Message:', msg),
    onToken: (token) => console.log('Token:', token),
    onToolCall: (name, args) => console.log('Tool:', name, args),
  });

  return (
    <div>
      <div>
        {messages.map((msg) => (
          <div key={msg.id}>
            <strong>{msg.role}:</strong> {msg.content}
          </div>
        ))}
      </div>
      <button onClick={() => sendMessage('Hello!')} disabled={isProcessing}>
        发送
      </button>
      <button onClick={clear}>清空</button>
    </div>
  );
}
```

### Vue 2/3 使用示例

```typescript
// Vue 3 Composition API
import { ref } from 'vue';
import { useAiAssistant } from './useAiAssistant';

export default {
  setup() {
    const messages = ref([]);
    const isProcessing = ref(false);

    const { sendMessage, clear } = useAiAssistant({
      proxyUrl: 'https://api.example.com',
      mcp: 'basic',
      provider: 'openai',
      model: 'gpt-4.1-mini',
      onMessage: (msg) => {
        messages.value = [...messages.value, msg];
      },
      onFinish: () => {
        isProcessing.value = false;
      },
    });

    const handleSend = async (text: string) => {
      isProcessing.value = true;
      await sendMessage(text);
    };

    return { messages, handleSend, clear, isProcessing };
  },
};
```
