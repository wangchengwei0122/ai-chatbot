import type { MessageRole } from '../types';

/**
 * 单条消息气泡组件
 * 说明：不创建独立 Shadow DOM，而是挂在父级 Shadow DOM 下，
 * 这样可以复用父组件注入的样式，同时仍然是自定义元素。
 */
export class QccMessageBubble extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['role', 'state', 'streaming'];
  }

  // 避免与 HTMLElement 自身的 role 属性冲突，使用内部字段名
  private _role: MessageRole | 'system' = 'assistant';
  private _state: 'normal' | 'error' = 'normal';
  private _streaming = false;

  constructor() {
    super();
  }

  connectedCallback(): void {
    this.updateFromAttributes();
    this.updateClasses();
  }

  attributeChangedCallback(): void {
    this.updateFromAttributes();
    this.updateClasses();
  }

  private updateFromAttributes(): void {
    const roleAttr = this.getAttribute('role') as MessageRole | 'system' | null;
    if (roleAttr) {
      this._role = roleAttr;
    }
    const stateAttr = this.getAttribute('state');
    this._state = stateAttr === 'error' ? 'error' : 'normal';
    this._streaming = this.hasAttribute('streaming');
  }

  private updateClasses(): void {
    const base = 'qcc-chatbot__bubble';
    const classes = new Set<string>([base]);

    if (this._role === 'user') {
      classes.add(`${base}--user`);
    } else if (this._role === 'assistant') {
      classes.add(`${base}--assistant`);
    } else if (this._role === 'tool') {
      classes.add(`${base}--tool`);
    } else if (this._role === 'system') {
      classes.add(`${base}--system`);
    }

    if (this._state === 'error') {
      classes.add(`${base}--error`);
    }

    if (this._streaming) {
      classes.add(`${base}--streaming`);
    }

    this.className = Array.from(classes).join(' ');
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'qcc-message-bubble': QccMessageBubble;
  }
}

if (!customElements.get('qcc-message-bubble')) {
  customElements.define('qcc-message-bubble', QccMessageBubble);
}

