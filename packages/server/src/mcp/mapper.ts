/**
 * MCP Schema 映射器
 * 将 MCP 工具 schema 转换为 OpenAI function schema
 */

import type { McpTool } from './client';

export interface FunctionDefinition {
  name: string;
  description?: string;
  parameters: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

/**
 * 将 MCP 工具转换为 OpenAI function schema
 */
export function mapMcpToolToFunction(tool: McpTool): FunctionDefinition {
  try {
    const schema: FunctionDefinition = {
      name: tool.name,
      description: tool.description || '',
      parameters: {
        type: tool.inputSchema.type || 'object',
        properties: tool.inputSchema.properties || {},
        required: tool.inputSchema.required || [],
      },
    };

    return schema;
  } catch (error) {
    const errorMessage = `Failed to map MCP tool "${tool.name}" to function schema: ${error instanceof Error ? error.message : String(error)}`;
    console.error(`[MCP Mapper] ${errorMessage}`);
    throw new Error(errorMessage);
  }
}

/**
 * 批量转换 MCP 工具列表
 */
export function mapMcpToolsToFunctions(tools: McpTool[]): FunctionDefinition[] {
  const functions: FunctionDefinition[] = [];
  const errors: string[] = [];

  for (const tool of tools) {
    try {
      functions.push(mapMcpToolToFunction(tool));
    } catch (error) {
      errors.push(`Tool "${tool.name}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (errors.length > 0) {
    console.warn(`[MCP Mapper] Some tools failed to map:\n${errors.join('\n')}`);
  }

  return functions;
}

