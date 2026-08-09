import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TransactionService } from '../services/transaction-service.js';
import * as z from 'zod/v4';
import { register } from './register-helper.js';
import { reference, transactionType, amount, selectorShape } from './schemas.js';
export function registerTransactionTools(server: McpServer, transactionService: TransactionService) {
    register(server, 'search_transactions', {
        title: 'Search transactions',
        description: 'Search ezBookkeeping transactions. Results include stable IDs, full tag data, editability and a revision hash for safe updates.',
        inputSchema: {
            ...selectorShape,
            cursor: z.string().optional(),
            limit: z.number().int().min(1).max(100).default(50),
            with_pictures: z.boolean().optional()
        }
    }, (args) => transactionService.search(args));
    register(server, 'get_transaction', {
        title: 'Get transaction',
        description: 'Get one transaction by ID with a revision hash.',
        inputSchema: { transaction_id: z.string().min(1) }
    }, ({ transaction_id }) => transactionService.get(transaction_id));
    register(server, 'create_transaction', {
        title: 'Create transaction',
        description: 'Create an income, expense, transfer or balance modification transaction. Requires standard write profile.',
        inputSchema: {
            type: transactionType,
            category: reference.optional(),
            time: z.string().optional(),
            utc_offset: z.number().int().min(-720).max(840).optional(),
            source_account: reference,
            destination_account: reference.optional(),
            source_amount: amount,
            destination_amount: amount.optional(),
            hide_amount: z.boolean().optional(),
            tags: z.array(reference).max(10).optional(),
            comment: z.string().max(255).optional(),
            geo_location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
            client_session_id: z.string().optional()
        }
    }, (args) => transactionService.create(args));
    register(server, 'patch_transaction', {
        title: 'Patch transaction',
        description: 'Safely update selected transaction fields while preserving all unspecified fields. Supply expected_revision from get/search to prevent lost updates.',
        inputSchema: {
            transaction_id: z.string().min(1),
            expected_revision: z.string().min(1),
            patch: z.object({
                type: transactionType.optional(),
                category: reference.optional(),
                time: z.string().optional(),
                utc_offset: z.number().int().min(-720).max(840).optional(),
                source_account: reference.optional(),
                destination_account: reference.optional(),
                source_amount: amount.optional(),
                destination_amount: amount.optional(),
                hide_amount: z.boolean().optional(),
                tags_set: z.array(reference).max(10).optional(),
                tags_add: z.array(reference).max(10).optional(),
                tags_remove: z.array(reference).max(10).optional(),
                comment: z.string().max(255).optional(),
                geo_location: z.union([z.object({ latitude: z.number(), longitude: z.number() }), z.null()]).optional()
            })
        }
    }, ({ transaction_id, expected_revision, patch }) => transactionService.patch(transaction_id, expected_revision, patch));
    register(server, 'preview_transaction_batch', {
        title: 'Preview batch transaction update',
        description: 'Preview one batch category, tag or account update and receive a signed confirmation token.',
        inputSchema: {
            selector: z.object(selectorShape),
            operation: z.discriminatedUnion('type', [
                z.object({ type: z.literal('set_category'), category: reference }),
                z.object({ type: z.literal('add_tags'), tags: z.array(reference).min(1).max(10) }),
                z.object({ type: z.literal('remove_tags'), tags: z.array(reference).min(1).max(10) }),
                z.object({ type: z.literal('clear_tags') }),
                z.object({ type: z.literal('set_source_account'), account: reference }),
                z.object({ type: z.literal('set_destination_account'), account: reference })
            ])
        }
    }, ({ selector, operation }) => transactionService.previewBatch(selector, operation));
    register(server, 'apply_transaction_batch', {
        title: 'Apply batch transaction update',
        description: 'Apply a previously previewed batch operation. Every target revision is checked again before writing.',
        inputSchema: { confirmation_token: z.string().min(1) }
    }, ({ confirmation_token }) => transactionService.applyBatch(confirmation_token));
    register(server, 'delete_transaction', {
        title: 'Delete transaction',
        description: 'Preview or apply deletion of one transaction. Apply requires a signed confirmation token.',
        inputSchema: {
            transaction_id: z.string().min(1),
            mode: z.enum(['preview', 'apply']),
            confirmation_token: z.string().optional()
        }
    }, ({ transaction_id, mode, confirmation_token }) => transactionService.delete(transaction_id, mode, confirmation_token));
}
