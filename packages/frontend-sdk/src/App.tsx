import { useEffect, useRef } from 'react'
import './App.css'

function App() {
  const proxyUrl = import.meta.env.VITE_PROXY_URL || 'http://localhost:3000';
  const mcpId = import.meta.env.VITE_MCP_ID || import.meta.env.VITE_MCP || '';
  const provider = import.meta.env.VITE_PROVIDER || 'openai';
  const model = import.meta.env.VITE_MODEL || 'gpt-4.1-mini';
  const title = import.meta.env.VITE_CHATBOT_TITLE || 'AI 智能客服';
  const theme = import.meta.env.VITE_CHATBOT_THEME || '#1677ff';
  const debug = (import.meta.env.VITE_DEBUG ?? 'false') === 'true';

  const chatbotRef = useRef<HTMLElement & {
    open?: () => void
    close?: () => void
    minimize?: () => void
    clear?: () => void
    ask?: (question: string) => void
  } | null>(null)

 

  useEffect(() => {
    // 确保 Web Component 已加载
    if (customElements.get('qcc-ai-chatbot')) {
      chatbotRef.current = document.querySelector('qcc-ai-chatbot') as any
    }
  }, [])

  const handleAsk = () => {
    chatbotRef.current?.ask?.('查询企查查科技股份有限公司的企业的工商信息，如企业类型、注册资本、成立日期、登记状态、行政区划等信息')
  }

  const handleOpen = () => {
    chatbotRef.current?.open?.()
  }

  const handleClose = () => {
    chatbotRef.current?.close?.()
  }

  const handleClear = () => {
    chatbotRef.current?.clear?.()
  }

  return (
    <div style={{ padding: '40px', maxWidth: '800px', margin: '0 auto' }}>
      {/* <h1>AI 聊天客服组件 Demo</h1>
      <p>这是一个本地调试页面，用于测试 Web Component 聊天组件。</p> */}

      <div style={{ marginTop: '30px' }}>
        <h2>配置示例</h2>
        <pre style={{ background: '#f5f5f5', padding: '16px', borderRadius: '8px', overflow: 'auto' }}>
{`<qcc-ai-chatbot
  proxy-url="https://proxy.example.com"
  mcp="basic"
  provider="openai"
  model="gpt-4.1-mini"
  title="AI 智能客服"
  theme-color="#1677ff"
  debug="true"
></qcc-ai-chatbot>`}
        </pre>
      </div>

      <div style={{ marginTop: '30px' }}>
        <h2>外部控制 API</h2>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '16px' }}>
          <button onClick={handleOpen} style={{ padding: '10px 20px', cursor: 'pointer' }}>
            打开聊天窗口
          </button>
          <button onClick={handleClose} style={{ padding: '10px 20px', cursor: 'pointer' }}>
            关闭聊天窗口
          </button>
          <button onClick={handleAsk} style={{ padding: '10px 20px', cursor: 'pointer' }}>
            外部触发提问
          </button>
          <button onClick={handleClear} style={{ padding: '10px 20px', cursor: 'pointer' }}>
            清空对话
          </button>
        </div>
      </div>

      <div style={{ marginTop: '30px' }}>
        <h2>使用说明</h2>
        <ul>
          <li>组件会自动固定在页面右下角</li>
          <li>点击悬浮按钮可以打开/关闭聊天窗口</li>
          <li>支持最小化、关闭、清空对话等功能</li>
          <li>可以通过 JavaScript API 外部控制组件</li>
        </ul>
      </div>

      {/* Web Component 实例 - 在这里配置你的 MCP 参数 */}
      <qcc-ai-chatbot
        proxy-url={proxyUrl}
        mcp={mcpId || undefined}
        model={model}
        provider={provider}
        title={title}
        theme-color={theme}
        debug={debug ? 'true' : 'false'}
      ></qcc-ai-chatbot>
    </div>
  )
}

export default App
