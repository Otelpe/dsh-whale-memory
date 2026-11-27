import test from 'node:test';
import assert from 'node:assert/strict';

import { renderRecall } from '../lib/recall.js';

const rows = [
  { v: 1, session: 'aaa', seq: 7, time: '2026-11-26T05:39:00.000Z', role: 'user', text: '这个插件怎么装啊，帮我看看', chars: 12, path: 'x' },
  { v: 1, session: 'bbb', seq: 3, time: '2026-11-20T01:00:00.000Z', role: 'user', text: '今天吃了米饭', chars: 6, path: 'y' },
];

test('renders one pointer with a door sign', () => {
  const out = renderRecall({ query: '这个插件怎么装啊', index: rows });
  assert.match(out, /log:session-aaa#seq=7&h=[0-9a-f]{8}/);
  assert.ok(out.includes('这个插件怎么装啊'));
  assert.equal(out.includes('米饭'), false);
});

test('returns empty string when nothing matches', () => {
  const out = renderRecall({ query: '完全不相关的一句', index: rows });
  assert.equal(out, '');
});

test('excludes the asking session', () => {
  const out = renderRecall({ query: '这个插件怎么装啊', index: rows, excludeSessions: ['aaa'] });
  assert.equal(out, '');
});

test('honours maxHits', () => {
  const dup = [...rows, { ...rows[0], seq: 8 }];
  const out = renderRecall({ query: '这个插件怎么装啊', index: dup, maxHits: 1 });
  assert.equal(out.split('\n').filter((l) => l.startsWith('- ')).length, 1);
});

test('never rewrites: no narrative words', () => {
  const out = renderRecall({ query: '这个插件怎么装啊', index: rows });
  assert.equal(out.includes('讨论了'), false);
  assert.equal(out.includes('我们'), false);
});
