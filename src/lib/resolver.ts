import type { EntityReference, NamedEntity } from '../types.js';
import { AppError } from './errors.js';
export function normalizeName(value: string): string {
    return String(value).normalize('NFKC').trim().toLocaleLowerCase('en-US');
}
export function flattenTree<T extends NamedEntity>(items: readonly T[], childKey: string, parentPath: readonly string[] = []): T[] {
    const output: T[] = [];
    for (const item of items ?? []) {
        const path = [...parentPath, item.name];
        output.push({ ...item, path: path.join(' / ') });
        const children = item[childKey];
        output.push(...flattenTree(Array.isArray(children) ? children as T[] : [], childKey, path));
    }
    return output;
}
export function resolveReference<T extends NamedEntity>(reference: EntityReference | null | undefined, items: readonly T[], options: { entity?: string } = {}): T {
    const entity = options.entity || 'item';
    if (reference == null)
        throw new AppError(`MISSING_${entity.toUpperCase()}_REFERENCE`, `${entity} reference is required`);
    if (typeof reference === 'string')
        reference = { name: reference };
    if (reference.id != null) {
        const match = items.find((item) => String(item.id) === String(reference.id));
        if (!match)
            throw new AppError(`${entity.toUpperCase()}_NOT_FOUND`, `${entity} ID ${reference.id} was not found`);
        return match;
    }
    if (!reference.name)
        throw new AppError(`INVALID_${entity.toUpperCase()}_REFERENCE`, `${entity} reference requires id or name`);
    const normalized = normalizeName(reference.name);
    let matches = items.filter((item) => normalizeName(item.name) === normalized);
    if (reference.parent_name) {
        const parentNormalized = normalizeName(reference.parent_name);
        matches = matches.filter((item) => normalizeName(item.parentName ?? item.path?.split(' / ').slice(-2, -1)[0] ?? '') === parentNormalized);
    }
    if (reference.type != null)
        matches = matches.filter((item) => String(item.type) === String(reference.type));
    if (matches.length === 0) {
        throw new AppError(`${entity.toUpperCase()}_NOT_FOUND`, `${entity} named "${reference.name}" was not found`);
    }
    if (matches.length > 1) {
        throw new AppError(`AMBIGUOUS_${entity.toUpperCase()}`, `${entity} name "${reference.name}" is ambiguous`, {
            details: { candidates: matches.map((item) => ({ id: String(item.id), name: item.name, path: item.path })) }
        });
    }
    return matches[0]!;
}
