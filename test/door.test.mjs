import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { renderDoor } from '../lib/door.js';
import { apply, DEFAULTS } from '../lib/index.js';

const NOW = new Date('2026-11-27T23:18:00+08:00');

test('door shows clock and weekday', () => {
  const text = renderDoor({ now: NOW });
  assert.match(text, /现在：2026-11-27 23:18/);
  assert.match(text, /星期五/);
  assert.match(text, /必须去查/);
});

test('door omits the rest line when there is no open landing', () => {
  assert.equal(renderDoor({ now: NOW, restEntry: null }).includes('上次停在这'), false);
  const withRest = renderDoor({ now: NOW, restEntry: { text: '在验重启后的三件事', fromSeq: 12 } });
  assert.ok(withRest.includes('上次停在这'));
  assert.ok(withRest.includes('在验重启后的三件事'));
});

test('door truncates on a character boundary within maxBytes', () => {
  const text = renderDoor({ now: NOW, maxBytes: 120 });
  assert.ok(Buffer.byteLength(text, 'utf8') <= 120);
  assert.equal(text.includes('\uFFFD'), false);
});

test('apply registers door and recall sections, cached after first render', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-door-'));
  const indexPath = path.join(root, 'words.jsonl');
  fs.writeFileSync(
    indexPath,
    JSON.stringify({ v: 1, session: 'zzz', seq: 1, time: '2026-11-26T05:00:00.000Z', role: 'user', text: '帮我装个插件', chars: 6, path: 'x' }) + '\n',
    'utf8',
  );

  const calls = [];
  const ctx = {
    inject(services, fn) {
      assert.deepEqual(services, ['systemPrompt']);
      fn({ systemPrompt: { context: (spec) => calls.push(spec) } });
    },
  };

  apply(ctx, { ...DEFAULTS, indexPath, sessionsRoot: '' });
  assert.deepEqual(calls.map((c) => c.name), ['whale:door', 'whale:recall']);
  assert.deepEqual(calls.map((c) => c.order), [130, 132]);

  const door1 = calls[0].text();
  const door2 = calls[0].text();
  assert.equal(door1, door2);
  assert.ok(door1.includes('whale') || door1.includes('memq'));
  assert.equal(calls[1].text(), '');
});

test('door can be switched off while keeping the recall slot', () => {
  const calls = [];
  const ctx = { inject: (_s, fn) => fn({ systemPrompt: { context: (spec) => calls.push(spec) } }) };
  apply(ctx, { ...DEFAULTS, door: false, sessionsRoot: '' });
  assert.deepEqual(calls.map((c) => c.name), ['whale:recall']);
});

test('apply never throws on a broken index path', () => {
  const calls = [];
  const ctx = { inject: (_s, fn) => fn({ systemPrompt: { context: (spec) => calls.push(spec) } }) };
  assert.doesNotThrow(() => apply(ctx, { ...DEFAULTS, indexPath: 'Z:/definitely/missing.jsonl' }));
  assert.doesNotThrow(() => calls[0].text());
});
