// 中文检索的土办法：2 字 / 3 字片段 + 英文词，没有分词器，也不该为一个插件装一个。
//
// 主判据是 3 字：2 字片段会把「一个」「什么」这种组合当成相关，噪音很大。

const STOP_ZH = [
  '这个', '那个', '我们', '你们', '他们', '什么', '怎么', '一个', '没有', '不是',
  '这样', '那样', '已经', '还是', '可能', '应该', '需要', '时候', '问题', '帮我',
  '给我', '看看', '一下', '然后', '而且', '或者', '只是', '还有', '这里', '那里',
  '知道', '觉得', '感觉', '东西', '可以', '就是', '但是', '因为', '所以', '如果',
];

const STOP_RE = new RegExp(STOP_ZH.join('|'), 'g');
const HAN_RUN = /[\u4e00-\u9fa5]+/g;
const EN_TOKEN = /[a-z0-9][a-z0-9_-]{1,}/g;

/** 去掉停用词；剩下的实义字少于 3 个就算空查询。 */
function core(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(STOP_RE, '')
    .trim();
}

function shingles(run, size) {
  const out = new Set();
  for (let i = 0; i + size <= run.length; i++) out.add(run.slice(i, i + size));
  return out;
}

export function grams(text) {
  // 片段从原文取（停用词只是判「弱查询」的尺子，不是滤网）；
  // 从原文取才能让「这个插件怎么装啊 / 这个插件怎么安装」这种同句式对上。
  const raw = String(text ?? '').toLowerCase();
  const stripped = core(raw);
  const tri = new Set();
  const bi = new Set();
  const en = new Set();
  const han = raw.match(HAN_RUN) ?? [];
  for (const run of han) {
    for (const g of shingles(run, 3)) tri.add(g);
    for (const g of shingles(run, 2)) bi.add(g);
  }
  const enTokens = raw.match(EN_TOKEN) ?? [];
  for (const t of enTokens) en.add(t);
  // 实义内容不足：去掉停用词后中文少于 3 字且没有英文词 —— 视为空查询。
  const weakHan = (stripped.match(HAN_RUN) ?? []).join('');
  const weak = weakHan.length < 3 && enTokens.length === 0;
  return { tri: weak ? new Set() : tri, bi: weak ? new Set() : bi, en };
}

function overlaps(a, b) {
  let n = 0;
  for (const g of a) if (b.has(g)) n++;
  return n;
}

export function scoreLine(queryGrams, lineGrams) {
  const tri = overlaps(queryGrams.tri, lineGrams.tri);
  const bi = overlaps(queryGrams.bi, lineGrams.bi);
  const en = overlaps(queryGrams.en, lineGrams.en);
  const ratio = queryGrams.bi.size === 0 ? 0 : bi / queryGrams.bi.size;
  return { tri, bi, en, ratio };
}

/** 三档并联：3 字主判据 / 1 tri + N bi / N bi + 覆盖率；英文另走一条。 */
export function passes(score, thresholds) {
  const { minTri = 2, minBiWithOneTri = 4, minBi = 6, minBiRatio = 0.3 } = thresholds ?? {};
  if (score.tri >= minTri) return true;
  if (score.tri >= 1 && score.bi >= minBiWithOneTri) return true;
  if (score.bi >= minBi && score.ratio >= minBiRatio) return true;
  if (score.en >= 2) return true;
  return false;
}
