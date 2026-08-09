import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Runtime } from '../runtime.js';
import { registerTransactionTools } from './register-transactions.js';
import { registerMasterTools } from './register-master.js';
import { registerAnalyticsTools } from './register-analytics.js';
export function registerTools(server: McpServer, runtime: Runtime) {
    const { transactionService, masterService, analyticsService, config } = runtime;
    registerAnalyticsTools(server, analyticsService, config);
    registerTransactionTools(server, transactionService);
    registerMasterTools(server, masterService);
}
