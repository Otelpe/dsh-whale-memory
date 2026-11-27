import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { zstdCompressSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { formatSign } from '../lib/sign.js';

const BIN = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'bin', 'dsh-whale-memory.js');
const SESSION = 'cccccccc-1111-2222-3333-444444444444';

function run(args) {
  try {
    const out = execFileSync(process.execPath, [BIN, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: String(err.stdout ?? ''), err: String(err.stderr ?? '') };
  }
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-cli-'));
  const sessions = path.join(root, 'sessions');
  const dir = path.join(sessions, '--E-demo--', `session-${SESSION}`);
  fs.mkdirSync(dir, { recursive: true });
  const body = [
    JSON.stringify({ type: 'user/message', time: 1700000000000, data: { content: [{ type: 'text', text: '帮我装个插件' }] } }),
    JSON.stringify({ type: 'assistant/message', time: 1700000001000, data: { message: { content: [{ type: 'text', text: '先说结论' }] } } }),
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(body + '\n', 'utf8')));
  return { root, sessions, index: path.join(root, 'index') };
}

test('index then query finds the line', () => {
  const { sessions, index } = setup();
  assert.equal(run(['index', '--sessions', sessions, '--out', index]).code, 0);
  const q = run(['query', '装个插件', '--index', index]);
  assert.equal(q.code, 0);
  assert.match(q.out, new RegExp(`log:session-${SESSION}#seq=1&h=[0-9a-f]{8}`));
});

test('open returns the verbatim line and rejects a wrong hash', () => {
  const { sessions, index } = setup();
  run(['index', '--sessions', sessions, '--out', index]);
  const rows = fs.readFileSync(path.join(index, 'words.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const sign = formatSign({ session: SESSION, seq: rows[0].seq, role: rows[0].role, text: rows[0].text });
  const ok = run(['open', sign, '--sessions', sessions]);
  assert.equal(ok.code, 0);
  assert.equal(ok.out.trim(), '帮我装个插件');

  const bad = sign.replace(/h=[0-9a-f]{8}/, 'h=deadbeef');
  const no = run(['open', bad, '--sessions', sessions]);
  assert.notEqual(no.code, 0);
  assert.match(no.err, /原文已变/);
});

test('doctor reports a missing index without failing', () => {
  const { root } = setup();
  const d = run(['doctor', '--index', path.join(root, 'nope')]);
  assert.equal(d.code, 0);
  assert.match(d.out, /index not found/);
});

test('query with no index exits non-zero with a clear message', () => {
  const { root } = setup();
  const q = run(['query', '装个插件', '--index', path.join(root, 'nope')]);
  assert.notEqual(q.code, 0);
  assert.match(q.err, /index not found/);
});
