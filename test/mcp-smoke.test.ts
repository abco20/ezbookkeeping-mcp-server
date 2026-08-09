import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/server.js';
import type { Runtime } from '../src/runtime.js';
test('MCP server lists and calls tools through official SDK', async () => {
    const runtime = {
        config: { mcp: { name: 'test-server', version: '0.1.0', transport: 'stdio', writeProfile: 'read', batchUpdateLimit: 100, confirmationTtlSeconds: 600 } },
        analyticsService: { async getServerInfo() { return { version: '1.5.0' }; } },
        transactionService: {}, masterService: {}
    };
    const server = createMcpServer(runtime as unknown as Runtime);
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === 'get_server_info'));
    const result = await client.callTool({ name: 'get_server_info', arguments: {} });
    const upstream = (result.structuredContent as { upstream: { version: string } }).upstream;
    assert.equal(upstream.version, '1.5.0');
    await client.close();
    await server.close();
});
