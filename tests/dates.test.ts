import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTokenDate, isExpired, latestCreatedToken, type TokenRow } from '../src/token-list.js';

test('strict supported dates reject invalid and ambiguous values', () => {
  for (const text of ['02/31/26', '13/01/26', '2026-02-29', 'foo', '', '10/31/2026 trailing', '2026-10-31T10:00:00']) assert.equal(parseTokenDate(text), null, text);
  for (const text of ['10/31/26', '10/31/2026', '2026-10-31', '2026-10-31T10:00:00+08:00', '2024-02-29']) assert.ok(parseTokenDate(text), text);
});

test('date-only expiration retains today across the Shanghai UTC boundary', () => {
  const now = new Date('2026-10-30T17:00:00Z');
  assert.equal(isExpired(parseTokenDate('10/30/26')!, now), true);
  assert.equal(isExpired(parseTokenDate('10/31/26')!, now), false);
  assert.equal(isExpired(parseTokenDate('2026-10-31T00:00:00+08:00')!, now), true);
});


test('same-day tokens are ordered by precise JWT issuance time instead of DOM order', () => {
  const jwt = (iat: number) => 'header.' + Buffer.from(JSON.stringify({ iat })).toString('base64url') + '.signature';
  const row = (key: string, token: string): TokenRow => ({ key, token, creation: '10/31/26', expiration: '11/07/26', description: key, tableIndex: 0, rowIndex: 0 });
  const older = row('older', jwt(Date.parse('2026-10-31T04:01:13Z') / 1000));
  const newest = row('newest', jwt(Date.parse('2026-10-31T06:36:02Z') / 1000));
  assert.equal(latestCreatedToken([older, newest])?.key, 'newest');
  assert.equal(latestCreatedToken([newest, older])?.key, 'newest');
  assert.throws(() => latestCreatedToken([row('unknown', 'opaque'), newest]), { code: 'TOKEN_CREATION_AMBIGUOUS' });
});
