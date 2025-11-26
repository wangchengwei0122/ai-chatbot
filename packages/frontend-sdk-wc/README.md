## QCC AI Chatbot Web Component（frontend-sdk-wc）

一个零依赖、纯浏览器可用的 `<qcc-ai-chatbot>` Web Component，封装了 MCP 连接、LLM 流式对话与工具调用链，可直接在任意前端项目中使用。

### 安装与构建

在 monorepo 中（当前项目）：

```bash
pnpm install
pnpm --filter frontend-sdk-wc build
```

构建完成后会生成：

- `dist/qcc-ai-chatbot.js`（ESM，浏览器原生 `type="module"` 可用）
- `dist/qcc-ai-chatbot.umd.js`（UMD，传统打包器可用）
- `dist/chatbot.css`（可选外链样式，组件内部已自动注入一份）

### 直接在浏览器中使用

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>QCC AI Chatbot Demo</title>
    <link rel="stylesheet" href="./dist/chatbot.css" />
  </head>
  <body>
    <qcc-ai-chatbot
      proxy-url="http://localhost:7001"
      provider="deepseek"
      model="deepseek-chat"
      mcp="qcc-mcp"
      title="企业 AI 助手"
      theme-color="#2563eb"
      debug="true"
    ></qcc-ai-chatbot>

    <script type="module" src="./dist/qcc-ai-chatbot.js"></script>
  </body>
  </html>
```

### 自定义元素属性

- `proxy-url`：MCP Proxy Server 地址（必填）
- `provider`：LLM 提供商，如 `deepseek` / `openai` / `gemini` / `qwen` / `ollama`（必填）
- `model`：模型名称（必填）
- `mcp`：MCP 服务器 ID，可选
- `title`：头部标题文案，默认“智能助手”
- `theme-color`：主题主色（十六进制 / CSS 颜色值）
- `debug`：是否开启调试日志（存在该属性且不为 `"false"` 时视为开启）

### 对外 JS API

通过 DOM 引用可以直接调用：

```ts
const el = document.querySelector('qcc-ai-chatbot')!;

// 打开/收起面板
el.open();
el.close();

// 清空消息
el.clearMessages();

// 从外部发送一条消息
el.sendMessage('帮我检索某个企业的基本信息');
```

### 说明

- 不依赖 React/Vue/Solid 等框架，仅依赖浏览器原生能力。
- 所有 LLM/MCP/工具调用逻辑都在 `src/core` 中，通过 `AiEngine` 统一封装，UI 层只负责展示与事件转发。
- 样式通过 Shadow DOM 封装，不会污染全局页面样式。


