import test from 'node:test';
import assert from 'node:assert/strict';
import { EzBookkeepingClient } from '../src/lib/ezbk-client.js';
import { AppError } from '../src/lib/errors.js';
function jsonResponse(payload: unknown, status = 200, headers: HeadersInit = {}) {
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', ...headers } });
}
function fetchInputUrl(input: string | URL | Request): string {
    if (typeof input === 'string') return input;
    return input instanceof URL ? input.href : input.url;
}
test('client sends API token and unwraps result', async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const client = new EzBookkeepingClient({
        baseUrl: 'http://localhost:8080', apiToken: 'secret', timezone: 'Asia/Tokyo', timezoneOffset: 540, timeoutMs: 1000
    }, async (url, init) => {
        seen = init === undefined ? { url: fetchInputUrl(url) } : { url: fetchInputUrl(url), init };
        return jsonResponse({ success: true, result: { version: '1.5.0' } });
    });
    const result = await client.get<{ version: string }>('systems/version.json');
    assert.deepEqual(result, { version: '1.5.0' });
    assert(seen);
    assert.match(seen.url, /\/api\/v1\/systems\/version\.json$/);
    const headers = new Headers(seen.init?.headers);
    assert.equal(headers.get('Authorization'), 'Bearer secret');
    assert.equal(headers.get('X-Timezone-Name'), 'Asia/Tokyo');
});
test('client converts upstream error envelope', async () => {
    const client = new EzBookkeepingClient({
        baseUrl: 'http://localhost:8080', apiToken: 'secret', timezone: 'Asia/Tokyo', timezoneOffset: 540, timeoutMs: 1000
    }, async () => jsonResponse({ success: false, errorCode: 205018, errorMessage: 'not editable', path: '/api/v1/transactions/modify.json' }, 400));
    await assert.rejects(() => client.post('transactions/modify.json', {}), (error: unknown) => {
        assert(error instanceof AppError);
        assert.equal(error.code, 'EZBOOKKEEPING_API_ERROR');
        assert.equal(error.upstreamErrorCode, 205018);
        return true;
    });
});
test('client preserves an ezBookkeeping base URL subpath', async () => {
    let requestedUrl = '';
    const client = new EzBookkeepingClient({
        baseUrl: 'https://example.test/finance', apiToken: 'secret', timezone: 'Asia/Tokyo', timezoneOffset: 540, timeoutMs: 1000
    }, async (url) => {
        requestedUrl = fetchInputUrl(url);
        return new Response(JSON.stringify({ success: true, result: true }), {
            status: 200, headers: { 'content-type': 'application/json' }
        });
    });
    await client.get('systems/version.json');
    assert.equal(new URL(requestedUrl).pathname, '/finance/api/v1/systems/version.json');
});
