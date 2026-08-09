import type { EzBookkeepingConfig, QueryParams, UnknownRecord } from '../types.js';
import { randomUUID } from 'node:crypto';
import { AppError } from './errors.js';
export class EzBookkeepingClient {
    readonly config: EzBookkeepingConfig;
    private readonly fetchImpl: typeof globalThis.fetch;
    constructor(config: EzBookkeepingConfig, fetchImpl: typeof globalThis.fetch = globalThis.fetch) {
        this.config = config;
        this.fetchImpl = fetchImpl;
    }
    async get<T>(path: string, query: QueryParams = {}, options: { timeoutMs?: number } = {}): Promise<T> {
        return this.request('GET', path, { query, ...options });
    }
    async post<T>(path: string, body: UnknownRecord, options: { timeoutMs?: number } = {}): Promise<T> {
        return this.request('POST', path, { body, ...options });
    }
    async request<T>(method: 'GET' | 'POST', path: string, { query, body, timeoutMs }: { query?: QueryParams; body?: UnknownRecord; timeoutMs?: number } = {}): Promise<T> {
        const requestId = randomUUID();
        const url = new URL(`${this.config.baseUrl.replace(/\/$/, '')}/api/v1/${path.replace(/^\//, '')}`);
        if (query) {
            for (const [key, value] of Object.entries(query)) {
                if (value === undefined || value === null || value === '')
                    continue;
                if (Array.isArray(value))
                    url.searchParams.set(key, value.join(','));
                else if (typeof value === 'string')
                    url.searchParams.set(key, value);
                else if (typeof value === 'number' || typeof value === 'boolean')
                    url.searchParams.set(key, String(value));
                else
                    url.searchParams.set(key, JSON.stringify(value));
            }
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.config.timeoutMs);
        try {
            const response = await this.fetchImpl(url, {
                method,
                headers: {
                    Authorization: `Bearer ${this.config.apiToken}`,
                    'Content-Type': 'application/json',
                    'X-Timezone-Name': this.config.timezone,
                    'X-Timezone-Offset': String(this.config.timezoneOffset),
                    'X-Request-Id': requestId,
                    'User-Agent': 'ezbookkeeping-mcp-server/0.1.0'
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                signal: controller.signal
            });
            const responseRequestId = response.headers.get('x-request-id') || requestId;
            let payload: unknown;
            const text = await response.text();
            try {
                payload = text ? JSON.parse(text) as unknown : {};
            }
            catch (cause) {
                throw new AppError('UPSTREAM_INVALID_JSON', `ezBookkeeping returned invalid JSON for ${path}`, {
                    cause, retryable: response.status >= 500, status: response.status, requestId: responseRequestId,
                    details: { body_preview: text.slice(0, 500) }
                });
            }
            if (!isApiEnvelope(payload)) {
                throw new AppError('UPSTREAM_INVALID_RESPONSE', `ezBookkeeping returned an invalid response envelope for ${path}`, {
                    retryable: response.status >= 500,
                    status: response.status,
                    requestId: responseRequestId
                });
            }
            if (!response.ok || payload.success === false) {
                throw new AppError('EZBOOKKEEPING_API_ERROR', payload.errorMessage || `ezBookkeeping request failed with HTTP ${response.status}`, {
                    retryable: response.status >= 500 || response.status === 429,
                    status: response.status,
                    ...(payload.errorCode === undefined ? {} : { upstreamErrorCode: payload.errorCode }),
                    requestId: responseRequestId,
                    details: { path: payload.path || url.pathname }
                });
            }
            return payload.result as T;
        }
        catch (error) {
            if (error instanceof AppError)
                throw error;
            if (error instanceof Error && error.name === 'AbortError') {
                throw new AppError('EZBOOKKEEPING_TIMEOUT', `ezBookkeeping request timed out for ${path}`, {
                    retryable: true, requestId
                });
            }
            const message = error instanceof Error ? error.message : String(error);
            throw new AppError('EZBOOKKEEPING_UNAVAILABLE', `Could not reach ezBookkeeping: ${message}`, {
                retryable: true, cause: error, requestId
            });
        }
        finally {
            clearTimeout(timer);
        }
    }
}
interface ApiEnvelope {
    success?: boolean;
    result?: unknown;
    errorMessage?: string;
    errorCode?: string | number;
    path?: string;
}
function isApiEnvelope(value: unknown): value is ApiEnvelope {
    if (typeof value !== 'object' || value === null)
        return false;
    const success = (value as Record<string, unknown>).success;
    return success === undefined || typeof success === 'boolean';
}
