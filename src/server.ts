import type { Runtime } from './runtime.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from './tools/register.js';
export function createMcpServer(runtime: Runtime) {
    const server = new McpServer({ name: runtime.config.mcp.name, version: runtime.config.mcp.version }, { capabilities: { logging: {} } });
    registerTools(server, runtime);
    return server;
}
