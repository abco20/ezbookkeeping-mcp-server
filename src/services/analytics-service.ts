import type { ApiClient, AuditWriter, EntityReference, UnknownRecord } from '../types.js';
import type { ServiceDependencies } from '../domain-types.js';
import { minorToDecimal } from '../lib/amounts.js';
import { parseUnixTime } from '../lib/time.js';
import { requireProfile } from '../lib/permissions.js';
import { AppError, assert } from '../lib/errors.js';
export class AnalyticsService {
    readonly client: ApiClient;
    readonly catalog: ServiceDependencies['catalog'];
    readonly audit: AuditWriter;
    readonly config: ServiceDependencies['config'];
    constructor({ client, catalog, audit, config }: Omit<ServiceDependencies, 'signer'>) {
        this.client = client;
        this.catalog = catalog;
        this.audit = audit;
        this.config = config;
    }
    async getFinancialSummary(input: FinancialSummaryInput) {
        const start = parseUnixTime(input.start_time, 'start_time');
        const end = parseUnixTime(input.end_time, 'end_time');
        const [statistics, amounts, accounts, categories] = await Promise.all([
            this.client.get<StatisticsResult>('transactions/statistics.json', {
                start_time: start,
                end_time: end,
                keyword: input.keyword,
                match_mode: input.ignore_case ? 1 : 0,
                use_transaction_timezone: input.use_transaction_timezone ?? true
            }),
            this.client.get<Record<string, AmountGroup>>('transactions/amounts.json', {
                query: `selected_${start}_${end}`,
                use_transaction_timezone: input.use_transaction_timezone ?? true
            }),
            this.catalog.accounts(),
            this.catalog.categories()
        ]);
        const accountMap = new Map(accounts.map((item) => [String(item.id), item]));
        const categoryMap = new Map(categories.map((item) => [String(item.id), item]));
        return {
            start_time: new Date(start * 1000).toISOString(),
            end_time: new Date(end * 1000).toISOString(),
            totals: Object.fromEntries(Object.entries(amounts).map(([name, value]) => [name, {
                    ...value,
                    amounts: (value.amounts ?? []).map((amount) => ({
                        currency: amount.currency,
                        income: minorToDecimal(amount.incomeAmount),
                        expense: minorToDecimal(amount.expenseAmount),
                        net: minorToDecimal(BigInt(amount.incomeAmount) - BigInt(amount.expenseAmount))
                    }))
                }])),
            breakdown: (statistics.items ?? []).map((item) => ({
                account: accountMap.has(String(item.accountId)) ? { id: String(item.accountId), name: accountMap.get(String(item.accountId))!.name } : { id: String(item.accountId) },
                category: categoryMap.has(String(item.categoryId)) ? { id: String(item.categoryId), name: categoryMap.get(String(item.categoryId))!.name, path: categoryMap.get(String(item.categoryId))!.path } : { id: String(item.categoryId) },
                related_account_id: item.relatedAccountId ? String(item.relatedAccountId) : null,
                amount: minorToDecimal(item.amount),
                amount_minor: String(item.amount)
            }))
        };
    }
    async getFinancialTrends(input: FinancialTrendsInput) {
        const accounts = await this.catalog.accounts();
        const accountMap = new Map(accounts.map((item) => [String(item.id), item]));
        if (input.kind === 'assets') {
            assert(input.start_time && input.end_time, 'TIME_RANGE_REQUIRED', 'Asset trends require start_time and end_time');
            const result = await this.client.get<AssetTrendDay[]>('transactions/statistics/asset_trends.json', {
                start_time: parseUnixTime(input.start_time, 'start_time'),
                end_time: parseUnixTime(input.end_time, 'end_time')
            });
            return result.map((day) => ({
                date: `${day.year}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`,
                accounts: day.items.map((item) => ({
                    account: accountMap.has(String(item.accountId)) ? { id: String(item.accountId), name: accountMap.get(String(item.accountId))!.name } : { id: String(item.accountId) },
                    opening_balance: minorToDecimal(item.accountOpeningBalance),
                    closing_balance: minorToDecimal(item.accountClosingBalance)
                }))
            }));
        }
        assert(input.start_year_month && input.end_year_month, 'YEAR_MONTH_RANGE_REQUIRED', 'Income/expense trends require start_year_month and end_year_month');
        const categories = await this.catalog.categories();
        const categoryMap = new Map(categories.map((item) => [String(item.id), item]));
        const result = await this.client.get<MonthlyTrend[]>('transactions/statistics/trends.json', {
            start_year_month: input.start_year_month,
            end_year_month: input.end_year_month,
            keyword: input.keyword,
            match_mode: input.ignore_case ? 1 : 0,
            use_transaction_timezone: input.use_transaction_timezone ?? true
        });
        return result.map((month) => ({
            year_month: `${month.year}-${String(month.month).padStart(2, '0')}`,
            items: month.items.map((item) => ({
                account: accountMap.has(String(item.accountId)) ? { id: String(item.accountId), name: accountMap.get(String(item.accountId))!.name } : { id: String(item.accountId) },
                category: categoryMap.has(String(item.categoryId)) ? { id: String(item.categoryId), name: categoryMap.get(String(item.categoryId))!.name } : { id: String(item.categoryId) },
                amount: minorToDecimal(item.amount)
            }))
        }));
    }
    async getReconciliationStatement(input: ReconciliationInput) {
        const account = await this.catalog.resolveAccount(input.account);
        const result = await this.client.get<ReconciliationResult>('transactions/reconciliation_statements.json', {
            account_id: String(account.id),
            start_time: input.start_time ? parseUnixTime(input.start_time) : 0,
            end_time: input.end_time ? parseUnixTime(input.end_time) : 0
        });
        return {
            account: { id: String(account.id), name: account.name, currency: account.currency },
            opening_balance: minorToDecimal(result.openingBalance),
            closing_balance: minorToDecimal(result.closingBalance),
            total_inflows: minorToDecimal(result.totalInflows),
            total_outflows: minorToDecimal(result.totalOutflows),
            transactions: result.transactions.map((item) => ({
                transaction: item,
                account_opening_balance: minorToDecimal(item.accountOpeningBalance),
                account_closing_balance: minorToDecimal(item.accountClosingBalance)
            }))
        };
    }
    async getExchangeRates(): Promise<unknown> {
        return this.client.get<unknown>('exchange_rates/latest.json');
    }
    async manageCustomExchangeRate(input: { operation: 'set' | 'delete'; currency: string; rate?: string | undefined }): Promise<unknown> {
        requireProfile(this.config.writeProfile, 'extended', 'manage_custom_exchange_rate');
        if (input.operation === 'set') {
            assert(input.rate !== undefined && input.rate !== '', 'RATE_REQUIRED', 'rate is required when setting a custom exchange rate');
            const numericRate = Number(input.rate);
            assert(Number.isFinite(numericRate) && numericRate > 0, 'INVALID_EXCHANGE_RATE', 'rate must be a positive finite number');
            const body = { currency: input.currency.toUpperCase(), rate: String(input.rate) };
            const result = await this.client.post<unknown>('exchange_rates/user_custom/update.json', body);
            await this.audit.write({ tool: 'manage_custom_exchange_rate', operation: 'set', normalized_arguments: body, result: 'success' });
            return result;
        }
        if (input.operation === 'delete') {
            const body = { currency: input.currency.toUpperCase() };
            const result = await this.client.post<unknown>('exchange_rates/user_custom/delete.json', body);
            await this.audit.write({ tool: 'manage_custom_exchange_rate', operation: 'delete', normalized_arguments: body, result: 'success' });
            return result;
        }
        throw new AppError('INVALID_OPERATION', 'Unsupported exchange rate operation');
    }
    async getServerInfo(): Promise<UnknownRecord> {
        const version = await this.client.get<UnknownRecord>('systems/version.json');
        return version;
    }
}
interface FinancialSummaryInput { start_time: string; end_time: string; keyword?: string | undefined; ignore_case?: boolean | undefined; use_transaction_timezone?: boolean | undefined }
interface FinancialTrendsInput { kind: 'income_expense' | 'assets'; start_year_month?: string | undefined; end_year_month?: string | undefined; start_time?: string | undefined; end_time?: string | undefined; keyword?: string | undefined; ignore_case?: boolean | undefined; use_transaction_timezone?: boolean | undefined }
interface ReconciliationInput { account: EntityReference; start_time?: string | undefined; end_time?: string | undefined }
interface AmountValue { currency: string; incomeAmount: string | number; expenseAmount: string | number }
interface AmountGroup extends UnknownRecord { amounts?: AmountValue[] }
interface StatisticsItem { accountId: string | number; categoryId: string | number; relatedAccountId?: string | number; amount: string | number }
interface StatisticsResult { items?: StatisticsItem[] }
interface AssetTrendDay { year: number; month: number; day: number; items: { accountId: string | number; accountOpeningBalance: string | number; accountClosingBalance: string | number }[] }
interface MonthlyTrend { year: number; month: number; items: { accountId: string | number; categoryId: string | number; amount: string | number }[] }
interface ReconciliationTransaction extends UnknownRecord { accountOpeningBalance: string | number; accountClosingBalance: string | number }
interface ReconciliationResult { openingBalance: string | number; closingBalance: string | number; totalInflows: string | number; totalOutflows: string | number; transactions: ReconciliationTransaction[] }
