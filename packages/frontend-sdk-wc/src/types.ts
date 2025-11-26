/**
 * AI 助手 SDK 类型定义
 */

/**
 * LLM 提供商类型
 */
export type LLMProvider = 'openai' | 'deepseek' | 'gemini' | 'qwen' | 'ollama';

/**
 * 消息角色
 */
export type MessageRole = 'user' | 'assistant' | 'tool';

/**
 * 统一消息格式规范（Message Envelope Structure）
 * 
 * 为什么需要这些字段：
 * - id: 用于消息追踪、去重、UI 渲染时的 key
 * - role: 区分消息类型，用于正确显示和 LLM API 调用
 * - content: 消息文本内容
 * - tool_call: 工具调用信息，用于调试工具链、UI 显示工具调用状态
 * - tool_result: 工具执行结果，用于调试、回放工具调用链
 * - createdAt: 时间戳，用于排序、调试、显示时间
 */
export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  tool_call?: {
    id?: string;
    name: string;
    arguments: any;
  };
  tool_result?: {
    tool_call_id?: string;
    name: string;
    content: any;
  };
  createdAt: number;
}

/**
 * 工具调用信息（OpenAI 格式）
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/**
 * 函数定义（OpenAI function calling 格式）
 */
export interface FunctionDefinition {
  name: string;
  description?: string;
  parameters: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

/**
 * SDK 配置接口
 * 注意：前端永远不允许传递 apiKey、baseUrl、mcpUrl 等敏感字段
 * 所有 API Key 由 Node Proxy Server 管理
 */
export interface AiAssistantConfig {
  provider: LLMProvider; // LLM 提供商（非敏感）
  model: string; // 模型名称（非敏感）
  proxyUrl: string; // Proxy Server URL
  mcp?: string; // MCP 服务器 ID（可选，未指定时使用默认）
  debug?: boolean; // 是否启用调试日志
  maxToolCallDepth?: number; // 最大工具调用深度，默认 5
  maxRetries?: number; // MCP 重连最大次数，默认 5
  toolCallTimeout?: number; // 工具调用超时（毫秒），默认 30000
  llmTimeout?: number; // LLM 调用超时（毫秒），默认 60000
  maxMessages?: number; // 最大消息数量，默认 50
  // 事件回调
  onMessage?: (message: Message) => void;
  onToken?: (token: string) => void;
  onToolCall?: (toolName: string, args: any) => void;
  onError?: (error: Error) => void;
  onFinish?: () => void;
  onReconnect?: () => void;
  onDisconnect?: () => void;
}

/**
 * 规范化后的配置
 */
type NormalizedRequiredFields = Required<
  Omit<
    AiAssistantConfig,
    'mcp' | 'onMessage' | 'onToken' | 'onToolCall' | 'onError' | 'onFinish' | 'onReconnect' | 'onDisconnect'
  >
>;

export interface NormalizedConfig extends NormalizedRequiredFields {
  mcp?: AiAssistantConfig['mcp']; // MCP 服务器 ID（可选）
  onMessage?: AiAssistantConfig['onMessage'];
  onToken?: AiAssistantConfig['onToken'];
  onToolCall?: AiAssistantConfig['onToolCall'];
  onError?: AiAssistantConfig['onError'];
  onFinish?: AiAssistantConfig['onFinish'];
  onReconnect?: AiAssistantConfig['onReconnect'];
  onDisconnect?: AiAssistantConfig['onDisconnect'];
  baseUrl?: string;
  apiKey?: string;
}

/**
 * 错误类型枚举
 */
export const ErrorType = {
  PROVIDER_CONFIG_ERROR: 'PROVIDER_CONFIG_ERROR',
  MCP_TOOL_ERROR: 'MCP_TOOL_ERROR',
  API_CALL_ERROR: 'API_CALL_ERROR',
  STREAM_PARSE_ERROR: 'STREAM_PARSE_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

export type ErrorType = (typeof ErrorType)[keyof typeof ErrorType];

/**
 * 统一错误格式
 */
export interface SDKError extends Error {
  type: ErrorType;
  code?: string;
  details?: any;
}

/**
 * LLM 聊天请求参数
 */
export interface ChatRequest {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | null;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
    name?: string;
  }>;
  tools?: Array<{
    type: 'function';
    function: FunctionDefinition;
  }>;
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

/**
 * LLM 流式响应块
 */
export interface StreamChunk {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

/**
 * 解析后的流式数据
 */
export interface ParsedStreamData {
  content?: string;
  toolCall?: {
    id?: string;
    name?: string;
    arguments?: string;
  };
  finishReason?: string | null;
}

/**
 * MCP 工具定义
 */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

/**
 * 工具调用结果
 */
export interface ToolCallResult {
  tool_call_id?: string;
  name: string;
  content: any;
  isError?: boolean;
}
