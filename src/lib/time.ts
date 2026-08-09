import { AppError } from './errors.js';
export function parseUnixTime(value: string | number, fieldName = 'time'): number {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0)
        return value;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new AppError('INVALID_TIME', `${fieldName} must be a valid RFC 3339 datetime or unix timestamp`);
    }
    return Math.floor(date.getTime() / 1000);
}
export function getTimezoneOffsetMinutes(timeZone: string, date: Date = new Date()): number {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23'
    });
    const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    return Math.round((asUtc - date.getTime()) / 60000);
}
// ezBookkeeping transaction time sequence IDs preserve ordering within one second.
// The exact server helper uses the same second-based boundary semantics.
export function minTimeSequenceId(unixSeconds: number): string {
    return String(unixSeconds * 1000);
}
export function maxTimeSequenceId(unixSeconds: number): string {
    return String(unixSeconds * 1000 + 999);
}
