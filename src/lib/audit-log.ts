import type { UnknownRecord } from '../types.js';
import { appendFile, chmod, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const SECRET_KEYS = /token|authorization|secret|password/i;
export function redact(value: unknown): unknown {
    if (Array.isArray(value))
        return value.map(redact);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEYS.test(key) ? '[REDACTED]' : redact(item)]));
    }
    return value;
}
export class AuditLog {
    readonly filePath: string;
    lastError: string | null;
    constructor(filePath: string) {
        this.filePath = filePath;
        this.lastError = null;
    }
    async ensureWritable() {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        const handle = await open(this.filePath, 'a', 0o600);
        await handle.close();
        await chmod(this.filePath, 0o600);
        this.lastError = null;
    }
    async write(event: UnknownRecord): Promise<string | null> {
        const record = {
            timestamp: new Date().toISOString(),
            audit_id: randomUUID(),
            ...(redact(event) as UnknownRecord)
        };
        try {
            await mkdir(path.dirname(this.filePath), { recursive: true });
            await appendFile(this.filePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
            this.lastError = null;
            return record.audit_id;
        }
        catch (error) {
            this.lastError = error instanceof Error ? error.message : String(error);
            console.error('AUDIT_LOG_WRITE_FAILED', this.lastError);
            return null;
        }
    }
}
