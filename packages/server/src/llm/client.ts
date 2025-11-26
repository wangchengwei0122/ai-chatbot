/**
 * LLM 客户端（服务器端）
 * 支持多个 LLM 提供商，API Key 从环境变量加载
 */

export type LLMProvider = 'openai' | 'deepseek' | 'gemini' | 'qwen' | 'ollama';

export interface LLMConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface ChatMessage {
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
}

export interface FunctionDefinition {
  name: string;
  description?: string;
  parameters: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

export interface LLMResponse {
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: any;
  }>;
  finishReason?: string | null;
}

type ChatCompletionToolCall = {
  id?: string;
  function: {
    name: string;
    arguments: string;
  };
};

type ChatCompletionMessage = {
  content?: string | null;
  tool_calls?: ChatCompletionToolCall[];
};

/**
 * Provider 的 baseUrl 映射
 */
const PROVIDER_BASE_URLS: Record<LLMProvider, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  ollama: 'http://localhost:11434/v1',
};

/**
 * 从环境变量加载 LLM 配置
 */
export function loadLlmConfig(): Record<LLMProvider, LLMConfig> {
  const config: Record<string, LLMConfig> = {};
  
  const llmConfigJson = process.env.LLM_CONFIG;
  if (!llmConfigJson) {
    console.warn('[LLM Client] LLM_CONFIG not found in environment variables');
    return config as Record<LLMProvider, LLMConfig>;
  }

  try {
    const parsed = JSON.parse(llmConfigJson);
    
    for (const [provider, providerConfig] of Object.entries(parsed)) {
      if (providerConfig && typeof providerConfig === 'object' && 'apiKey' in providerConfig) {
        config[provider] = {
          apiKey: (providerConfig as any).apiKey,
          baseUrl: (providerConfig as any).baseUrl,
        };
        console.log(`[LLM Client] Loaded config for provider: ${provider}`);
      }
    }
  } catch (error) {
    console.error('[LLM Client] Failed to parse LLM_CONFIG:', error);
  }

  return config as Record<LLMProvider, LLMConfig>;
}

/**
 * LLM 客户端
 */
export class LLMClient {
  private config: Record<LLMProvider, LLMConfig>;
  private provider: LLMProvider;
  private model: string;

  constructor(provider: LLMProvider, model: string) {
    this.config = loadLlmConfig();
    this.provider = provider;
    this.model = model;

    // 验证配置
    if (!this.config[provider]?.apiKey && provider !== 'ollama') {
      throw new Error(`API Key not found for provider: ${provider}. Please configure LLM_CONFIG environment variable.`);
    }
  }

  /**
   * 聊天接口（流式）
   */
  async chatStream(
    messages: ChatMessage[],
    tools?: FunctionDefinition[]
  ): Promise<ReadableStream<Uint8Array>> {
    const baseUrl = this.config[this.provider]?.baseUrl || PROVIDER_BASE_URLS[this.provider];
    const apiKey = this.config[this.provider]?.apiKey || '';

    const url = `${baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // 添加认证头
    if (apiKey) {
      if (this.provider === 'gemini') {
        headers['x-goog-api-key'] = apiKey;
      } else if (this.provider === 'qwen') {
        headers['Authorization'] = `Bearer ${apiKey}`;
        headers['X-DashScope-SSE'] = 'enable';
      } else {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
    }

    const requestBody: any = {
      model: this.model,
      messages,
      stream: true,
    };

    if (tools && tools.length > 0) {
      requestBody.tools = tools.map((f) => ({ type: 'function' as const, function: f }));
      requestBody.tool_choice = 'auto';
      console.log(`[LLM Client] ${this.provider}/${this.model} - Including ${tools.length} tools in request`);
    }

    console.log(`[LLM Client] ${this.provider}/${this.model} - Sending request:`, {
      url,
      messagesCount: messages.length,
      toolsCount: tools?.length || 0,
      hasApiKey: !!apiKey,
    });

    const startTime = Date.now();
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
    const fetchTime = Date.now() - startTime;

    console.log(`[LLM Client] ${this.provider}/${this.model} - Response received:`, {
      status: response.status,
      statusText: response.statusText,
      fetchTime: `${fetchTime}ms`,
      hasBody: !!response.body,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(`[LLM Client] ${this.provider}/${this.model} - API error:`, {
        status: response.status,
        statusText: response.statusText,
        errorText,
      });
      throw new Error(`LLM API error: ${response.status} ${response.statusText}. ${errorText}`);
    }

    if (!response.body) {
      console.error(`[LLM Client] ${this.provider}/${this.model} - Response body is null`);
      throw new Error('Response body is null');
    }

    console.log(`[LLM Client] ${this.provider}/${this.model} - Returning stream`);
    return response.body;
  }

  /**
   * 聊天接口（非流式）
   */
  async chat(
    messages: ChatMessage[],
    tools?: FunctionDefinition[]
  ): Promise<LLMResponse> {
    const baseUrl = this.config[this.provider]?.baseUrl || PROVIDER_BASE_URLS[this.provider];
    const apiKey = this.config[this.provider]?.apiKey || '';

    const url = `${baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // 添加认证头
    if (apiKey) {
      if (this.provider === 'gemini') {
        headers['x-goog-api-key'] = apiKey;
      } else if (this.provider === 'qwen') {
        headers['Authorization'] = `Bearer ${apiKey}`;
      } else {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
    }

    const requestBody: any = {
      model: this.model,
      messages,
      stream: false,
    };

    if (tools && tools.length > 0) {
      requestBody.tools = tools.map((f) => ({ type: 'function' as const, function: f }));
      requestBody.tool_choice = 'auto';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`LLM API error: ${response.status} ${response.statusText}. ${errorText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: ChatCompletionMessage;
        content?: string | null;
        tool_calls?: ChatCompletionToolCall[];
        finish_reason?: string | null;
      }>;
    };
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error('Invalid response format: no choices');
    }

    const message: ChatCompletionMessage = choice.message || {
      content: choice.content,
      tool_calls: choice.tool_calls,
    };
    const result: LLMResponse = {
      content: message.content || '',
      finishReason: choice.finish_reason,
    };

    // 解析工具调用
    if (message.tool_calls && message.tool_calls.length > 0) {
      result.toolCalls = message.tool_calls.map((tc, index) => ({
        id: tc.id || `tool_call_${Date.now()}_${index}`,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || '{}'),
      }));
    }

    return result;
  }
}
