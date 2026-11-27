import test from 'node:test';
import assert from 'node:assert/strict';

import { hashLine, formatSign, parseSign } from '../lib/sign.js';

test('hashLine returns 8 lowercase hex chars', () => {
  const h = hashLine('user', '你好');
  assert.match(h, /^[0-9a-f]{8}$/);
  assert.equal(h, hashLine('user', '你好'));
  assert.notEqual(h, hashLine('assistant', '你好'));
  assert.notEqual(h, hashLine('user', '你好 '));
  assert.notEqual(h, hashLine('user', '你们'));
});

test('formatSign roundtrips through parseSign', () => {
  const sign = formatSign({ session: 'session-abc', seq: 7, role: 'user', text: '装插件' });
  assert.equal(sign, `log:session-abc#seq=7&h=${hashLine('user', '装插件')}`);
  const parsed = parseSign(sign);
  assert.deepEqual(parsed, { session: 'abc', seq: 7, hash: hashLine('user', '装插件') });
});

test('parseSign tolerates a sign without hash', () => {
  assert.deepEqual(parseSign('log:session-abc#seq=7'), { session: 'abc', seq: 7, hash: null });
});

test('parseSign rejects junk', () => {
  assert.equal(parseSign('乱写'), null);
  assert.equal(parseSign('log:session-abc#seq=x'), null);
  assert.equal(parseSign(''), null);
});
