import type { AppConfig, McpTransport, WriteProfile } from './types.js';
import path from 'node:path';
import { AppError } from './lib/errors.js';
import { getTimezoneOffsetMinutes } from './lib/time.js';
type Env = Readonly<Record<string, string | undefined>>;
function integerEnv(env: Env, name: string, fallback: number, { min = -Infinity, max = Infinity }: { min?: number; max?: number } = {}) {
    const raw = env[name];
    const value = raw == null || raw === '' ? fallback : Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new AppError('INVALID_CONFIGURATION', `${name} must be an integer between ${min} and ${max}`);
    }
    return value;
}
function booleanEnv(env: Env, name: string, fallback = false) {
    const raw = env[name];
    if (raw == null || raw === '')
        return fallback;
    if (String(raw).toLowerCase() === 'true')
        return true;
    if (String(raw).toLowerCase() === 'false')
        return false;
    throw new AppError('INVALID_CONFIGURATION', `${name} must be true or false`);
}
function normalizeBaseUrl(value: string) {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/\/$/, '');
    return url.toString().replace(/\/$/, '');
}
export function loadConfig(env: Env = process.env): AppConfig {
    const baseUrl = env.EZBK_BASE_URL;
    const apiToken = env.EZBK_API_TOKEN;
    if (!baseUrl)
        throw new AppError('INVALID_CONFIGURATION', 'EZBK_BASE_URL is required');
    if (!apiToken)
        throw new AppError('INVALID_CONFIGURATION', 'EZBK_API_TOKEN is required');
    const timezone = env.EZBK_TIMEZONE || 'Asia/Tokyo';
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    }
    catch {
        throw new AppError('INVALID_CONFIGURATION', `Invalid IANA timezone: ${timezone}`);
    }
    const profile = env.MCP_WRITE_PROFILE || 'read';
    if (!['read', 'standard', 'extended', 'admin'].includes(profile)) {
        throw new AppError('INVALID_CONFIGURATION', 'MCP_WRITE_PROFILE must be read, standard, extended, or admin');
    }
    const confirmationSecret = env.MCP_CONFIRMATION_SECRET || '';
    if (profile !== 'read' && confirmationSecret.length < 32) {
        throw new AppError('INVALID_CONFIGURATION', 'MCP_CONFIRMATION_SECRET must contain at least 32 characters for write profiles');
    }
    const transport = env.MCP_TRANSPORT || 'stdio';
    if (!['stdio', 'http'].includes(transport)) {
        throw new AppError('INVALID_CONFIGURATION', 'MCP_TRANSPORT must be stdio or http');
    }
    const httpHost = env.MCP_HTTP_HOST || '127.0.0.1';
    const httpBearerToken = env.MCP_HTTP_BEARER_TOKEN || '';
    if (httpBearerToken && httpBearerToken.length < 32) {
        throw new AppError('INVALID_CONFIGURATION', 'MCP_HTTP_BEARER_TOKEN must contain at least 32 characters');
    }
    const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
    const allowUnauthenticatedHttp = booleanEnv(env, 'MCP_HTTP_ALLOW_UNAUTHENTICATED', false);
    if (transport === 'http' && !loopbackHosts.has(httpHost) && !httpBearerToken && !allowUnauthenticatedHttp) {
        throw new AppError('INVALID_CONFIGURATION', 'Non-loopback HTTP requires MCP_HTTP_BEARER_TOKEN or explicit MCP_HTTP_ALLOW_UNAUTHENTICATED=true for an externally authenticated proxy');
    }
    const configuredAllowedHosts = (env.MCP_HTTP_ALLOWED_HOSTS || '').split(',').map((item) => item.trim()).filter(Boolean);
    const httpAllowedHosts = configuredAllowedHosts.length
        ? configuredAllowedHosts
        : loopbackHosts.has(httpHost) ? undefined : ['127.0.0.1', 'localhost'];
    return {
        ezbookkeeping: {
            baseUrl: normalizeBaseUrl(baseUrl),
            apiToken,
            timezone,
            timezoneOffset: getTimezoneOffsetMinutes(timezone),
            timeoutMs: integerEnv(env, 'EZBK_REQUEST_TIMEOUT_MS', 10000, { min: 1000, max: 1800000 })
        },
        mcp: {
            name: 'ezbookkeeping-mcp-server',
            version: '0.1.0',
            transport: transport as McpTransport,
            host: httpHost,
            port: integerEnv(env, 'MCP_HTTP_PORT', 3000, { min: 1, max: 65535 }),
            ...(httpAllowedHosts ? { httpAllowedHosts } : {}),
            httpBearerToken,
            allowUnauthenticatedHttp,
            writeProfile: profile as WriteProfile,
            confirmationSecret,
            confirmationTtlSeconds: integerEnv(env, 'MCP_CONFIRMATION_TTL_SECONDS', 600, { min: 30, max: 86400 }),
            batchUpdateLimit: integerEnv(env, 'MCP_BATCH_UPDATE_LIMIT', 100, { min: 1, max: 100 }),
            auditLogPath: path.resolve(env.MCP_AUDIT_LOG_PATH || './data/audit.jsonl')
        }
    };
}
