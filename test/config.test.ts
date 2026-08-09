import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const base = {
  EZBK_BASE_URL: 'https://finance.example.test/ezbookkeeping/',
  EZBK_API_TOKEN: 'token',
  EZBK_TIMEZONE: 'Asia/Tokyo'
};

test('loadConfig uses the supplied environment object and preserves base path', () => {
  const config = loadConfig({
    ...base,
    EZBK_REQUEST_TIMEOUT_MS: '2345',
    MCP_HTTP_PORT: '4321',
    MCP_BATCH_UPDATE_LIMIT: '12'
  });
  assert.equal(config.ezbookkeeping.baseUrl, 'https://finance.example.test/ezbookkeeping');
  assert.equal(config.ezbookkeeping.timeoutMs, 2345);
  assert.equal(config.mcp.port, 4321);
  assert.equal(config.mcp.batchUpdateLimit, 12);
});

test('non-loopback HTTP requires bearer authentication or explicit proxy trust', () => {
  assert.throws(
    () => loadConfig({ ...base, MCP_TRANSPORT: 'http', MCP_HTTP_HOST: '0.0.0.0' }),
    { code: 'INVALID_CONFIGURATION' }
  );
});

test('non-loopback HTTP accepts a sufficiently strong bearer token', () => {
  const config = loadConfig({
    ...base,
    MCP_TRANSPORT: 'http',
    MCP_HTTP_HOST: '0.0.0.0',
    MCP_HTTP_BEARER_TOKEN: 'b'.repeat(64),
    MCP_HTTP_ALLOWED_HOSTS: 'finance.example.test,localhost'
  });
  assert.equal(config.mcp.httpBearerToken, 'b'.repeat(64));
  assert.deepEqual(config.mcp.httpAllowedHosts, ['finance.example.test', 'localhost']);
});

test('non-loopback HTTP can explicitly trust an authenticating reverse proxy', () => {
  const config = loadConfig({
    ...base,
    MCP_TRANSPORT: 'http',
    MCP_HTTP_HOST: '0.0.0.0',
    MCP_HTTP_ALLOW_UNAUTHENTICATED: 'true'
  });
  assert.equal(config.mcp.allowUnauthenticatedHttp, true);
});
