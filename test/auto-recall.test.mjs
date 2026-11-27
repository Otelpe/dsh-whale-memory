import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { zstdCompressSync } from 'node:zlib';

import { firstUserText, newestSessionFile } from '../lib/session-log.js';
import { apply, DEFAULTS } from '../lib/index.js';

function frame(records) {
  return zstdCompressSync(Buffer.from(records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8'));
}

function session(root, id, text, mtimeMs) {
  const dir = path.join(root, '--E-x--', `session-${id}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'session.v4.jsonl.zstd');
  fs.writeFileSync(file, frame([{ type: 'user/message', data: { content: [{ type: 'text', text }] } }]));
  if (mtimeMs) fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
  return file;
}

test('firstUserText returns the first human line of a log', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-first-'));
  const file = session(root, 'aaaa-1', '先问问这个插件怎么装\n');
  assert.equal(firstUserText(file), '先问问这个插件怎么装');
});

test('newestSessionFile follows mtime', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-newest-'));
  session(root, 'old-1', '旧的', Date.now() - 3600_000);
  session(root, 'new-1', '新的', Date.now());
  const newest = newestSessionFile(root);
  assert.equal(newest.session, 'new-1');
});

test('recall uses the newest log when no explicit query is given', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-auto-'));
  const sessions = path.join(root, 'sessions');
  session(sessions, 'cur-1', '这个插件怎么装啊', Date.now());

  const indexPath = path.join(root, 'words.jsonl');
  fs.writeFileSync(
    indexPath,
    JSON.stringify({ v: 1, session: 'old-9', seq: 3, time: '2026-11-20T01:00:00.000Z', role: 'user', text: '这个插件怎么安装', chars: 8, path: 'x' }) + '\n',
  );

  const calls = [];
  const ctx = { inject: (_s, fn) => fn({ systemPrompt: { context: (spec) => calls.push(spec) } }) };
  apply(ctx, { ...DEFAULTS, sessionsRoot: sessions, indexPath, recallQuery: '', door: false, autoIndexMinutes: 0 });

  const text = calls[0].text();
  assert.match(text, /log:session-old-9#seq=3/);
  assert.equal(text.includes('讨论了'), false);
});

test('a session log older than the pick window is not treated as current', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-stale-'));
  const sessions = path.join(root, 'sessions');
  session(sessions, 'stale-1', '这个插件怎么装啊', Date.now() - 3600_000);

  const indexPath = path.join(root, 'words.jsonl');
  fs.writeFileSync(
    indexPath,
    JSON.stringify({ v: 1, session: 'old-9', seq: 3, time: '2026-11-20T01:00:00.000Z', role: 'user', text: '这个插件怎么安装', chars: 8, path: 'x' }) + '\n',
  );

  const calls = [];
  const ctx = { inject: (_s, fn) => fn({ systemPrompt: { context: (spec) => calls.push(spec) } }) };
  apply(ctx, { ...DEFAULTS, sessionsRoot: sessions, indexPath, door: false, sessionPickWindowMs: 60_000 });
  assert.equal(calls[0].text(), '');
});

test('a stale index is rebuilt in-process before recall', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-rebuild-'));
  const sessions = path.join(root, 'sessions');
  session(sessions, 'cur-3', '把记忆收成独立仓库', Date.now());

  const out = path.join(root, 'index');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'words.jsonl'), '');
  fs.writeFileSync(
    path.join(out, 'meta.json'),
    JSON.stringify({ builtAt: new Date(Date.now() - 2 * 3600_000).toISOString(), logs: 0, written: 0, skipped: 0, failed: 0, files: {} }),
  );

  const calls = [];
  const ctx = { inject: (_s, fn) => fn({ systemPrompt: { context: (spec) => calls.push(spec) } }) };
  apply(ctx, {
    ...DEFAULTS,
    sessionsRoot: sessions,
    indexPath: path.join(out, 'words.jsonl'),
    recallQuery: '收成独立仓库',
    door: false,
    autoIndexMinutes: 1,
  });

  // 重建发生在第一次求值里，所以先取文本，再看磁盘。
  const text = calls[0].text();
  assert.match(fs.readFileSync(path.join(out, 'words.jsonl'), 'utf8'), /收成独立仓库/);
  assert.match(text, /log:session-cur-3#seq=1/);
});

test('recall stays empty when session picking is off', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-off-'));
  const sessions = path.join(root, 'sessions');
  session(sessions, 'cur-2', '这个插件怎么装啊', Date.now());
  const calls = [];
  const ctx = { inject: (_s, fn) => fn({ systemPrompt: { context: (spec) => calls.push(spec) } }) };
  apply(ctx, { ...DEFAULTS, sessionsRoot: sessions, indexPath: path.join(root, 'none.jsonl'), sessionPick: false, door: false });
  assert.equal(calls[0].text(), '');
});
