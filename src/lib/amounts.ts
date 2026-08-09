import { AppError } from './errors.js';
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
export function decimalToMinor(value: string): number {
    const text = String(value).trim();
    if (!DECIMAL_PATTERN.test(text)) {
        throw new AppError('INVALID_AMOUNT', `Invalid amount: ${text}`, {
            details: { expected: 'decimal string with at most two fractional digits' }
        });
    }
    const negative = text.startsWith('-');
    const unsigned = negative ? text.slice(1) : text;
    const [whole = '0', fraction = ''] = unsigned.split('.');
    const minor = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
    const signed = negative ? -minor : minor;
    if (signed > 999999999999999n || signed < -999999999999999n) {
        throw new AppError('AMOUNT_OUT_OF_RANGE', `Amount is outside ezBookkeeping range: ${text}`);
    }
    const number = Number(signed);
    if (!Number.isSafeInteger(number)) {
        throw new AppError('AMOUNT_NOT_SAFE_INTEGER', `Amount cannot be represented safely: ${text}`);
    }
    return number;
}
export function minorToDecimal(value: string | number | bigint): string {
    const minor = BigInt(String(value));
    const negative = minor < 0n;
    const absolute = negative ? -minor : minor;
    const whole = absolute / 100n;
    const fraction = String(absolute % 100n).padStart(2, '0');
    return `${negative ? '-' : ''}${whole}.${fraction}`;
}
export type AmountFilter = string | { op: 'gt' | 'lt' | 'eq' | 'ne'; value: string } | { op: 'between'; min: string; max: string };
export function normalizeAmountFilter(filter?: AmountFilter): string | undefined {
    if (!filter)
        return undefined;
    if (typeof filter === 'string')
        return filter;
    const op = filter.op;
    if (op !== 'between') {
        return `${op}:${decimalToMinor(filter.value)}`;
    }
    return `bt:${decimalToMinor(filter.min)}:${decimalToMinor(filter.max)}`;
}
