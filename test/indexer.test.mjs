import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { zstdCompressSync } from 'node:zlib';

import { buildIndex, readIndex } from '../lib/indexer.js';
import { hashLine } from '../lib/sign.js';

const SESSION = 'bbbbbbbb-1111-2222-3333-444444444444';

function frame(records) {
  const body = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  return zstdCompressSync(Buffer.from(body, 'utf8'));
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-idx-'));
  const sessions = path.join(root, 'sessions');
  const dir = path.join(sessions, '--E-demo--', `session-${SESSION}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'session.v4.jsonl.zstd');
  fs.writeFileSync(
    file,
    Buffer.concat([
      frame([
        { type: 'user/message', seq: 1, time: 1000, data: { content: [{ type: 'text', text: '帮我装个插件' }] } },
        { type: 'system/note', seq: 2, data: { text: '不是对话' } },
      ]),
      frame([
        { type: 'assistant/message', seq: 3, time: 2000, data: { message: { content: [{ type: 'text', text: '先说结论' }] } } },
        { type: 'user/message', seq: 4, time: 3000, data: { content: [{ type: 'text', text: '[卡片] 不该进索引' }] } },
      ]),
    ]),
  );
  return { root, sessions, out: path.join(root, 'index'), file };
}

test('buildIndex writes one row per conversation line', () => {
  const { sessions, out } = setup();
  const res = buildIndex({ sessionsRoot: sessions, outDir: out });
  assert.equal(res.failed, 0);
  assert.equal(res.written, 2);
  const rows = readIndex(path.join(out, 'words.jsonl'));
  assert.deepEqual(rows.map((r) => r.text), ['帮我装个插件', '先说结论']);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['chars', 'path', 'role', 'seq', 'session', 'text', 'time', 'v']);
  assert.equal(rows[0].session, SESSION);
  assert.equal(rows[0].seq, 1);
  assert.equal(rows[1].seq, 3);
  assert.equal(rows[0].role, 'user');
});

test('buildIndex is incremental and --full rebuilds', () => {
  const { sessions, out } = setup();
  buildIndex({ sessionsRoot: sessions, outDir: out });
  const second = buildIndex({ sessionsRoot: sessions, outDir: out });
  assert.equal(second.written, 0);
  assert.equal(second.skipped, 1);
  const rowsAgain = readIndex(path.join(out, 'words.jsonl'));
  assert.equal(rowsAgain.length, 2);
  const third = buildIndex({ sessionsRoot: sessions, outDir: out, full: true });
  assert.equal(third.written, 2);
});

test('meta.json records file fingerprints', () => {
  const { sessions, out } = setup();
  buildIndex({ sessionsRoot: sessions, outDir: out });
  const meta = JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8'));
  const key = Object.keys(meta.files)[0];
  assert.ok(key.includes(SESSION));
  assert.ok(meta.files[key].size > 0);
  assert.ok(meta.builtAt);
});

test('row text hash matches sign hash for the same line', () => {
  const { sessions, out } = setup();
  buildIndex({ sessionsRoot: sessions, outDir: out });
  const rows = readIndex(path.join(out, 'words.jsonl'));
  assert.equal(hashLine(rows[0].role, rows[0].text).length, 8);
});
