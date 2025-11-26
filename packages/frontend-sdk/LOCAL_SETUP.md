# 本地配置和运行指南

## 1. 安装依赖

首先确保已安装所有依赖：

```bash
# 使用 npm
npm install

# 或使用 pnpm（推荐）
pnpm install

# 或使用 yarn
yarn install
```

## 2. 配置 MCP 服务器和 LLM

### 方式一：在 App.tsx 中配置（用于测试）

编辑 `src/App.tsx`，修改 Web Component 的属性：

```tsx
<qcc-ai-chatbot
  proxy-url="http://localhost:3000"  // Proxy Server 地址
  mcp="basic"                        // MCP 服务器 ID（可选）
  provider="openai"                  // 提供商：openai/deepseek/gemini/qwen/ollama
  model="gpt-4.1-mini"               // 模型名称
  title="AI 智能客服"
  theme-color="#1677ff"
  debug="true"                       // 启用调试日志
></qcc-ai-chatbot>
```

### 方式二：在 ChatWidget 组件中直接使用（React）

```tsx
import ChatWidget from './components/ChatWidget';

function App() {
  return (
    <ChatWidget
      proxyUrl="http://localhost:3000"
      mcp="basic"          // 可选
      model="gpt-4.1-mini"
      provider="openai"
      debug={true}
    />
  );
}
```

## 3. 配置说明

### 必需参数

- **proxy-url**: Proxy Server 地址
  - 例如：`http://localhost:3000`
  - 由 Node 端统一管理 LLM API Key 和 MCP 连接

- **model**: 模型名称
  - OpenAI: `gpt-4.1-mini`, `gpt-4o` 等
  - DeepSeek: `deepseek-chat`, `deepseek-coder` 等
  - Gemini: `gemini-1.5-flash` 等
  - Qwen: `qwen-plus`, `qwen-turbo` 等
  - Ollama: `llama2`, `mistral` 等（需要本地运行 Ollama）

- **provider**: LLM 提供商
  - `openai` / `deepseek` / `gemini` / `qwen` / `ollama`

### 可选参数

- **mcp**: MCP 服务器 ID（在 Proxy Server 的配置中定义）
- **title**: 聊天窗口标题（默认：`AI 智能客服`）
- **theme-color**: 主题色（默认：`#1677ff`）
- **debug**: 是否启用调试日志（默认：`false`）
- **max-tool-call-depth**: 最大工具调用深度（默认：`5`）
- **max-retries**: MCP 重连最大次数（默认：`5`）
- **tool-call-timeout**: 工具调用超时时间，单位毫秒（默认：`30000`）
- **llm-timeout**: LLM 调用超时时间，单位毫秒（默认：`60000`）

## 4. 运行开发服务器

```bash
# 使用 npm
npm run dev

# 或使用 pnpm
pnpm dev

# 或使用 yarn
yarn dev
```

服务器启动后，访问 `http://localhost:5173` 查看应用。

## 5. 测试配置

### 测试 OpenAI

```tsx
<qcc-ai-chatbot
  proxy-url="http://localhost:3000"
  mcp="basic"
  model="gpt-4.1-mini"
  provider="openai"
  debug="true"
></qcc-ai-chatbot>
```

### 测试 DeepSeek

```tsx
<qcc-ai-chatbot
  proxy-url="http://localhost:3000"
  mcp="basic"
  model="deepseek-chat"
  provider="deepseek"
  debug="true"
></qcc-ai-chatbot>
```

### 测试本地 Ollama

1. 首先启动 Ollama 服务：
```bash
ollama serve
```

2. 然后配置：
```tsx
<qcc-ai-chatbot
  proxy-url="http://localhost:3000"
  mcp="local"
  model="llama2"
  provider="ollama"
  debug="true"
></qcc-ai-chatbot>
```

## 6. 常见问题

### 问题 1: Proxy 连接失败

**错误信息**: `Failed to connect to proxy server`

**解决方案**:
- 检查 `proxy-url` 是否指向正在运行的 Proxy Server
- 确认 Proxy Server 能够访问目标 MCP 服务
- 检查网络连接
- 查看浏览器控制台的详细错误信息（启用 debug 模式）

### 问题 2: LLM 配置错误

**错误信息**: `API key is required` 或 `401 Unauthorized`

**解决方案**:
- 检查 Proxy Server 的 `LLM_CONFIG` 环境变量是否配置正确
- 确认对应 provider 的 `apiKey`、`baseUrl` 是否填写
- 确认 API Key 有足够的权限

### 问题 3: 模型不支持工具调用

**错误信息**: `Provider does not support function calling`

**解决方案**:
- 确认使用的模型支持 function calling
- OpenAI: `gpt-4`, `gpt-4-turbo`, `gpt-3.5-turbo` 等
- DeepSeek: `deepseek-chat` 等
- 某些基础模型可能不支持工具调用

### 问题 4: 工具调用超时

**错误信息**: `Tool call timed out`

**解决方案**:
- 增加 `tool-call-timeout` 的值
- 检查 MCP 服务器是否正常运行
- 检查网络连接

## 7. 调试技巧

### 启用调试模式

在配置中添加 `debug="true"` 或 `debug={true}`，可以在浏览器控制台查看：

- LLM 请求参数和响应
- MCP 工具调用详情
- 流式解析过程
- 重连和缓存逻辑
- 错误堆栈信息

### 查看网络请求

在浏览器开发者工具的 Network 标签中，可以查看：

- LLM API 请求（`/chat/completions`）
- MCP SSE 连接
- 工具调用请求

### 查看控制台日志

启用 debug 模式后，控制台会显示：

```
[2024-01-01T00:00:00.000Z] [DEBUG] [MCPClient] Connecting to MCP server: https://...
[2024-01-01T00:00:00.000Z] [DEBUG] [LLMClient] Request: { provider: 'openai', model: 'gpt-4', ... }
[2024-01-01T00:00:00.000Z] [DEBUG] [MCPClient] Tool call: { name: 'xxx', args: {...} }
```

## 8. 环境变量配置（可选）

如果需要使用环境变量，可以创建 `.env` 文件：

```env
VITE_PROXY_URL=http://localhost:3000
VITE_MCP_ID=basic
VITE_MODEL=gpt-4.1-mini
VITE_PROVIDER=openai
VITE_CHATBOT_TITLE=AI 智能客服
VITE_CHATBOT_THEME=#1677ff
VITE_DEBUG=true
```

然后在代码中使用：

```tsx
<qcc-ai-chatbot
  proxy-url={import.meta.env.VITE_PROXY_URL}
  mcp={import.meta.env.VITE_MCP_ID}
  model={import.meta.env.VITE_MODEL}
  provider={import.meta.env.VITE_PROVIDER}
  title={import.meta.env.VITE_CHATBOT_TITLE}
  theme-color={import.meta.env.VITE_CHATBOT_THEME}
  debug={import.meta.env.VITE_DEBUG}
></qcc-ai-chatbot>
```

**注意**: 环境变量必须以 `VITE_` 开头才能在 Vite 项目中使用。

## 9. 构建生产版本

```bash
npm run build
```

构建完成后，文件会在 `dist` 目录中。

## 10. 预览生产构建

```bash
npm run preview
```

这会启动一个本地服务器预览构建后的应用。
