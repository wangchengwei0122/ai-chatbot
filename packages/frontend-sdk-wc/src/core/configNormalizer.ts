/**
 * 配置规范化
 * 自动推断和校验配置参数，减少用户配置负担
 * 
 * 安全要求：
 * - 前端永远不允许传递 apiKey、baseUrl、mcpUrl 等敏感字段
 * - 所有 API Key 由 Node Proxy Server 管理
 */

import type { LLMProvider, AiAssistantConfig, NormalizedConfig } from '../types';
import { ProviderConfigError } from './errorHandler';

/**
 * 支持 function calling 的 provider
 */
const FUNCTION_CALLING_SUPPORTED: LLMProvider[] = [
  'openai',
  'deepseek',
  'gemini',
  'qwen',
  'ollama', // Ollama 部分模型支持
];

/**
 * 规范化配置
 */
export function normalizeConfig(config: AiAssistantConfig): NormalizedConfig {
  // 验证 provider
  if (!['openai', 'deepseek', 'gemini', 'qwen', 'ollama'].includes(config.provider)) {
    throw new ProviderConfigError(
      `Unsupported provider: ${config.provider}`,
      'UNSUPPORTED_PROVIDER',
      { provider: config.provider }
    );
  }

  // 验证必需字段
  if (!config.model) {
    throw new ProviderConfigError('Model is required', 'MISSING_MODEL');
  }

  if (!config.proxyUrl) {
    throw new ProviderConfigError('proxyUrl is required', 'MISSING_PROXY_URL');
  }

  // 校验 provider 是否支持 function_call
  if (!FUNCTION_CALLING_SUPPORTED.includes(config.provider)) {
    throw new ProviderConfigError(
      `Provider ${config.provider} does not support function calling`,
      'FUNCTION_CALLING_NOT_SUPPORTED',
      { provider: config.provider }
    );
  }

  // 规范化配置，设置默认值
  const normalized: NormalizedConfig = {
    provider: config.provider,
    model: config.model,
    proxyUrl: config.proxyUrl,
    mcp: config.mcp,
    debug: config.debug ?? false,
    maxToolCallDepth: config.maxToolCallDepth ?? 5,
    maxRetries: config.maxRetries ?? 5,
    toolCallTimeout: config.toolCallTimeout ?? 30000,
    llmTimeout: config.llmTimeout ?? 60000,
    maxMessages: config.maxMessages ?? 50,
    // 事件回调
    onMessage: config.onMessage,
    onToken: config.onToken,
    onToolCall: config.onToolCall,
    onError: config.onError,
    onFinish: config.onFinish,
    onReconnect: config.onReconnect,
    onDisconnect: config.onDisconnect,
  };

  return normalized;
}

/**
 * 验证模型是否支持工具调用
 * 注意：这是一个简化的验证，实际可能需要更复杂的逻辑
 */
export function validateModelSupportsTools(provider: LLMProvider, _model: string): boolean {
  // 对于大多数 provider，如果支持 function calling，则模型也应该支持
  // 这里可以添加更具体的模型验证逻辑
  if (!FUNCTION_CALLING_SUPPORTED.includes(provider)) {
    return false;
  }

  // Ollama 需要特殊处理，只有部分模型支持
  if (provider === 'ollama') {
    // 这里可以维护一个支持工具调用的 Ollama 模型列表
    // 暂时返回 true，让用户自己验证
    return true;
  }

  return true;
}
