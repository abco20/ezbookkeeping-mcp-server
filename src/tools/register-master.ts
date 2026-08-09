import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MasterService } from '../services/master-service.js';
import * as z from 'zod/v4';
import { register } from './register-helper.js';
import { reference, accountCreate, accountPatch, categoryCreate, categoryPatch, tagCreate, tagPatch, templateCreate, templatePatch } from './schemas.js';
export function registerMasterTools(server: McpServer, masterService: MasterService) {
    register(server, 'list_accounts', {
        title: 'List accounts',
        description: 'List all accounts and subaccounts with IDs, balances and hierarchy paths.',
        inputSchema: { include_hidden: z.boolean().default(true) }
    }, (args) => masterService.listAccounts(args));
    register(server, 'manage_account', {
        title: 'Manage account',
        description: 'Create, update, hide, unhide, reorder or delete accounts. Account deletion requires admin profile and Preview/Apply.',
        inputSchema: {
            operation: z.enum(['create', 'update', 'hide', 'unhide', 'move', 'delete']),
            account: accountCreate.optional(),
            account_ref: reference.optional(),
            patch: accountPatch.optional(),
            orders: z.array(z.object({ account: reference, display_order: z.number().int() })).optional(),
            mode: z.enum(['preview', 'apply']).optional(),
            confirmation_token: z.string().optional()
        }
    }, (args) => masterService.manageAccount(args));
    register(server, 'list_categories', {
        title: 'List transaction categories',
        description: 'List income, expense and transfer category trees.',
        inputSchema: { include_hidden: z.boolean().default(true), type: z.enum(['income', 'expense', 'transfer']).optional() }
    }, (args) => masterService.listCategories(args));
    register(server, 'manage_category', {
        title: 'Manage transaction category',
        description: 'Create, update, hide, unhide, reorder or delete transaction categories. Delete uses Preview/Apply.',
        inputSchema: {
            operation: z.enum(['create', 'update', 'hide', 'unhide', 'move', 'delete']),
            category: categoryCreate.optional(),
            category_ref: reference.optional(),
            patch: categoryPatch.optional(),
            orders: z.array(z.object({ category: reference, display_order: z.number().int() })).optional(),
            mode: z.enum(['preview', 'apply']).optional(),
            confirmation_token: z.string().optional()
        }
    }, (args) => masterService.manageCategory(args));
    register(server, 'list_tag_groups', {
        title: 'List tag groups',
        description: 'List transaction tag groups.',
        inputSchema: {}
    }, () => masterService.listTagGroups());
    register(server, 'manage_tag_group', {
        title: 'Manage tag group',
        description: 'Create, rename, reorder or delete a tag group. Delete uses Preview/Apply.',
        inputSchema: {
            operation: z.enum(['create', 'update', 'move', 'delete']),
            group: z.object({ name: z.string().min(1).max(64) }).optional(),
            group_ref: reference.optional(),
            patch: z.object({ name: z.string().min(1).max(64).optional() }).optional(),
            orders: z.array(z.object({ group: reference, display_order: z.number().int() })).optional(),
            mode: z.enum(['preview', 'apply']).optional(),
            confirmation_token: z.string().optional()
        }
    }, (args) => masterService.manageTagGroup(args));
    register(server, 'list_tags', {
        title: 'List tags',
        description: 'List all transaction tags with group names.',
        inputSchema: { include_hidden: z.boolean().default(true) }
    }, (args) => masterService.listTags(args));
    register(server, 'manage_tag', {
        title: 'Manage tag',
        description: 'Create, update, hide, unhide, reorder or delete tags. Delete uses Preview/Apply.',
        inputSchema: {
            operation: z.enum(['create', 'update', 'hide', 'unhide', 'move', 'delete']),
            tag: tagCreate.optional(),
            tag_ref: reference.optional(),
            patch: tagPatch.optional(),
            orders: z.array(z.object({ tag: reference, display_order: z.number().int() })).optional(),
            mode: z.enum(['preview', 'apply']).optional(),
            confirmation_token: z.string().optional()
        }
    }, (args) => masterService.manageTag(args));
    register(server, 'list_templates', {
        title: 'List transaction templates',
        description: 'List normal or scheduled transaction templates.',
        inputSchema: { template_type: z.enum(['normal', 'schedule']).optional() }
    }, (args) => masterService.listTemplates(args));
    register(server, 'manage_template', {
        title: 'Manage transaction template',
        description: 'Create, update, hide, unhide, reorder or delete normal and scheduled transaction templates.',
        inputSchema: {
            operation: z.enum(['create', 'update', 'hide', 'unhide', 'move', 'delete']),
            template_type: z.enum(['normal', 'schedule']).optional(),
            template: templateCreate.optional(),
            template_ref: reference.optional(),
            patch: templatePatch.optional(),
            orders: z.array(z.object({ template: reference, display_order: z.number().int() })).optional(),
            mode: z.enum(['preview', 'apply']).optional(),
            confirmation_token: z.string().optional()
        }
    }, (args) => masterService.manageTemplate(args));
}
