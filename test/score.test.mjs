import test from 'node:test';
import assert from 'node:assert/strict';

import { grams, scoreLine, passes } from '../lib/score.js';

const TH = { minTri: 2, minBiWithOneTri: 4, minBi: 6, minBiRatio: 0.3 };

test('grams splits Chinese into 2 and 3 char shingles', () => {
  const g = grams('装插件的门');
  assert.ok(g.tri.has('装插件'));
  assert.ok(g.bi.has('插件'));
});

test('near-identical Chinese sentence passes', () => {
  const q = grams('这个插件怎么装啊');
  const l = grams('这个插件怎么安装');
  const s = scoreLine(q, l);
  assert.ok(s.tri >= 2);
  assert.equal(passes(s, TH), true);
});

test('two common stopword bigrams do not pass', () => {
  const q = grams('一个什么');
  const l = grams('一个什么');
  const s = scoreLine(q, l);
  assert.equal(passes(s, TH), false);
});

test('English tokens match', () => {
  const q = grams('dsh plugin install');
  const l = grams('install the dsh plugin');
  const s = scoreLine(q, l);
  assert.ok(s.en >= 2);
  assert.equal(passes(s, TH), true);
});

test('a three-character query can hit on its single trigram', () => {
  const q = grams('鱼八股');
  const l = grams('去看这个视频【DeepSeek鱼八股怎么去掉】');
  const s = scoreLine(q, l);
  assert.equal(s.triTotal, 1);
  assert.equal(passes(s, TH), true);
});

test('empty query never passes', () => {
  const s = scoreLine(grams(''), grams('任意一句话'));
  assert.equal(passes(s, TH), false);
});
