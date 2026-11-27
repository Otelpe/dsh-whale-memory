// 索引：把会话日志里的话抽成一行一条 JSON，供 query / recall 用。
//
// 只存原话（和助手首段），不存摘要 —— 摘要只能是索引，不能是记忆本体。

import fs from 'node:fs';
import path from 'node:path';

import { listSessionFiles, readRecords } from './session-log.js';

const SKIP_PREFIX = '[';

function textOf(record) {
  const d = record?.data ?? {};
  const pick = (parts) =>
    parts
      .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('');

  if (record.type === 'user/message') {
    if (Array.isArray(d.content)) return pick(d.content);
    if (typeof d.text === 'string') return d.text;
    return '';
  }
  if (record.type === 'assistant/message') {
    const msg = d.message ?? {};
    if (Array.isArray(msg.content)) return pick(msg.content);
    return '';
  }
  return '';
}

function roleOf(record) {
  if (record.type === 'user/message') return 'user';
  if (record.type === 'assistant/message') return 'assistant';
  return null;
}

function toIso(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === 'string') {
    const t = Date.parse(value);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return null;
}

export function readIndex(indexPath) {
  if (!fs.existsSync(indexPath)) return [];
  return fs
    .readFileSync(indexPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function loadMeta(outDir) {
  const p = path.join(outDir, 'meta.json');
  if (!fs.existsSync(p)) return { files: {} };
  try {
    const m = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { files: m.files ?? {} };
  } catch {
    return { files: {} };
  }
}

export function buildIndex({ sessionsRoot, outDir, full = false }) {
  if (!sessionsRoot) throw new Error('sessionsRoot 为空');
  if (!outDir) throw new Error('outDir 为空');
  fs.mkdirSync(outDir, { recursive: true });

  const files = listSessionFiles(sessionsRoot);
  const meta = loadMeta(outDir);
  const existing = full ? [] : readIndex(path.join(outDir, 'words.jsonl'));
  const kept = new Map(); // rel -> rows
  for (const row of existing) {
    if (!kept.has(row.path)) kept.set(row.path, []);
    kept.get(row.path).push(row);
  }

  const rows = [];
  const nextFiles = {};
  let written = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of files) {
    const rel = path.relative(sessionsRoot, entry.file).split(path.sep).join('/');
    nextFiles[rel] = { size: entry.size, mtimeMs: entry.mtimeMs };

    const prev = meta.files[rel];
    const unchanged = !full && prev && prev.size === entry.size && prev.mtimeMs === entry.mtimeMs;
    if (unchanged) {
      skipped++;
      rows.push(...(kept.get(rel) ?? []));
      continue;
    }

    const { records, failed: bad } = readRecords(entry.file);
    failed += bad;
    let lineNo = 0;
    const fileRows = [];
    for (const record of records) {
      lineNo++;
      const role = roleOf(record);
      if (!role) continue;
      const text = textOf(record).trim();
      if (!text || text.startsWith(SKIP_PREFIX)) continue;
      fileRows.push({
        v: 1,
        session: entry.session,
        seq: lineNo,
        time: toIso(record.time),
        role,
        text,
        chars: text.length,
        path: rel,
      });
    }
    rows.push(...fileRows);
    written += fileRows.length;
  }

  const tmp = path.join(outDir, 'words.jsonl.tmp');
  fs.writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
  fs.renameSync(tmp, path.join(outDir, 'words.jsonl'));

  fs.writeFileSync(
    path.join(outDir, 'meta.json'),
    JSON.stringify(
      { builtAt: new Date().toISOString(), logs: files.length, written, skipped, failed, files: nextFiles },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  return { written, skipped, failed, logs: files.length };
}
