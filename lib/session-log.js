// 会话日志读取：多帧 zstd。
//
// 宿主把 JSONL 切成多段压缩后首尾相接。zlib.zstdDecompressSync 只吃第一帧，
// 后面的段会被静默忽略 —— 这是这套东西最容易「看起来能用其实只读了一小半」的地方。

import fs from 'node:fs';
import path from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** 按 zstd 帧魔数切分；找不到魔数的尾段忽略。 */
export function splitFrames(buffer) {
  const cuts = [];
  let i = buffer.indexOf(MAGIC, 0);
  while (i !== -1) {
    cuts.push(i);
    i = buffer.indexOf(MAGIC, i + 4);
  }
  const frames = [];
  for (let k = 0; k < cuts.length; k++) {
    const end = k + 1 < cuts.length ? cuts[k + 1] : buffer.length;
    frames.push(buffer.subarray(cuts[k], end));
  }
  return frames;
}

/** 解一个日志文件；坏帧记进 failed，不抛。 */
export function readRecords(file) {
  const raw = fs.readFileSync(file);
  const frames = splitFrames(raw);
  const records = [];
  let failed = 0;
  for (const frame of frames) {
    let text;
    try {
      text = zstdDecompressSync(frame).toString('utf8');
    } catch {
      failed++;
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        failed++;
      }
    }
  }
  return { records, frames: frames.length, failed };
}

const SESSION_FILE = /^session\.v\d+\.jsonl\.zstd$/;

/** 递归找 <root>/<工作区>/session-<id>/session.v*.jsonl.zstd。 */
export function listSessionFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      if (!SESSION_FILE.test(e.name)) continue;
      const stat = fs.statSync(full);
      const parent = path.basename(path.dirname(full));
      out.push({
        session: parent.replace(/^session-/, ''),
        file: full,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    }
  };
  walk(root);
  return out;
}
