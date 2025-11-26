/**
 * LLM 客户端
 * 统一的多提供商 LLM 客户端，支持 baseUrl 自动推断
 */

import type { ChatRequest, NormalizedConfig, ParsedStreamData, FunctionDefinition } from '../types';
import { ApiCallError, NetworkError, withTimeout } from './errorHandler';
import { logger } from './Logger';
import { UnifiedStreamParser } from './UnifiedStreamParser';
import type { StreamFormat } from './UnifiedStreamParser';

export interface LLMResponse {
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: any;
  }>;
  finishReason?: string | null;
}

export class LLMClient {
  private config: NormalizedConfig;

  constructor(config: NormalizedConfig) {
    this.config = config;
  }

  /**
   * 聊天接口（流式）
   */
  async chatStream(
    messages: ChatRequest['messages'],
    tools?: FunctionDefinition[]
  ): Promise<ReadableStream<Uint8Array>> {
    const request: ChatRequest = {
      model: this.config.model,
      messages,
      tools: tools ? tools.map((f) => ({ type: 'function' as const, function: f })) : undefined,
      tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
      stream: true,
    };

    logger.logLLMRequest(this.config.provider, this.config.model, messages, tools);

    try {
      const stream = await withTimeout(
        async () => {
          return await this.makeRequest(request, true);
        },
        this.config.llmTimeout,
        `LLM chat: ${this.config.provider}`
      );

      logger.logLLMResponse(this.config.provider, true);
      return stream as ReadableStream<Uint8Array>;
    } catch (error) {
      logger.error('LLMClient', 'Chat request failed:', error);
      throw error;
    }
  }

  /**
   * 聊天接口（非流式）
   */
  async chat(
    messages: ChatRequest['messages'],
    tools?: FunctionDefinition[]
  ): Promise<LLMResponse> {
    const request: ChatRequest = {
      model: this.config.model,
      messages,
      tools: tools ? tools.map((f) => ({ type: 'function' as const, function: f })) : undefined,
      tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
      stream: false,
    };

    logger.logLLMRequest(this.config.provider, this.config.model, messages, tools);

    try {
      const response = await withTimeout(
        async () => {
          return await this.makeRequest(request, false);
        },
        this.config.llmTimeout,
        `LLM chat: ${this.config.provider}`
      );

      logger.logLLMResponse(this.config.provider, false);
      return response as LLMResponse;
    } catch (error) {
      logger.error('LLMClient', 'Chat request failed:', error);
      throw error;
    }
  }

  /**
   * 发起请求
   */
  private async makeRequest(
    request: ChatRequest,
    stream: boolean = true
  ): Promise<ReadableStream<Uint8Array> | LLMResponse> {
    const baseUrl = this.config.baseUrl || this.config.proxyUrl;

    if (!baseUrl) {
      throw new ApiCallError('LLM base URL is not configured', 'MISSING_BASE_URL');
    }

    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const url = `${normalizedBaseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    console.log('this.config', this.config);
    console.log('+++++++++++++++++++++++++++++')
    // 添加认证头
    if (this.config.apiKey) {
      if (this.config.provider === 'gemini') {
        headers['x-goog-api-key'] = this.config.apiKey;
      } else if (this.config.provider === 'qwen') {
        console.log('qwen', this.config.apiKey);
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        headers['X-DashScope-SSE'] = 'enable'; // DashScope 需要这个头
      } else {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new ApiCallError(
        `LLM API error: ${response.status} ${response.statusText}. ${errorText}`,
        `HTTP_${response.status}`,
        { status: response.status, statusText: response.statusText, body: errorText }
      );
    }

    if (stream) {
      if (!response.body) {
        throw new NetworkError('Response body is null', 'NO_RESPONSE_BODY');
      }
      return response.body;
    } else {
      const data = await response.json();
      return this.parseResponse(data);
    }
  }

  /**
   * 解析非流式响应
   */
  private parseResponse(data: any): LLMResponse {
    const choice = data.choices?.[0];
    if (!choice) {
      throw new ApiCallError('Invalid response format: no choices', 'INVALID_RESPONSE');
    }

    const message = choice.message || choice;
    const result: LLMResponse = {
      content: message.content || '',
      finishReason: choice.finish_reason,
    };

    // 解析工具调用
    if (message.tool_calls && message.tool_calls.length > 0) {
      result.toolCalls = message.tool_calls.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || '{}'),
      }));
    }

    return result;
  }

  /**
   * 获取流格式
   */
  getStreamFormat(): StreamFormat {
    // Ollama 使用 JSONL，其他使用 SSE
    return this.config.provider === 'ollama' ? 'jsonl' : 'sse';
  }

  /**
   * 创建流解析器
   */
  createStreamParser(onToken?: (data: ParsedStreamData) => void): UnifiedStreamParser {
    return new UnifiedStreamParser({
      format: this.getStreamFormat(),
      onToken,
    });
  }
}
