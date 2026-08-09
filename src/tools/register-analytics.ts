import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppConfig } from '../types.js';
import type { AnalyticsService } from '../services/analytics-service.js';
import * as z from 'zod/v4';
import { capabilitiesForProfile } from '../lib/permissions.js';
import { register } from './register-helper.js';
import { reference } from './schemas.js';
export function registerAnalyticsTools(server: McpServer, analyticsService: AnalyticsService, config: AppConfig) {
    register(server, 'get_server_info', {
        title: 'Get ezBookkeeping server information',
        description: 'Return upstream version information and enabled MCP write capabilities.',
        inputSchema: {}
    }, async () => ({
        upstream: await analyticsService.getServerInfo(),
        mcp: {
            name: config.mcp.name,
            version: config.mcp.version,
            transport: config.mcp.transport,
            capabilities: capabilitiesForProfile(config.mcp.writeProfile),
            limits: {
                batch_update: config.mcp.batchUpdateLimit,
                confirmation_ttl_seconds: config.mcp.confirmationTtlSeconds
            }
        }
    }));
    register(server, 'get_financial_summary', {
        title: 'Get financial summary',
        description: 'Return period totals and category/account breakdown using ezBookkeeping server-side statistics.',
        inputSchema: {
            start_time: z.string(),
            end_time: z.string(),
            keyword: z.string().optional(),
            ignore_case: z.boolean().optional(),
            use_transaction_timezone: z.boolean().default(true)
        }
    }, (args) => analyticsService.getFinancialSummary(args));
    register(server, 'get_financial_trends', {
        title: 'Get financial trends',
        description: 'Return monthly income/expense trends or daily asset balance trends.',
        inputSchema: {
            kind: z.enum(['income_expense', 'assets']),
            start_year_month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
            end_year_month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
            start_time: z.string().optional(),
            end_time: z.string().optional(),
            keyword: z.string().optional(),
            ignore_case: z.boolean().optional(),
            use_transaction_timezone: z.boolean().default(true)
        }
    }, (args) => analyticsService.getFinancialTrends(args));
    register(server, 'get_reconciliation_statement', {
        title: 'Get reconciliation statement',
        description: 'Return account opening/closing balances and transaction running balances for reconciliation.',
        inputSchema: { account: reference, start_time: z.string().optional(), end_time: z.string().optional() }
    }, (args) => analyticsService.getReconciliationStatement(args));
    register(server, 'get_exchange_rates', {
        title: 'Get exchange rates',
        description: 'Return latest upstream and user-custom exchange rates.',
        inputSchema: {}
    }, () => analyticsService.getExchangeRates());
    register(server, 'manage_custom_exchange_rate', {
        title: 'Manage custom exchange rate',
        description: 'Set or delete a user custom exchange rate. Requires extended write profile.',
        inputSchema: {
            operation: z.enum(['set', 'delete']),
            currency: z.string().length(3),
            rate: z.string().optional()
        }
    }, (args) => analyticsService.manageCustomExchangeRate(args));
}
