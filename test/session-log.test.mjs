import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { zstdCompressSync } from 'node:zlib';

import { splitFrames, readRecords, listSessionFiles } from '../lib/session-log.js';

function frame(records) {
  const body = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  return zstdCompressSync(Buffer.from(body, 'utf8'));
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-'));
  const dir = path.join(root, '--E-demo--', 'session-aaaaaaaa-1111-2222-3333-444444444444');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'session.v4.jsonl.zstd');
  const buf = Buffer.concat([
    frame([{ type: 'user/message', seq: 1, data: { text: '第一帧' } }]),
    frame([{ type: 'assistant/message', seq: 2, data: { text: '第二帧' } }, { type: 'x', seq: 3, data: {} }]),
    frame([{ type: 'user/message', seq: 4, data: { text: '第三帧' } }]),
  ]);
  fs.writeFileSync(file, buf);
  return { root, dir, file };
}

test('splitFrames finds every zstd frame', () => {
  const { file } = makeFixture();
  const frames = splitFrames(fs.readFileSync(file));
  assert.equal(frames.length, 3);
});

test('readRecords decodes all frames in order', () => {
  const { file } = makeFixture();
  const { records, frames, failed } = readRecords(file);
  assert.equal(frames, 3);
  assert.equal(failed, 0);
  assert.deepEqual(records.map((r) => r.seq), [1, 2, 3, 4]);
});

test('readRecords survives a corrupt middle frame', () => {
  const { file } = makeFixture();
  const buf = fs.readFileSync(file);
  const bad = Buffer.from(buf);
  bad.fill(0, 40, 52); // 撕坏第一帧的压缩体
  fs.writeFileSync(file, bad);
  const { records, failed } = readRecords(file);
  assert.ok(failed >= 1);
  assert.ok(Array.isArray(records));
});

test('listSessionFiles finds session logs under a workspace dir', () => {
  const { root } = makeFixture();
  const found = listSessionFiles(root);
  assert.equal(found.length, 1);
  assert.equal(found[0].session, 'aaaaaaaa-1111-2222-3333-444444444444');
  assert.ok(found[0].size > 0);
});
