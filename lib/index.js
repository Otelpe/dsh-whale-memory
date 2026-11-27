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
  /** 门与召回各自可关：装了自带门的宿主（SELF 那类）时把 door 关掉，只留召回位子。 */
  door: true,
  recall: true,
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
  timeZone: '',
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
    let recallText = null;
    // 启动时就报一次，不等第一次召回才说 —— 装配期说不出话等于没有告警。
    if (cfg.recall || cfg.door) {
      if (!cfg.indexPath) warn('index not found: indexPath 未配置');
      else if (!fs.existsSync(cfg.indexPath)) warn(`index not found: ${cfg.indexPath}`);
      else if (readIndex(cfg.indexPath).length === 0) warn(`index empty: ${cfg.indexPath}`);
    }

    ctx.inject(['systemPrompt'], (scope) => {
      if (cfg.door) {
        scope.systemPrompt.context({
        name: 'whale:door',
        order: cfg.doorOrder,
        text: () => {
          // 门不缓存：缓存会把「现在几点」冻在首轮。它只占十几行，每步现算便宜。
          try {
            const text = renderDoor({
              restPath: cfg.restPath,
              memqCmd: cfg.memqCmd,
              maxBytes: cfg.maxDoorBytes,
              timeZone: cfg.timeZone || undefined,
            });
            if (Buffer.byteLength(text, 'utf8') > cfg.maxDoorBytes) {
              warn(`door 超过上限 ${cfg.maxDoorBytes}B，已截断 —— 调大 maxDoorBytes 或收短模板`);
            }
            return text;
          } catch (err) {
            warn(`door failed: ${err?.message ?? err}`);
            return '';
          }
        },
      });
      }

      if (cfg.recall) {
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
              excludeSessions: cfg.excludeSessions ?? [],
            });
          } catch (err) {
            warn(`recall failed: ${err?.message ?? err}`);
            recallText = '';
          }
          return recallText;
        },
      });
      }
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
