import type { Account, ApiClient, AuditWriter, UnknownRecord } from '../../types.js';
import type { ConfirmedDeleteOptions, ManageAccountInput, ServiceDependencies } from '../../domain-types.js';
import { AppError, assert } from '../../lib/errors.js';
import { decimalToMinor } from '../../lib/amounts.js';
import { parseUnixTime } from '../../lib/time.js';
import { requireProfile } from '../../lib/permissions.js';
const ACCOUNT_CATEGORY: Record<string, number> = {
    cash: 1, checking: 2, credit_card: 3, virtual: 4, debt: 5,
    receivable: 6, investment: 7, savings: 8, certificate_of_deposit: 9
};
const ACCOUNT_TYPE: Record<string, number> = { single: 1, parent: 2 };
export class MasterAccountMethods {
    declare client: ApiClient;
    declare catalog: ServiceDependencies['catalog'];
    declare audit: AuditWriter;
    declare config: ServiceDependencies['config'];
    declare confirmedDelete: (options: ConfirmedDeleteOptions) => Promise<unknown>;
    async listAccounts({ include_hidden = true }: { include_hidden?: boolean | undefined } = {}): Promise<Account[]> {
        const items = await this.catalog.accounts({ refresh: true });
        return items.filter((item) => include_hidden || !item.hidden);
    }
    async manageAccount(input: ManageAccountInput): Promise<unknown> {
        requireProfile(this.config.writeProfile, 'extended', 'manage_account');
        const op = input.operation;
        if (op === 'create') {
            const account = input.account;
            assert(account, 'ACCOUNT_REQUIRED', 'account is required for create');
            const accountType = ACCOUNT_TYPE[account.type];
            const accountCategory = ACCOUNT_CATEGORY[account.category];
            assert(accountType !== undefined, 'INVALID_ACCOUNT_TYPE', `Unsupported account type: ${account.type}`);
            assert(accountCategory !== undefined, 'INVALID_ACCOUNT_CATEGORY', `Unsupported account category: ${account.category}`);
            const defaultCurrency = account.currency;
            if (accountType === 1)
                assert(defaultCurrency, 'CURRENCY_REQUIRED', 'A single account requires currency');
            if (accountType === 2) {
                assert(account.sub_accounts?.length, 'SUB_ACCOUNTS_REQUIRED', 'A parent account requires at least one sub-account');
                for (const sub of account.sub_accounts) {
                    const subCategory = ACCOUNT_CATEGORY[sub.category ?? account.category];
                    assert(subCategory === accountCategory, 'SUB_ACCOUNT_CATEGORY_MISMATCH', 'Every sub-account category must match its parent');
                    assert(sub.currency ?? account.currency, 'CURRENCY_REQUIRED', `Sub-account ${sub.name} requires currency`);
                }
            }
            if (accountCategory !== ACCOUNT_CATEGORY.credit_card) {
                assert((account.credit_card_statement_date ?? 0) === 0, 'INVALID_CREDIT_CARD_STATEMENT_DATE', 'Only credit card accounts may set a statement date');
            }
            const body: UnknownRecord = {
                name: account.name,
                category: accountCategory,
                type: accountType,
                icon: String(account.icon ?? 1),
                color: account.color ?? '409EFF',
                currency: accountType === 2 ? '---' : defaultCurrency!.toUpperCase(),
                balance: accountType === 2 ? 0 : decimalToMinor(account.balance ?? '0'),
                balanceTime: account.balance_time ? parseUnixTime(account.balance_time) : Math.floor(Date.now() / 1000),
                comment: account.comment ?? '',
                creditCardStatementDate: account.credit_card_statement_date ?? 0,
                subAccounts: account.sub_accounts?.map((sub) => {
                    const currency = sub.currency ?? defaultCurrency;
                    assert(currency, 'CURRENCY_REQUIRED', `Sub-account ${sub.name} requires currency`);
                    return {
                        name: sub.name,
                        category: ACCOUNT_CATEGORY[sub.category ?? account.category],
                        type: 1,
                        icon: String(sub.icon ?? account.icon ?? 1),
                        color: sub.color ?? account.color ?? '409EFF',
                        currency: currency.toUpperCase(),
                        balance: decimalToMinor(sub.balance ?? '0'),
                        balanceTime: sub.balance_time ? parseUnixTime(sub.balance_time) : Math.floor(Date.now() / 1000),
                        comment: sub.comment ?? '',
                        creditCardStatementDate: sub.credit_card_statement_date ?? 0
                    };
                }) ?? []
            };
            const result = await this.client.post<{ id: string | number } & UnknownRecord>('accounts/add.json', body);
            this.catalog.invalidate('accounts');
            await this.audit.write({ tool: 'manage_account', operation: op, target_ids: [String(result.id)], normalized_arguments: body, result: 'success' });
            return result;
        }
        if (op === 'update') {
            assert(input.account_ref ?? input.account, 'ACCOUNT_REFERENCE_REQUIRED', 'account_ref is required for update');
            const ref = input.account_ref ?? input.account;
            const existingRef = await this.catalog.resolveAccount(ref);
            const current = await this.client.get<RawAccount>('accounts/get.json', { id: String(existingRef.id) });
            const patch = input.patch ?? {};
            const updatedCategory = patch.category === undefined ? current.category : ACCOUNT_CATEGORY[patch.category];
            assert(!(Number(current.type) === 2 && (patch.currency !== undefined || patch.balance !== undefined)), 'PARENT_ACCOUNT_VALUE_NOT_ALLOWED', 'Parent accounts cannot set currency or balance');
            const updatedStatementDate = updatedCategory === ACCOUNT_CATEGORY.credit_card
                ? (patch.credit_card_statement_date ?? current.creditCardStatementDate ?? 0)
                : 0;
            const body: UnknownRecord = {
                id: String(current.id),
                name: patch.name ?? current.name,
                category: updatedCategory,
                icon: String(patch.icon ?? current.icon),
                color: patch.color ?? current.color,
                currency: patch.currency !== undefined ? patch.currency.toUpperCase() : undefined,
                balance: patch.balance !== undefined ? decimalToMinor(patch.balance) : undefined,
                balanceTime: patch.balance_time !== undefined
                    ? parseUnixTime(patch.balance_time)
                    : patch.balance !== undefined ? Math.floor(Date.now() / 1000) : undefined,
                lastReconciledTime: patch.last_reconciled_time !== undefined ? parseUnixTime(patch.last_reconciled_time) : undefined,
                comment: patch.comment ?? current.comment ?? '',
                creditCardStatementDate: updatedStatementDate,
                hidden: patch.hidden ?? current.hidden,
                subAccounts: undefined
            };
            const result = await this.client.post<unknown>('accounts/modify.json', body);
            this.catalog.invalidate('accounts');
            await this.audit.write({ tool: 'manage_account', operation: op, target_ids: [String(current.id)], normalized_arguments: body, result: 'success' });
            return result;
        }
        if (op === 'hide' || op === 'unhide') {
            assert(input.account_ref, 'ACCOUNT_REFERENCE_REQUIRED', 'account_ref is required');
            const account = await this.catalog.resolveAccount(input.account_ref);
            const body = { id: String(account.id), hidden: op === 'hide' };
            const result = await this.client.post<unknown>('accounts/hide.json', body);
            this.catalog.invalidate('accounts');
            await this.audit.write({ tool: 'manage_account', operation: op, target_ids: [String(account.id)], result: 'success' });
            return result;
        }
        if (op === 'move') {
            assert(input.orders?.length, 'ORDERS_REQUIRED', 'orders are required for move');
            const orders = await Promise.all(input.orders.map(async (entry) => ({ id: String((await this.catalog.resolveAccount(entry.account)).id), displayOrder: entry.display_order })));
            const result = await this.client.post<unknown>('accounts/move.json', { newDisplayOrders: orders });
            this.catalog.invalidate('accounts');
            await this.audit.write({ tool: 'manage_account', operation: op, target_ids: orders.map((item) => item.id), result: 'success' });
            return result;
        }
        if (op === 'delete')
            return this.confirmedDelete({
                entity: 'account', reference: input.account_ref, mode: input.mode, token: input.confirmation_token,
                requiredProfile: 'admin', resolve: () => this.catalog.resolveAccount(input.account_ref), endpoint: 'accounts/delete.json', invalidate: 'accounts'
            });
        throw new AppError('INVALID_OPERATION', 'Unsupported account operation');
    }
}
interface RawAccount extends Account {
    icon: string | number;
    color: string;
    comment?: string;
    creditCardStatementDate?: number;
}
