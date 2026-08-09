import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
function createVersionServer() {
    return http.createServer((req, res) => {
        if (req.headers.authorization !== 'Bearer smoke-token') {
            res.writeHead(401).end();
            return;
        }
        if (req.url?.startsWith('/api/v1/systems/version.json')) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: true, result: { version: '1.5.0-smoke' } }));
            return;
        }
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: false, errorCode: 100001, errorMessage: 'not found' }));
    });
}
async function listen(server: http.Server): Promise<number> {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
    return address.port;
}
async function allocatePort() {
    const server = http.createServer();
    const port = await listen(server);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    return port;
}
async function waitForHealth(url: string): Promise<void> {
    let lastError;
    for (let attempt = 0; attempt < 50; attempt += 1) {
        try {
            const response = await fetch(url);
            if (response.ok)
                return;
        }
        catch (error) {
            lastError = error;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    throw lastError ?? new Error(`Timed out waiting for ${url}`);
}
function baseEnv(upstreamPort: number, temp: string): NodeJS.ProcessEnv {
    return {
        ...process.env,
        EZBK_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
        EZBK_API_TOKEN: 'smoke-token',
        EZBK_TIMEZONE: 'Asia/Tokyo',
        MCP_WRITE_PROFILE: 'read',
        MCP_AUDIT_LOG_PATH: path.join(temp, 'audit.jsonl')
    };
}
test('stdio transport works through the official MCP client', async () => {
    const upstream = createVersionServer();
    const upstreamPort = await listen(upstream);
    const temp = await mkdtemp(path.join(os.tmpdir(), 'ezbk-stdio-'));
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', path.resolve('src/index.ts')],
        env: { ...baseEnv(upstreamPort, temp), MCP_TRANSPORT: 'stdio' },
        stderr: 'pipe'
    });
    const client = new Client({ name: 'stdio-smoke', version: '1.0.0' });
    try {
        await client.connect(transport);
        const result = await client.callTool({ name: 'get_server_info', arguments: {} });
        const upstream = (result.structuredContent as { upstream: { version: string } }).upstream;
        assert.equal(upstream.version, '1.5.0-smoke');
    }
    finally {
        await client.close().catch(() => { });
        upstream.close();
        await rm(temp, { recursive: true, force: true });
    }
});
test('Streamable HTTP transport works through the official MCP client', async () => {
    const { spawn } = await import('node:child_process');
    const upstream = createVersionServer();
    const upstreamPort = await listen(upstream);
    const mcpPort = await allocatePort();
    const temp = await mkdtemp(path.join(os.tmpdir(), 'ezbk-http-'));
    const child = spawn(process.execPath, ['--import', 'tsx', path.resolve('src/index.ts')], {
        env: {
            ...baseEnv(upstreamPort, temp),
            MCP_TRANSPORT: 'http', MCP_HTTP_HOST: '127.0.0.1', MCP_HTTP_PORT: String(mcpPort),
            MCP_HTTP_BEARER_TOKEN: 'm'.repeat(64)
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    try {
        await waitForHealth(`http://127.0.0.1:${mcpPort}/healthz`);
        const unauthorized = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
        });
        assert.equal(unauthorized.status, 401);
        const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${'m'.repeat(64)}` } } });
        const client = new Client({ name: 'http-smoke', version: '1.0.0' });
        await client.connect(transport as unknown as Transport);
        const result = await client.callTool({ name: 'get_server_info', arguments: {} });
        const upstream = (result.structuredContent as { upstream: { version: string } }).upstream;
        assert.equal(upstream.version, '1.5.0-smoke');
        await client.close();
    }
    finally {
        child.kill('SIGTERM');
        await once(child, 'exit').catch(() => { });
        upstream.close();
        await rm(temp, { recursive: true, force: true });
    }
});
