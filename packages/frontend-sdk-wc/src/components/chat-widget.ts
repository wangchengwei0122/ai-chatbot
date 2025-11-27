import type { AiAssistantConfig, Message, MessageRole } from '../types';
import { QccMessageBubble } from './message-bubble';
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
  private panelEl: HTMLDivElement | null = null;
  private headerTitleEl: HTMLSpanElement | null = null;
  private messagesEl: HTMLDivElement | null = null;
  private toolStatusEl: HTMLDivElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private mcpMenuEl: HTMLDivElement | null = null;
  private mcpIconButtonEl: HTMLButtonElement | null = null;
  private quickMenuEl: HTMLDivElement | null = null;
  private quickPhrasesButtonEl: HTMLButtonElement | null = null;
  private sendButtonEl: HTMLButtonElement | null = null;
  private loadingTextEl: HTMLSpanElement | null = null;
  private fabButtonEl: HTMLButtonElement | null = null;
  private closeButtonEl: HTMLButtonElement | null = null;
  private maskEl: HTMLDivElement | null = null;

  private engine: AiEngine | null = null;
  private eventEmitter: EventEmitter | null = null;

  private messages: Message[] = [];
  private isProcessing = false;
  private isOpen = false;
  private isMobileViewport = false;
  private toolStatusText = '';
  private streamingMessageId: string | null = null;

  // MCP 相关 state
  private allMcpList: string[] = [];
  private selectedMcpIds: string[] = [];
  private isMcpMenuOpen = false;
  private documentClickHandler: ((event: MouseEvent) => void) | null = null;

  // 快捷短语相关 state
  private isQuickMenuOpen = false;
  private quickPhrases = [
    {
      name:'查找下，乐视这家公司目前的老板是谁，它还存在诉讼风险吗？',
      content:'查找下，乐视这家公司目前的老板是谁，它还存在诉讼风险吗？',
    },
    {
      name:'平凉锦航商贸有限责任公司 这个公司是什么时候成立的？',
      content:'平凉锦航商贸有限责任公司 这个公司是什么时候成立的？',
    },
    {
      name:'小米科技的雷军和金山软件的雷军是同一个人吗？',
      content:'小米科技的雷军和金山软件的雷军是同一个人吗？',
    },
    
  ];

  private uiTitle = '智能助手';
  private themeColor: string | null = null;
  private debug = false;

  private coreConfigSignature: CoreConfigSignature = null;
  private mediaQuery: MediaQueryList | null = null;
  private mediaQueryHandler: ((event: MediaQueryListEvent | MediaQueryList) => void) | null = null;

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
      this.initViewportWatcher();
      void this.fetchMcpListIfPossible();
      this.initDocumentClickListener();
    }
  }

  disconnectedCallback(): void {
    void this.destroyEngine();
    this.cleanupViewportWatcher();
    this.cleanupDocumentClickListener();
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
  public open(text?: string): void {
    this.isOpen = true;
    this.updateOpenState();
    if (text) {
      this.sendMessage(text);
    }
  }

  /**
   * 对外 API：收起面板
   */
  public close(): void {
    if (this.isMobileViewport) return;
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
    void this.fetchMcpListIfPossible();
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
      const updated = this.updateStreamingBubbleContent(lastAssistant);
      if (!updated) {
        this.renderMessages();
        this.updateStreamingBubbleContent(lastAssistant);
      }
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
    root.className = 'qcc-chatbot qcc-chatbot--closed';
    this.rootEl = root;

    const mask = document.createElement('div');
    mask.className = 'qcc-chatbot__mask';
    mask.addEventListener('click', () => {
      if (this.isMobileViewport) return;
      this.isOpen = false;
      this.updateOpenState();
    });
    this.maskEl = mask;

    const panel = document.createElement('div');
    panel.className = 'qcc-chatbot__panel';
    panel.setAttribute('aria-hidden', 'true');
    this.panelEl = panel;

    const fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'qcc-chatbot__fab';
    fab.title = '打开聊天窗口';
    fab.setAttribute('aria-label', '打开聊天窗口');
    fab.innerHTML = this.renderRobotIcon();
    fab.addEventListener('click', () => {
      if (this.isMobileViewport) return;
      this.isOpen = true;
      this.updateOpenState();
    });
    this.fabButtonEl = fab;

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

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'qcc-chatbot__circle-button';
    closeBtn.title = '收起';
    closeBtn.setAttribute('aria-label', '收起窗口');
    closeBtn.innerHTML =
      '<svg class="qcc-chatbot__icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5l9 9m0-9l-9 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    closeBtn.addEventListener('click', () => {
      if (this.isMobileViewport) return;
      this.isOpen = false;
      this.updateOpenState();
    });
    this.closeButtonEl = closeBtn;

    headerActions.appendChild(closeBtn);

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

    // MCP 工具栏
    const toolbar = document.createElement('div');
    toolbar.className = 'qcc-chatbot__toolbar';

    const mcpButton = document.createElement('button');
    mcpButton.type = 'button';
    mcpButton.className = 'qcc-chatbot__toolbar-icon';
    mcpButton.title = '选择 MCP';
    mcpButton.setAttribute('aria-label', '选择 MCP');
    mcpButton.innerHTML = `
      <svg class="qcc-chatbot__icon" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M4 6.5a2.5 2.5 0 0 1 2.5-2.5h7A2.5 2.5 0 0 1 16 6.5v1A2.5 2.5 0 0 1 13.5 10h-7A2.5 2.5 0 0 1 4 7.5v-1Zm0 7a2.5 2.5 0 0 1 2.5-2.5h2a.75.75 0 0 1 0 1.5h-2A1 1 0 0 0 5 13.5v1A1 1 0 0 0 6.5 15h7a1 1 0 0 0 1-1v-1a.75.75 0 0 1 1.5 0v1A2.5 2.5 0 0 1 13.5 16h-7A2.5 2.5 0 0 1 4 14.5v-1Z" fill="currentColor"/>
      </svg>
      <span class="qcc-chatbot__toolbar-icon-label">MCP</span>
    `;
    mcpButton.addEventListener('click', (event: MouseEvent) => {
      event.stopPropagation();
      this.closeQuickMenu(); // 打开 MCP 菜单时关闭快捷菜单
      this.toggleMcpMenu();
    });
    this.mcpIconButtonEl = mcpButton;

    // --- 新增：快捷短语按钮
    const quickPhrasesButton = document.createElement('button');
    quickPhrasesButton.type = 'button';
    quickPhrasesButton.className = 'qcc-chatbot__toolbar-icon';
    quickPhrasesButton.title = '快捷短语';
    quickPhrasesButton.setAttribute('aria-label', '快捷短语');
    quickPhrasesButton.innerHTML = `
      <svg class="qcc-chatbot__icon" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 2a6 6 0 0 0-6 6c0 1.887.454 3.665 1.257 5.234a.75.75 0 0 0 1.305-.75 4.5 4.5 0 1 1 4.876 0 .75.75 0 0 0 1.305.75A7.993 7.993 0 0 0 16 8a6 6 0 0 0-6-6Zm0 1.5a4.5 4.5 0 0 1 4.5 4.5c0 1.443-.346 2.8-.957 3.998a.75.75 0 0 1-1.336-.496c.5-1.05.793-2.18.793-3.502a3 3 0 1 0-6 0c0 1.322.293 2.452.793 3.502a.75.75 0 0 1-1.336.496A7.95 7.95 0 0 1 5.5 8a4.5 4.5 0 0 1 4.5-4.5ZM9.25 8a.75.75 0 0 1 .75-.75h.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1-.75-.75V8Zm1.5 0a.75.75 0 0 1 .75-.75h.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1-.75-.75V8Z" fill="currentColor"/>
      </svg>
      <span class="qcc-chatbot__toolbar-icon-label">快捷</span>
    `;
    quickPhrasesButton.addEventListener('click', (event: MouseEvent) => {
      event.stopPropagation();
      this.closeMcpMenu(); // 打开快捷菜单时关闭 MCP 菜单
      this.toggleQuickMenu();
    });
    this.quickPhrasesButtonEl = quickPhrasesButton;

    const inputRow = document.createElement('div');
    inputRow.className = 'qcc-chatbot__input-row';

    const textarea = document.createElement('textarea');
    textarea.className = 'qcc-chatbot__input';
    textarea.rows = 2;
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

    const hintText = document.createElement('span');
    hintText.textContent = '按 Enter 发送，Shift+Enter 换行';

    const hintActions = document.createElement('div');
    hintActions.className = 'qcc-chatbot__hint-actions';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'qcc-chatbot__plain-button';
    clearBtn.textContent = '清空';
    clearBtn.addEventListener('click', () => {
      // eslint-disable-next-line no-console
      console.log('[qcc-ai-chatbot] Clear button clicked');
      this.clearMessages();
      void this.resetServerConversation();
    });

    const loading = document.createElement('span');
    loading.className = 'qcc-chatbot__loading';
    const loadingLabel = document.createElement('span');
    loadingLabel.textContent = '思考中';
    this.loadingTextEl = loading;

    const loadingDots = document.createElement('span');
    loadingDots.className = 'qcc-chatbot__loading-dots';
    loadingDots.innerHTML =
      '<span class="qcc-chatbot__loading-dot"></span>' +
      '<span class="qcc-chatbot__loading-dot"></span>' +
      '<span class="qcc-chatbot__loading-dot"></span>';

    loading.appendChild(loadingLabel);
    loading.appendChild(loadingDots);

    hintActions.appendChild(clearBtn);
    hintActions.appendChild(loading);

    hint.appendChild(hintText);
    hint.appendChild(hintActions);

    const mcpMenu = document.createElement('div');
    mcpMenu.className = 'qcc-chatbot__mcp-menu';
    this.mcpMenuEl = mcpMenu;

    // --- 新增：快捷短语菜单
    const quickMenu = document.createElement('div');
    quickMenu.className = 'qcc-chatbot__quick-menu';
    this.quickMenuEl = quickMenu;

    toolbar.appendChild(mcpButton);
    toolbar.appendChild(mcpMenu);
    toolbar.appendChild(quickPhrasesButton);
    toolbar.appendChild(quickMenu);

    // 工具栏在输入区域上方
    inputArea.appendChild(toolbar);
    inputArea.appendChild(inputRow);
    inputArea.appendChild(hint);

    body.appendChild(messages);
    body.appendChild(toolStatus);

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(inputArea);

    root.appendChild(panel);
    root.appendChild(fab);
    root.appendChild(mask);
    this.shadow.appendChild(root);

    this.renderMessages();
    this.renderToolStatus();
    this.updateLoadingState();
    this.renderMcpMenu();
    this.renderQuickMenu();
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
    const root = this.rootEl;
    root.classList.toggle('qcc-chatbot--open', this.isOpen);
    root.classList.toggle('qcc-chatbot--closed', !this.isOpen);
    root.classList.toggle('qcc-chatbot--mobile', this.isMobileViewport);
    if (this.panelEl) {
      this.panelEl.setAttribute('aria-hidden', this.isOpen ? 'false' : 'true');
    }
    if (this.maskEl) {
      const shouldShowMask = this.isOpen && !this.isMobileViewport;
      this.maskEl.classList.toggle('qcc-chatbot__mask--visible', shouldShowMask);
      this.maskEl.setAttribute('aria-hidden', shouldShowMask ? 'false' : 'true');
    }
    if (this.fabButtonEl) {
      this.fabButtonEl.setAttribute('aria-expanded', this.isOpen ? 'true' : 'false');
      this.fabButtonEl.disabled = this.isMobileViewport;
    }
    if (this.closeButtonEl) {
      this.closeButtonEl.disabled = this.isMobileViewport;
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
      line.className = 'qcc-chatbot__message qcc-chatbot__message-line';
      line.dataset.messageId = msg.id;
      const bubble = document.createElement(
        'qcc-message-bubble'
      ) as unknown as QccMessageBubble;

      const role: MessageRole | 'system' =
        msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool'
          ? msg.role
          : 'system';

      bubble.setAttribute('role', role);
      if (role === 'user') {
        line.classList.add('qcc-chatbot__message--user');
      } else {
        line.classList.add('qcc-chatbot__message--assistant');
      }

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

  private updateStreamingBubbleContent(message: Message | undefined): boolean {
    if (!message || !this.messagesEl) return false;
    const bubble = this.messagesEl.querySelector(
      `[data-message-id="${message.id}"] qcc-message-bubble`
    );
    if (bubble) {
      bubble.textContent = message.content;
      return true;
    }
    return false;
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
    this.closeMcpMenu();

    if (!textFromApi && this.inputEl) {
      this.inputEl.value = '';
    }

    try {
      await this.engine.processMessage(text, {
        selectedMcpIds: this.selectedMcpIds,
      });
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

  private renderRobotIcon(): string {
    return `
      <span class="qcc-chatbot__fab-icon" aria-hidden="true">
        <svg viewBox="0 0 48 48" role="presentation">
          <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="14" width="30" height="20" rx="10"></rect>
            <path d="M9 26H4m40 0h-5M19 38h10"></path>
            <circle cx="19" cy="24" r="2"></circle>
            <circle cx="29" cy="24" r="2"></circle>
            <path d="M24 14V8"></path>
          </g>
        </svg>
      </span>
    `;
  }

  private initViewportWatcher(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 767px)');
    this.mediaQuery = media;
    this.applyViewportMode(media.matches);
    const handler = (event: MediaQueryListEvent | MediaQueryList): void => {
      this.applyViewportMode('matches' in event ? event.matches : media.matches);
    };
    this.mediaQueryHandler = handler;
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handler);
    } else if (typeof media.addListener === 'function') {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - legacy Safari
      media.addListener(handler);
    }
  }

  private cleanupViewportWatcher(): void {
    if (this.mediaQuery && this.mediaQueryHandler) {
      if (typeof this.mediaQuery.removeEventListener === 'function') {
        this.mediaQuery.removeEventListener('change', this.mediaQueryHandler);
      } else if (typeof this.mediaQuery.removeListener === 'function') {
        this.mediaQuery.removeListener(this.mediaQueryHandler);
      }
    }
    this.mediaQuery = null;
    this.mediaQueryHandler = null;
  }

  private applyViewportMode(isMobile: boolean): void {
    this.isMobileViewport = isMobile;
    if (isMobile) {
      this.isOpen = true;
    }
    this.updateOpenState();
  }

  // =========================
  // MCP 菜单相关
  // =========================

  private async fetchMcpListIfPossible(): Promise<void> {
    const core = this.buildCoreConfig();
    const proxyUrl = core?.proxyUrl || '';
    if (!proxyUrl) return;

    try {
      const normalizedProxyUrl = proxyUrl.endsWith('/') ? proxyUrl.slice(0, -1) : proxyUrl;
      const resp = await fetch(`${normalizedProxyUrl}/mcp/list`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!resp.ok) {
        if (this.debug) {
          // eslint-disable-next-line no-console
          console.warn('qcc-ai-chatbot: Failed to fetch MCP list', resp.status, resp.statusText);
        }
        return;
      }
      const data = (await resp.json()) as { mcpList?: string[] };
      if (Array.isArray(data.mcpList)) {
        this.allMcpList = data.mcpList;
        this.renderMcpMenu();
      }
    } catch (error) {
      if (this.debug) {
        const formatted = formatError(error as Error);
        // eslint-disable-next-line no-console
        console.error('qcc-ai-chatbot: Error fetching MCP list', formatted);
      }
    }
  }

  private renderMcpMenu(): void {
    if (!this.mcpMenuEl) return;
    const menu = this.mcpMenuEl;
    menu.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'qcc-chatbot__mcp-menu-title';
    title.textContent = '选择 MCP';
    menu.appendChild(title);

    if (!this.allMcpList.length) {
      const empty = document.createElement('div');
      empty.className = 'qcc-chatbot__mcp-menu-empty';
      empty.textContent = '暂无可用 MCP';
      menu.appendChild(empty);
    } else {
      const list = document.createElement('div');
      list.className = 'qcc-chatbot__mcp-menu-list';

      for (const mcpId of this.allMcpList) {
        const item = document.createElement('label');
        item.className = 'qcc-chatbot__mcp-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = this.selectedMcpIds.includes(mcpId);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            if (!this.selectedMcpIds.includes(mcpId)) {
              this.selectedMcpIds = [...this.selectedMcpIds, mcpId];
            }
          } else {
            this.selectedMcpIds = this.selectedMcpIds.filter((id) => id !== mcpId);
          }
        });

        const labelText = document.createElement('span');
        labelText.textContent = mcpId;

        item.appendChild(checkbox);
        item.appendChild(labelText);
        list.appendChild(item);
      }

      menu.appendChild(list);
    }

    this.updateMcpMenuVisibility();
  }

  private toggleMcpMenu(): void {
    this.isMcpMenuOpen = !this.isMcpMenuOpen;
    this.updateMcpMenuVisibility();
  }

  private closeMcpMenu(): void {
    if (!this.isMcpMenuOpen) return;
    this.isMcpMenuOpen = false;
    this.updateMcpMenuVisibility();
  }

  private updateMcpMenuVisibility(): void {
    if (!this.mcpMenuEl) return;
    if (this.isMcpMenuOpen) {
      this.mcpMenuEl.classList.add('qcc-chatbot__mcp-menu--open');
    } else {
      this.mcpMenuEl.classList.remove('qcc-chatbot__mcp-menu--open');
    }
  }

  private initDocumentClickListener(): void {
    if (this.documentClickHandler) return;
    this.documentClickHandler = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      const path = (event.composedPath && event.composedPath()) || [];

      // MCP 菜单相关判断
      const clickedOnMcpMenu =
        (this.mcpMenuEl && path.includes(this.mcpMenuEl)) ||
        (this.mcpMenuEl && this.mcpMenuEl.contains(target));
      const clickedOnMcpIcon =
        (this.mcpIconButtonEl && path.includes(this.mcpIconButtonEl)) ||
        (this.mcpIconButtonEl && this.mcpIconButtonEl.contains(target));

      // 快捷短语菜单相关判断
      const clickedOnQuickMenu =
        (this.quickMenuEl && path.includes(this.quickMenuEl)) ||
        (this.quickMenuEl && this.quickMenuEl.contains(target));
      const clickedOnQuickIcon =
        (this.quickPhrasesButtonEl && path.includes(this.quickPhrasesButtonEl)) ||
        (this.quickPhrasesButtonEl && this.quickPhrasesButtonEl.contains(target));

      // 关闭 MCP 菜单（如果点击在外部）
      if (this.isMcpMenuOpen && !clickedOnMcpMenu && !clickedOnMcpIcon) {
        this.closeMcpMenu();
      }

      // 关闭快捷短语菜单（如果点击在外部）
      if (this.isQuickMenuOpen && !clickedOnQuickMenu && !clickedOnQuickIcon) {
        this.closeQuickMenu();
      }
    };
    document.addEventListener('click', this.documentClickHandler, true);
  }

  private cleanupDocumentClickListener(): void {
    if (this.documentClickHandler) {
      document.removeEventListener('click', this.documentClickHandler, true);
      this.documentClickHandler = null;
    }
  }

  // =========================
  // 快捷短语菜单相关
  // =========================

  private renderQuickMenu(): void {
    if (!this.quickMenuEl) return;
    const menu = this.quickMenuEl;
    menu.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'qcc-chatbot__quick-menu-title';
    title.textContent = '选择快捷短语';
    menu.appendChild(title);

    if (!this.quickPhrases.length) {
      const empty = document.createElement('div');
      empty.className = 'qcc-chatbot__quick-menu-empty';
      empty.textContent = '暂无快捷短语';
      menu.appendChild(empty);
    } else {
      const list = document.createElement('div');
      list.className = 'qcc-chatbot__quick-menu-list';

      for (const phrase of this.quickPhrases) {
        const item = document.createElement('div');
        item.className = 'qcc-chatbot__quick-item';
        item.textContent = phrase.name;
        item.addEventListener('click', async () => {
          this.closeQuickMenu();
          await this.sendMessage(phrase.content);
        });
        list.appendChild(item);
      }

      menu.appendChild(list);
    }

    this.updateQuickMenuVisibility();
  }

  private toggleQuickMenu(): void {
    this.isQuickMenuOpen = !this.isQuickMenuOpen;
    this.updateQuickMenuVisibility();
  }

  private closeQuickMenu(): void {
    if (!this.isQuickMenuOpen) return;
    this.isQuickMenuOpen = false;
    this.updateQuickMenuVisibility();
  }

  private updateQuickMenuVisibility(): void {
    if (!this.quickMenuEl) return;
    if (this.isQuickMenuOpen) {
      this.quickMenuEl.classList.add('qcc-chatbot__quick-menu--open');
    } else {
      this.quickMenuEl.classList.remove('qcc-chatbot__quick-menu--open');
    }
  }

  // =========================
  // 服务端会话重置
  // =========================

  private async resetServerConversation(): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[qcc-ai-chatbot] resetServerConversation called');
    
    // 直接获取 proxy-url 属性，不依赖 buildCoreConfig
    const proxyUrl = this.getAttribute('proxy-url') || '';
    
    // eslint-disable-next-line no-console
    console.log('[qcc-ai-chatbot] proxy-url attribute:', proxyUrl);
    
    if (!proxyUrl) {
      // eslint-disable-next-line no-console
      console.warn('[qcc-ai-chatbot] Cannot reset server conversation: proxy-url attribute is missing');
      return;
    }

    try {
      const normalizedProxyUrl = proxyUrl.endsWith('/') ? proxyUrl.slice(0, -1) : proxyUrl;
      const url = `${normalizedProxyUrl}/conversation/reset`;
      
      // eslint-disable-next-line no-console
      console.log('[qcc-ai-chatbot] Resetting server conversation:', url);
      
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: null,
        }),
      });

      if (!resp.ok) {
        // eslint-disable-next-line no-console
        console.warn('[qcc-ai-chatbot] Failed to reset server conversation:', resp.status, resp.statusText);
        return;
      }

      // eslint-disable-next-line no-console
      console.log('[qcc-ai-chatbot] Server conversation reset successfully');
    } catch (error) {
      const formatted = formatError(error as Error);
      // eslint-disable-next-line no-console
      console.error('[qcc-ai-chatbot] Error resetting server conversation:', formatted);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'qcc-ai-chatbot': QccAiChatbot;
  }
}
