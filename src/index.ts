#!/usr/bin/env node
import type { Runtime } from './runtime.js';
import { loadConfig } from './config.js';
import { createRuntime } from './runtime.js';
import { createMcpServer } from './server.js';
import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
function bearerMatches(header: unknown, expectedToken: string): boolean {
    if (typeof header !== 'string') return false;
    const value = header;
    if (!value.toLowerCase().startsWith('bearer '))
        return false;
    const actual = Buffer.from(value.slice(7));
    const expected = Buffer.from(expectedToken);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}
async function runStdio(runtime: Runtime) {
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    const server = createMcpServer(runtime);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`${runtime.config.mcp.name} ${runtime.config.mcp.version} running over stdio`);
}
async function runHttp(runtime: Runtime) {
    const [{ StreamableHTTPServerTransport }, { createMcpExpressApp }] = await Promise.all([
        import('@modelcontextprotocol/sdk/server/streamableHttp.js'),
        import('@modelcontextprotocol/sdk/server/express.js')
    ]);
    const app = createMcpExpressApp({
        host: runtime.config.mcp.host,
        ...(runtime.config.mcp.httpAllowedHosts ? { allowedHosts: runtime.config.mcp.httpAllowedHosts } : {})
    });
    app.get('/healthz', (_req: Request, res: Response) => {
        const auditHealthy = runtime.audit.lastError == null;
        res.status(auditHealthy ? 200 : 503).json({
            status: auditHealthy ? 'ok' : 'degraded',
            name: runtime.config.mcp.name,
            version: runtime.config.mcp.version,
            audit_log: auditHealthy ? 'ok' : 'error'
        });
    });
    if (runtime.config.mcp.httpBearerToken) {
        app.use('/mcp', (req: Request, res: Response, next: NextFunction) => {
            if (!bearerMatches(req.headers.authorization, runtime.config.mcp.httpBearerToken)) {
                res.setHeader('WWW-Authenticate', 'Bearer');
                res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
                return;
            }
            next();
        });
    }
    app.post('/mcp', async (req: Request, res: Response) => {
        const server = createMcpServer(runtime);
        const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
        res.on('close', () => {
            void transport.close();
            void server.close();
        });
        try {
            await server.connect(transport as Transport);
            await transport.handleRequest(req, res, req.body);
        }
        catch (error) {
            console.error('MCP HTTP request failed', error);
            if (!res.headersSent) {
                res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
            }
        }
    });
    app.get('/mcp', (_req: Request, res: Response) => res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }));
    app.delete('/mcp', (_req: Request, res: Response) => res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }));
    const listener = app.listen(runtime.config.mcp.port, runtime.config.mcp.host, () => {
        console.error(`${runtime.config.mcp.name} listening at http://${runtime.config.mcp.host}:${runtime.config.mcp.port}/mcp`);
    });
    const shutdown = () => listener.close(() => process.exit(0));
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}
try {
    const config = loadConfig();
    const runtime = createRuntime(config);
    if (config.mcp.writeProfile !== 'read') {
        if (!runtime.audit.ensureWritable)
            throw new Error('Configured audit writer does not support startup writability checks');
        await runtime.audit.ensureWritable();
    }
    if (config.mcp.transport === 'http')
        await runHttp(runtime);
    else
        await runStdio(runtime);
}
catch (error) {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
}
