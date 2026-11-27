// dsh-whale-memory 宿主插件：两段注入，别无他物。
//
// 纪律：装配里绝不抛异常（抛一次就毁掉整个回合）；同一会话的文本只算一次（前缀缓存不白花）；
// 超预算显式告警，不静默截断。

import fs from 'node:fs';

import { renderDoor } from './door.js';
import { readIndex } from './indexer.js';
import { renderRecall } from './recall.js';

export const name = 'dsh-whale-memory';
export const inject = ['systemPrompt'];

export const DEFAULTS = {
  enabled: true,
  /** 会话日志根目录；空则 recall 关闭（拿不到本会话第一句，无从发起）。 */
  sessionsRoot: '',
  /** 索引文件；空则按 sessionsRoot 推。 */
  indexPath: '',
  /** 落点 JSONL；空则门里不显示「上次停在这」。 */
  restPath: '',
  doorOrder: 130,
  recallOrder: 132,
  memqCmd: 'npx dsh-whale-memory',
  maxDoorBytes: 600,
  maxHits: 2,
  maxSnippetChars: 90,
  timeZone: 'Asia/Shanghai',
  thresholds: { minTri: 2, minBiWithOneTri: 4, minBi: 6, minBiRatio: 0.3 },
  /** 语义化钩子：宿主给不出本会话第一句时，recall 输出空。 */
  recallQuery: '',
  debug: false,
};

function warn(msg) {
  try {
    console.warn(`[whale] ${msg}`);
  } catch {
    /* 连 console 都不给就没办法了 */
  }
}

/** 懒加载索引，失败返回空数组并告警一次。 */
function makeIndexReader(cfg) {
  let cache = null;
  return () => {
    if (cache) return cache;
    if (!cfg.indexPath) {
      warn('index not found: indexPath 未配置');
      cache = [];
      return cache;
    }
    try {
      cache = readIndex(cfg.indexPath);
      if (cache.length === 0) warn(`index empty: ${cfg.indexPath}`);
    } catch (err) {
      warn(`index unreadable: ${cfg.indexPath}（${err?.message ?? err}）`);
      cache = [];
    }
    return cache;
  };
}

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...config };
  if (!cfg.enabled) return;

  try {
    const loadIndex = makeIndexReader(cfg);
    let doorText = null;
    let recallText = null;

    ctx.inject(['systemPrompt'], (scope) => {
      scope.systemPrompt.context({
        name: 'whale:door',
        order: cfg.doorOrder,
        text: () => {
          if (doorText !== null) return doorText;
          try {
            doorText = renderDoor({
              restPath: cfg.restPath,
              memqCmd: cfg.memqCmd,
              maxBytes: cfg.maxDoorBytes,
              timeZone: cfg.timeZone,
            });
            if (Buffer.byteLength(doorText, 'utf8') >= cfg.maxDoorBytes) {
              warn(`door 到达上限 ${cfg.maxDoorBytes}B，已截断 —— 调大 maxDoorBytes 或收短模板`);
            }
          } catch (err) {
            warn(`door failed: ${err?.message ?? err}`);
            doorText = '';
          }
          return doorText;
        },
      });

      scope.systemPrompt.context({
        name: 'whale:recall',
        order: cfg.recallOrder,
        text: () => {
          if (recallText !== null) return recallText;
          try {
            const query = cfg.recallQuery;
            if (!query || !cfg.sessionsRoot) {
              recallText = '';
              return recallText;
            }
            recallText = renderRecall({
              query,
              index: loadIndex(),
              thresholds: cfg.thresholds,
              maxHits: cfg.maxHits,
              maxSnippet: cfg.maxSnippetChars,
            });
          } catch (err) {
            warn(`recall failed: ${err?.message ?? err}`);
            recallText = '';
          }
          return recallText;
        },
      });
    });
  } catch (err) {
    warn(`disabled: ${err?.message ?? err}`);
  }
}

/** 测试与 doctor 用：把索引读出来。 */
export function peek(indexPath) {
  if (!indexPath || !fs.existsSync(indexPath)) return [];
  return readIndex(indexPath);
}
