import test from 'node:test';
import assert from 'node:assert/strict';
import { decimalToMinor, minorToDecimal, normalizeAmountFilter } from '../src/lib/amounts.js';
import { ConfirmationSigner } from '../src/lib/confirmation.js';
import { parseDeleteTransactionPayload } from '../src/confirmation-payloads.js';
import { resolveReference, flattenTree } from '../src/lib/resolver.js';
import { transactionRevision } from '../src/lib/revision.js';
import { AuditLog } from '../src/lib/audit-log.js';
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('amount conversion is exact and supports negatives', () => {
  assert.equal(decimalToMinor('12.34'), 1234);
  assert.equal(decimalToMinor('-0.05'), -5);
  assert.equal(minorToDecimal('1234'), '12.34');
  assert.equal(minorToDecimal(-5), '-0.05');
  assert.equal(normalizeAmountFilter({ op: 'between', min: '1.00', max: '2.50' }), 'bt:100:250');
  assert.throws(() => decimalToMinor('1.234'), { code: 'INVALID_AMOUNT' });
});

test('confirmation tokens are signed, action-bound and expire', () => {
  let now = 1_700_000_000_000;
  const signer = new ConfirmationSigner('x'.repeat(64), 60, () => now);
  const issued = signer.issue('apply', { ids: ['1'] });
  const parseIds = (value: unknown) => value;
  assert.deepEqual(signer.verify(issued.token, 'apply', parseIds), { ids: ['1'] });
  assert.throws(() => signer.verify(issued.token, 'delete', parseIds), { code: 'CONFIRMATION_ACTION_MISMATCH' });
  const [payload, signature] = issued.token.split('.');
  if (!payload || !signature) throw new Error('Expected signed confirmation token');
  const tampered = `${payload}.${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;
  assert.throws(() => signer.verify(tampered, 'apply', parseIds), { code: 'INVALID_CONFIRMATION_TOKEN' });
  now += 61_000;
  assert.throws(() => signer.verify(issued.token, 'apply', parseIds), { code: 'CONFIRMATION_TOKEN_EXPIRED' });
});

test('confirmation payloads are runtime validated after signature verification', () => {
  const signer = new ConfirmationSigner('x'.repeat(64));
  const malformed = signer.issue('delete_transaction', { transaction_id: 1, revision: 'revision' });
  assert.throws(
    () => signer.verify(malformed.token, 'delete_transaction', parseDeleteTransactionPayload),
    { code: 'INVALID_CONFIRMATION_TOKEN' }
  );
});

test('resolver rejects ambiguous names and supports paths', () => {
  const flat = flattenTree<{ id: string; name: string; subCategories: unknown[]; path?: string }>([
    { id: '1', name: 'Food', subCategories: [{ id: '2', name: 'Other', subCategories: [] }] },
    { id: '3', name: 'Travel', subCategories: [{ id: '4', name: 'Other', subCategories: [] }] }
  ], 'subCategories');
  assert.equal(resolveReference({ id: '2' }, flat, { entity: 'category' }).path, 'Food / Other');
  assert.throws(() => resolveReference('Other', flat, { entity: 'category' }), { code: 'AMBIGUOUS_CATEGORY' });
});

test('transaction revision is stable across tag and picture order', () => {
  const base = {
    id: '10', type: 3, categoryId: '20', time: 100, utcOffset: 540,
    sourceAccountId: '30', destinationAccountId: '0', sourceAmount: 1234,
    destinationAmount: null, hideAmount: false, tagIds: ['2', '1'],
    pictures: [{ pictureId: '9' }, { pictureId: '8' }], comment: 'x', geoLocation: null, editable: true
  };
  const changedOrder = { ...base, tagIds: ['1', '2'], pictures: [{ pictureId: '8' }, { pictureId: '9' }] };
  assert.equal(transactionRevision(base), transactionRevision(changedOrder));
  assert.notEqual(transactionRevision(base), transactionRevision({ ...base, comment: 'y' }));
});

test('audit write failure is reported without turning a completed upstream write into a retryable failure', async () => {
  const audit = new AuditLog('/dev/null/audit.jsonl');
  const messages: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => messages.push(args);
  let auditId: string | null;
  try {
    auditId = await audit.write({ tool: 'test', result: 'success' });
  }
  finally {
    console.error = originalError;
  }
  assert.equal(auditId, null);
  assert.match(audit.lastError ?? '', /ENOTDIR|EEXIST/);
  assert.equal(messages[0]?.[0], 'AUDIT_LOG_WRITE_FAILED');
});

test('audit preflight creates and restricts the log file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ezbk-audit-'));
  const file = path.join(directory, 'audit.jsonl');
  try {
    await writeFile(file, '', { mode: 0o644 });
    await chmod(file, 0o644);
    const audit = new AuditLog(file);
    await audit.ensureWritable();
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal(audit.lastError, null);
  }
  finally {
    await rm(directory, { recursive: true, force: true });
  }
});
