import type { Account, ApiClient, Category, EntityReference, NamedEntity, Tag, TagGroup } from '../types.js';
import { TtlCache } from '../lib/cache.js';
import { flattenTree, resolveReference } from '../lib/resolver.js';
import { minorToDecimal } from '../lib/amounts.js';
export class CatalogService {
    readonly client: ApiClient;
    readonly cache: TtlCache;
    constructor(client: ApiClient, ttlMs = 5000) {
        this.client = client;
        this.cache = new TtlCache(ttlMs);
    }
    invalidate(kind: 'accounts' | 'categories' | 'tagGroups' | 'tags' | 'templates') {
        if (kind === 'templates') {
            this.cache.clear('templates:0');
            this.cache.clear('templates:1');
            this.cache.clear('templates:2');
            return;
        }
        this.cache.clear(kind);
    }
    async accounts(options: { refresh?: boolean } = {}): Promise<Account[]> {
        return this.cache.get('accounts', async () => {
            const tree = await this.client.get<Account[]>('accounts/list.json');
            const flat = flattenTree(tree, 'subAccounts');
            const byId = new Map(flat.map((item) => [String(item.id), item]));
            return flat.map((item) => ({
                ...item,
                ...(item.balance == null ? {} : { balance_decimal: minorToDecimal(item.balance) }),
                ...(item.parentId && String(item.parentId) !== '0' && byId.get(String(item.parentId))?.name
                    ? { parentName: byId.get(String(item.parentId))!.name }
                    : {})
            }));
        }, options);
    }
    async categories(options: { refresh?: boolean } = {}): Promise<Category[]> {
        return this.cache.get('categories', async () => {
            const grouped = await this.client.get<Record<string, Category[]>>('transaction/categories/list.json');
            const roots = Object.values(grouped).flat();
            const flat = flattenTree(roots, 'subCategories');
            const byId = new Map(flat.map((item) => [String(item.id), item]));
            return flat.map((item) => ({
                ...item,
                ...(item.parentId && String(item.parentId) !== '0' && byId.get(String(item.parentId))?.name
                    ? { parentName: byId.get(String(item.parentId))!.name }
                    : {})
            }));
        }, options);
    }
    async tagGroups(options: { refresh?: boolean } = {}): Promise<TagGroup[]> {
        return this.cache.get('tagGroups', () => this.client.get<TagGroup[]>('transaction/tags/groups/list.json'), options);
    }
    async tags(options: { refresh?: boolean } = {}): Promise<Tag[]> {
        return this.cache.get('tags', async () => {
            const [tags, groups] = await Promise.all([
                this.client.get<Tag[]>('transaction/tags/list.json'),
                this.tagGroups(options)
            ]);
            const groupMap = new Map(groups.map((group) => [String(group.id), group]));
            return tags.map((tag) => ({
                ...tag,
                ...(groupMap.get(String(tag.groupId))?.name ? { groupName: groupMap.get(String(tag.groupId))!.name } : {}),
                path: `${groupMap.get(String(tag.groupId))?.name ?? 'Default'} / ${tag.name}`
            }));
        }, options);
    }
    async templates(templateType?: number, options: { refresh?: boolean } = {}): Promise<NamedEntity[]> {
        const key = `templates:${templateType ?? 0}`;
        return this.cache.get(key, () => this.client.get<NamedEntity[]>('transaction/templates/list.json', templateType ? { templateType } : {}), options);
    }
    async resolveAccount(reference: EntityReference | null | undefined): Promise<Account> {
        return resolveReference(reference, await this.accounts(), { entity: 'account' });
    }
    async resolveCategory(reference: EntityReference | null | undefined): Promise<Category> {
        return resolveReference(reference, await this.categories(), { entity: 'category' });
    }
    async resolveTag(reference: EntityReference | null | undefined): Promise<Tag> {
        return resolveReference(reference, await this.tags(), { entity: 'tag' });
    }
    async resolveTagGroup(reference: EntityReference | null | undefined): Promise<TagGroup> {
        return resolveReference(reference, await this.tagGroups(), { entity: 'tag_group' });
    }
    async resolveTemplate(reference: EntityReference | null | undefined, templateType?: number): Promise<NamedEntity> {
        return resolveReference(reference, await this.templates(templateType), { entity: 'template' });
    }
}
