import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { zstdCompressSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { buildIndex, readIndex } from '../lib/indexer.js';
import { readRecords } from '../lib/session-log.js';

const BIN = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'bin', 'dsh-whale-memory.js');
const SESSION = 'eeeeeeee-1111-2222-3333-444444444444';

function cli(args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [BIN, ...args], { encoding: 'utf8' }) };
  } catch (err) {
    return { code: err.status ?? 1, out: String(err.stdout ?? ''), err: String(err.stderr ?? '') };
  }
}

function makeLog(text) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-fix-'));
  const sessions = path.join(root, 'sessions');
  const dir = path.join(sessions, '--E-x--', `session-${SESSION}`);
  fs.mkdirSync(dir, { recursive: true });
  const body = JSON.stringify({ type: 'assistant/message', time: 1764200000000, data: { message: { content: [{ type: 'text', text }] } } });
  fs.writeFileSync(path.join(dir, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(body + '\n', 'utf8')));
  return { root, sessions, out: path.join(root, 'index') };
}

test('a line with a trailing newline still opens by its sign', () => {
  // 助手消息几乎都带换行；索引 trim 过而 open 用原文校验，就会让门永远打不开。
  const text = '先说结论：可以\n';
  const { sessions, out } = makeLog(text);
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

test('a file whose frames cannot be decoded fails loudly', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-legacy-'));
  const sessions = path.join(root, 'sessions');
  const dir = path.join(sessions, '--E-y--', `session-${SESSION}`);
  fs.mkdirSync(dir, { recursive: true });
  // 不是 zstd 帧：既没有魔数，也不是这个版本认的格式。
  fs.writeFileSync(path.join(dir, 'session.v3.jsonl.zstd'), Buffer.from('not a zstd frame at all'));

  const { ok } = readRecords(path.join(dir, 'session.v3.jsonl.zstd'));
  assert.equal(ok, false);

  const out = path.join(root, 'index');
  const res = cli(['index', '--sessions', sessions, '--out', out]);
  assert.notEqual(res.code, 0);
  assert.match(res.err, /一帧都没解开/);

  // 用另一个输出目录，否则第二次会被增量逻辑跳过、看不到失败。
  const built = buildIndex({ sessionsRoot: sessions, outDir: path.join(root, 'index2') });
  assert.equal(built.failedFiles, 1);
});
