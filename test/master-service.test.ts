import type { EntityReference, UnknownRecord, WriteProfile } from '../src/types.js';
import type { ServiceDependencies } from '../src/domain-types.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MasterService } from '../src/services/master-service.js';
import { ConfirmationSigner } from '../src/lib/confirmation.js';
function fixture(profile: WriteProfile = 'extended') {
    const calls: { path: string; body: UnknownRecord }[] = [];
    const accounts = {
        parent: { id: '1', name: 'Cards', category: 3, type: 2, currency: '---', balance: '12000', hidden: false, subAccounts: [] },
        single: { id: '2', name: 'Visa', category: 3, type: 1, currency: 'JPY', balance: '12000', icon: '1', color: '409EFF', comment: '', hidden: false }
    };
    const catalog = {
        invalidate() { },
        async resolveAccount(ref: EntityReference) { const item = refObject(ref); return item.id === '1' || item.name === 'Cards' ? accounts.parent : accounts.single; },
        async resolveCategory(ref: EntityReference) { const item = refObject(ref); return { id: item.id ?? '10', name: item.name ?? 'Other', type: 2, parentId: '9', hidden: false }; },
        async resolveTag(ref: EntityReference) { const item = refObject(ref); return { id: item.id ?? '30', name: item.name ?? 'Review', hidden: false }; },
        async resolveTagGroup() { return { id: '40', name: 'Group' }; },
        async resolveTemplate() { return { id: '50', name: 'Template' }; },
        async templates() { return []; },
        async accounts() { return Object.values(accounts); },
        async categories() { return []; },
        async tags() { return []; },
        async tagGroups() { return []; }
    };
    const client = {
        config: { timezoneOffset: 540 },
        async get(path: string) {
            if (path === 'accounts/get.json')
                return structuredClone(accounts.single);
            if (path === 'transaction/templates/get.json')
                return {
                    id: '50', templateType: 2, name: 'Scheduled balance', type: 1, categoryId: '0',
                    sourceAccountId: '2', destinationAccountId: '0', sourceAmount: 1000,
                    destinationAmount: null, hideAmount: false, tagIds: [], comment: '',
                    scheduledFrequencyType: 3, scheduledFrequency: '', scheduledStartDate: '2026-08-01',
                    scheduledEndDate: null, utcOffset: 540
                };
            throw new Error(`unexpected GET ${path}`);
        },
        async post(path: string, body: UnknownRecord) { calls.push({ path, body }); return { id: body.id ?? '99', ...body }; }
    };
    const service = new MasterService({
        client, catalog, signer: new ConfirmationSigner('x'.repeat(64), 600),
        audit: { async write() { return 'audit'; } }, config: { writeProfile: profile, batchUpdateLimit: 100 }
    } as unknown as ServiceDependencies);
    return { service, calls, accounts };
}
function refObject(reference: EntityReference) {
    return typeof reference === 'string' ? { name: reference } : reference;
}
test('parent account creation uses ezBookkeeping placeholder currency and single subaccounts', async () => {
    const { service, calls } = fixture();
    await service.manageAccount({
        operation: 'create',
        account: {
            name: 'Cards', category: 'credit_card', type: 'parent',
            sub_accounts: [{ name: 'Visa', currency: 'JPY', balance: '0' }]
        }
    });
    const body = calls[0]!.body;
    assert.equal(body.currency, '---');
    assert.equal(body.balance, 0);
    assert(Array.isArray(body.subAccounts));
    const firstSubAccount = body.subAccounts[0] as UnknownRecord;
    assert.equal(firstSubAccount.type, 1);
    assert.equal(firstSubAccount.category, 3);
    assert.equal(firstSubAccount.balance, 0);
});
test('account metadata update does not resend balance or currency', async () => {
    const { service, calls } = fixture();
    await service.manageAccount({ operation: 'update', account_ref: { id: '2' }, patch: { comment: 'updated' } });
    const body = calls[0]!.body;
    assert.equal(body.comment, 'updated');
    assert.equal(body.balance, undefined);
    assert.equal(body.currency, undefined);
});
test('account balances are sent to ezBookkeeping as minor-unit integers', async () => {
    const { service, calls } = fixture();
    await service.manageAccount({ operation: 'update', account_ref: { id: '2' }, patch: { balance: '12.34' } });
    const body = calls[0]!.body;
    assert.equal(body.balance, 1234);
    assert.equal(typeof body.balance, 'number');
    assert.equal(typeof body.balanceTime, 'number');
});
test('balance-modification template does not resolve a category', async () => {
    const { service } = fixture();
    const body = await service.buildTemplateBody({
        template_type: 'normal', name: 'Opening balance', type: 'balance_modification',
        source_account: { id: '2' }, source_amount: '100.00'
    });
    assert.equal(body.categoryId, '0');
    assert.equal(body.type, 1);
});
test('scheduled template partial update preserves existing schedule', async () => {
    const { service, calls } = fixture();
    await service.manageTemplate({
        operation: 'update', template_type: 'schedule', template_ref: { id: '50' },
        patch: { schedule: { end_date: '2026-12-31' } }
    });
    const body = calls[0]!.body;
    assert.equal(body.scheduledStartDate, '2026-08-01');
    assert.equal(body.scheduledEndDate, '2026-12-31');
    assert.equal(body.categoryId, '0');
});
test('parent account creation rejects a sub-account without currency', async () => {
    const { service } = fixture();
    await assert.rejects(() => service.manageAccount({
        operation: 'create',
        account: { name: 'Cards', category: 'credit_card', type: 'parent', sub_accounts: [{ name: 'Visa' }] }
    }), { code: 'CURRENCY_REQUIRED' });
});
test('template creation rejects a primary category', async () => {
    const { service } = fixture();
    service.catalog.resolveCategory = async () => ({ id: '9', name: 'Expense', type: 2, parentId: '0', hidden: false });
    await assert.rejects(() => service.buildTemplateBody({
        template_type: 'normal', name: 'Expense', type: 'expense', category: { id: '9' },
        source_account: { id: '2' }, source_amount: '10.00'
    }), { code: 'PRIMARY_CATEGORY_NOT_ALLOWED' });
});
test('template creation rejects hidden tags', async () => {
    const { service } = fixture();
    service.catalog.resolveTag = async () => ({ id: '30', name: 'Hidden', hidden: true });
    await assert.rejects(() => service.buildTemplateBody({
        template_type: 'normal', name: 'Expense', type: 'expense', category: { id: '10' },
        source_account: { id: '2' }, source_amount: '10.00', tags: [{ id: '30' }]
    }), { code: 'HIDDEN_TAG_NOT_ALLOWED' });
});
