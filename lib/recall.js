// 召回：只给指针和逐字片段，不给转述。
//
// 「上一轮我们讨论了……」这种句子是这道题最容易写错的地方 —— 它读起来有用，
// 实际上是一层二手转述，比原文更容易骗人。

import { formatSign } from './sign.js';
import { grams, passes, scoreLine } from './score.js';

export const DEFAULT_THRESHOLDS = { minTri: 2, minBiWithOneTri: 4, minBi: 6, minBiRatio: 0.3 };

/** 截断到指定字符宽度，不切半个字（按码位切）。 */
export function slice(text, max) {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join('');
}

export function rank(query, index, { thresholds = DEFAULT_THRESHOLDS, excludeSessions = [], maxHits = 2 } = {}) {
  const q = grams(query);
  const excluded = new Set(excludeSessions);
  const scored = [];
  for (const row of index) {
    if (excluded.has(row.session)) continue;
    const s = scoreLine(q, grams(row.text));
    if (!passes(s, thresholds)) continue;
    scored.push({ row, score: s.tri * 10 + s.bi * 3 + s.en * 4 + s.ratio });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxHits).map((x) => x.row);
}

export function renderRecall({ query, index, thresholds, maxHits = 2, maxSnippet = 90, excludeSessions = [] }) {
  if (!Array.isArray(index) || index.length === 0) return '';
  const hits = rank(query, index, { thresholds, maxHits, excludeSessions });
  if (hits.length === 0) return '';
  const lines = hits.map((row) => {
    const sign = formatSign({ session: row.session, seq: row.seq, role: row.role, text: row.text });
    const when = row.time ? row.time.slice(0, 16).replace('T', ' ') : '时间未知';
    return `- ${when} ${slice(row.text.replace(/\s+/g, ' '), maxSnippet)} └ ${sign}`;
  });
  return ['可能相关（只是线索，不是事实；要用就取原文）：', ...lines].join('\n');
}
