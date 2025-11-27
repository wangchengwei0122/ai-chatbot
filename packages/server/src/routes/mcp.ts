/**
 * MCP API 路由
 * 提供 REST API 接口供前端调用
 */

import { FastifyPluginAsync } from 'fastify';
import { getMcpClientManager } from '../mcp/client.js';
import { ToolEngine } from '../engine/toolEngine.js';

const mcpRoutes: FastifyPluginAsync = async (fastify) => {
  const mcpManager = getMcpClientManager();
  const toolEngine = new ToolEngine(5);

  /**
   * 获取工具列表
   * POST /mcp/list-tools
   */
  fastify.post<{
    Body: {
      mcp?: string;
    };
  }>('/mcp/list-tools', async (request, reply) => {
    try {
      const { mcp } = request.body;
      const tools = await mcpManager.listTools(mcp);
      
      return {
        success: true,
        data: {
          tools,
          mcp: mcp || mcpManager.getDefaultMcpId(),
        },
      };
    } catch (error) {
      reply.code(500);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  /**
   * 调用单个工具
   * POST /mcp/call-tool
   */
  fastify.post<{
    Body: {
      mcp?: string;
      name: string;
      args: any;
    };
  }>('/mcp/call-tool', async (request, reply) => {
    try {
      const { mcp, name, args } = request.body;

      if (!name) {
        reply.code(400);
        return {
          success: false,
          error: 'Tool name is required',
        };
      }

      const result = await mcpManager.callTool(mcp, name, args);
      
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      reply.code(500);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  /**
   * 发送消息（完整对话接口，支持流式返回）
   * POST /mcp/send-message
   */
  fastify.post<{
    Body: {
      mcp?: string;
      provider: string;
      model: string;
      messages: Array<{
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
      }>;
      selectedMcpIds?: string[];
    };
  }>('/mcp/send-message', async (request, reply) => {
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`[MCP Routes] [${requestId}] Request received:`, {
      provider: request.body.provider,
      model: request.body.model,
      selectedMcpIds: request.body.selectedMcpIds,
      messagesCount: request.body.messages?.length,
    });

    try {
      const { provider, model, messages, selectedMcpIds } = request.body;

      if (!provider || !model) {
        console.error(`[MCP Routes] [${requestId}] Validation failed: provider or model missing`);
        reply.code(400);
        return {
          success: false,
          error: 'Provider and model are required',
        };
      }

      if (!messages || messages.length === 0) {
        console.error(`[MCP Routes] [${requestId}] Validation failed: messages empty`);
        reply.code(400);
        return {
          success: false,
          error: 'Messages are required',
        };
      }

      // 确保 selectedMcpIds 是数组格式
      const validSelectedMcpIds = Array.isArray(selectedMcpIds) ? selectedMcpIds : [];
      const enableMcp = validSelectedMcpIds.length > 0;

      console.log(
        `[MCP Routes] [${requestId}] Validation passed, setting up SSE headers (enableMcp=${enableMcp}, selectedMcpIds=${JSON.stringify(validSelectedMcpIds)})`
      );

      // CORS 头（Fastify CORS 对 raw 响应不自动处理，需要手动设置）
      const requestOrigin = request.headers.origin;
      if (requestOrigin) {
        reply.raw.setHeader('Access-Control-Allow-Origin', requestOrigin);
        reply.raw.setHeader('Vary', 'Origin');
      }
      reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');

      // 设置 SSE 响应头
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no'); // 禁用 nginx 缓冲

      console.log(`[MCP Routes] [${requestId}] SSE headers set, starting stream processing`);

      // 发送流式响应
      let chunkCount = 0;
      const sendSSE = (data: any) => {
        try {
          chunkCount++;
          reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
          if (chunkCount % 10 === 0 || data.type === 'finish' || data.type === 'error') {
            console.log(`[MCP Routes] [${requestId}] Sent chunk #${chunkCount}:`, {
              type: data.type,
              hasData: !!data.data,
            });
          }
        } catch (error) {
          console.error(`[MCP Routes] [${requestId}] Failed to write SSE data:`, error);
        }
      };

      // 设置请求超时（5分钟）
      const REQUEST_TIMEOUT = 300000;
      const timeout = setTimeout(() => {
        console.warn(`[MCP Routes] [${requestId}] Request timeout after ${REQUEST_TIMEOUT}ms, closing connection`);
        try {
          sendSSE({
            type: 'error',
            data: {
              error: 'Request timeout',
            },
          });
        } catch (error) {
          // 忽略发送错误
        }
        try {
          reply.raw.end();
        } catch (error) {
          // 忽略关闭错误
        }
      }, REQUEST_TIMEOUT);

      // 处理流式响应
      let isClosed = false;
      try {
        console.log(
          `[MCP Routes] [${requestId}] Starting to iterate over stream generator`
        );
        for await (const chunk of toolEngine.processMessageStream(
          provider,
          model,
          messages,
          validSelectedMcpIds
        )) {
          if (isClosed) {
            console.log(`[MCP Routes] [${requestId}] Connection already closed, breaking loop`);
            break;
          }
          sendSSE(chunk);
        }
        console.log(`[MCP Routes] [${requestId}] Stream iteration completed, total chunks: ${chunkCount}`);
      } catch (error) {
        console.error(`[MCP Routes] [${requestId}] Stream error:`, error);
        if (!isClosed) {
          sendSSE({
            type: 'error',
            data: {
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }
      } finally {
        clearTimeout(timeout);
        isClosed = true;
        console.log(`[MCP Routes] [${requestId}] Closing connection, total chunks sent: ${chunkCount}`);
        try {
          reply.raw.end();
        } catch (error) {
          console.error(`[MCP Routes] [${requestId}] Error closing connection:`, error);
        }
      }
    } catch (error) {
      reply.code(500);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  /**
   * 获取可用的 MCP 服务器列表
   * GET /mcp/servers
   */
  fastify.get('/mcp/servers', async () => {
    return {
      success: true,
      data: {
        servers: mcpManager.getAvailableMcpIds(),
        default: mcpManager.getDefaultMcpId(),
      },
    };
  });

  /**
   * 获取 MCP 列表（给前端 SDK 使用）
   * GET /mcp/list
   *
   * 返回结构：
   * { "mcpList": ["basic","qcc-mcp","search"] }
   */
  fastify.get('/mcp/list', async () => {
    const mcpList = mcpManager.getAvailableMcpIds();
    return {
      mcpList,
    };
  });
};

export default mcpRoutes;
