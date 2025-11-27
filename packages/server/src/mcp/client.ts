/**
 * MCP 客户端模块
 * 支持多个 MCP 服务器，完全动态配置，无硬编码
 */

type Constructor<T = any> = new (...args: any[]) => T;

// 动态导入 MCP SDK（Node.js 环境）
let ClientCtor: Constructor | null = null;
let TransportCtor: Constructor | null = null;

async function loadMcpSdk() {
  if (ClientCtor && TransportCtor) {
    return { Client: ClientCtor, Transport: TransportCtor };
  }

  try {
    // 导入 Client（使用包的 exports 路径）
    const clientModule: any = await import('@modelcontextprotocol/sdk/client');
    ClientCtor = clientModule.Client || clientModule.default?.Client;
    
    // 导入 StreamableHTTPClientTransport（使用包的 exports 路径）
    const httpModule: any = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    TransportCtor = httpModule.StreamableHTTPClientTransport || httpModule.default?.StreamableHTTPClientTransport;

    if (!ClientCtor || !TransportCtor) {
      throw new Error('Failed to load MCP SDK: Client or StreamableHTTPClientTransport not found');
    }

    return { Client: ClientCtor, Transport: TransportCtor };
  } catch (error) {
    console.error('[MCP Client] Failed to load MCP SDK:', error);
    throw new Error(`Failed to load MCP SDK: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface McpServerConfig {
  id: string;
  url: string;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

export interface ToolCallResult {
  tool_call_id?: string;
  name: string;
  content: any;
  isError?: boolean;
}

/**
 * 单个 MCP 客户端
 */
class McpClientInstance {
  private client: InstanceType<Constructor> | null = null;
  private transport: InstanceType<Constructor> | null = null;
  private url: string;
  private isConnected = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private toolsCache: McpTool[] | null = null;
  private maxRetries = 5;

  constructor(url: string) {
    this.url = url;
  }

  /**
   * 连接 MCP 服务器
   */
  async connect(): Promise<void> {
    if (this.isConnected && this.client) {
      return;
    }

    try {
      console.log(`[MCP Client] Connecting to: ${this.url}`);
      
      // 确保 MCP SDK 已加载
      const { Client: McpClient, Transport: McpTransport } = await loadMcpSdk();
      
      this.transport = new McpTransport(new URL(this.url));
      this.client = new McpClient(
        {
          name: 'mcp-proxy-server',
          version: '1.0.0',
        },
        {
          capabilities: {
            tools: {},
          },
        }
      );

      this.transport.onerror = (error: unknown) => {
        console.error(`[MCP Client] Transport error for ${this.url}:`, error);
        this.handleDisconnect();
      };

      await this.client.connect(this.transport);
      this.isConnected = true;
      this.reconnectAttempts = 0;
      
      console.log(`[MCP Client] Connected to: ${this.url}`);
    } catch (error) {
      console.error(`[MCP Client] Connection failed for ${this.url}:`, error);
      this.handleDisconnect();
      throw error;
    }
  }

  /**
   * 断开连接处理
   */
  private handleDisconnect(): void {
    if (!this.isConnected) {
      return;
    }

    this.isConnected = false;
    console.warn(`[MCP Client] Disconnected from: ${this.url}`);

    // 尝试重连
    this.attemptReconnect();
  }

  /**
   * 尝试重连（指数退避）
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxRetries) {
      console.error(`[MCP Client] Max reconnection attempts reached for ${this.url}`);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);

    console.log(`[MCP Client] Reconnecting to ${this.url} (attempt ${this.reconnectAttempts}/${this.maxRetries}) in ${delay}ms`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        console.error(`[MCP Client] Reconnection attempt failed for ${this.url}:`, error);
      }
    }, delay);
  }

  /**
   * 获取工具列表（带缓存）
   */
  async listTools(): Promise<McpTool[]> {
    // 检查缓存
    if (this.toolsCache) {
      return this.toolsCache;
    }

    if (!this.client || !this.isConnected) {
      await this.connect();
    }

    try {
      const response = await this.client!.listTools();
      const responseTools = response.tools || [];
      const tools: McpTool[] = responseTools.map((tool: any) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as any,
      }));

      // 缓存工具列表
      this.toolsCache = tools;
      console.log(`[MCP Client] Loaded ${tools.length} tools from ${this.url}`);

      return tools;
    } catch (error) {
      console.error(`[MCP Client] Failed to list tools from ${this.url}:`, error);
      throw error;
    }
  }

  /**
   * 调用工具
   */
  async callTool(name: string, args: any): Promise<ToolCallResult> {
    console.log(`[MCP Client] callTool called: ${name} on ${this.url}`, {
      args,
      isConnected: this.isConnected,
      hasClient: !!this.client,
    });

    if (!this.client || !this.isConnected) {
      console.log(`[MCP Client] Client not connected, connecting...`);
      await this.connect();
    }

    console.log(`[MCP Client] Calling tool: ${name} on ${this.url} with args:`, args);
    const startTime = Date.now();

    try {
      const response = await this.client!.callTool({
        name,
        arguments: args,
      });

      const callTime = Date.now() - startTime;
      console.log(`[MCP Client] Tool call ${name} completed in ${callTime}ms:`, {
        hasContent: !!response.content,
        contentLength: Array.isArray(response.content) ? response.content.length : 'N/A',
        isError: response.isError || false,
      });

      return {
        tool_call_id: response.content?.[0]?.text ? undefined : name,
        name,
        content: response.content,
        isError: response.isError || false,
      };
    } catch (error) {
      const callTime = Date.now() - startTime;
      console.error(`[MCP Client] Tool call ${name} failed after ${callTime}ms on ${this.url}:`, error);
      throw error;
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.toolsCache = null;
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.client) {
      try {
        await this.client.close();
      } catch (error) {
        console.error(`[MCP Client] Error closing client for ${this.url}:`, error);
      }
      this.client = null;
    }

    if (this.transport) {
      this.transport = null;
    }

    this.isConnected = false;
    console.log(`[MCP Client] Disconnected from: ${this.url}`);
  }
}

/**
 * MCP 客户端管理器
 * 管理多个 MCP 服务器连接
 */
export class McpClientManager {
  private clients: Map<string, McpClientInstance> = new Map();
  private defaultMcpId: string | null = null;

  /**
   * 从环境变量加载 MCP 服务器配置
   */
  static loadMcpServerMap(): Map<string, string> {
    const map = new Map<string, string>();
    
    const serversJson = process.env.MCP_SERVERS_JSON;
    if (!serversJson) {
      console.warn('[MCP Manager] MCP_SERVERS_JSON not found in environment variables');
      return map;
    }

    try {
      const servers: McpServerConfig[] = JSON.parse(serversJson);
      
      for (const server of servers) {
        if (server.id && server.url) {
          map.set(server.id, server.url);
          console.log(`[MCP Manager] Loaded MCP server: ${server.id} -> ${server.url}`);
        }
      }
    } catch (error) {
      console.error('[MCP Manager] Failed to parse MCP_SERVERS_JSON:', error);
    }

    return map;
  }

  /**
   * 初始化 MCP 客户端管理器
   */
  constructor() {
    const serverMap = McpClientManager.loadMcpServerMap();
    
    for (const [id, url] of serverMap.entries()) {
      this.clients.set(id, new McpClientInstance(url));
    }

    // 设置默认 MCP
    this.defaultMcpId = process.env.MCP_DEFAULT || (serverMap.size > 0 ? Array.from(serverMap.keys())[0] : null);
    
    if (this.defaultMcpId) {
      console.log(`[MCP Manager] Default MCP: ${this.defaultMcpId}`);
    }
  }

  /**
   * 获取 MCP 客户端
   */
  private getClient(mcpId?: string): McpClientInstance {
    const id = mcpId || this.defaultMcpId;
    
    if (!id) {
      throw new Error('No MCP ID specified and no default MCP configured');
    }

    const client = this.clients.get(id);
    if (!client) {
      throw new Error(`MCP server "${id}" not found. Available: ${Array.from(this.clients.keys()).join(', ')}`);
    }

    return client;
  }

  /**
   * 获取工具列表
   */
  async listTools(mcpId?: string): Promise<McpTool[]> {
    const client = this.getClient(mcpId);
    return await client.listTools();
  }

  /**
   * 获取多个 MCP 的工具列表（并行调用，自动添加前缀）
   */
  async listToolsForMany(mcpIds: string[]): Promise<McpTool[]> {
    if (!mcpIds || mcpIds.length === 0) {
      return [];
    }

    console.log(`[MCP Manager] Fetching tools from ${mcpIds.length} MCP servers:`, mcpIds);

    // 并行获取所有 MCP 的工具列表
    const toolPromises = mcpIds.map(async (mcpId) => {
      try {
        const client = this.getClient(mcpId);
        const tools = await client.listTools();
        
        // 为每个工具添加前缀 <mcpId>__<toolName>
        const prefixedTools: McpTool[] = tools.map((tool) => ({
          ...tool,
          name: `${mcpId}__${tool.name}`,
        }));

        console.log(`[MCP Manager] Loaded ${prefixedTools.length} tools from ${mcpId} (with prefix)`);
        return prefixedTools;
      } catch (error) {
        console.error(`[MCP Manager] Failed to load tools from ${mcpId}:`, error);
        // 返回空数组，不阻断其他 MCP
        return [];
      }
    });

    const toolArrays = await Promise.all(toolPromises);
    const allTools = toolArrays.flat();

    console.log(`[MCP Manager] Total tools loaded from ${mcpIds.length} MCPs: ${allTools.length}`);
    return allTools;
  }

  /**
   * 调用工具（支持带前缀的工具名称）
   * 工具名称格式：<mcpId>__<toolName>
   */
  async callTool(mcpId: string | undefined, name: string, args: any): Promise<ToolCallResult> {
    // 检查工具名称是否包含前缀
    if (name.includes('__')) {
      const [prefixMcpId, rawToolName] = name.split('__', 2);
      console.log(`[MCP Manager] Parsed tool name: ${name} -> mcpId=${prefixMcpId}, toolName=${rawToolName}`);
      const client = this.getClient(prefixMcpId);
      return await client.callTool(rawToolName, args);
    }

    // 向后兼容：如果没有前缀，使用传入的 mcpId
    const client = this.getClient(mcpId);
    return await client.callTool(name, args);
  }

  /**
   * 获取所有可用的 MCP ID
   */
  getAvailableMcpIds(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * 获取默认 MCP ID
   */
  getDefaultMcpId(): string | null {
    return this.defaultMcpId;
  }

  /**
   * 断开所有连接
   */
  async disconnectAll(): Promise<void> {
    const promises = Array.from(this.clients.values()).map(client => client.disconnect());
    await Promise.all(promises);
  }
}

// 单例实例
let managerInstance: McpClientManager | null = null;

/**
 * 获取 MCP 客户端管理器单例
 */
export function getMcpClientManager(): McpClientManager {
  if (!managerInstance) {
    managerInstance = new McpClientManager();
  }
  return managerInstance;
}
