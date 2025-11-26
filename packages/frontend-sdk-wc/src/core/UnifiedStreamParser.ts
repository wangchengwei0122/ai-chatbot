/**
 * 统一流式解析器
 * 解析不同提供商的流式响应格式
 */

import type { StreamChunk, ParsedStreamData } from '../types';
import { StreamParseError } from './errorHandler';
import { logger } from './Logger';

export type StreamFormat = 'sse' | 'jsonl';

export interface StreamParserOptions {
  format?: StreamFormat;
  onToken?: (data: ParsedStreamData) => void;
}

export class UnifiedStreamParser {
  private format: StreamFormat;
  private onToken?: (data: ParsedStreamData) => void;
  private buffer: string = '';
  private currentToolCall: {
    id?: string;
    name?: string;
    arguments?: string;
  } | null = null;

  constructor(options: StreamParserOptions = {}) {
    this.format = options.format || 'sse';
    this.onToken = options.onToken;
  }

  /**
   * 解析 SSE 格式流
   */
  private parseSSE(chunk: string): ParsedStreamData[] {
    const results: ParsedStreamData[] = [];
    this.buffer += chunk;

    // 按行分割
    const lines = this.buffer.split('\n');
    // 保留最后一个不完整的行
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) {
        continue;
      }

      const jsonStr = trimmed.slice(6); // 移除 'data: ' 前缀
      if (jsonStr === '[DONE]') {
        continue;
      }

      try {
        const data: StreamChunk = JSON.parse(jsonStr);
        const parsed = this.parseChunk(data);
        if (parsed) {
          results.push(parsed);
        }
      } catch (error) {
        logger.warn('StreamParser', 'Failed to parse SSE chunk:', error);
        // 继续处理下一行，不中断
      }
    }

    return results;
  }

  /**
   * 解析 JSON Lines 格式流（Ollama）
   */
  private parseJSONL(chunk: string): ParsedStreamData[] {
    const results: ParsedStreamData[] = [];
    this.buffer += chunk;

    // 按行分割
    const lines = this.buffer.split('\n');
    // 保留最后一个不完整的行
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        const data: StreamChunk = JSON.parse(trimmed);
        const parsed = this.parseChunk(data);
        if (parsed) {
          results.push(parsed);
        }
      } catch (error) {
        logger.warn('StreamParser', 'Failed to parse JSONL chunk:', error);
        // 继续处理下一行
      }
    }

    return results;
  }

  /**
   * 解析单个 chunk
   */
  private parseChunk(chunk: StreamChunk): ParsedStreamData | null {
    logger.logStreamParse(chunk);

    const choice = chunk.choices?.[0];
    if (!choice) {
      return null;
    }

    const delta = choice.delta;
    if (!delta) {
      return null;
    }

    const result: ParsedStreamData = {};

    // 处理内容增量
    if (delta.content) {
      result.content = delta.content;
    }

    // 处理工具调用增量（chunked function_call 拼接）
    if (delta.tool_calls && delta.tool_calls.length > 0) {
      for (const toolCallDelta of delta.tool_calls) {
        if (toolCallDelta.id) {
          // 新的工具调用开始
          if (!this.currentToolCall || this.currentToolCall.id !== toolCallDelta.id) {
            this.currentToolCall = {
              id: toolCallDelta.id,
              name: toolCallDelta.function?.name || '',
              arguments: toolCallDelta.function?.arguments || '',
            };
          }
        }

        if (this.currentToolCall) {
          // 拼接函数名称
          if (toolCallDelta.function?.name) {
            this.currentToolCall.name = toolCallDelta.function.name;
          }

          // 拼接函数参数（可能是分块的）
          if (toolCallDelta.function?.arguments) {
            this.currentToolCall.arguments = (this.currentToolCall.arguments || '') + toolCallDelta.function.arguments;
          }

          // 如果工具调用完成，添加到结果中
          if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'function_call') {
            result.toolCall = {
              id: this.currentToolCall.id,
              name: this.currentToolCall.name,
              arguments: this.currentToolCall.arguments,
            };
            this.currentToolCall = null;
          }
        }
      }
    }

    // 处理完成原因
    if (choice.finish_reason) {
      result.finishReason = choice.finish_reason;
    }

    return Object.keys(result).length > 0 ? result : null;
  }

  /**
   * 解析流数据
   */
  parse(chunk: string): ParsedStreamData[] {
    try {
      if (this.format === 'sse') {
        return this.parseSSE(chunk);
      } else {
        return this.parseJSONL(chunk);
      }
    } catch (error) {
      throw new StreamParseError(
        `Failed to parse stream: ${error instanceof Error ? error.message : String(error)}`,
        'PARSE_ERROR',
        { format: this.format, chunk, error }
      );
    }
  }

  /**
   * 处理流式响应
   */
  async processStream(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // 处理缓冲区中剩余的数据
          if (this.buffer.trim()) {
            const results = this.parse(this.buffer);
            for (const result of results) {
              if (this.onToken) {
                this.onToken(result);
              }
            }
          }
          break;
        }

        // 解码数据块并追加到缓冲区
        const chunk = decoder.decode(value, { stream: true });
        this.buffer += chunk;

        // 解析数据（parse 方法会更新 this.buffer，保留未完成的行）
        const results = this.parse(this.buffer);

        // 触发回调
        for (const result of results) {
          if (this.onToken) {
            this.onToken(result);
          }
        }
      }
    } catch (error) {
      throw new StreamParseError(
        `Stream processing error: ${error instanceof Error ? error.message : String(error)}`,
        'STREAM_PROCESSING_ERROR',
        { error }
      );
    }
  }

  /**
   * 重置解析器状态
   */
  reset(): void {
    this.buffer = '';
    this.currentToolCall = null;
  }
}
