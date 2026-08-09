#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import path from 'node:path';
const required = ['EZBK_BASE_URL', 'EZBK_API_TOKEN'];
for (const name of required) {
    if (!process.env[name]) {
        console.error(`${name} is required`);
        process.exit(2);
    }
}
const childEnv: Record<string, string> = {};
for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) childEnv[name] = value;
}
const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve('dist/index.js')],
    env: {
        ...childEnv,
        MCP_TRANSPORT: 'stdio',
        MCP_WRITE_PROFILE: 'read',
        MCP_CONFIRMATION_SECRET: '',
        MCP_AUDIT_LOG_PATH: process.env.MCP_AUDIT_LOG_PATH || './data/real-smoke-audit.jsonl'
    },
    stderr: 'pipe'
});
const client = new Client({ name: 'ezbookkeeping-real-smoke', version: '0.1.0' });
async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const result = await client.callTool({ name, arguments: args }) as CallToolResult;
    if (result.isError)
        throw new Error(`${name} failed: ${result.content[0]?.type === 'text' ? result.content[0].text : 'unknown error'}`);
    if (!result.structuredContent)
        throw new Error(`${name} returned no structured content`);
    return result.structuredContent as T;
}
try {
    await client.connect(transport);
    const server = await call<{ upstream: unknown; mcp: unknown }>('get_server_info');
    const accounts = await call<{ items: unknown[] }>('list_accounts', { include_hidden: true });
    const categories = await call<{ items: unknown[] }>('list_categories', { include_hidden: true });
    const groups = await call<{ items: unknown[] }>('list_tag_groups');
    const tags = await call<{ items: unknown[] }>('list_tags', { include_hidden: true });
    const transactions = await call<{ total_count: number }>('search_transactions', { limit: 1 });
    console.log(JSON.stringify({
        ok: true,
        upstream: server.upstream,
        mcp: server.mcp,
        counts: {
            accounts: accounts.items.length,
            categories: categories.items.length,
            tag_groups: groups.items.length,
            tags: tags.items.length,
            matched_transactions: transactions.total_count
        }
    }, null, 2));
}
finally {
    await client.close().catch(() => { });
}
