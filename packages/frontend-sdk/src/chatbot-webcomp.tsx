import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import ChatWidget, { type ChatWidgetProps, type ChatWidgetRef } from './components/ChatWidget';
import chatWidgetStyles from './components/ChatWidget.css?inline';

class QccAiChatbot extends HTMLElement {
  private root: Root | null = null;
  private widgetRef: ChatWidgetRef | null = null;
  private readonly shadowRootRef: ShadowRoot;

  constructor() {
    super();
    // 创建 Shadow DOM 实现样式隔离
    this.shadowRootRef = this.attachShadow({ mode: 'open' });
  }

  static get observedAttributes() {
    return ['proxy-url', 'mcp', 'provider', 'model', 'title', 'theme-color', 'debug'];
  }

  connectedCallback() {
    this.render();
  }

  disconnectedCallback() {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null) {
    if (oldValue !== newValue && this.root) {
      // 属性变化时重新渲染
      this.render();
    }
  }

  private getProps(): ChatWidgetProps {
    return {
      proxyUrl: this.getAttribute('proxy-url') || '',
      mcp: this.getAttribute('mcp') || undefined,
      provider: (this.getAttribute('provider') as any) || 'openai',
      model: this.getAttribute('model') || 'gpt-4.1-mini',
      title: this.getAttribute('title') || 'AI 智能客服',
      themeColor: this.getAttribute('theme-color') || '#1677ff',
      debug: this.getAttribute('debug') === 'true',
    };
  }

  private render() {
    // 清空 Shadow DOM
    this.shadowRootRef.innerHTML = '';

    // 注入 CSS 样式
    const styleElement = document.createElement('style');
    styleElement.textContent = chatWidgetStyles;
    this.shadowRootRef.appendChild(styleElement);

    // 创建容器
    const container = document.createElement('div');
    container.id = 'chatbot-root';
    this.shadowRootRef.appendChild(container);

    // 创建 React Root 并渲染
    this.root = createRoot(container);
    this.root.render(
      <ChatWidget
        {...this.getProps()}
        ref={(ref) => {
          this.widgetRef = ref;
        }}
      />
    );
  }

  // 公开方法：打开聊天窗口
  open() {
    if (this.widgetRef) {
      this.widgetRef.open();
    }
  }

  // 公开方法：关闭聊天窗口
  close() {
    if (this.widgetRef) {
      this.widgetRef.close();
    }
  }

  // 公开方法：最小化聊天窗口
  minimize() {
    if (this.widgetRef) {
      this.widgetRef.minimize();
    }
  }

  // 公开方法：清空对话
  clear() {
    if (this.widgetRef) {
      this.widgetRef.clear();
    }
  }

  // 公开方法：触发提问
  ask(question: string) {
    if (this.widgetRef) {
      this.widgetRef.ask(question);
    }
  }
}

// 注册自定义元素
if (!customElements.get('qcc-ai-chatbot')) {
  customElements.define('qcc-ai-chatbot', QccAiChatbot);
}

export default QccAiChatbot;
