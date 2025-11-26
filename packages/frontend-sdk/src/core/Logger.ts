/**
 * Logger 日志模块
 * 可选的调试日志系统，用于调试递归工具调用链、排查问题、监控 SDK 运行状态
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export class Logger {
  private enabled: boolean;
  private level: LogLevel;

  constructor(enabled: boolean = false, level: LogLevel = LogLevel.DEBUG) {
    this.enabled = enabled;
    this.level = level;
  }

  /**
   * 启用日志
   */
  enable(): void {
    this.enabled = true;
  }

  /**
   * 禁用日志
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * 设置日志级别
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private log(level: LogLevel, prefix: string, ...args: any[]): void {
    if (!this.enabled || level < this.level) {
      return;
    }

    const timestamp = new Date().toISOString();
    const levelName = LogLevel[level];
    console[level === LogLevel.ERROR ? 'error' : level === LogLevel.WARN ? 'warn' : 'log'](
      `[${timestamp}] [${levelName}] [${prefix}]`,
      ...args
    );
  }

  /**
   * 调试日志
   */
  debug(prefix: string, ...args: any[]): void {
    this.log(LogLevel.DEBUG, prefix, ...args);
  }

  /**
   * 信息日志
   */
  info(prefix: string, ...args: any[]): void {
    this.log(LogLevel.INFO, prefix, ...args);
  }

  /**
   * 警告日志
   */
  warn(prefix: string, ...args: any[]): void {
    this.log(LogLevel.WARN, prefix, ...args);
  }

  /**
   * 错误日志
   */
  error(prefix: string, ...args: any[]): void {
    this.log(LogLevel.ERROR, prefix, ...args);
  }

  /**
   * 记录 LLM 请求
   */
  logLLMRequest(provider: string, model: string, messages: any[], tools?: any[]): void {
    this.debug('LLMClient', 'Request:', {
      provider,
      model,
      messageCount: messages.length,
      toolCount: tools?.length || 0,
    });
  }

  /**
   * 记录 LLM 响应
   */
  logLLMResponse(provider: string, hasStream: boolean): void {
    this.debug('LLMClient', 'Response:', {
      provider,
      stream: hasStream,
    });
  }

  /**
   * 记录 MCP 工具调用
   */
  logToolCall(name: string, args: any): void {
    this.debug('MCPClient', 'Tool call:', { name, args });
  }

  /**
   * 记录 MCP 工具结果
   */
  logToolResult(name: string, result: any, isError: boolean = false): void {
    if (isError) {
      this.error('MCPClient', 'Tool error:', { name, result });
    } else {
      this.debug('MCPClient', 'Tool result:', { name, result });
    }
  }

  /**
   * 记录流式解析
   */
  logStreamParse(chunk: any): void {
    this.debug('StreamParser', 'Parsed chunk:', chunk);
  }

  /**
   * 记录重连
   */
  logReconnect(attempt: number, maxRetries: number): void {
    this.info('MCPClient', `Reconnecting... (${attempt}/${maxRetries})`);
  }

  /**
   * 记录缓存操作
   */
  logCache(action: 'get' | 'set' | 'clear', key: string, value?: any): void {
    this.debug('MCPClient', `Cache ${action}:`, { key, hasValue: !!value });
  }

  /**
   * 记录超时
   */
  logTimeout(operation: string, timeout: number): void {
    this.warn('Timeout', `Operation "${operation}" timed out after ${timeout}ms`);
  }
}

// 全局 Logger 实例
export const logger = new Logger();

