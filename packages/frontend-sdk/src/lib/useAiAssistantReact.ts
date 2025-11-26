/**
 * React Hook 包装器
 * 为 React 提供响应式更新
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useAiAssistant } from '../useAiAssistant';
import type { UseAiAssistantReturn } from '../useAiAssistant';
import type { AiAssistantConfig, Message } from '../types';

/**
 * React Hook 版本的 useAiAssistant
 */
export function useAiAssistantReact(config: AiAssistantConfig): UseAiAssistantReturn & {
  isProcessing: boolean;
} {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const configRef = useRef(config);

  // 更新配置引用
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // 创建 API 实例（使用 useMemo 确保只创建一次）
  const api = useMemo(() => {
    const apiInstance = useAiAssistant({
      ...configRef.current,
      onMessage: (message) => {
        // 通过获取最新消息来更新状态
        setMessages([...apiInstance.messages]);
        if (configRef.current.onMessage) {
          configRef.current.onMessage(message);
        }
      },
      onFinish: () => {
        setIsProcessing(false);
        if (configRef.current.onFinish) {
          configRef.current.onFinish();
        }
      },
    });
    return apiInstance;
  }, []); // 只在组件挂载时创建一次

  // 设置更新回调
  useEffect(() => {
    if ((api as any).__setUpdateCallback) {
      (api as any).__setUpdateCallback(() => {
        setMessages([...api.messages]);
        setIsProcessing(api.isProcessing);
      });
    }

    // 初始同步
    setMessages([...api.messages]);
    setIsProcessing(api.isProcessing);
  }, [api]);

  // 清理函数
  useEffect(() => {
    return () => {
      if ((api as any).__cleanup) {
        (api as any).__cleanup();
      }
    };
  }, [api]);

  return {
    ...api,
    messages,
    isProcessing,
  };
}

