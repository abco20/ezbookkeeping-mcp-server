import type { ApiClient, QueryParams, RawTransaction } from '../../types.js';
import type { NormalizedTransaction, ServiceDependencies, TransactionSearchInput, TransactionSearchResult, TransactionSelector } from '../../domain-types.js';
import { minorToDecimal, normalizeAmountFilter } from '../../lib/amounts.js';
import { parseUnixTime, minTimeSequenceId, maxTimeSequenceId } from '../../lib/time.js';
import { transactionRevision } from '../../lib/revision.js';
const TYPE_CODE: Record<string, number> = { balance_modification: 1, income: 2, expense: 3, transfer: 4 };
const TYPE_NAME: Record<number, string> = { 1: 'balance_modification', 2: 'income', 3: 'expense', 4: 'transfer' };
function formatOffset(offsetMinutes: number): string {
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absolute = Math.abs(offsetMinutes);
    return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}
function localIso(unix: number, offsetMinutes: number): string {
    const shifted = new Date((unix + offsetMinutes * 60) * 1000).toISOString().replace('Z', '');
    return `${shifted}${formatOffset(offsetMinutes)}`;
}
export class TransactionReadMethods {
    declare client: ApiClient;
    declare catalog: ServiceDependencies['catalog'];
    normalize(transaction: RawTransaction, { includePictures = true }: { includePictures?: boolean } = {}): NormalizedTransaction {
        const sourceAccount = transaction.sourceAccount;
        const destinationAccount = transaction.destinationAccount;
        const category = transaction.category;
        const tags = transaction.tags ?? [];
        const normalized = {
            id: String(transaction.id),
            revision: transactionRevision(transaction),
            type: TYPE_NAME[transaction.type] ?? `unknown_${transaction.type}`,
            type_code: transaction.type,
            time: localIso(transaction.time, transaction.utcOffset),
            unix_time: transaction.time,
            utc_offset: transaction.utcOffset,
            category: category ? { id: String(category.id), name: category.name } : { id: String(transaction.categoryId ?? '0') },
            source_account: sourceAccount ? { id: String(sourceAccount.id), name: sourceAccount.name, currency: sourceAccount.currency } : { id: String(transaction.sourceAccountId) },
            destination_account: destinationAccount ? { id: String(destinationAccount.id), name: destinationAccount.name, currency: destinationAccount.currency } : (transaction.destinationAccountId && String(transaction.destinationAccountId) !== '0' ? { id: String(transaction.destinationAccountId) } : null),
            source_amount: minorToDecimal(transaction.sourceAmount),
            source_amount_minor: String(transaction.sourceAmount),
            destination_amount: transaction.destinationAmount == null ? null : minorToDecimal(transaction.destinationAmount),
            destination_amount_minor: transaction.destinationAmount == null ? null : String(transaction.destinationAmount),
            hide_amount: Boolean(transaction.hideAmount),
            tags: tags.map((tag) => ({ id: String(tag.id), name: tag.name, group_id: String(tag.groupId ?? '0') })),
            tag_ids: (transaction.tagIds ?? []).map(String),
            ...(includePictures ? { pictures: transaction.pictures ?? [] } : {}),
            comment: transaction.comment ?? '',
            geo_location: transaction.geoLocation ?? null,
            editable: transaction.editable !== false
        };
        return normalized;
    }
    async getRaw(transactionId: string, { withPictures = true }: { withPictures?: boolean } = {}): Promise<RawTransaction> {
        return this.client.get<RawTransaction>('transactions/get.json', {
            id: String(transactionId),
            with_pictures: withPictures,
            trim_account: false,
            trim_category: false,
            trim_tag: false
        });
    }
    async get(transactionId: string): Promise<NormalizedTransaction> {
        return this.normalize(await this.getRaw(transactionId));
    }
    async resolveFilters(filters: TransactionSelector = {}): Promise<QueryParams> {
        const query: QueryParams = {
            type: filters.type ? TYPE_CODE[filters.type] : undefined,
            keyword: filters.keyword,
            match_mode: filters.ignore_case ? 1 : undefined,
            must_have_pictures: filters.must_have_pictures,
            amount_filter: normalizeAmountFilter(filters.amount_filter)
        };
        if (filters.categories?.length) {
            query.category_ids = (await Promise.all(filters.categories.map((ref) => this.catalog.resolveCategory(ref)))).map((item) => item.id).join(',');
        }
        if (filters.accounts?.length) {
            query.account_ids = (await Promise.all(filters.accounts.map((ref) => this.catalog.resolveAccount(ref)))).map((item) => item.id).join(',');
        }
        const tagGroups: string[] = [];
        if (filters.tags_any?.length) {
            const ids = (await Promise.all(filters.tags_any.map((ref) => this.catalog.resolveTag(ref)))).map((item) => item.id);
            tagGroups.push(`0:${ids.join(',')}`);
        }
        if (filters.tags_all?.length) {
            const ids = (await Promise.all(filters.tags_all.map((ref) => this.catalog.resolveTag(ref)))).map((item) => item.id);
            tagGroups.push(`1:${ids.join(',')}`);
        }
        if (filters.tags_none?.length) {
            const ids = (await Promise.all(filters.tags_none.map((ref) => this.catalog.resolveTag(ref)))).map((item) => item.id);
            tagGroups.push(`2:${ids.join(',')}`);
        }
        if (filters.no_tags)
            query.tag_filter = 'none';
        else if (tagGroups.length)
            query.tag_filter = tagGroups.join(';');
        return query;
    }
    async search(filters: TransactionSearchInput = {}): Promise<TransactionSearchResult> {
        const limit = Math.min(filters.limit ?? 50, 100);
        const query = await this.resolveFilters(filters);
        if (filters.cursor)
            query.max_time = filters.cursor;
        else if (filters.end_time)
            query.max_time = maxTimeSequenceId(parseUnixTime(filters.end_time, 'end_time'));
        if (filters.start_time)
            query.min_time = minTimeSequenceId(parseUnixTime(filters.start_time, 'start_time'));
        query.page = 1;
        query.count = Math.min(limit, 50);
        query.with_count = true;
        // Pictures are always fetched because they participate in the revision hash.
        // They may be omitted from the returned payload when the caller does not request them.
        query.with_pictures = true;
        query.trim_account = false;
        query.trim_category = false;
        query.trim_tag = false;
        const result = await this.client.get<{ items?: RawTransaction[]; totalCount: number; nextTimeSequenceId?: string | number }>('transactions/list.json', query);
        let items = result.items ?? [];
        let nextCursor = result.nextTimeSequenceId;
        if (limit > 50 && nextCursor && items.length < limit) {
            const second = await this.client.get<{ items?: RawTransaction[]; nextTimeSequenceId?: string | number }>('transactions/list.json', { ...query, max_time: nextCursor, count: limit - items.length, with_count: false });
            items = items.concat(second.items ?? []);
            nextCursor = second.nextTimeSequenceId;
        }
        return {
            total_count: result.totalCount,
            next_cursor: nextCursor ? String(nextCursor) : null,
            transactions: items.slice(0, limit).map((item) => this.normalize(item, { includePictures: Boolean(filters.with_pictures) }))
        };
    }
}
