import type { EntityReference, RawTransaction, UnknownRecord } from '../src/types.js';
import type { ServiceDependencies } from '../src/domain-types.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { TransactionService } from '../src/services/transaction-service.js';
import { ConfirmationSigner } from '../src/lib/confirmation.js';
import { transactionRevision } from '../src/lib/revision.js';
function rawTransaction(overrides: Partial<RawTransaction> = {}): RawTransaction {
    return {
        id: '1', type: 3, categoryId: '10', category: { id: '10', name: 'Other', type: 2, parentId: '9', hidden: false },
        time: 1700000000, utcOffset: 540,
        sourceAccountId: '20', sourceAccount: { id: '20', name: 'Card', currency: 'JPY', type: 1, hidden: false },
        destinationAccountId: '0', sourceAmount: 1000, destinationAmount: null,
        hideAmount: false, tagIds: ['30'], tags: [{ id: '30', name: 'Review', groupId: '0', hidden: false }],
        pictures: [{ pictureId: '40' }], comment: 'merchant', geoLocation: null, editable: true,
        ...overrides
    };
}
function serviceFixture() {
    const calls: { path: string; body: UnknownRecord }[] = [];
    let current = rawTransaction();
    const client = {
        config: { timezoneOffset: 540 },
        async get(path: string) {
            if (path === 'transactions/get.json')
                return structuredClone(current);
            throw new Error(`unexpected GET ${path}`);
        },
        async post(path: string, body: UnknownRecord) {
            calls.push({ path, body });
            if (path === 'transactions/modify.json') {
                current = {
                    ...current,
                    ...body,
                    category: body.categoryId === '11' ? { id: '11', name: 'Medical', type: 2, parentId: '9', hidden: false } : current.category ?? null,
                    sourceAccount: current.sourceAccount ?? null,
                    tagIds: body.tagIds as string[],
                    tags: (body.tagIds as string[]).map((id) => ({ id, name: id === '31' ? 'Medical' : 'Review', groupId: '0', hidden: false })),
                    pictures: (body.pictureIds as string[]).map((pictureId) => ({ pictureId }))
                };
                return structuredClone(current);
            }
            return true;
        }
    };
    const catalog = {
        invalidate() { },
        async resolveCategory(ref: EntityReference) { const item = refObject(ref); return { id: item.name === 'Medical' ? '11' : item.id ?? '10', name: item.name ?? 'Other', type: 2, parentId: '9', hidden: false }; },
        async resolveAccount(ref: EntityReference) { const item = refObject(ref); return { id: item.id ?? '20', name: item.name ?? 'Card', currency: 'JPY', type: 1, hidden: false }; },
        async resolveTag(ref: EntityReference) { const item = refObject(ref); return { id: item.name === 'Medical' ? '31' : item.id ?? '30', name: item.name ?? 'Review', hidden: false }; }
    };
    const audit = { async write() { return 'audit-1'; } };
    const signer = new ConfirmationSigner('s'.repeat(64), 600);
    const service = new TransactionService({ client, catalog, signer, audit, config: { writeProfile: 'standard', batchUpdateLimit: 100 } } as unknown as ServiceDependencies);
    return { service, calls, getCurrent: () => current };
}
function refObject(reference: EntityReference) {
    return typeof reference === 'string' ? { name: reference } : reference;
}
test('patch preserves unspecified fields and pictures', async () => {
    const { service, calls, getCurrent } = serviceFixture();
    const revision = transactionRevision(getCurrent());
    const result = await service.patch('1', revision, { category: { name: 'Medical' }, tags_add: [{ name: 'Medical' }] });
    assert.equal(result.category.id, '11');
    assert.deepEqual(result.tag_ids.sort(), ['30', '31']);
    const body = calls[0]!.body;
    assert.equal(body.comment, 'merchant');
    assert.deepEqual(body.pictureIds, ['40']);
    assert.equal(body.sourceAmount, 1000);
});
test('patch rejects stale revision', async () => {
    const { service } = serviceFixture();
    await assert.rejects(() => service.patch('1', 'sha256:stale', { comment: 'new' }), { code: 'TRANSACTION_CHANGED' });
});
test('patch requires a revision instead of silently bypassing concurrency checks', async () => {
    const { service } = serviceFixture();
    await assert.rejects(() => service.patch('1', undefined as unknown as string, { comment: 'new' }), { code: 'TRANSACTION_CHANGED' });
});
test('batch preview rejects more matches than configured limit', async () => {
    const { service } = serviceFixture();
    service.config.batchUpdateLimit = 1;
    service.search = async () => ({ total_count: 2, next_cursor: null, transactions: [service.normalize(rawTransaction())] });
    await assert.rejects(() => service.previewBatch({}, { type: 'clear_tags' }), { code: 'BATCH_LIMIT_EXCEEDED' });
});
test('batch preview rejects assigning destination account to a non-transfer', async () => {
    const { service } = serviceFixture();
    service.search = async () => ({ total_count: 1, next_cursor: null, transactions: [service.normalize(rawTransaction())] });
    service.catalog.resolveAccount = async () => ({ id: '21', name: 'Other card', currency: 'JPY', type: 1, hidden: false });
    await assert.rejects(() => service.previewBatch({}, { type: 'set_destination_account', account: { id: '21' } }), { code: 'DESTINATION_ACCOUNT_NOT_APPLICABLE' });
});
test('batch preview checks the final ten-tag limit', async () => {
    const { service } = serviceFixture();
    const tags = Array.from({ length: 10 }, (_, index) => ({ id: String(index + 1), name: `T${index + 1}`, groupId: '0' }));
    const raw = rawTransaction({ tagIds: tags.map((tag) => tag.id), tags });
    service.search = async () => ({ total_count: 1, next_cursor: null, transactions: [service.normalize(raw)] });
    service.catalog.resolveTag = async () => ({ id: '99', name: 'Extra', hidden: false });
    await assert.rejects(() => service.previewBatch({}, { type: 'add_tags', tags: [{ id: '99' }] }), { code: 'TOO_MANY_TAGS' });
});
test('batch apply revalidates master data changed after preview', async () => {
    const { service } = serviceFixture();
    let hidden = false;
    service.search = async () => ({ total_count: 1, next_cursor: null, transactions: [service.normalize(rawTransaction())] });
    service.catalog.resolveCategory = async () => ({ id: '11', name: 'Medical', type: 2, parentId: '9', hidden });
    const preview = await service.previewBatch({}, { type: 'set_category', category: { id: '11' } });
    hidden = true;
    await assert.rejects(() => service.applyBatch(preview.confirmation_token), { code: 'HIDDEN_CATEGORY_NOT_ALLOWED' });
});
test('create rejects a hidden account before writing', async () => {
    const { service, calls } = serviceFixture();
    service.catalog.resolveAccount = async () => ({ id: '20', name: 'Hidden', currency: 'JPY', type: 1, hidden: true });
    await assert.rejects(() => service.create({ type: 'expense', category: { id: '10' }, source_account: { id: '20' }, source_amount: '10.00' }), { code: 'HIDDEN_ACCOUNT_NOT_ALLOWED' });
    assert.equal(calls.length, 0);
});
test('patch rejects a category whose type does not match the transaction', async () => {
    const { service, getCurrent } = serviceFixture();
    service.catalog.resolveCategory = async () => ({ id: '11', name: 'Salary', type: 1, parentId: '8', hidden: false });
    await assert.rejects(() => service.patch('1', transactionRevision(getCurrent()), { category: { id: '11' } }), { code: 'CATEGORY_TYPE_MISMATCH' });
});
test('patch rejects adding a hidden tag', async () => {
    const { service, getCurrent } = serviceFixture();
    service.catalog.resolveTag = async () => ({ id: '31', name: 'Hidden', hidden: true });
    await assert.rejects(() => service.patch('1', transactionRevision(getCurrent()), { tags_add: [{ id: '31' }] }), { code: 'HIDDEN_TAG_NOT_ALLOWED' });
});
