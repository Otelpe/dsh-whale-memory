// 门：每一屏最上面那四行。
//
// 常驻注入，所以必须短。默认英文/中文都不用加粗、不用表格 —— 这段每步都要重读。

import fs from 'node:fs';

const WEEKDAY = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export const DEFAULT_TEMPLATE = [
  '现在：{{clock}}',
  '{{rest}}',
  '必须去查：说「之前/上次/记得吗」；准备写「我记得」；涉及路径/版本/数字/文件名；老大说你记错了。',
  '门：{{memqCmd}} query <词> ／ {{memqCmd}} open <门牌>',
].join('\n');

function clockOf(now, timeZone) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  const wd = WEEKDAY[now.getUTCDay() === undefined ? 0 : 0];
  return {
    text: `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`,
    weekday: wd,
  };
}

function weekdayIn(now, timeZone) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(now);
  const map = { Sun: '星期日', Mon: '星期一', Tue: '星期二', Wed: '星期三', Thu: '星期四', Fri: '星期五', Sat: '星期六' };
  return map[name] ?? '';
}

/** 按字节上限截断，不切半个字。 */
export function truncateBytes(text, maxBytes) {
  if (!maxBytes || maxBytes <= 0) return text;
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const chars = Array.from(text);
  let out = '';
  for (const ch of chars) {
    if (Buffer.byteLength(out + ch, 'utf8') > maxBytes) break;
    out += ch;
  }
  return out;
}

function lastOpenRest(restPath) {
  if (!restPath || !fs.existsSync(restPath)) return null;
  const lines = fs.readFileSync(restPath, 'utf8').split('\n').filter((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const row = JSON.parse(lines[i]);
      if (row && row.status === 'open' && typeof row.text === 'string') return row;
    } catch {
      /* 坏行跳过 */
    }
  }
  return null;
}

export function renderDoor({
  now = new Date(),
  timeZone = 'Asia/Shanghai',
  restEntry = null,
  memqCmd = 'npx dsh-whale-memory',
  template = DEFAULT_TEMPLATE,
  maxBytes = 600,
  restPath = null,
} = {}) {
  const rest = restEntry ?? lastOpenRest(restPath);
  const clock = `${clockOf(now, timeZone).text}（${weekdayIn(now, timeZone)}）`;
  const restLine = rest
    ? `上次停在这：${String(rest.text).replace(/\s+/g, ' ').slice(0, 60)}（${rest.at ? String(rest.at).slice(0, 16).replace('T', ' ') : '时间未知'}）`
    : '';
  const text = template
    .replace('{{clock}}', clock)
    .replace('{{rest}}', restLine)
    .replaceAll('{{memqCmd}}', memqCmd)
    .split('\n')
    .filter((line) => line.trim())
    .join('\n');
  return truncateBytes(text, maxBytes);
}
