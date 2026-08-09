import type { ApiClient, AuditWriter, RawTransaction, UnknownRecord } from '../../types.js';
import type { BatchOperation, NormalizedTransaction, ResolvedBatchOperation, ServiceDependencies, TransactionSearchInput, TransactionSearchResult, TransactionSelector } from '../../domain-types.js';
import { parseBatchConfirmationPayload, parseDeleteTransactionPayload } from '../../confirmation-payloads.js';
import { AppError, assert } from '../../lib/errors.js';
import { transactionRevision } from '../../lib/revision.js';
import { requireProfile } from '../../lib/permissions.js';
export class TransactionBatchMethods {
    declare client: ApiClient;
    declare catalog: ServiceDependencies['catalog'];
    declare signer: ServiceDependencies['signer'];
    declare audit: AuditWriter;
    declare config: ServiceDependencies['config'];
    declare search: (input?: TransactionSearchInput) => Promise<TransactionSearchResult>;
    declare getRaw: (transactionId: string, options?: { withPictures?: boolean }) => Promise<RawTransaction>;
    declare get: (transactionId: string) => Promise<NormalizedTransaction>;
    declare normalize: (transaction: RawTransaction, options?: { includePictures?: boolean }) => NormalizedTransaction;
    async listBatchTargets(selector: TransactionSelector): Promise<NormalizedTransaction[]> {
        const result = await this.search({ ...selector, with_pictures: true, limit: this.config.batchUpdateLimit });
        if (Number(result.total_count) > this.config.batchUpdateLimit) {
            throw new AppError('BATCH_LIMIT_EXCEEDED', `Batch matches more than ${this.config.batchUpdateLimit} transactions`);
        }
        assert(result.transactions.length > 0, 'NO_TRANSACTIONS_MATCHED', 'No transactions matched the selector');
        return result.transactions;
    }
    async resolveBatchOperation(operation: BatchOperation): Promise<ResolvedBatchOperation> {
        switch (operation.type) {
            case 'set_category': {
                const category = await this.catalog.resolveCategory(operation.category);
                return { type: operation.type, categoryId: String(category.id), categoryType: category.type, categoryName: category.name, parentId: String(category.parentId ?? '0'), hidden: Boolean(category.hidden) };
            }
            case 'add_tags': {
                const tags = await Promise.all(operation.tags.map((ref) => this.catalog.resolveTag(ref)));
                return { type: operation.type, tagIds: tags.map((tag) => String(tag.id)), tags: tags.map((tag) => ({ id: String(tag.id), name: tag.name, hidden: Boolean(tag.hidden) })) };
            }
            case 'remove_tags': {
                const tags = await Promise.all(operation.tags.map((ref) => this.catalog.resolveTag(ref)));
                return { type: operation.type, tagIds: tags.map((tag) => String(tag.id)), tags: tags.map((tag) => ({ id: String(tag.id), name: tag.name })) };
            }
            case 'clear_tags': return { type: operation.type };
            case 'set_source_account': {
                const account = await this.catalog.resolveAccount(operation.account);
                return { type: operation.type, accountId: String(account.id), accountName: account.name, currency: account.currency, accountType: account.type, hidden: Boolean(account.hidden), isDestinationAccount: false };
            }
            case 'set_destination_account': {
                const account = await this.catalog.resolveAccount(operation.account);
                return { type: operation.type, accountId: String(account.id), accountName: account.name, currency: account.currency, accountType: account.type, hidden: Boolean(account.hidden), isDestinationAccount: true };
            }
            default: throw new AppError('INVALID_BATCH_OPERATION', 'Unsupported batch operation');
        }
    }
    async previewBatch(selector: TransactionSelector, operation: BatchOperation) {
        requireProfile(this.config.writeProfile, 'standard', 'preview_transaction_batch');
        const targets = await this.listBatchTargets(selector);
        const resolvedOperation = await this.resolveBatchOperation(operation);
        validateBatchTargets(targets, resolvedOperation);
        const changes = targets.map((transaction) => ({
            id: transaction.id,
            revision: transaction.revision,
            before: summarizeForBatch(transaction),
            after: summarizeBatchAfter(transaction, resolvedOperation)
        }));
        const confirmation = this.signer.issue('apply_transaction_batch', {
            transaction_ids: targets.map((item) => item.id),
            revisions: Object.fromEntries(targets.map((item) => [item.id, item.revision])),
            operation: resolvedOperation
        });
        return { matched_count: targets.length, operation: resolvedOperation, changes, confirmation_token: confirmation.token, expires_at: confirmation.expires_at };
    }
    async applyBatch(token: string) {
        requireProfile(this.config.writeProfile, 'standard', 'apply_transaction_batch');
        const payload = this.signer.verify(token, 'apply_transaction_batch', parseBatchConfirmationPayload);
        const raws = await Promise.all(payload.transaction_ids.map((id) => this.getRaw(id, { withPictures: true })));
        for (const raw of raws) {
            const revision = transactionRevision(raw);
            if (payload.revisions[String(raw.id)] !== revision) {
                throw new AppError('TRANSACTION_CHANGED', `Transaction ${raw.id} changed after preview`, {
                    details: { transaction_id: String(raw.id), expected_revision: payload.revisions[String(raw.id)], current_revision: revision }
                });
            }
            assert(raw.editable !== false, 'TRANSACTION_NOT_EDITABLE', `Transaction ${raw.id} is not editable`);
        }
        const op = await this.refreshBatchOperation(payload.operation);
        validateBatchTargets(raws.map((raw) => this.normalize(raw)), op);
        const ids = payload.transaction_ids.map(String);
        let endpoint: string;
        let body: UnknownRecord;
        if (op.type === 'set_category') {
            endpoint = 'transactions/batch_update/category.json';
            body = { transactionIds: ids, categoryId: op.categoryId };
        }
        else if (op.type === 'add_tags') {
            endpoint = 'transactions/batch_update/tag/add.json';
            body = { transactionIds: ids, tagIds: op.tagIds };
        }
        else if (op.type === 'remove_tags') {
            endpoint = 'transactions/batch_update/tag/remove.json';
            body = { transactionIds: ids, tagIds: op.tagIds };
        }
        else if (op.type === 'clear_tags') {
            endpoint = 'transactions/batch_update/tag/clear.json';
            body = { transactionIds: ids };
        }
        else if (op.type === 'set_source_account' || op.type === 'set_destination_account') {
            endpoint = 'transactions/batch_update/account.json';
            body = { transactionIds: ids, accountId: op.accountId, isDestinationAccount: op.isDestinationAccount };
        }
        else
            throw new AppError('INVALID_BATCH_OPERATION', 'Unsupported batch operation');
        await this.client.post(endpoint, body, { timeoutMs: 1800000 });
        this.catalog.invalidate?.('accounts');
        const auditId = await this.audit.write({ tool: 'apply_transaction_batch', target_ids: ids, normalized_arguments: { operation: op }, result: 'success' });
        return { updated_count: ids.length, transaction_ids: ids, operation: op, audit_id: auditId };
    }
    async refreshBatchOperation(operation: ResolvedBatchOperation): Promise<ResolvedBatchOperation> {
        if (operation.type === 'set_category') {
            this.catalog.invalidate?.('categories');
            return this.resolveBatchOperation({ type: operation.type, category: { id: operation.categoryId } });
        }
        if (operation.type === 'add_tags' || operation.type === 'remove_tags') {
            this.catalog.invalidate?.('tags');
            return this.resolveBatchOperation({ type: operation.type, tags: operation.tagIds.map((id) => ({ id })) });
        }
        if (operation.type === 'set_source_account' || operation.type === 'set_destination_account') {
            this.catalog.invalidate?.('accounts');
            return this.resolveBatchOperation({ type: operation.type, account: { id: operation.accountId } });
        }
        if (operation.type === 'clear_tags')
            return { type: operation.type };
        throw new AppError('INVALID_BATCH_OPERATION', 'Unsupported batch operation');
    }
    async delete(transactionId: string, mode: 'preview' | 'apply', confirmationToken?: string) {
        requireProfile(this.config.writeProfile, 'standard', 'delete_transaction');
        if (mode === 'preview') {
            const transaction = await this.get(transactionId);
            assert(transaction.editable, 'TRANSACTION_NOT_EDITABLE', 'Transaction is not editable');
            const confirmation = this.signer.issue('delete_transaction', { transaction_id: transaction.id, revision: transaction.revision });
            return { transaction, confirmation_token: confirmation.token, expires_at: confirmation.expires_at };
        }
        if (mode !== 'apply')
            throw new AppError('INVALID_MODE', 'mode must be preview or apply');
        assert(confirmationToken, 'CONFIRMATION_TOKEN_REQUIRED', 'confirmation_token is required for apply');
        const payload = this.signer.verify(confirmationToken, 'delete_transaction', parseDeleteTransactionPayload);
        assert(String(payload.transaction_id) === String(transactionId), 'CONFIRMATION_TARGET_MISMATCH', 'Confirmation token targets another transaction');
        const current = await this.getRaw(transactionId);
        const revision = transactionRevision(current);
        if (revision !== payload.revision)
            throw new AppError('TRANSACTION_CHANGED', 'Transaction changed after deletion preview');
        await this.client.post('transactions/delete.json', { id: String(transactionId) });
        this.catalog.invalidate?.('accounts');
        const auditId = await this.audit.write({ tool: 'delete_transaction', target_ids: [String(transactionId)], before_revision: revision, result: 'success' });
        return { deleted: true, transaction_id: String(transactionId), audit_id: auditId };
    }
}
interface BatchSummary {
    category: NormalizedTransaction['category'];
    source_account: NormalizedTransaction['source_account'];
    destination_account: NormalizedTransaction['destination_account'];
    tags: NormalizedTransaction['tags'];
}
function summarizeForBatch(transaction: NormalizedTransaction): BatchSummary {
    return { category: transaction.category, source_account: transaction.source_account, destination_account: transaction.destination_account, tags: transaction.tags };
}
function summarizeBatchAfter(transaction: NormalizedTransaction, operation: ResolvedBatchOperation): BatchSummary {
    const result = summarizeForBatch(transaction);
    if (operation.type === 'set_category')
        result.category = { id: operation.categoryId };
    if (operation.type === 'add_tags')
        result.tags = [...transaction.tags, ...operation.tagIds.filter((id) => !transaction.tag_ids.includes(id)).map((id) => ({ id, name: operation.tags.find((tag) => tag.id === id)?.name ?? id, group_id: '0' }))];
    if (operation.type === 'remove_tags')
        result.tags = transaction.tags.filter((tag) => !operation.tagIds.includes(tag.id));
    if (operation.type === 'clear_tags')
        result.tags = [];
    if (operation.type === 'set_source_account')
        result.source_account = { id: operation.accountId };
    if (operation.type === 'set_destination_account')
        result.destination_account = { id: operation.accountId };
    return result;
}
function validateBatchTargets(targets: NormalizedTransaction[], operation: ResolvedBatchOperation): void {
    if (operation.type === 'set_category') {
        assert(operation.parentId !== '0', 'PRIMARY_CATEGORY_NOT_ALLOWED', 'Transactions must use a secondary category');
        assert(!operation.hidden, 'HIDDEN_CATEGORY_NOT_ALLOWED', 'Cannot assign a hidden category');
        const expected: Record<string, number> = { income: 1, expense: 2, transfer: 3 };
        for (const target of targets) {
            assert(expected[target.type] === operation.categoryType, 'CATEGORY_TYPE_MISMATCH', `Category type does not match transaction ${target.id}`);
        }
    }
    if (operation.type === 'add_tags') {
        assert(operation.tags.every((tag) => !tag.hidden), 'HIDDEN_TAG_NOT_ALLOWED', 'Cannot add a hidden tag');
        for (const target of targets) {
            const finalCount = new Set([...target.tag_ids, ...operation.tagIds]).size;
            assert(finalCount <= 10, 'TOO_MANY_TAGS', `Transaction ${target.id} would exceed the 10-tag limit`);
        }
    }
    if (operation.type === 'set_source_account' || operation.type === 'set_destination_account') {
        assert(!operation.hidden, 'HIDDEN_ACCOUNT_NOT_ALLOWED', 'Cannot move transactions to a hidden account');
        assert(operation.accountType !== 2, 'PARENT_ACCOUNT_NOT_ALLOWED', 'Cannot assign transactions to a parent account');
        for (const target of targets) {
            if (operation.type === 'set_destination_account') {
                assert(target.type === 'transfer', 'DESTINATION_ACCOUNT_NOT_APPLICABLE', `Transaction ${target.id} is not a transfer`);
                assert(target.destination_account?.currency === operation.currency, 'ACCOUNT_CURRENCY_MISMATCH', `Destination currency differs for transaction ${target.id}`);
                assert(target.source_account?.id !== operation.accountId, 'SAME_TRANSFER_ACCOUNT', `Transaction ${target.id} would use the same source and destination account`);
            }
            else {
                assert(target.source_account?.currency === operation.currency, 'ACCOUNT_CURRENCY_MISMATCH', `Source currency differs for transaction ${target.id}`);
                assert(target.destination_account?.id !== operation.accountId, 'SAME_TRANSFER_ACCOUNT', `Transaction ${target.id} would use the same source and destination account`);
            }
        }
    }
}
