import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ShapeOutput, ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { toolFailure, toolSuccess } from '../lib/response.js';
export function register<Shape extends ZodRawShapeCompat>(
    server: McpServer,
    name: string,
    metadata: { title?: string; description?: string; inputSchema: Shape },
    handler: (args: ShapeOutput<Shape>) => unknown
) {
    const callback = (async (args: ShapeOutput<Shape>) => {
        try {
            const result = await handler(args);
            return toolSuccess(result);
        }
        catch (error) {
            return toolFailure(error);
        }
    }) as unknown as ToolCallback<Shape>;
    server.registerTool(name, metadata, callback);
}
