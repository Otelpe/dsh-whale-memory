import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { zstdCompressSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { buildIndex, readIndex } from '../lib/indexer.js';
import { readRecords } from '../lib/session-log.js';
import { formatSign } from '../lib/sign.js';

const BIN = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'bin', 'dsh-whale-memory.js');
const SESSION = 'eeeeeeee-1111-2222-3333-444444444444';

function cli(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

function writeLog(text) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-fix-'));
  const sessions = path.join(root, 'sessions');
  const dir = path.join(sessions, '--E-x--', `session-${SESSION}`);
  fs.mkdirSync(dir, { recursive: true });
  const body = JSON.stringify({ type: 'assistant/message', time: 1764200000000, data: { message: { content: [{ type: 'text', text }] } } });
  fs.writeFileSync(path.join(dir, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(body + '\n', 'utf8')));
  return { root, sessions, out: path.join(root, 'index'), dir };
}

test('a line with a trailing newline still opens by its sign', () => {
  const text = '先说结论：可以\n';
  const { sessions, out } = writeLog(text);
  assert.equal(cli(['index', '--sessions', sessions, '--out', out]).code, 0);

  const rows = readIndex(path.join(out, 'words.jsonl'));
  assert.equal(rows[0].text, text, '索引必须存原文');

  const q = cli(['query', '先说结论', '--index', out]);
  assert.equal(q.code, 0);
  const sign = q.out.trim().split('└ ').pop();
  const opened = cli(['open', sign, '--sessions', sessions]);
  assert.equal(opened.code, 0);
  assert.equal(opened.out.replace(/\r\n/g, '\n').trim(), '先说结论：可以');
});

test('a drifted line number still opens via its hash', () => {
  const { sessions, dir } = writeLog('第一句\n');
  // 门牌按「这行内容」签发，但行号写成了 1；实际它现在落在 seq=2。
  const sign = formatSign({ session: SESSION, seq: 1, role: 'assistant', text: '第一句\n' });
  const body =
    JSON.stringify({ type: 'user/message', data: { content: [{ type: 'text', text: '前插的一句' }] } }) +
    '\n' +
    JSON.stringify({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '第一句\n' }] } } }) +
    '\n';
  fs.writeFileSync(path.join(dir, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(body, 'utf8')));

  const res = cli(['open', sign, '--sessions', sessions]);
  assert.equal(res.code, 0);
  assert.match(res.out, /第一句/);
  assert.match(res.err, /行号已变/);
});

test('a file whose frames cannot be decoded fails loudly', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-legacy-'));
  const sessions = path.join(root, 'sessions');
  const dir = path.join(sessions, '--E-y--', `session-${SESSION}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'session.v3.jsonl.zstd'), Buffer.from('not a zstd frame at all'));

  const { ok } = readRecords(path.join(dir, 'session.v3.jsonl.zstd'));
  assert.equal(ok, false);

  const out = path.join(root, 'index');
  const res = cli(['index', '--sessions', sessions, '--out', out]);
  assert.notEqual(res.code, 0);
  assert.match(res.err, /一帧都没解开/);

  const built = buildIndex({ sessionsRoot: sessions, outDir: path.join(root, 'index2') });
  assert.equal(built.failedFiles, 1);
});
