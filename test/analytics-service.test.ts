import type { QueryParams } from '../src/types.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { AnalyticsService } from '../src/services/analytics-service.js';
type AnalyticsDeps = ConstructorParameters<typeof AnalyticsService>[0];
function service() {
    return new AnalyticsService({
        client: { async get() { return []; } },
        catalog: { async accounts() { return []; }, async categories() { return []; } },
        audit: { async write() { return null; } }, config: { writeProfile: 'extended', batchUpdateLimit: 100 }
    } as unknown as AnalyticsDeps);
}
test('asset trends require a concrete time range', async () => {
    await assert.rejects(() => service().getFinancialTrends({ kind: 'assets' }), { code: 'TIME_RANGE_REQUIRED' });
});
test('income/expense trends require a year-month range', async () => {
    await assert.rejects(() => service().getFinancialTrends({ kind: 'income_expense' }), { code: 'YEAR_MONTH_RANGE_REQUIRED' });
});
test('setting a custom rate requires rate', async () => {
    await assert.rejects(() => service().manageCustomExchangeRate({ operation: 'set', currency: 'USD' }), { code: 'RATE_REQUIRED' });
});
test('financial summary maps upstream minor-unit totals and names', async () => {
    const calls: { path: string; query?: QueryParams }[] = [];
    const svc = new AnalyticsService({
        client: {
            async get(path: string, query?: QueryParams) {
                calls.push(query === undefined ? { path } : { path, query });
                if (path === 'transactions/statistics.json')
                    return { items: [{ accountId: '1', categoryId: '2', amount: '750' }] };
                if (path === 'transactions/amounts.json')
                    return {
                        selected_1704067200_1704153600: {
                            startTime: 1704067200, endTime: 1704153600,
                            amounts: [{ currency: 'JPY', incomeAmount: '1000', expenseAmount: '250' }]
                        }
                    };
                throw new Error(`unexpected ${path}`);
            }
        },
        catalog: {
            async accounts() { return [{ id: '1', name: 'Bank' }]; },
            async categories() { return [{ id: '2', name: 'Salary', path: 'Income / Salary' }]; }
        },
        audit: { async write() { return null; } }, config: { writeProfile: 'extended', batchUpdateLimit: 100 }
    } as unknown as AnalyticsDeps);
    const result = await svc.getFinancialSummary({
        start_time: '2024-01-01T00:00:00Z', end_time: '2024-01-02T00:00:00Z'
    });
    const total = result.totals.selected_1704067200_1704153600!.amounts[0];
    assert.deepEqual(total, { currency: 'JPY', income: '10.00', expense: '2.50', net: '7.50' });
    assert.equal(result.breakdown[0]!.account.name, 'Bank');
    assert.equal(result.breakdown[0]!.category.name, 'Salary');
    assert.equal(result.breakdown[0]!.amount, '7.50');
    assert.equal(calls[1]!.query?.query, 'selected_1704067200_1704153600');
});
test('reconciliation statement formats balances', async () => {
    const svc = new AnalyticsService({
        client: { async get() {
                return {
                    openingBalance: '1000', closingBalance: '1250', totalInflows: '500', totalOutflows: '250',
                    transactions: [{ id: '1', accountOpeningBalance: '1000', accountClosingBalance: '1250' }]
                };
            } },
        catalog: { async resolveAccount() { return { id: '1', name: 'Bank', currency: 'JPY' }; } },
        audit: { async write() { return null; } }, config: { writeProfile: 'extended', batchUpdateLimit: 100 }
    } as unknown as AnalyticsDeps);
    const result = await svc.getReconciliationStatement({ account: { id: '1' } });
    assert.equal(result.opening_balance, '10.00');
    assert.equal(result.closing_balance, '12.50');
    assert.equal(result.transactions[0]!.account_closing_balance, '12.50');
});
test('custom exchange rates must be positive finite numbers', async () => {
    await assert.rejects(() => service().manageCustomExchangeRate({ operation: 'set', currency: 'USD', rate: '-1' }), { code: 'INVALID_EXCHANGE_RATE' });
});
