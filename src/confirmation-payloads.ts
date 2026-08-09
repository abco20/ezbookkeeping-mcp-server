import * as z from 'zod/v4';
import type { BatchConfirmationPayload, DeleteTransactionPayload, EntityDeletePayload } from './domain-types.js';

const resolvedBatchOperation = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('set_category'), categoryId: z.string(), categoryType: z.number(),
        categoryName: z.string(), parentId: z.string(), hidden: z.boolean()
    }).strict(),
    z.object({
        type: z.literal('add_tags'), tagIds: z.array(z.string()),
        tags: z.array(z.object({ id: z.string(), name: z.string(), hidden: z.boolean() }).strict())
    }).strict(),
    z.object({
        type: z.literal('remove_tags'), tagIds: z.array(z.string()),
        tags: z.array(z.object({ id: z.string(), name: z.string() }).strict())
    }).strict(),
    z.object({ type: z.literal('clear_tags') }).strict(),
    z.object({
        type: z.enum(['set_source_account', 'set_destination_account']), accountId: z.string(),
        accountName: z.string(), currency: z.string(), accountType: z.number(), hidden: z.boolean(),
        isDestinationAccount: z.boolean()
    }).strict()
]);

const batchConfirmationPayload = z.object({
    transaction_ids: z.array(z.string()).min(1),
    revisions: z.record(z.string(), z.string()),
    operation: resolvedBatchOperation
}).strict();

const deleteTransactionPayload = z.object({ transaction_id: z.string(), revision: z.string() }).strict();
const entityDeletePayload = z.object({ id: z.string(), revision: z.string() }).strict();

export function parseBatchConfirmationPayload(value: unknown): BatchConfirmationPayload {
    return batchConfirmationPayload.parse(value);
}

export function parseDeleteTransactionPayload(value: unknown): DeleteTransactionPayload {
    return deleteTransactionPayload.parse(value);
}

export function parseEntityDeletePayload(value: unknown): EntityDeletePayload {
    return entityDeletePayload.parse(value);
}
