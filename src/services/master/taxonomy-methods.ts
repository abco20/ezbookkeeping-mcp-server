import type { ApiClient, AuditWriter, Category, Tag, TagGroup } from '../../types.js';
import type { ConfirmedDeleteOptions, ManageCategoryInput, ManageTagGroupInput, ManageTagInput, ServiceDependencies, TransactionTypeName } from '../../domain-types.js';
import { AppError, assert } from '../../lib/errors.js';
import { requireProfile } from '../../lib/permissions.js';
const CATEGORY_TYPE: Record<string, number> = { income: 1, expense: 2, transfer: 3 };
export class MasterTaxonomyMethods {
    declare client: ApiClient;
    declare catalog: ServiceDependencies['catalog'];
    declare audit: AuditWriter;
    declare config: ServiceDependencies['config'];
    declare confirmedDelete: (options: ConfirmedDeleteOptions) => Promise<unknown>;
    async listCategories({ include_hidden = true, type }: { include_hidden?: boolean | undefined; type?: Exclude<TransactionTypeName, 'balance_modification'> | undefined } = {}): Promise<Category[]> {
        const items = await this.catalog.categories({ refresh: true });
        return items.filter((item) => (include_hidden || !item.hidden) && (!type || item.type === CATEGORY_TYPE[type]));
    }
    async manageCategory(input: ManageCategoryInput): Promise<unknown> {
        requireProfile(this.config.writeProfile, 'extended', 'manage_category');
        const op = input.operation;
        if (op === 'create') {
            const category = input.category;
            assert(category, 'CATEGORY_REQUIRED', 'category is required for create');
            const parent = category.parent ? await this.catalog.resolveCategory(category.parent) : null;
            if (parent) {
                assert(String(parent.parentId ?? '0') === '0', 'SECONDARY_PARENT_NOT_ALLOWED', 'A secondary category cannot contain another category');
                if (category.type !== undefined) {
                    assert((CATEGORY_TYPE[category.type] ?? category.type) === parent.type, 'CATEGORY_TYPE_MISMATCH', 'Subcategory type must match its parent');
                }
            }
            const declaredType = category.type === undefined ? undefined : CATEGORY_TYPE[category.type];
            const categoryType = parent?.type ?? declaredType;
            assert(categoryType !== undefined, 'INVALID_CATEGORY_TYPE', `Unsupported category type: ${category.type}`);
            const body = {
                name: category.name,
                type: categoryType,
                parentId: parent ? String(parent.id) : '0',
                icon: String(category.icon ?? 1),
                color: category.color ?? '409EFF',
                comment: category.comment ?? ''
            };
            const result = await this.client.post<{ id: string | number }>('transaction/categories/add.json', body);
            this.catalog.invalidate('categories');
            await this.audit.write({ tool: 'manage_category', operation: op, target_ids: [String(result.id)], normalized_arguments: body, result: 'success' });
            return result;
        }
        if (op === 'update') {
            assert(input.category_ref, 'CATEGORY_REFERENCE_REQUIRED', 'category_ref is required for update');
            const existing = await this.catalog.resolveCategory(input.category_ref);
            const current = await this.client.get<RawCategory>('transaction/categories/get.json', { id: String(existing.id) });
            const patch = input.patch ?? {};
            const parent = patch.parent !== undefined ? (patch.parent ? await this.catalog.resolveCategory(patch.parent) : null) : undefined;
            if (parent) {
                assert(String(parent.id) !== String(current.id), 'CATEGORY_SELF_PARENT', 'A category cannot be its own parent');
                assert(String(parent.parentId ?? '0') === '0', 'SECONDARY_PARENT_NOT_ALLOWED', 'A secondary category cannot contain another category');
                assert(Number(parent.type) === Number(current.type), 'CATEGORY_TYPE_MISMATCH', 'Category parent type must match the category type');
            }
            const body = {
                id: String(current.id),
                name: patch.name ?? current.name,
                parentId: parent === undefined ? String(current.parentId) : parent ? String(parent.id) : '0',
                icon: String(patch.icon ?? current.icon),
                color: patch.color ?? current.color,
                comment: patch.comment ?? current.comment ?? '',
                hidden: patch.hidden ?? current.hidden
            };
            const result = await this.client.post<unknown>('transaction/categories/modify.json', body);
            this.catalog.invalidate('categories');
            await this.audit.write({ tool: 'manage_category', operation: op, target_ids: [String(current.id)], normalized_arguments: body, result: 'success' });
            return result;
        }
        if (op === 'hide' || op === 'unhide') {
            assert(input.category_ref, 'CATEGORY_REFERENCE_REQUIRED', 'category_ref is required');
            const category = await this.catalog.resolveCategory(input.category_ref);
            const result = await this.client.post<unknown>('transaction/categories/hide.json', { id: String(category.id), hidden: op === 'hide' });
            this.catalog.invalidate('categories');
            await this.audit.write({ tool: 'manage_category', operation: op, target_ids: [String(category.id)], result: 'success' });
            return result;
        }
        if (op === 'move') {
            assert(input.orders?.length, 'ORDERS_REQUIRED', 'orders are required for move');
            const orders = await Promise.all(input.orders.map(async (entry) => ({ id: String((await this.catalog.resolveCategory(entry.category)).id), displayOrder: entry.display_order })));
            const result = await this.client.post<unknown>('transaction/categories/move.json', { newDisplayOrders: orders });
            this.catalog.invalidate('categories');
            await this.audit.write({ tool: 'manage_category', operation: op, target_ids: orders.map((item) => item.id), result: 'success' });
            return result;
        }
        if (op === 'delete')
            return this.confirmedDelete({
                entity: 'category', reference: input.category_ref, mode: input.mode, token: input.confirmation_token,
                requiredProfile: 'extended', resolve: () => this.catalog.resolveCategory(input.category_ref), endpoint: 'transaction/categories/delete.json', invalidate: 'categories'
            });
        throw new AppError('INVALID_OPERATION', 'Unsupported category operation');
    }
    async listTagGroups(): Promise<TagGroup[]> {
        return this.catalog.tagGroups({ refresh: true });
    }
    async manageTagGroup(input: ManageTagGroupInput): Promise<unknown> {
        requireProfile(this.config.writeProfile, 'extended', 'manage_tag_group');
        const op = input.operation;
        if (op === 'create') {
            assert(input.group?.name, 'TAG_GROUP_REQUIRED', 'group.name is required for create');
            const result = await this.client.post<{ id: string | number }>('transaction/tags/groups/add.json', { name: input.group.name });
            this.catalog.invalidate('tagGroups');
            this.catalog.invalidate('tags');
            await this.audit.write({ tool: 'manage_tag_group', operation: op, target_ids: [String(result.id)], result: 'success' });
            return result;
        }
        if (op === 'update') {
            assert(input.group_ref, 'TAG_GROUP_REFERENCE_REQUIRED', 'group_ref is required for update');
            const group = await this.catalog.resolveTagGroup(input.group_ref);
            const result = await this.client.post<unknown>('transaction/tags/groups/modify.json', { id: String(group.id), name: input.patch?.name ?? group.name });
            this.catalog.invalidate('tagGroups');
            this.catalog.invalidate('tags');
            await this.audit.write({ tool: 'manage_tag_group', operation: op, target_ids: [String(group.id)], result: 'success' });
            return result;
        }
        if (op === 'move') {
            assert(input.orders?.length, 'ORDERS_REQUIRED', 'orders are required for move');
            const orders = await Promise.all(input.orders.map(async (entry) => ({ id: String((await this.catalog.resolveTagGroup(entry.group)).id), displayOrder: entry.display_order })));
            const result = await this.client.post<unknown>('transaction/tags/groups/move.json', { newDisplayOrders: orders });
            this.catalog.invalidate('tagGroups');
            await this.audit.write({ tool: 'manage_tag_group', operation: op, target_ids: orders.map((item) => item.id), result: 'success' });
            return result;
        }
        if (op === 'delete')
            return this.confirmedDelete({
                entity: 'tag_group', reference: input.group_ref, mode: input.mode, token: input.confirmation_token,
                requiredProfile: 'extended', resolve: () => this.catalog.resolveTagGroup(input.group_ref), endpoint: 'transaction/tags/groups/delete.json', invalidate: 'tagGroups', extraInvalidate: 'tags'
            });
        throw new AppError('INVALID_OPERATION', 'Unsupported tag group operation');
    }
    async listTags({ include_hidden = true }: { include_hidden?: boolean } = {}): Promise<Tag[]> {
        const items = await this.catalog.tags({ refresh: true });
        return items.filter((item) => include_hidden || !item.hidden);
    }
    async manageTag(input: ManageTagInput): Promise<unknown> {
        requireProfile(this.config.writeProfile, 'extended', 'manage_tag');
        const op = input.operation;
        if (op === 'create') {
            assert(input.tag?.name, 'TAG_REQUIRED', 'tag.name is required for create');
            const group = input.tag.group ? await this.catalog.resolveTagGroup(input.tag.group) : null;
            const body = { groupId: group ? String(group.id) : '0', name: input.tag.name };
            const result = await this.client.post<{ id: string | number }>('transaction/tags/add.json', body);
            this.catalog.invalidate('tags');
            await this.audit.write({ tool: 'manage_tag', operation: op, target_ids: [String(result.id)], normalized_arguments: body, result: 'success' });
            return result;
        }
        if (op === 'update') {
            assert(input.tag_ref, 'TAG_REFERENCE_REQUIRED', 'tag_ref is required for update');
            const tag = await this.catalog.resolveTag(input.tag_ref);
            const patch = input.patch ?? {};
            const group = patch.group !== undefined ? (patch.group ? await this.catalog.resolveTagGroup(patch.group) : null) : undefined;
            const body = { id: String(tag.id), groupId: group === undefined ? String(tag.groupId ?? '0') : group ? String(group.id) : '0', name: patch.name ?? tag.name };
            const result = await this.client.post<unknown>('transaction/tags/modify.json', body);
            this.catalog.invalidate('tags');
            await this.audit.write({ tool: 'manage_tag', operation: op, target_ids: [String(tag.id)], normalized_arguments: body, result: 'success' });
            return result;
        }
        if (op === 'hide' || op === 'unhide') {
            assert(input.tag_ref, 'TAG_REFERENCE_REQUIRED', 'tag_ref is required');
            const tag = await this.catalog.resolveTag(input.tag_ref);
            const result = await this.client.post<unknown>('transaction/tags/hide.json', { id: String(tag.id), hidden: op === 'hide' });
            this.catalog.invalidate('tags');
            await this.audit.write({ tool: 'manage_tag', operation: op, target_ids: [String(tag.id)], result: 'success' });
            return result;
        }
        if (op === 'move') {
            assert(input.orders?.length, 'ORDERS_REQUIRED', 'orders are required for move');
            const orders = await Promise.all(input.orders.map(async (entry) => ({ id: String((await this.catalog.resolveTag(entry.tag)).id), displayOrder: entry.display_order })));
            const result = await this.client.post<unknown>('transaction/tags/move.json', { newDisplayOrders: orders });
            this.catalog.invalidate('tags');
            await this.audit.write({ tool: 'manage_tag', operation: op, target_ids: orders.map((item) => item.id), result: 'success' });
            return result;
        }
        if (op === 'delete')
            return this.confirmedDelete({
                entity: 'tag', reference: input.tag_ref, mode: input.mode, token: input.confirmation_token,
                requiredProfile: 'extended', resolve: () => this.catalog.resolveTag(input.tag_ref), endpoint: 'transaction/tags/delete.json', invalidate: 'tags'
            });
        throw new AppError('INVALID_OPERATION', 'Unsupported tag operation');
    }
}
interface RawCategory extends Category {
    icon: string | number;
    color: string;
    comment?: string;
}
