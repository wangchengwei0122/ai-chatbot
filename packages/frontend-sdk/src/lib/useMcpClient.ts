/**
 * useMcpClient
 * 使用新的 AI 助手 SDK（React 版本）
 */

import { useAiAssistantReact } from './useAiAssistantReact';
import type { AiAssistantConfig, Message } from '../types';

// 为了保持向后兼容，导出 ChatMessage 类型
export type ChatMessage = Message;

// 导出配置类型
export type McpClientConfig = AiAssistantConfig;

/**
 * useMcpClient Hook
 * 完全替换原有实现，使用新的 SDK（React 版本）
 */
export function useMcpClient(config: McpClientConfig): {
  messages: ChatMessage[];
  sendMessage: (text: string) => Promise<void>;
  clear: () => void;
} {
  // 如果没有指定 provider，默认使用 openai
  const fullConfig: AiAssistantConfig = {
    provider: config.provider || 'openai',
    model: config.model,
    proxyUrl: config.proxyUrl,
    mcp: config.mcp,
    debug: config.debug,
    maxToolCallDepth: config.maxToolCallDepth,
    maxRetries: config.maxRetries,
    toolCallTimeout: config.toolCallTimeout,
    llmTimeout: config.llmTimeout,
    maxMessages: config.maxMessages,
    onMessage: config.onMessage,
    onToken: config.onToken,
    onToolCall: config.onToolCall,
    onError: config.onError,
    onFinish: config.onFinish,
    onReconnect: config.onReconnect,
    onDisconnect: config.onDisconnect,
  };



  const { messages, sendMessage, clear } = useAiAssistantReact(fullConfig);

  return {
    messages,
    sendMessage,
    clear,
  };
}
