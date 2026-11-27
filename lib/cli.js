// CLI：index / query / open / doctor。
// 参数自己解析 —— 这个包零依赖，不为四个开关引一个解析库。

import fs from 'node:fs';
import path from 'node:path';

import { buildIndex, readIndex } from './indexer.js';
import { listSessionFiles, readRecords } from './session-log.js';
import { hashLine, formatSign, parseSign } from './sign.js';
import { rank, slice } from './recall.js';

const USAGE = `用法：
  dsh-whale-memory index --sessions <dir> --out <dir> [--full]
  dsh-whale-memory query <词> [--index <words.jsonl>] [--limit 25]
  dsh-whale-memory open <门牌> --sessions <dir>
  dsh-whale-memory doctor [--index <words.jsonl>]`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function indexPathFrom(flags) {
  if (!flags.index) return '';
  const p = path.resolve(flags.index);
  // 允许给目录：使用者多半记得的是索引目录，不是那个文件名。
  try {
    if (fs.statSync(p).isDirectory()) return path.join(p, 'words.jsonl');
  } catch {
    /* 不存在就按文件名处理，交给调用方报 index not found */
  }
  return p;
}

function openBySign(sign, sessionsRoot) {
  const parsed = parseSign(sign);
  if (!parsed) return { code: 1, err: `门牌格式不对：${sign}` };
  if (!sessionsRoot) return { code: 1, err: '缺少 --sessions' };
  const target = listSessionFiles(sessionsRoot).find((f) => f.session === parsed.session);
  if (!target) return { code: 1, err: `找不到会话：${parsed.session}` };
  const { records } = readRecords(target.file);
  const record = records[parsed.seq - 1];
  if (!record) return { code: 1, err: `seq 超出范围：${parsed.seq}` };
  const content = textOf(record);
  if (parsed.hash && hashLine(roleOf(record) ?? '', content) !== parsed.hash) {
    return { code: 1, err: '原文已变：这行的内容与门牌里的哈希不符，不给错行。' };
  }
  return { code: 0, out: content };
}

function roleOf(record) {
  if (record.type === 'user/message') return 'user';
  if (record.type === 'assistant/message') return 'assistant';
  return null;
}

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
  if (record.type === 'assistant/message' && Array.isArray(d.message?.content)) return pick(d.message.content);
  return '';
}

export async function main(argv = process.argv.slice(2), io = { out: console.log, err: console.error }) {
  const [cmd, ...rest] = argv;
  const { positional, flags } = parseArgs(rest);

  try {
    if (!cmd || cmd === '--help' || cmd === '-h') {
      io.out(USAGE);
      return 0;
    }

    if (cmd === 'index') {
      const sessionsRoot = flags.sessions ? path.resolve(flags.sessions) : '';
      const outDir = flags.out ? path.resolve(flags.out) : '';
      if (!sessionsRoot || !outDir) {
        io.err('缺少 --sessions 或 --out');
        return 1;
      }
      const res = buildIndex({ sessionsRoot, outDir, full: Boolean(flags.full) });
      io.out(`索引完成：${res.logs} 份日志，写入 ${res.written} 条，跳过 ${res.skipped} 个未变文件，坏帧 ${res.failed}`);
      if (res.failedFiles > 0) {
        io.err(`[whale] ${res.failedFiles} 份日志一帧都没解开 —— 格式变了或不认帧头，索引不可信`);
        return 1;
      }
      return 0;
    }

    if (cmd === 'query') {
      const indexPath = indexPathFrom(flags);
      const rows = readIndex(indexPath);
      if (!rows.length) {
        io.err(`index not found: ${indexPath || '(未指定 --index)'}`);
        return 1;
      }
      const q = positional[0] ?? '';
      const hits = rank(q, rows, { maxHits: Number.isFinite(Number(flags.limit)) ? Number(flags.limit) : 25 });
      if (!hits.length) {
        io.out('（没有命中）');
        return 0;
      }
      for (const row of hits) {
        const when = row.time ? row.time.slice(0, 16).replace('T', ' ') : '时间未知';
        const sign = formatSign({ session: row.session, seq: row.seq, role: row.role, text: row.text });
        io.out(`${when} ${row.session.slice(0, 8)} ${slice(row.text.replace(/\s+/g, ' '), 120)} └ ${sign}`);
      }
      return 0;
    }

    if (cmd === 'open') {
      const sign = positional[0] ?? '';
      const sessionsRoot = flags.sessions ? path.resolve(flags.sessions) : '';
      const res = openBySign(sign, sessionsRoot);
      if (res.err) {
        io.err(res.err);
        return res.code;
      }
      io.out(res.out);
      return 0;
    }

    if (cmd === 'doctor') {
      const indexPath = indexPathFrom(flags);
      const exists = Boolean(indexPath) && fs.existsSync(indexPath);
      if (!exists) {
        io.out(`index not found: ${indexPath || '(未指定 --index)'} —— 先跑 index`);
        return 0;
      }
      const rows = readIndex(indexPath);
      const metaPath = path.join(path.dirname(indexPath), 'meta.json');
      let meta = null;
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } catch {
        meta = null;
      }
      io.out(`索引：${rows.length} 条，${meta ? `建于 ${meta.builtAt}，日志 ${meta.logs} 份` : 'meta.json 缺失'}`);
      return 0;
    }

    io.err(`未知命令：${cmd}\n${USAGE}`);
    return 1;
  } catch (err) {
    io.err(`[whale] ${err && err.message ? err.message : String(err)}`);
    return 1;
  }
}
