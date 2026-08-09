import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppConfig, UnknownRecord } from '../src/types.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createRuntime } from '../src/runtime.js';
import { createMcpServer } from '../src/server.js';
function success(res: ServerResponse, result: unknown) {
    res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'mock-request' });
    res.end(JSON.stringify({ success: true, result }));
}
async function readJson(req: IncomingMessage): Promise<UnknownRecord> {
    let body = '';
    for await (const chunk of req)
        body += chunk;
    return body ? JSON.parse(body) as UnknownRecord : {};
}
function createMockServer() {
    const state = {
        transaction: {
            id: '1', timeSequenceId: '1700000000000', type: 3,
            categoryId: '10', category: { id: '10', name: 'Other', parentId: '9', type: 2 },
            time: 1700000000, utcOffset: 540,
            sourceAccountId: '20', sourceAccount: { id: '20', name: 'Card', currency: 'JPY' },
            destinationAccountId: '0', sourceAmount: 1000, destinationAmount: null,
            hideAmount: false, tagIds: ['30'], tags: [{ id: '30', name: 'Review', groupId: '0' }],
            pictures: [], comment: 'merchant', geoLocation: null, editable: true
        }
    };
    const server = http.createServer(async (req, res) => {
        assert.equal(req.headers.authorization, 'Bearer test-token');
        const url = new URL(req.url ?? '/', 'http://localhost');
        const route = url.pathname.replace('/api/v1/', '');
        if (route === 'systems/version.json')
            return success(res, { version: '1.5.0' });
        if (route === 'accounts/list.json')
            return success(res, [{
                    id: '20', name: 'Card', parentId: '0', category: 3, type: 1, icon: '1', color: '409EFF', currency: 'JPY', balance: '0', comment: '', displayOrder: 0, hidden: false
                }]);
        if (route === 'transaction/categories/list.json')
            return success(res, {
                2: [{ id: '9', name: 'Expense', parentId: '0', type: 2, icon: '1', color: '409EFF', comment: '', displayOrder: 0, hidden: false,
                        subCategories: [
                            { id: '10', name: 'Other', parentId: '9', type: 2, icon: '1', color: '409EFF', comment: '', displayOrder: 0, hidden: false },
                            { id: '11', name: 'Medical', parentId: '9', type: 2, icon: '1', color: '409EFF', comment: '', displayOrder: 1, hidden: false }
                        ] }]
            });
        if (route === 'transaction/tags/groups/list.json')
            return success(res, []);
        if (route === 'transaction/tags/list.json')
            return success(res, [{ id: '30', name: 'Review', groupId: '0', displayOrder: 0, hidden: false }]);
        if (route === 'transactions/list.json')
            return success(res, { items: [state.transaction], totalCount: 1 });
        if (route === 'transactions/get.json')
            return success(res, state.transaction);
        if (route === 'transactions/modify.json') {
            const body = await readJson(req) as Partial<typeof state.transaction> & { categoryId?: string };
            state.transaction = {
                ...state.transaction,
                ...body,
                category: body.categoryId === '11' ? { id: '11', name: 'Medical', parentId: '9', type: 2 } : state.transaction.category,
                tags: state.transaction.tags,
                pictures: []
            };
            return success(res, state.transaction);
        }
        if (route === 'transactions/batch_update/category.json') {
            const body = await readJson(req);
            const categoryId = String(body.categoryId);
            state.transaction.categoryId = categoryId;
            state.transaction.category = { id: categoryId, name: categoryId === '11' ? 'Medical' : 'Other', parentId: '9', type: 2 };
            return success(res, true);
        }
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: false, errorCode: 100001, errorMessage: `No mock for ${route}`, path: url.pathname }));
    });
    return { server, state };
}
test('end-to-end MCP flow works against mocked ezBookkeeping API', async () => {
    const { server: upstream, state } = createMockServer();
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
    const temp = await mkdtemp(path.join(os.tmpdir(), 'ezbk-mcp-'));
    const config = {
        ezbookkeeping: {
            baseUrl: `http://127.0.0.1:${address.port}`,
            apiToken: 'test-token', timezone: 'Asia/Tokyo', timezoneOffset: 540, timeoutMs: 2000
        },
        mcp: {
            name: 'e2e-server', version: '0.1.0', transport: 'stdio', host: '127.0.0.1', port: 3000,
            writeProfile: 'standard', confirmationSecret: 'x'.repeat(64), confirmationTtlSeconds: 600,
            batchUpdateLimit: 100, auditLogPath: path.join(temp, 'audit.jsonl')
        }
    };
    const runtime = createRuntime(config as unknown as AppConfig);
    const mcpServer = createMcpServer(runtime);
    const client = new Client({ name: 'e2e-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)]);
    try {
        const search = await client.callTool({ name: 'search_transactions', arguments: { limit: 10 } });
        const searchData = search.structuredContent as { total_count: number; transactions: { revision: string; category: { name: string } }[] };
        assert.equal(searchData.total_count, 1);
        const first = searchData.transactions[0]!;
        assert.equal(first.category.name, 'Other');
        const missingRevision = await client.callTool({
            name: 'patch_transaction',
            arguments: { transaction_id: '1', patch: { category: { name: 'Medical' } } }
        });
        assert.equal(missingRevision.isError, true);
        const patched = await client.callTool({
            name: 'patch_transaction',
            arguments: { transaction_id: '1', expected_revision: first.revision, patch: { category: { name: 'Medical' } } }
        });
        const patchedData = patched.structuredContent as { category: { name: string } };
        assert.equal(patchedData.category.name, 'Medical');
        state.transaction.categoryId = '10';
        state.transaction.category = { id: '10', name: 'Other', parentId: '9', type: 2 };
        const preview = await client.callTool({
            name: 'preview_transaction_batch',
            arguments: { selector: {}, operation: { type: 'set_category', category: { name: 'Medical' } } }
        });
        const previewData = preview.structuredContent as { matched_count: number; confirmation_token: string };
        assert.equal(previewData.matched_count, 1);
        const applied = await client.callTool({
            name: 'apply_transaction_batch', arguments: { confirmation_token: previewData.confirmation_token }
        });
        const appliedData = applied.structuredContent as { updated_count: number };
        assert.equal(appliedData.updated_count, 1);
        assert.equal(state.transaction.categoryId, '11');
    }
    finally {
        await client.close();
        await mcpServer.close();
        upstream.close();
        await rm(temp, { recursive: true, force: true });
    }
});
