/**
 * 工具调用引擎
 * 递归多轮工具调用，支持流式响应
 */

import { LLMClient, type ChatMessage } from '../llm/client.js';
import { getMcpClientManager } from '../mcp/client.js';
import { mapMcpToolsToFunctions } from '../mcp/mapper.js';

export interface StreamChunk {
  type: 'token' | 'tool_call' | 'finish';
  data?: any;
}

/**
 * 工具调用引擎
 */
export class ToolEngine {
  private maxDepth: number;

  constructor(maxDepth: number = 5) {
    this.maxDepth = maxDepth;
  }

  /**
   * 处理消息（流式）
   */
  async *processMessageStream(
    provider: string,
    model: string,
    messages: ChatMessage[],
    mcpId?: string,
    useMcp: boolean = true
  ): AsyncGenerator<StreamChunk, void, unknown> {
    console.log('[Tool Engine] processMessageStream started:', {
      provider,
      model,
      mcpId,
      messagesCount: messages.length,
      useMcp,
    });
    try {
      yield* this.processWithToolsStream(provider, model, messages, mcpId, useMcp, 0);
      console.log('[Tool Engine] processMessageStream completed');
    } catch (error) {
      console.error('[Tool Engine] processMessageStream error:', error);
      throw error;
    }
  }

  /**
   * 递归处理工具调用（流式）
   */
  private async *processWithToolsStream(
    provider: string,
    model: string,
    conversationMessages: ChatMessage[],
    mcpId: string | undefined,
    useMcp: boolean,
    depth: number
  ): AsyncGenerator<StreamChunk, void, unknown> {
    console.log(`[Tool Engine] [depth:${depth}] processWithToolsStream started`);
    
    // 检查深度限制
    if (depth >= this.maxDepth) {
      console.warn(`[Tool Engine] [depth:${depth}] Max tool call depth reached: ${depth}`);
      yield { type: 'finish', data: { reason: 'max_depth' } };
      return;
    }

    // 获取工具列表（仅在启用 MCP 时）
    let functionDefinitions:
      | ReturnType<typeof mapMcpToolsToFunctions>
      | undefined;
    if (useMcp) {
      console.log(
        `[Tool Engine] [depth:${depth}] Fetching tools from MCP: ${mcpId || 'default'}`
      );
      const mcpManager = getMcpClientManager();
      const tools = await mcpManager.listTools(mcpId);
      console.log(
        `[Tool Engine] [depth:${depth}] Loaded ${tools.length} tools`
      );

      functionDefinitions = mapMcpToolsToFunctions(tools);
      console.log(
        `[Tool Engine] [depth:${depth}] Mapped to ${functionDefinitions.length} function definitions`
      );
    } else {
      console.log(
        `[Tool Engine] [depth:${depth}] MCP disabled for this request, calling LLM without tools`
      );
      functionDefinitions = undefined;
    }

    // 创建 LLM 客户端
    console.log(`[Tool Engine] [depth:${depth}] Creating LLM client: ${provider}/${model}`);
    const llmClient = new LLMClient(provider as any, model);

    // 调用 LLM（流式）
    console.log(`[Tool Engine] [depth:${depth}] Calling LLM chatStream with ${conversationMessages.length} messages`);
    const stream = await llmClient.chatStream(
      conversationMessages,
      functionDefinitions
    );
    console.log(`[Tool Engine] [depth:${depth}] LLM stream obtained, starting to read`);

    // 读取流
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    let accumulatedContent = '';
    let toolCalls: Array<{
      id: string;
      name: string;
      arguments: any;
    }> = [];
    let finishReason: string | null = null;
    let readCount = 0;
    let tokenCount = 0;

    // 添加超时机制（5分钟）
    const STREAM_TIMEOUT = 300000;
    const timeoutId = setTimeout(() => {
      reader.cancel();
      console.error(`[Tool Engine] [depth:${depth}] Stream read timeout after ${STREAM_TIMEOUT}ms`);
    }, STREAM_TIMEOUT);

    try {
      console.log(`[Tool Engine] [depth:${depth}] Starting to read stream chunks`);
      while (true) {
        const { done, value } = await reader.read();
        readCount++;
        
        if (done) {
          console.log(`[Tool Engine] [depth:${depth}] Stream read completed, total reads: ${readCount}, tokens: ${tokenCount}`);
          break;
        }
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              console.log(`[Tool Engine] [depth:${depth}] Received [DONE] marker, finishReason: ${finishReason || 'not set'}`);
              // 不要覆盖 finishReason，它应该已经在之前从 choice.finish_reason 中设置了
              // 只在 finishReason 未设置时才设置为 stop（作为后备）
              if (!finishReason) {
                finishReason = 'stop';
                console.log(`[Tool Engine] [depth:${depth}] Setting finishReason to 'stop' as fallback`);
              }
              break;
            }

            try {
              const parsed = JSON.parse(data);
              const choice = parsed.choices?.[0];
              if (!choice) continue;

              const delta = choice.delta;

              // 处理内容
              if (delta.content) {
                accumulatedContent += delta.content;
                tokenCount++;
                yield { type: 'token', data: delta.content };
              }

              // 处理工具调用
              if (delta.tool_calls) {
                console.log(`[Tool Engine] [depth:${depth}] Received tool_calls delta:`, delta.tool_calls);
                for (const toolCall of delta.tool_calls) {
                  const index = toolCall.index || 0;
                  if (!toolCalls[index]) {
                    toolCalls[index] = {
                      id: toolCall.id || `call_${Date.now()}_${index}`,
                      name: '',
                      arguments: '',
                    };
                    console.log(`[Tool Engine] [depth:${depth}] Initialized tool call #${index}:`, toolCalls[index]);
                  }
                  if (toolCall.function?.name) {
                    toolCalls[index].name = toolCall.function.name;
                    console.log(`[Tool Engine] [depth:${depth}] Tool call #${index} name set: ${toolCall.function.name}`);
                  }
                  if (toolCall.function?.arguments) {
                    toolCalls[index].arguments += toolCall.function.arguments;
                  }
                }
              }

              // 处理完成原因
              if (choice.finish_reason) {
                finishReason = choice.finish_reason;
                console.log(`[Tool Engine] [depth:${depth}] Finish reason received: ${finishReason}`);
              }
            } catch (error) {
              console.warn(`[Tool Engine] [depth:${depth}] Failed to parse SSE data:`, error, 'data:', data);
            }
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
      reader.releaseLock();
      console.log(`[Tool Engine] [depth:${depth}] Stream reader released`);
    }

    // 如果有工具调用，执行工具并递归
    console.log(`[Tool Engine] [depth:${depth}] Stream processing finished:`, {
      accumulatedContentLength: accumulatedContent.length,
      toolCallsCount: toolCalls.length,
      finishReason,
    });

    if (toolCalls.length > 0 && finishReason === 'tool_calls') {
      console.log(`[Tool Engine] [depth:${depth}] Tool calls detected:`, toolCalls.map(tc => ({ name: tc.name, id: tc.id })));

      // 创建助手消息
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: accumulatedContent || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments),
          },
        })),
      };

      // 执行所有工具调用，收集所有结果（仅在启用 MCP 时）
      const toolResults: ChatMessage[] = [];
      
      for (let i = 0; i < toolCalls.length; i++) {
        const toolCall = toolCalls[i];
        console.log(
          `[Tool Engine] [depth:${depth}] Executing tool call ${i + 1}/${toolCalls.length}: ${toolCall.name}`
        );
        yield { type: 'tool_call', data: { name: toolCall.name, arguments: toolCall.arguments } };

        try {
          const args = typeof toolCall.arguments === 'string' 
            ? JSON.parse(toolCall.arguments) 
            : toolCall.arguments;

          console.log(
            `[Tool Engine] [depth:${depth}] Calling MCP tool: ${toolCall.name} with args:`,
            args
          );
          const mcpManager = getMcpClientManager();
          const toolResult = await mcpManager.callTool(mcpId, toolCall.name, args);
          console.log(`[Tool Engine] [depth:${depth}] Tool call ${toolCall.name} completed`);

          // 添加工具结果消息
          const toolMsg: ChatMessage = {
            role: 'tool',
            content: typeof toolResult.content === 'string' 
              ? toolResult.content 
              : JSON.stringify(toolResult.content),
            tool_call_id: toolCall.id,
            name: toolResult.name,
          };
          
          toolResults.push(toolMsg);
        } catch (error) {
          console.error(`[Tool Engine] [depth:${depth}] Tool call failed: ${toolCall.name}`, error);
          // 添加错误消息，确保 LLM 知道工具调用失败
          toolResults.push({
            role: 'tool',
            content: `Error: ${error instanceof Error ? error.message : String(error)}`,
            tool_call_id: toolCall.id,
            name: toolCall.name,
          });
        }
      }

      // 所有工具调用完成后，一次性递归调用 LLM（继续对话）
      if (toolResults.length > 0) {
        console.log(`[Tool Engine] [depth:${depth}] All ${toolResults.length} tool calls completed, recursing to depth ${depth + 1}`);
        yield* this.processWithToolsStream(
          provider,
          model,
          [...conversationMessages, assistantMsg, ...toolResults],
          mcpId,
          useMcp,
          depth + 1
        );
      } else {
        console.log(`[Tool Engine] [depth:${depth}] No tool results to recurse with`);
      }
    } else {
      // 没有工具调用，完成
      console.log(`[Tool Engine] [depth:${depth}] No tool calls, finishing with reason: ${finishReason || 'stop'}`);
      yield { type: 'finish', data: { reason: finishReason || 'stop' } };
    }
  }
}
