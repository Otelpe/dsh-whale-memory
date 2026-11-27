// 门牌：log:session-<uuid>#seq=<n>&h=<sha8>
//
// 为什么带哈希：只有 seq 的门牌，日志一旦重建、截断或换格式，同一 seq 就指到别的行上，
// 而且错得没有声音。哈希把「这行是不是当初那行」变成可校验的，错了就明确报错。

import { createHash } from 'node:crypto';

/** 8 位小写 hex，取 role + 换行 + text 的 sha256 前缀。 */
export function hashLine(role, text) {
  return createHash('sha256').update(`${role}\n${text}`, 'utf8').digest('hex').slice(0, 8);
}

export function formatSign({ session, seq, role, text }) {
  const id = String(session).replace(/^session-/, '');
  return `log:session-${id}#seq=${seq}&h=${hashLine(role, text)}`;
}

const SIGN_RE = /^log:session-([0-9A-Za-z._-]+)#seq=(\d+)(?:&h=([0-9a-f]{8}))?$/;

/** 解析门牌；无哈希时 hash 为 null（老门牌照读，只是不校验）；无法解析返回 null。 */
export function parseSign(sign) {
  if (typeof sign !== 'string') return null;
  const m = SIGN_RE.exec(sign.trim());
  if (!m) return null;
  return { session: m[1], seq: Number(m[2]), hash: m[3] ?? null };
}
