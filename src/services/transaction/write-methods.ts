import type { Account, ApiClient, AuditWriter, Category, RawTransaction, Tag, UnknownRecord } from '../../types.js';
import type { CreateTransactionInput, NormalizedTransaction, ServiceDependencies, TransactionPatch, TransactionTypeName } from '../../domain-types.js';
import { AppError, assert } from '../../lib/errors.js';
import { decimalToMinor } from '../../lib/amounts.js';
import { parseUnixTime, getTimezoneOffsetMinutes } from '../../lib/time.js';
import { transactionRevision } from '../../lib/revision.js';
import { requireProfile } from '../../lib/permissions.js';
const TYPE_CODE: Record<string, number> = { balance_modification: 1, income: 2, expense: 3, transfer: 4 };
const TYPE_NAME: Record<number, TransactionTypeName> = { 1: 'balance_modification', 2: 'income', 3: 'expense', 4: 'transfer' };
const CATEGORY_TYPE_FOR_TRANSACTION: Record<string, number> = { income: 1, expense: 2, transfer: 3 };
function assertUsableAccount(account: Account | null | undefined, label = 'account'): asserts account is Account {
    assert(account, 'ACCOUNT_REQUIRED', `${label} is required`);
    assert(!account.hidden, 'HIDDEN_ACCOUNT_NOT_ALLOWED', `Cannot use hidden ${label}`);
    assert(Number(account.type) !== 2, 'PARENT_ACCOUNT_NOT_ALLOWED', `Cannot use a parent ${label} for transactions`);
}
function assertUsableCategory(category: Category | null | undefined, transactionType: TransactionTypeName): asserts category is Category {
    assert(category, 'CATEGORY_REQUIRED', 'A secondary category is required');
    assert(String(category.parentId ?? '0') !== '0', 'PRIMARY_CATEGORY_NOT_ALLOWED', 'Transactions must use a secondary category');
    assert(!category.hidden, 'HIDDEN_CATEGORY_NOT_ALLOWED', 'Cannot assign a hidden category');
    assert(Number(category.type) === CATEGORY_TYPE_FOR_TRANSACTION[transactionType], 'CATEGORY_TYPE_MISMATCH', `Category type does not match ${transactionType} transaction`);
}
function assertUsableNewTags(tags: Tag[]) {
    assert(tags.every((tag) => !tag.hidden), 'HIDDEN_TAG_NOT_ALLOWED', 'Cannot add a hidden tag');
}
function rawPictureIds(transaction: RawTransaction): string[] {
    return (transaction.pictures ?? []).map((picture) => String(picture.pictureId));
}
export class TransactionWriteMethods {
    declare client: ApiClient;
    declare catalog: ServiceDependencies['catalog'];
    declare audit: AuditWriter;
    declare config: ServiceDependencies['config'];
    declare get: (transactionId: string) => Promise<NormalizedTransaction>;
    declare getRaw: (transactionId: string, options?: { withPictures?: boolean }) => Promise<RawTransaction>;
    declare normalize: (transaction: RawTransaction, options?: { includePictures?: boolean }) => NormalizedTransaction;
    async create(input: CreateTransactionInput): Promise<NormalizedTransaction> {
        requireProfile(this.config.writeProfile, 'standard', 'create_transaction');
        const type = TYPE_CODE[input.type];
        assert(type, 'INVALID_TRANSACTION_TYPE', `Unsupported transaction type: ${input.type}`);
        const sourceAccount = await this.catalog.resolveAccount(input.source_account);
        const destinationAccount = input.type === 'transfer' ? await this.catalog.resolveAccount(input.destination_account) : null;
        const category = input.type === 'balance_modification' ? null : await this.catalog.resolveCategory(input.category);
        const tags = input.tags?.length ? await Promise.all(input.tags.map((ref) => this.catalog.resolveTag(ref))) : [];
        assertUsableAccount(sourceAccount, 'source account');
        if (destinationAccount) {
            assertUsableAccount(destinationAccount, 'destination account');
            assert(String(sourceAccount.id) !== String(destinationAccount.id), 'SAME_TRANSFER_ACCOUNT', 'Source and destination accounts must differ');
        }
        if (category)
            assertUsableCategory(category, input.type);
        assertUsableNewTags(tags);
        assert(tags.length <= 10, 'TOO_MANY_TAGS', 'ezBookkeeping permits at most 10 tags per transaction');
        const time = parseUnixTime(input.time ?? new Date().toISOString());
        const body: UnknownRecord = {
            type,
            categoryId: category ? String(category.id) : '0',
            time,
            utcOffset: input.utc_offset ?? getTimezoneOffsetMinutes(this.client.config.timezone, new Date(time * 1000)),
            sourceAccountId: String(sourceAccount.id),
            destinationAccountId: destinationAccount ? String(destinationAccount.id) : '0',
            sourceAmount: decimalToMinor(input.source_amount),
            destinationAmount: destinationAccount ? decimalToMinor(input.destination_amount ?? input.source_amount) : 0,
            hideAmount: input.hide_amount ?? false,
            tagIds: tags.map((tag) => String(tag.id)),
            pictureIds: [],
            comment: input.comment ?? '',
            geoLocation: input.geo_location ?? undefined,
            clientSessionId: input.client_session_id
        };
        const created = await this.client.post<{ id: string | number }>('transactions/add.json', body);
        this.catalog.invalidate?.('accounts');
        await this.audit.write({ tool: 'create_transaction', target_ids: [String(created.id)], normalized_arguments: body, result: 'success' });
        return this.get(String(created.id));
    }
    async buildModifyBody(current: RawTransaction, patch: TransactionPatch): Promise<UnknownRecord & { type: number; categoryId: string; sourceAccountId: string; destinationAccountId: string; tagIds: string[] }> {
        let selectedCategory = current.category ?? null;
        let selectedSourceAccount = current.sourceAccount ?? null;
        let selectedDestinationAccount = current.destinationAccount ?? null;
        const newlySelectedTags: Tag[] = [];
        const type = patch.type ? TYPE_CODE[patch.type] : current.type;
        assert(type, 'INVALID_TRANSACTION_TYPE', 'A valid transaction type is required');
        const body = {
            id: String(current.id),
            type,
            categoryId: String(current.categoryId ?? '0'),
            time: patch.time !== undefined ? parseUnixTime(patch.time) : current.time,
            utcOffset: patch.utc_offset ?? current.utcOffset,
            sourceAccountId: String(current.sourceAccountId),
            destinationAccountId: String(current.destinationAccountId ?? '0'),
            sourceAmount: patch.source_amount !== undefined ? decimalToMinor(patch.source_amount) : Number(current.sourceAmount),
            destinationAmount: patch.destination_amount !== undefined ? decimalToMinor(patch.destination_amount) : Number(current.destinationAmount ?? 0),
            hideAmount: patch.hide_amount ?? current.hideAmount,
            tagIds: [...(current.tagIds ?? [])].map(String),
            pictureIds: rawPictureIds(current),
            comment: patch.comment ?? current.comment ?? '',
            geoLocation: patch.geo_location !== undefined ? patch.geo_location : current.geoLocation
        };
        if (patch.category !== undefined) {
            selectedCategory = await this.catalog.resolveCategory(patch.category);
            body.categoryId = String(selectedCategory.id);
        }
        if (patch.source_account !== undefined) {
            selectedSourceAccount = await this.catalog.resolveAccount(patch.source_account);
            body.sourceAccountId = String(selectedSourceAccount.id);
        }
        if (patch.destination_account !== undefined) {
            selectedDestinationAccount = await this.catalog.resolveAccount(patch.destination_account);
            body.destinationAccountId = String(selectedDestinationAccount.id);
        }
        if (patch.tags_set) {
            const selected = await Promise.all(patch.tags_set.map((ref) => this.catalog.resolveTag(ref)));
            newlySelectedTags.push(...selected);
            body.tagIds = selected.map((tag) => String(tag.id));
        }
        if (patch.tags_add?.length) {
            const selected = await Promise.all(patch.tags_add.map((ref) => this.catalog.resolveTag(ref)));
            newlySelectedTags.push(...selected);
            const add = selected.map((tag) => String(tag.id));
            body.tagIds = [...new Set([...body.tagIds, ...add])];
        }
        if (patch.tags_remove?.length) {
            const remove = new Set((await Promise.all(patch.tags_remove.map((ref) => this.catalog.resolveTag(ref)))).map((tag) => String(tag.id)));
            body.tagIds = body.tagIds.filter((id) => !remove.has(id));
        }
        const transactionType = TYPE_NAME[body.type];
        assert(transactionType, 'INVALID_TRANSACTION_TYPE', 'A valid transaction type is required');
        assertUsableAccount(selectedSourceAccount, 'source account');
        assertUsableNewTags(newlySelectedTags);
        if (body.type !== TYPE_CODE.transfer) {
            body.destinationAccountId = '0';
            body.destinationAmount = 0;
            selectedDestinationAccount = null;
        }
        if (body.type === TYPE_CODE.balance_modification) {
            body.categoryId = '0';
            selectedCategory = null;
        }
        else {
            assertUsableCategory(selectedCategory, transactionType);
            assert(body.categoryId !== '0', 'CATEGORY_REQUIRED', 'A secondary category is required');
        }
        if (body.type === TYPE_CODE.transfer) {
            assert(body.destinationAccountId !== '0', 'DESTINATION_ACCOUNT_REQUIRED', 'A transfer requires destination_account');
            assertUsableAccount(selectedDestinationAccount, 'destination account');
            assert(body.sourceAccountId !== body.destinationAccountId, 'SAME_TRANSFER_ACCOUNT', 'Source and destination accounts must differ');
        }
        assert(body.tagIds.length <= 10, 'TOO_MANY_TAGS', 'ezBookkeeping permits at most 10 tags per transaction');
        return body;
    }
    async patch(transactionId: string, expectedRevision: string, patch: TransactionPatch): Promise<NormalizedTransaction> {
        requireProfile(this.config.writeProfile, 'standard', 'patch_transaction');
        const current = await this.getRaw(transactionId);
        const actualRevision = transactionRevision(current);
        if (expectedRevision !== actualRevision) {
            throw new AppError('TRANSACTION_CHANGED', 'Transaction changed after it was read', {
                details: { expected_revision: expectedRevision, current_revision: actualRevision, current_transaction: this.normalize(current) }
            });
        }
        assert(current.editable !== false, 'TRANSACTION_NOT_EDITABLE', 'Transaction is not editable');
        const body = await this.buildModifyBody(current, patch);
        await this.client.post<unknown>('transactions/modify.json', body);
        const refreshed = await this.getRaw(transactionId);
        this.catalog.invalidate?.('accounts');
        await this.audit.write({
            tool: 'patch_transaction', target_ids: [String(transactionId)], before_revision: actualRevision,
            after_revision: transactionRevision(refreshed), normalized_arguments: body, result: 'success'
        });
        return this.normalize(refreshed);
    }
}
