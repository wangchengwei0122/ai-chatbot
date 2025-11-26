/**
 * useAiAssistant
 * 框架无关的 hook API，管理消息状态和事件
 */

import type { Message, AiAssistantConfig } from './types';
import { normalizeConfig } from './core/configNormalizer';
import { AiEngine } from './core/AiEngine';
import { EventEmitter } from './core/EventEmitter';
import { logger } from './core/Logger';
import { formatError } from './core/errorHandler';

export interface UseAiAssistantReturn {
  messages: Message[];
  sendMessage: (text: string) => Promise<void>;
  clear: () => void;
  isProcessing: boolean;
}

/**
 * useAiAssistant Hook
 * 框架无关的 AI 助手 API
 */
export function useAiAssistant(config: AiAssistantConfig): UseAiAssistantReturn {
  // 规范化配置
  console.log(config)
  const normalizedConfig = normalizeConfig(config);
  console.log(normalizedConfig)
  // 启用/禁用日志
  if (normalizedConfig.debug) {
    logger.enable();
  } else {
    logger.disable();
  }

  // 创建事件发射器
  const eventEmitter = new EventEmitter();

  // 创建 AI 引擎（不再需要 MCPClient 和 LLMClient，所有逻辑在 Proxy Server）
  const engine = new AiEngine(normalizedConfig, eventEmitter);

  // 状态管理（使用简单的响应式模式）
  let messages: Message[] = [];
  let isProcessing = false;
  let updateCallback: (() => void) | null = null;

  // 注册事件监听器
  eventEmitter.on('message', (message: Message) => {
    messages = engine.getMessages();
    if (updateCallback) {
      updateCallback();
    }
    if (normalizedConfig.onMessage) {
      normalizedConfig.onMessage(message);
    }
  });

  eventEmitter.on('error', (error: Error) => {
    if (normalizedConfig.onError) {
      normalizedConfig.onError(error);
    }
  });

  eventEmitter.on('finish', () => {
    isProcessing = false;
    if (updateCallback) {
      updateCallback();
    }
    if (normalizedConfig.onFinish) {
      normalizedConfig.onFinish();
    }
  });

  // 初始化引擎
  let initialized = false;
  const initPromise = engine.initialize().then(() => {
    initialized = true;
  }).catch((error) => {
    console.log(error)
    const formattedError = formatError(error);
    logger.error('useAiAssistant', 'Initialization failed:', formattedError);
    if (normalizedConfig.onError) {
      normalizedConfig.onError(formattedError);
    }
  });

  /**
   * 发送消息
   */
  const sendMessage = async (text: string): Promise<void> => {
    if (!text.trim() || isProcessing) {
      return;
    }

    // 等待初始化完成
    await initPromise;
    if (!initialized) {
      throw new Error('AI engine not initialized');
    }

    isProcessing = true;
    if (updateCallback) {
      updateCallback();
    }

    try {
      await engine.processMessage(text);
    } catch (error) {
      const formattedError = formatError(error);
      logger.error('useAiAssistant', 'Send message failed:', formattedError);
      if (normalizedConfig.onError) {
        normalizedConfig.onError(formattedError);
      }
    } finally {
      isProcessing = false;
      if (updateCallback) {
        updateCallback();
      }
    }
  };

  /**
   * 清空消息
   */
  const clear = (): void => {
    engine.clearMessages();
    messages = [];
    if (updateCallback) {
      updateCallback();
    }
  };

  // 返回 API
  const api: UseAiAssistantReturn = {
    get messages() {
      return messages;
    },
    sendMessage,
    clear,
    get isProcessing() {
      return isProcessing;
    },
  };

  // 为了支持响应式更新，我们需要一个机制来通知外部更新
  // 这里使用一个简单的回调机制
  // 在 React/Vue 等框架中，可以通过 useEffect/watch 来设置这个回调
  (api as any).__setUpdateCallback = (callback: () => void) => {
    updateCallback = callback;
  };

  // 清理函数（如果框架支持）
  (api as any).__cleanup = async () => {
    await engine.cleanup();
    eventEmitter.removeAllListeners();
  };

  return api;
}

/**
 * React Hook 包装器（可选）
 * 如果使用 React，可以使用这个包装器
 */
export function useAiAssistantReact(_config: AiAssistantConfig) {
  // 这里需要 React 的 useState 和 useEffect
  // 但由于要保持框架无关，我们不在核心文件中引入 React
  // 这个函数可以在 React 特定的文件中实现
  throw new Error('This function should be implemented in a React-specific file');
}
