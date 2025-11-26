import type { AiAssistantConfig, Message, MessageRole } from '../types';
import type { QccMessageBubble } from './message-bubble';
import { normalizeConfig } from '../core/configNormalizer';
import { AiEngine } from '../core/AiEngine';
import { EventEmitter } from '../core/EventEmitter';
import { logger } from '../core/Logger';
import { formatError } from '../core/errorHandler';
import chatbotCss from '../styles/chatbot.css?inline';

type CoreConfigSignature = string | null;

type CoreConfigFields = Pick<AiAssistantConfig, 'provider' | 'model' | 'proxyUrl' | 'mcp'>;

const UI_ATTRIBUTES = new Set(['title', 'theme-color', 'debug']);
const CORE_ATTRIBUTES = new Set(['proxy-url', 'provider', 'model', 'mcp']);

export class QccAiChatbot extends HTMLElement {
  static get observedAttributes(): string[] {
    return [
      'proxy-url',
      'provider',
      'model',
      'mcp',
      'title',
      'theme-color',
      'debug',
    ];
  }

  private shadow: ShadowRoot | null = null;

  private rootEl: HTMLDivElement | null = null;
  private headerTitleEl: HTMLSpanElement | null = null;
  private messagesEl: HTMLDivElement | null = null;
  private toolStatusEl: HTMLDivElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private sendButtonEl: HTMLButtonElement | null = null;
  private loadingTextEl: HTMLSpanElement | null = null;

  private engine: AiEngine | null = null;
  private eventEmitter: EventEmitter | null = null;

  private messages: Message[] = [];
  private isProcessing = false;
  private isOpen = true;
  private toolStatusText = '';
  private streamingMessageId: string | null = null;

  private uiTitle = '智能助手';
  private themeColor: string | null = null;
  private debug = false;

  private coreConfigSignature: CoreConfigSignature = null;

  constructor() {
    super();
  }

  connectedCallback(): void {
    if (!this.shadow) {
      this.shadow = this.attachShadow({ mode: 'open' });
      this.renderShell();
      this.updateFromAttributes();
      this.applyThemeColor();
      this.updateHeaderTitle();
      this.updateOpenState();
    }
  }

  disconnectedCallback(): void {
    void this.destroyEngine();
  }

  attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void {
    if (!this.isConnected) return;

    if (UI_ATTRIBUTES.has(name)) {
      this.handleUiAttributeChange(name, newValue);
      return;
    }

    if (CORE_ATTRIBUTES.has(name)) {
      this.handleCoreAttributeChange();
    }
  }

  /**
   * 对外 API：打开面板
   */
  public open(): void {
    this.isOpen = true;
    this.updateOpenState();
  }

  /**
   * 对外 API：收起面板
   */
  public close(): void {
    this.isOpen = false;
    this.updateOpenState();
  }

  /**
   * 对外 API：清空消息
   */
  public clearMessages(): void {
    if (this.engine) {
      this.engine.clearMessages();
    }
    this.messages = [];
    this.streamingMessageId = null;
    this.isProcessing = false;
    this.toolStatusText = '';
    this.renderMessages();
    this.renderToolStatus();
    this.updateLoadingState();
  }

  /**
   * 对外 API：发送一条消息
   */
  public async sendMessage(text: string): Promise<void> {
    await this.handleSend(text);
  }

  // =========================
  // 属性与配置处理
  // =========================

  private updateFromAttributes(): void {
    const titleAttr = this.getAttribute('title');
    if (titleAttr) {
      this.uiTitle = titleAttr;
    }

    const themeAttr = this.getAttribute('theme-color');
    if (themeAttr) {
      this.themeColor = themeAttr;
    }

    const debugAttr = this.getAttribute('debug');
    this.debug = debugAttr !== null && debugAttr !== 'false';
    if (this.debug) {
      logger.enable();
    } else {
      logger.disable();
    }
  }

  private handleUiAttributeChange(name: string, value: string | null): void {
    if (name === 'title') {
      this.uiTitle = value ?? this.uiTitle;
      this.updateHeaderTitle();
    } else if (name === 'theme-color') {
      this.themeColor = value;
      this.applyThemeColor();
    } else if (name === 'debug') {
      this.debug = value !== null && value !== 'false';
      if (this.debug) {
        logger.enable();
      } else {
        logger.disable();
      }
    }
  }

  private handleCoreAttributeChange(): void {
    // 仅当核心配置变化时才重建 engine
    void this.setupEngineIfNeeded(true);
  }

  private buildCoreConfig(): CoreConfigFields | null {
    const proxyUrl = this.getAttribute('proxy-url') || '';
    const provider = this.getAttribute('provider') as AiAssistantConfig['provider'] | null;
    const model = this.getAttribute('model') || '';
    const mcp = this.getAttribute('mcp') || undefined;

    if (!proxyUrl || !provider || !model) {
      return null;
    }

    return {
      proxyUrl,
      provider,
      model,
      mcp,
    };
  }

  private buildConfig(): AiAssistantConfig | null {
    const core = this.buildCoreConfig();
    if (!core) return null;

    const debug = this.debug || this.getAttribute('debug') !== null;

    return {
      ...core,
      debug,
    };
  }

  private getCoreConfigSignature(core: CoreConfigFields | null): CoreConfigSignature {
    if (!core) return null;
    return JSON.stringify({
      proxyUrl: core.proxyUrl,
      provider: core.provider,
      model: core.model,
      mcp: core.mcp ?? null,
    });
  }

  private async setupEngineIfNeeded(forceRecreate: boolean = false): Promise<void> {
    const config = this.buildConfig();
    if (!config) {
      // 核心配置未就绪时不创建 engine
      return;
    }

    const core = this.buildCoreConfig();
    const signature = this.getCoreConfigSignature(core);

    if (!forceRecreate && this.engine && signature === this.coreConfigSignature) {
      return;
    }

    await this.destroyEngine();

    const normalized = normalizeConfig(config);

    if (normalized.debug) {
      logger.enable();
    } else {
      logger.disable();
    }

    const eventEmitter = new EventEmitter();
    const engine = new AiEngine(normalized, eventEmitter);

    this.engine = engine;
    this.eventEmitter = eventEmitter;
    this.coreConfigSignature = signature;

    this.bindEngineEvents();
  }

  private async destroyEngine(): Promise<void> {
    if (this.engine) {
      try {
        await this.engine.cleanup();
      } catch {
        // ignore
      }
      this.engine = null;
    }
    if (this.eventEmitter) {
      this.eventEmitter.removeAllListeners();
      this.eventEmitter = null;
    }
    this.coreConfigSignature = null;
  }

  // =========================
  // 与 AiEngine 的事件交互
  // =========================

  private bindEngineEvents(): void {
    if (!this.eventEmitter) return;

    this.eventEmitter.on('message', () => {
      this.messages = this.engine ? this.engine.getMessages() : [];
      this.renderMessages();
      this.scrollToBottom();
    });

    this.eventEmitter.on('token', () => {
      if (!this.engine) return;
      this.isProcessing = true;
      this.messages = this.engine.getMessages();
      const lastAssistant = [...this.messages].reverse().find((m) => m.role === 'assistant');
      this.streamingMessageId = lastAssistant?.id ?? null;
      this.renderMessages();
      this.scrollToBottom();
      this.updateLoadingState();
    });

    this.eventEmitter.on('toolCall', (toolName: string) => {
      this.toolStatusText = `正在执行工具：${toolName}…`;
      this.renderToolStatus();
    });

    this.eventEmitter.on('finish', () => {
      this.isProcessing = false;
      this.streamingMessageId = null;
      this.messages = this.engine ? this.engine.getMessages() : this.messages;
      this.toolStatusText = '';
      this.renderMessages();
      this.renderToolStatus();
      this.updateLoadingState();
    });

    this.eventEmitter.on('error', (error: Error) => {
      const formatted = formatError(error);
      this.toolStatusText = '发生错误，请稍后重试';
      if (this.debug) {
        // eslint-disable-next-line no-console
        console.error('qcc-ai-chatbot error:', formatted);
      }
      this.renderToolStatus();
      this.updateLoadingState();
    });
  }

  // =========================
  // UI 渲染 & 事件绑定
  // =========================

  private renderShell(): void {
    if (!this.shadow) return;

    this.shadow.innerHTML = '';

    const style = document.createElement('style');
    style.textContent = chatbotCss;
    this.shadow.appendChild(style);

    const root = document.createElement('div');
    root.className = 'qcc-chatbot';
    this.rootEl = root;

    // Header
    const header = document.createElement('div');
    header.className = 'qcc-chatbot__header';

    const title = document.createElement('div');
    title.className = 'qcc-chatbot__title';

    const dot = document.createElement('span');
    dot.className = 'qcc-chatbot__dot';

    const titleText = document.createElement('span');
    this.headerTitleEl = titleText;

    title.appendChild(dot);
    title.appendChild(titleText);

    const headerActions = document.createElement('div');
    headerActions.className = 'qcc-chatbot__header-actions';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'qcc-chatbot__icon-button';
    toggleBtn.title = '展开/收起';
    toggleBtn.innerHTML = '▾';
    toggleBtn.addEventListener('click', () => {
      this.isOpen = !this.isOpen;
      this.updateOpenState();
    });

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'qcc-chatbot__icon-button';
    clearBtn.title = '清空对话';
    clearBtn.innerHTML = '✕';
    clearBtn.addEventListener('click', () => {
      this.clearMessages();
    });

    headerActions.appendChild(toggleBtn);
    headerActions.appendChild(clearBtn);

    header.appendChild(title);
    header.appendChild(headerActions);

    // Body
    const body = document.createElement('div');
    body.className = 'qcc-chatbot__body';

    const messages = document.createElement('div');
    messages.className = 'qcc-chatbot__messages';
    this.messagesEl = messages;

    const toolStatus = document.createElement('div');
    toolStatus.className = 'qcc-chatbot__tool-status';
    this.toolStatusEl = toolStatus;

    const inputArea = document.createElement('div');
    inputArea.className = 'qcc-chatbot__input-area';

    const inputRow = document.createElement('div');
    inputRow.className = 'qcc-chatbot__input-row';

    const textarea = document.createElement('textarea');
    textarea.className = 'qcc-chatbot__input';
    textarea.rows = 1;
    textarea.placeholder = '请输入内容，按 Enter 发送，Shift+Enter 换行';
    this.inputEl = textarea;

    textarea.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void this.handleSend();
      }
    });

    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'qcc-chatbot__send-button';
    sendBtn.textContent = '发送';
    this.sendButtonEl = sendBtn;

    sendBtn.addEventListener('click', () => {
      void this.handleSend();
    });

    inputRow.appendChild(textarea);
    inputRow.appendChild(sendBtn);

    const hint = document.createElement('div');
    hint.className = 'qcc-chatbot__hint';
    hint.innerHTML = '<span>按 Enter 发送，Shift+Enter 换行</span>';

    const loading = document.createElement('span');
    loading.className = 'qcc-chatbot__loading';
    const loadingText = document.createElement('span');
    loadingText.textContent = '思考中';
    this.loadingTextEl = loadingText;

    const loadingDots = document.createElement('span');
    loadingDots.className = 'qcc-chatbot__loading-dots';
    loadingDots.innerHTML =
      '<span class="qcc-chatbot__loading-dot"></span>' +
      '<span class="qcc-chatbot__loading-dot"></span>' +
      '<span class="qcc-chatbot__loading-dot"></span>';

    loading.appendChild(loadingText);
    loading.appendChild(loadingDots);

    hint.appendChild(loading);

    inputArea.appendChild(inputRow);
    inputArea.appendChild(hint);

    body.appendChild(messages);
    body.appendChild(toolStatus);
    body.appendChild(inputArea);

    root.appendChild(header);
    root.appendChild(body);
    this.shadow.appendChild(root);

    this.renderMessages();
    this.renderToolStatus();
    this.updateLoadingState();
  }

  private updateHeaderTitle(): void {
    if (!this.headerTitleEl) return;
    this.headerTitleEl.textContent = this.uiTitle || '智能助手';
  }

  private applyThemeColor(): void {
    if (!this.shadow) return;
    const color = this.themeColor || this.getAttribute('theme-color');
    if (color) {
      (this.shadow.host as HTMLElement).style.setProperty('--qcc-chatbot-theme-color', color);
    }
  }

  private updateOpenState(): void {
    if (!this.rootEl) return;
    if (this.isOpen) {
      this.rootEl.classList.remove('qcc-chatbot--closed');
    } else {
      this.rootEl.classList.add('qcc-chatbot--closed');
    }
  }

  private renderMessages(): void {
    if (!this.messagesEl) return;

    const container = this.messagesEl;
    container.innerHTML = '';

    if (!this.messages.length) {
      const empty = document.createElement('div');
      empty.className = 'qcc-chatbot__messages-empty';
      empty.textContent = '开始对话，向企业 AI 助手提问吧～';
      container.appendChild(empty);
      return;
    }

    for (const msg of this.messages) {
      const line = document.createElement('div');
      const bubble = document.createElement(
        'qcc-message-bubble'
      ) as unknown as QccMessageBubble;

      const role: MessageRole | 'system' =
        msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool'
          ? msg.role
          : 'system';

      bubble.setAttribute('role', role);

      if (this.streamingMessageId && msg.id === this.streamingMessageId) {
        bubble.setAttribute('streaming', '');
      } else {
        bubble.removeAttribute('streaming');
      }

      bubble.textContent = msg.content;

      line.appendChild(bubble);
      container.appendChild(line);
    }
  }

  private renderToolStatus(): void {
    if (!this.toolStatusEl) return;
    const el = this.toolStatusEl;
    el.innerHTML = '';
    if (!this.toolStatusText) return;

    const wrapper = document.createElement('span');
    wrapper.className = 'qcc-chatbot__tool-status-text';

    const dot = document.createElement('span');
    dot.className = 'qcc-chatbot__tool-status-dot';

    const text = document.createElement('span');
    text.textContent = this.toolStatusText;

    wrapper.appendChild(dot);
    wrapper.appendChild(text);

    el.appendChild(wrapper);
  }

  private updateLoadingState(): void {
    if (!this.loadingTextEl) return;
    this.loadingTextEl.style.visibility = this.isProcessing ? 'visible' : 'hidden';
    if (this.sendButtonEl) {
      this.sendButtonEl.disabled = this.isProcessing;
    }
  }

  private scrollToBottom(): void {
    if (!this.messagesEl) return;
    requestAnimationFrame(() => {
      this.messagesEl!.scrollTop = this.messagesEl!.scrollHeight;
    });
  }

  private async handleSend(textFromApi?: string): Promise<void> {
    const text =
      typeof textFromApi === 'string'
        ? textFromApi
        : (this.inputEl && this.inputEl.value ? this.inputEl.value : '');

    if (!text.trim() || this.isProcessing) {
      return;
    }

    await this.setupEngineIfNeeded(false);

    if (!this.engine) {
      if (this.debug) {
        // eslint-disable-next-line no-console
        console.warn('qcc-ai-chatbot: Engine is not ready, core config may be missing.');
      }
      return;
    }

    this.isProcessing = true;
    this.updateLoadingState();

    if (!textFromApi && this.inputEl) {
      this.inputEl.value = '';
    }

    try {
      await this.engine.processMessage(text);
    } catch (error) {
      const formatted = formatError(error);
      this.toolStatusText = '发送消息失败，请稍后重试';
      if (this.debug) {
        // eslint-disable-next-line no-console
        console.error('qcc-ai-chatbot sendMessage error:', formatted);
      }
      this.renderToolStatus();
    } finally {
      this.isProcessing = false;
      this.updateLoadingState();
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'qcc-ai-chatbot': QccAiChatbot;
  }
}


