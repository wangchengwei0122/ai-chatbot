/**
 * AI 引擎
 * 通过 Proxy Server 调用 MCP 和 LLM，所有逻辑在服务器端
 */

import type { Message, NormalizedConfig } from '../types';
import { EventEmitter } from './EventEmitter';
import { logger } from './Logger';
import { formatError } from './errorHandler';

export class AiEngine {
  private config: NormalizedConfig;
  private eventEmitter: EventEmitter;
  private messages: Message[] = [];
  private currentAbortController: AbortController | null = null;

  constructor(config: NormalizedConfig, eventEmitter: EventEmitter) {
    this.config = config;
    this.eventEmitter = eventEmitter;
  }

  /**
   * 初始化（兼容接口，实际不需要初始化）
   */
  async initialize(): Promise<void> {
    // 通过 Proxy Server，不需要初始化
    logger.debug('AiEngine', 'Using Proxy Server, no initialization needed');
  }

  /**
   * 处理用户消息（主入口）
   */
  async processMessage(
    userMessage: string,
    options?: { mcp?: string; selectedMcpIds?: string[] }
  ): Promise<void> {
    try {
      // 添加用户消息
      const userMsg: Message = {
        id: this.generateId(),
        role: 'user',
        content: userMessage,
        createdAt: Date.now(),
      };
      this.addMessage(userMsg);
      this.eventEmitter.emit('message', userMsg);

      // 调用 Proxy Server 的 /mcp/send-message 接口
      await this.processWithProxyServer([userMsg], {
        mcp: options?.mcp,
        selectedMcpIds: options?.selectedMcpIds,
      });
    } catch (error) {
      const formattedError = formatError(error);
      logger.error('AiEngine', 'Process message failed:', formattedError);
      this.eventEmitter.emit('error', formattedError);
      if (this.config.onError) {
        this.config.onError(formattedError);
      }
    }
  }

  /**
   * 通过 Proxy Server 处理消息
   */
  private async processWithProxyServer(
    conversationMessages: Message[],
    options?: { mcp?: string; selectedMcpIds?: string[] }
  ): Promise<void> {
    if (!this.config.proxyUrl) {
      throw new Error('proxyUrl is required');
    }

    // 转换为 Proxy Server 需要的消息格式
    const llmMessages = this.convertToLLMMessages(conversationMessages);

    // 创建助手消息（用于累积内容）
    const assistantMsg: Message = {
      id: this.generateId(),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
    };
    this.addMessage(assistantMsg);

    // 创建 AbortController 用于取消请求
    this.currentAbortController = new AbortController();

    try {
      // 调用 Proxy Server
      const body: {
        provider: string;
        model: string;
        messages: ReturnType<AiEngine['convertToLLMMessages']>;
        selectedMcpIds: string[];
      } = {
        provider: this.config.provider,
        model: this.config.model,
        messages: llmMessages,
        selectedMcpIds: options?.selectedMcpIds ?? [],
      };

      const response = await fetch(`${this.config.proxyUrl}/mcp/send-message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: this.currentAbortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Proxy Server error: ${response.status} ${response.statusText}. ${errorText}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      // 读取 SSE 流
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let accumulatedContent = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                break;
              }

              try {
                const parsed = JSON.parse(data);
                
                // 处理 token
                if (parsed.type === 'token' && parsed.data) {
                  accumulatedContent += parsed.data;
                  assistantMsg.content = accumulatedContent;
                  this.eventEmitter.emit('token', parsed.data);
                  if (this.config.onToken) {
                    this.config.onToken(parsed.data);
                  }
                }

                // 处理工具调用
                if (parsed.type === 'tool_call' && parsed.data) {
                  this.eventEmitter.emit('toolCall', parsed.data.name, parsed.data.arguments);
                  if (this.config.onToolCall) {
                    this.config.onToolCall(parsed.data.name, parsed.data.arguments);
                  }
                }

                // 处理完成
                if (parsed.type === 'finish') {
                  break;
                }

                // 处理错误
                if (parsed.type === 'error') {
                  throw new Error(parsed.data?.error || 'Unknown error');
                }
              } catch (error) {
                // 忽略解析错误，继续处理
                if (error instanceof Error && error.message.includes('Proxy Server error')) {
                  throw error;
                }
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // 更新助手消息
      assistantMsg.content = accumulatedContent;
      this.eventEmitter.emit('message', assistantMsg);

      // 完成
      this.eventEmitter.emit('finish');
      if (this.config.onFinish) {
        this.config.onFinish();
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logger.debug('AiEngine', 'Request aborted');
        return;
      }
      throw error;
    } finally {
      this.currentAbortController = null;
    }
  }

  /**
   * 转换为 LLM 消息格式
   */
  private convertToLLMMessages(messages: Message[]): Array<{
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string;
      };
    }>;
    tool_call_id?: string;
    name?: string;
  }> {
    return messages.map((msg) => {
      if (msg.role === 'user') {
        return {
          role: 'user' as const,
          content: msg.content,
        };
      } else if (msg.role === 'assistant') {
        const result: any = {
          role: 'assistant' as const,
          content: msg.content || null,
        };
        if (msg.tool_call) {
          result.tool_calls = [
            {
              id: msg.tool_call.id || this.generateId(),
              type: 'function' as const,
              function: {
                name: msg.tool_call.name,
                arguments: JSON.stringify(msg.tool_call.arguments),
              },
            },
          ];
        }
        return result;
      } else if (msg.role === 'tool') {
        return {
          role: 'tool' as const,
          content: msg.content,
          tool_call_id: msg.tool_result?.tool_call_id,
          name: msg.tool_result?.name,
        };
      }
      return {
        role: 'user' as const,
        content: msg.content,
      };
    });
  }

  /**
   * 添加消息（带截断策略）
   */
  private addMessage(message: Message): void {
    this.messages.push(message);

    // 消息截断策略：保留最近 N 条消息
    if (this.messages.length > this.config.maxMessages) {
      const removeCount = this.messages.length - this.config.maxMessages;
      this.messages.splice(0, removeCount);
      logger.debug('AiEngine', `Truncated ${removeCount} old messages`);
    }
  }

  /**
   * 获取消息列表
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * 清空消息
   */
  clearMessages(): void {
    this.messages = [];
  }

  /**
   * 停止当前流
   */
  async stopStream(): Promise<void> {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    await this.stopStream();
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
