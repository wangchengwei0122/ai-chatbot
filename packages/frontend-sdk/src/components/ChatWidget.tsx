import { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { useMcpClient, type ChatMessage } from '../lib/useMcpClient';
import './ChatWidget.css';

export interface ChatWidgetProps {
  proxyUrl: string;
  mcp?: string;
  provider: 'openai' | 'deepseek' | 'gemini' | 'qwen' | 'ollama';
  model: string;
  title?: string;
  themeColor?: string;
  debug?: boolean;
}

export interface ChatWidgetRef {
  open: () => void;
  close: () => void;
  minimize: () => void;
  clear: () => void;
  ask: (question: string) => void;
}

const ChatWidget = forwardRef<ChatWidgetRef, ChatWidgetProps>(
  ({ proxyUrl, mcp, model, provider = 'openai', title = 'AI 智能客服', themeColor = '#1677ff', debug = false }, ref) => {
    const [isOpen, setIsOpen] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const { messages, sendMessage, clear: clearMessages } = useMcpClient({
      proxyUrl,
      mcp,
      model,
      provider,
      debug,
    });

    // 暴露方法给父组件
    useImperativeHandle(ref, () => ({
      open: () => {
        setIsOpen(true);
        setIsMinimized(false);
      },
      close: () => {
        setIsOpen(false);
        setIsMinimized(false);
      },
      minimize: () => {
        setIsMinimized(true);
      },
      clear: () => {
        clearMessages();
      },
      ask: (question: string) => {
        if (question.trim()) {
          handleSendMessage(question);
          setIsOpen(true);
          setIsMinimized(false);
        }
      },
    }));

    // 自动滚动到底部
    useEffect(() => {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }, [messages, isLoading]);

    // 应用主题色
    useEffect(() => {
      if (typeof document !== 'undefined') {
        const style = document.createElement('style');
        style.textContent = `
          .chatbot-toggle-button,
          .chatbot-header,
          .chatbot-send-button {
            background: ${themeColor} !important;
          }
          .chatbot-toggle-button:hover,
          .chatbot-send-button:hover:not(:disabled) {
            background: ${adjustBrightness(themeColor, 20)} !important;
          }
          .chatbot-input:focus {
            border-color: ${themeColor} !important;
            box-shadow: 0 0 0 2px ${hexToRgba(themeColor, 0.1)} !important;
          }
        `;
        document.head.appendChild(style);
        return () => {
          document.head.removeChild(style);
        };
      }
    }, [themeColor]);

    const handleSendMessage = async (text?: string) => {
      const messageText = text || inputValue.trim();
      if (!messageText || isLoading) return;

      setInputValue('');
      setIsLoading(true);

      try {
        await sendMessage(messageText);
      } finally {
        setIsLoading(false);
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    };

    const handleToggle = () => {
      if (isOpen) {
        setIsMinimized(!isMinimized);
      } else {
        setIsOpen(true);
        setIsMinimized(false);
      }
    };

    // 检查是否有正在进行的流式响应
    const hasActiveStream = isLoading || 
      (messages.length > 0 && messages[messages.length - 1]?.role === 'assistant' && 
       messages[messages.length - 1]?.content === '');

    return (
      <div className="chatbot-container">
        {!isOpen && (
          <button
            className="chatbot-toggle-button"
            onClick={handleToggle}
            aria-label="打开聊天"
          >
            💬
          </button>
        )}

        {isOpen && (
          <div className={`chatbot-window ${isMinimized ? 'minimized' : ''}`}>
            <div className="chatbot-header">
              <h3 className="chatbot-header-title">{title}</h3>
              <div className="chatbot-header-actions">
                <button
                  className="chatbot-header-button"
                  onClick={() => setIsMinimized(!isMinimized)}
                  aria-label="最小化"
                >
                  {isMinimized ? '□' : '−'}
                </button>
                <button
                  className="chatbot-header-button"
                  onClick={() => {
                    setIsOpen(false);
                    setIsMinimized(false);
                  }}
                  aria-label="关闭"
                >
                  ×
                </button>
              </div>
            </div>

            {!isMinimized && (
              <>
                <div className="chatbot-body" ref={bodyRef}>
                  {messages.length === 0 && (
                    <div style={{ textAlign: 'center', color: '#999', marginTop: '40px' }}>
                      欢迎使用 AI 智能客服，有什么可以帮您的吗？
                    </div>
                  )}

                  {messages.map((message: ChatMessage, index: number) => (
                    <div
                      key={index}
                      className={`chatbot-message ${message.role}`}
                    >
                      <div className="chatbot-message-bubble">
                        {message.content || (message.role === 'assistant' ? '正在思考...' : '')}
                      </div>
                    </div>
                  ))}

                  {hasActiveStream && (
                    <div className="chatbot-message assistant">
                      <div className="chatbot-typing">
                        <div className="chatbot-typing-dot"></div>
                        <div className="chatbot-typing-dot"></div>
                        <div className="chatbot-typing-dot"></div>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                <div className="chatbot-footer">
                  <div className="chatbot-input-wrapper">
                    <textarea
                      ref={inputRef}
                      className="chatbot-input"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
                      rows={1}
                      disabled={isLoading}
                    />
                  </div>
                  <button
                    className="chatbot-send-button"
                    onClick={() => handleSendMessage()}
                    disabled={!inputValue.trim() || isLoading}
                  >
                    发送
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  }
);

ChatWidget.displayName = 'ChatWidget';

// 工具函数：调整颜色亮度
function adjustBrightness(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + percent);
  const g = Math.min(255, ((num >> 8) & 0x00ff) + percent);
  const b = Math.min(255, (num & 0x0000ff) + percent);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// 工具函数：十六进制转 rgba
function hexToRgba(hex: string, alpha: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 0x00ff;
  const b = num & 0x0000ff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default ChatWidget;

