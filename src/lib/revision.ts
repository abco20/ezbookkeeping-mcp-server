import type { RawTransaction } from '../types.js';
import { createHash } from 'node:crypto';
import { stableStringify } from './canonical.js';
export function transactionRevision(transaction: RawTransaction): string {
    const pictures = (transaction.pictures ?? []).map((picture) => String(picture.pictureId)).sort();
    const state = {
        id: String(transaction.id),
        type: transaction.type,
        categoryId: String(transaction.categoryId ?? '0'),
        time: transaction.time,
        utcOffset: transaction.utcOffset,
        sourceAccountId: String(transaction.sourceAccountId),
        destinationAccountId: String(transaction.destinationAccountId ?? '0'),
        sourceAmount: String(transaction.sourceAmount),
        destinationAmount: transaction.destinationAmount == null ? null : String(transaction.destinationAmount),
        hideAmount: Boolean(transaction.hideAmount),
        tagIds: [...(transaction.tagIds ?? [])].map(String).sort(),
        pictureIds: pictures,
        comment: transaction.comment ?? '',
        geoLocation: transaction.geoLocation ?? null,
        editable: transaction.editable !== false
    };
    return `sha256:${createHash('sha256').update(stableStringify(state)).digest('hex')}`;
}
export function withRevision(transaction: RawTransaction) {
    return { ...transaction, revision: transactionRevision(transaction) };
}
export function objectRevision(value: unknown): string {
    return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}
