import type { JsonValue } from '../types.js';
export function canonicalize(value: unknown): JsonValue | undefined {
    if (Array.isArray(value))
        return value.map(canonicalize).filter((item): item is JsonValue => item !== undefined);
    if (value && typeof value === 'object') {
        const output: Record<string, JsonValue> = {};
        for (const key of Object.keys(value).sort()) {
            const item = Reflect.get(value, key) as unknown;
            const normalized = canonicalize(item);
            if (normalized !== undefined)
                output[key] = normalized;
        }
        return output;
    }
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
        return value;
    if (typeof value === 'bigint') return value.toString();
    return undefined;
}
export function stableStringify(value: unknown): string {
    return JSON.stringify(canonicalize(value) ?? null);
}
