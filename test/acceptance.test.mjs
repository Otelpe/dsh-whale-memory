import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { zstdCompressSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { DEFAULTS } from '../lib/index.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BIN = path.join(ROOT, 'bin', 'dsh-whale-memory.js');
const SESSION = 'dddddddd-1111-2222-3333-444444444444';

function cli(args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [BIN, ...args], { encoding: 'utf8' }) };
  } catch (err) {
    return { code: err.status ?? 1, out: String(err.stdout ?? ''), err: String(err.stderr ?? '') };
  }
}

test('acceptance: index -> query -> open returns the same line verbatim', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-acc-'));
  const sessions = path.join(root, 'sessions');
  const dir = path.join(sessions, '--E-演示 工作区--', `session-${SESSION}`);
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    { type: 'user/message', time: 1764200000000, data: { content: [{ type: 'text', text: '把记忆那套收成独立仓库' }] } },
    { type: 'assistant/message', time: 1764200005000, data: { message: { content: [{ type: 'text', text: '先说结论：可以' }] } } },
  ];
  fs.writeFileSync(
    path.join(dir, 'session.v4.jsonl.zstd'),
    zstdCompressSync(Buffer.from(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8')),
  );

  const out = path.join(root, 'index');
  assert.equal(cli(['index', '--sessions', sessions, '--out', out]).code, 0);

  const q = cli(['query', '收成独立仓库', '--index', out]);
  assert.equal(q.code, 0);
  const sign = q.out.trim().split('└ ').pop();
  assert.match(sign, new RegExp(`^log:session-${SESSION}#seq=1&h=[0-9a-f]{8}$`));

  const opened = cli(['open', sign, '--sessions', sessions]);
  assert.equal(opened.code, 0);
  assert.equal(opened.out.trim(), '把记忆那套收成独立仓库');
});

test('acceptance: shipped defaults contain no local absolute paths', () => {
  const text = JSON.stringify(DEFAULTS);
  assert.equal(/[A-Za-z]:[\\/]/.test(text), false);
  assert.equal(text.includes('DSH-data'), false);
});

test('acceptance: repo sources contain no personal machine path outside docs', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '.superpowers') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(mjs|js|json|yml)$/.test(e.name)) continue;
      const body = fs.readFileSync(full, 'utf8');
      if (/[A-Za-z]:\\\\?(DSH-data|Plugin Development)/.test(body)) offenders.push(full);
    }
  };
  walk(ROOT);
  assert.deepEqual(offenders, []);
});
