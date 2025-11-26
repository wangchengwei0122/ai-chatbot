/**
 * MCP 客户端（前端）
 * 通过 Proxy Server 调用 MCP，不再直接连接 MCP
 */

import type { FunctionDefinition, McpTool, ToolCallResult } from '../types';
import { EventEmitter } from './EventEmitter';
import { logger } from './Logger';
import { McpToolError, NetworkError, withTimeout } from './errorHandler';

export interface MCPClientOptions {
  proxyUrl: string;
  mcp?: string; // MCP 服务器 ID（可选，未指定时使用默认）
  maxRetries?: number;
  toolCallTimeout?: number;
  onDisconnect?: () => void;
  onReconnect?: () => void;
}

export class MCPClient {
  private options: Required<Omit<MCPClientOptions, 'onDisconnect' | 'onReconnect'>> & {
    onDisconnect?: () => void;
    onReconnect?: () => void;
    mcp?: string;
  };
  private eventEmitter = new EventEmitter();
  private toolsCache: McpTool[] | null = null;
  private schemaCache: Map<string, FunctionDefinition> = new Map();

  constructor(options: MCPClientOptions) {
    if (!options.proxyUrl) {
      throw new Error('proxyUrl is required');
    }

    this.options = {
      proxyUrl: options.proxyUrl,
      mcp: options.mcp,
      maxRetries: options.maxRetries ?? 5,
      toolCallTimeout: options.toolCallTimeout ?? 30000,
      onDisconnect: options.onDisconnect,
      onReconnect: options.onReconnect,
    };
  }

  /**
   * 连接（兼容接口，实际不需要连接）
   */
  async connect(): Promise<void> {
    // 前端不再需要直接连接 MCP，所有请求都通过 Proxy Server
    logger.debug('MCPClient', 'Using Proxy Server, no direct connection needed');
    this.eventEmitter.emit('connected');
  }

  /**
   * 获取工具列表（带缓存）
   */
  async listTools(mcp?: string): Promise<McpTool[]> {
    const targetMcp = mcp || this.options.mcp;
    
    // 检查缓存（按 MCP ID 隔离）
    const cacheKey = targetMcp || 'default';
    if (this.toolsCache) {
      logger.logCache('get', 'tools');
      return this.toolsCache;
    }

    try {
      const response = await fetch(`${this.options.proxyUrl}/mcp/list-tools`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mcp: targetMcp,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new NetworkError(
          `Failed to list tools: ${response.status} ${response.statusText}. ${errorText}`,
          'LIST_TOOLS_FAILED',
          { status: response.status, statusText: response.statusText, body: errorText }
        );
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new McpToolError(
          data.error || 'Failed to list tools',
          'LIST_TOOLS_FAILED',
          { error: data.error }
        );
      }

      const tools: McpTool[] = data.data.tools || [];
      
      // 缓存工具列表
      this.toolsCache = tools;
      logger.logCache('set', 'tools', tools);
      logger.debug('MCPClient', `Loaded ${tools.length} tools from proxy`);

      return tools;
    } catch (error) {
      logger.error('MCPClient', 'Failed to list tools:', error);
      
      if (error instanceof NetworkError || error instanceof McpToolError) {
        throw error;
      }

      throw new McpToolError(
        `Failed to list tools: ${error instanceof Error ? error.message : String(error)}`,
        'LIST_TOOLS_FAILED',
        { error }
      );
    }
  }

  /**
   * 调用工具
   */
  async callTool(name: string, args: any, mcp?: string): Promise<ToolCallResult> {
    const targetMcp = mcp || this.options.mcp;

    logger.logToolCall(name, args);

    try {
      const result = await withTimeout(
        async () => {
          const response = await fetch(`${this.options.proxyUrl}/mcp/call-tool`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              mcp: targetMcp,
              name,
              args,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new NetworkError(
              `Tool call failed: ${response.status} ${response.statusText}. ${errorText}`,
              'TOOL_CALL_FAILED',
              { status: response.status, statusText: response.statusText, body: errorText }
            );
          }

          const data = await response.json();
          
          if (!data.success) {
            throw new McpToolError(
              data.error || 'Tool call failed',
              'TOOL_CALL_FAILED',
              { error: data.error }
            );
          }

          return data.data as ToolCallResult;
        },
        this.options.toolCallTimeout,
        `Tool call: ${name}`
      );

      logger.logToolResult(name, result.content, result.isError);

      return result;
    } catch (error) {
      logger.error('MCPClient', `Tool call failed: ${name}`, error);
      
      if (error instanceof Error && 'type' in error && (error as any).type === 'TIMEOUT_ERROR') {
        throw error;
      }

      if (error instanceof NetworkError || error instanceof McpToolError) {
        throw error;
      }

      throw new McpToolError(
        `Tool call failed: ${error instanceof Error ? error.message : String(error)}`,
        'TOOL_CALL_FAILED',
        { toolName: name, args, error }
      );
    }
  }

  /**
   * 将 MCP 工具转换为 OpenAI function schema（带缓存）
   */
  async getFunctionSchemas(mcp?: string): Promise<FunctionDefinition[]> {
    const tools = await this.listTools(mcp);
    const schemas: FunctionDefinition[] = [];

    for (const tool of tools) {
      // 检查缓存
      const cacheKey = tool.name;
      if (this.schemaCache.has(cacheKey)) {
        logger.logCache('get', `schema:${cacheKey}`);
        schemas.push(this.schemaCache.get(cacheKey)!);
        continue;
      }

      // 转换 schema
      const schema: FunctionDefinition = {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: tool.inputSchema.type || 'object',
          properties: tool.inputSchema.properties || {},
          required: tool.inputSchema.required || [],
        },
      };

      // 缓存 schema
      this.schemaCache.set(cacheKey, schema);
      logger.logCache('set', `schema:${cacheKey}`, schema);
      schemas.push(schema);
    }

    return schemas;
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.toolsCache = null;
    this.schemaCache.clear();
    logger.logCache('clear', 'all');
  }

  /**
   * 断开连接（兼容接口）
   */
  async disconnect(): Promise<void> {
    // 前端不再需要直接连接，这里只是清理缓存
    this.clearCache();
    logger.info('MCPClient', 'Disconnected');
  }

  /**
   * 获取事件发射器
   */
  getEventEmitter(): EventEmitter {
    return this.eventEmitter;
  }

  /**
   * 检查是否已连接（兼容接口，始终返回 true）
   */
  getIsConnected(): boolean {
    return true; // 通过 Proxy Server，始终可用
  }
}
