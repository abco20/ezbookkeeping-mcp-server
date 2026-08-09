import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors.js';
import { stableStringify } from './canonical.js';
function encode(value: string): string {
    return Buffer.from(value).toString('base64url');
}
function decode(value: string): string {
    return Buffer.from(value, 'base64url').toString('utf8');
}
export class ConfirmationSigner {
    private readonly secret: string;
    private readonly ttlSeconds: number;
    private readonly now: () => number;
    constructor(secret: string, ttlSeconds = 600, now: () => number = () => Date.now()) {
        this.secret = secret;
        this.ttlSeconds = ttlSeconds;
        this.now = now;
    }
    issue(action: string, payload: unknown) {
        if (!this.secret)
            throw new AppError('CONFIRMATION_SECRET_MISSING', 'MCP_CONFIRMATION_SECRET is required');
        const issuedAt = Math.floor(this.now() / 1000);
        const body = {
            version: 1,
            action,
            issued_at: issuedAt,
            expires_at: issuedAt + this.ttlSeconds,
            nonce: randomUUID(),
            payload
        };
        const encoded = encode(stableStringify(body));
        const signature = createHmac('sha256', this.secret).update(encoded).digest('base64url');
        return {
            token: `${encoded}.${signature}`,
            expires_at: new Date(body.expires_at * 1000).toISOString()
        };
    }
    verify<T>(token: string, expectedAction: string, parsePayload: (value: unknown) => T): T {
        if (!this.secret)
            throw new AppError('CONFIRMATION_SECRET_MISSING', 'MCP_CONFIRMATION_SECRET is required');
        const [encoded, signature, extra] = String(token).split('.');
        if (!encoded || !signature || extra)
            throw new AppError('INVALID_CONFIRMATION_TOKEN', 'Confirmation token is malformed');
        const expected = createHmac('sha256', this.secret).update(encoded).digest();
        const actual = Buffer.from(signature, 'base64url');
        if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
            throw new AppError('INVALID_CONFIRMATION_TOKEN', 'Confirmation token signature is invalid');
        }
        let body: unknown;
        try {
            body = JSON.parse(decode(encoded));
        }
        catch (cause) {
            throw new AppError('INVALID_CONFIRMATION_TOKEN', 'Confirmation token payload is invalid', { cause });
        }
        if (!isConfirmationBody(body))
            throw new AppError('INVALID_CONFIRMATION_TOKEN', 'Confirmation token payload has an invalid shape');
        if (body.action !== expectedAction) {
            throw new AppError('CONFIRMATION_ACTION_MISMATCH', `Token is for ${body.action}, not ${expectedAction}`);
        }
        if (body.expires_at < Math.floor(this.now() / 1000)) {
            throw new AppError('CONFIRMATION_TOKEN_EXPIRED', 'Confirmation token has expired');
        }
        try {
            return parsePayload(body.payload);
        }
        catch (cause) {
            throw new AppError('INVALID_CONFIRMATION_TOKEN', 'Confirmation token payload has an invalid shape', { cause });
        }
    }
}
function isConfirmationBody(value: unknown): value is { action: string; expires_at: number; payload: unknown } {
    if (typeof value !== 'object' || value === null) return false;
    const body = value as Record<string, unknown>;
    return body.version === 1 &&
        Number.isInteger(body.issued_at) &&
        typeof body.action === 'string' &&
        Number.isInteger(body.expires_at) &&
        typeof body.nonce === 'string' &&
        Object.hasOwn(body, 'payload');
}
