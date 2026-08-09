export class TtlCache {
    private readonly ttlMs: number;
    private readonly values = new Map<string, { value: unknown; expiresAt: number }>();
    constructor(ttlMs = 5000) {
        this.ttlMs = ttlMs;
    }
    async get<T>(key: string, loader: () => Promise<T>, { refresh = false }: { refresh?: boolean } = {}): Promise<T> {
        const now = Date.now();
        const existing = this.values.get(key);
        if (!refresh && existing && existing.expiresAt > now)
            return existing.value as T;
        const value = await loader();
        this.values.set(key, { value, expiresAt: now + this.ttlMs });
        return value;
    }
    clear(key?: string) {
        if (key)
            this.values.delete(key);
        else
            this.values.clear();
    }
}
