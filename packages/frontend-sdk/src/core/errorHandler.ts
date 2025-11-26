/**
 * 统一错误处理
 * 统一的错误分类和处理机制
 */

import { ErrorType } from '../types';
import type { SDKError } from '../types';

/**
 * 创建 SDK 错误
 */
export function createSDKError(
  type: ErrorType,
  message: string,
  code?: string,
  details?: any
): SDKError {
  const error = new Error(message) as SDKError;
  error.type = type;
  error.code = code;
  error.details = details;
  error.name = 'SDKError';
  return error;
}

/**
 * 提供者配置错误
 */
export class ProviderConfigError extends Error implements SDKError {
  type = ErrorType.PROVIDER_CONFIG_ERROR;
  code?: string;
  details?: any;

  constructor(message: string, code?: string, details?: any) {
    super(message);
    this.name = 'ProviderConfigError';
    this.code = code;
    this.details = details;
  }
}

/**
 * MCP 工具错误
 */
export class McpToolError extends Error implements SDKError {
  type = ErrorType.MCP_TOOL_ERROR;
  code?: string;
  details?: any;

  constructor(message: string, code?: string, details?: any) {
    super(message);
    this.name = 'McpToolError';
    this.code = code;
    this.details = details;
  }
}

/**
 * API 调用错误
 */
export class ApiCallError extends Error implements SDKError {
  type = ErrorType.API_CALL_ERROR;
  code?: string;
  details?: any;

  constructor(message: string, code?: string, details?: any) {
    super(message);
    this.name = 'ApiCallError';
    this.code = code;
    this.details = details;
  }
}

/**
 * 流解析错误
 */
export class StreamParseError extends Error implements SDKError {
  type = ErrorType.STREAM_PARSE_ERROR;
  code?: string;
  details?: any;

  constructor(message: string, code?: string, details?: any) {
    super(message);
    this.name = 'StreamParseError';
    this.code = code;
    this.details = details;
  }
}

/**
 * 超时错误
 */
export class TimeoutError extends Error implements SDKError {
  type = ErrorType.TIMEOUT_ERROR;
  code?: string;
  details?: any;

  constructor(message: string, operation?: string, timeout?: number) {
    super(message);
    this.name = 'TimeoutError';
    this.code = 'TIMEOUT';
    this.details = { operation, timeout };
  }
}

/**
 * 网络错误
 */
export class NetworkError extends Error implements SDKError {
  type = ErrorType.NETWORK_ERROR;
  code?: string;
  details?: any;

  constructor(message: string, code?: string, details?: any) {
    super(message);
    this.name = 'NetworkError';
    this.code = code;
    this.details = details;
  }
}

/**
 * 超时控制包装器
 * 在多轮工具链递归中，超时机制防止无限等待
 * 
 * @param fn 异步函数
 * @param timeout 超时时间（毫秒）
 * @param operation 操作名称（用于错误信息）
 * @returns Promise
 */
export function withTimeout<T>(
  fn: () => Promise<T>,
  timeout: number,
  operation: string = 'Operation'
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(
          new TimeoutError(
            `${operation} timed out after ${timeout}ms`,
            operation,
            timeout
          )
        );
      }, timeout);
    }),
  ]);
}

/**
 * 错误格式化
 */
export function formatError(error: unknown): SDKError {
  if (error instanceof Error) {
    // 如果已经是 SDKError，直接返回
    if ('type' in error) {
      return error as SDKError;
    }
    // 否则包装为未知错误
    return createSDKError(
      ErrorType.UNKNOWN_ERROR,
      error.message,
      undefined,
      { originalError: error }
    );
  }
  // 非 Error 对象
  return createSDKError(
    ErrorType.UNKNOWN_ERROR,
    String(error),
    undefined,
    { originalError: error }
  );
}

