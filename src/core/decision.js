/**
 * 判定核心（PROJECT.md §6 第 ② 层）
 *
 * 纪律：**纯函数 —— 输入一条微博的结构化数据，输出动作，绝不碰 DOM。**
 * 唯一目的是让判定逻辑能在不开浏览器的情况下被 Node 单测（配 tests/fixtures 的 DOM 快照夹具）。
 *
 * 本模块是「判定核心」的门面：把两条独立的判定线合成一个动作。
 *   - 广告识别 → `core/ad-detect.js`（§12-B1）  —— 判据与权重都在那边，这里不复刻
 *   - 关键词   → `core/keyword.js`（§12-A3）    —— 字段白名单在那边，这里不复刻
 *
 * ⚠️ 本模块**不知道**「隐藏」在技术上如何实现。它只说 `hide`。
 *    怎么 hide 是应用层的事 —— 而 B2 实测（§12-B2）已经定死了那是
 *    「保高度 + 降显著度」，不是删除。
 */

import { classifyFeedItem } from './ad-detect.js';
import { matchKeywords } from './keyword.js';

/** 动作枚举 */
export const ACTION = {
  KEEP: 'keep',
  HIDE: 'hide',
  HIGHLIGHT: 'highlight',
};

/**
 * @typedef {Object} Decision
 * @property {'keep'|'hide'|'highlight'} action
 * @property {string[]} reasons      命中的理由（§9 可解释性：判为 hide/highlight 必须给得出理由）
 * @property {boolean}  suspect      广告证据不足（存疑）—— 只记录，不产生动作
 * @property {number}   adScore      广告证据分（诊断页用）
 * @property {Array}    keywordHits  命中的关键词明细
 * @property {Array}    keywordErrors 正则模式的编译错误（诊断页用）
 */

/**
 * 判定一条微博该做什么。
 *
 * **动作优先级**：广告（并集）> 关键词 hide > 关键词 highlight > keep。
 * 两条线是**并集**关系 —— 广告识别说 hide、关键词只说了 highlight，结果仍是 hide
 * （「不想看」比「想留意」更硬，不能出现自相矛盾的结论）。
 *
 * @param {Object} item   适配层抽出的数据包（字段见 core/ad-detect.js 与 core/keyword.js）
 * @param {Object} config 完整配置
 * @returns {Decision}
 */
export function decide(item, config) {
  const cfg = config || {};
  const detectGate = (cfg.filter && cfg.filter.detect) || undefined;

  const reasons = [];

  const ad = classifyFeedItem(item, detectGate);
  if (ad.isAd) {
    for (const r of ad.reasons) reasons.push(`广告 · ${r}`);
  }

  const kw = matchKeywords(item, cfg);
  if (kw.action) {
    for (const r of kw.reasons) reasons.push(r);
  }

  let action = ACTION.KEEP;
  if (ad.isAd || kw.action === 'hide') action = ACTION.HIDE;
  else if (kw.action === 'highlight') action = ACTION.HIGHLIGHT;

  return {
    action,
    reasons,
    // 存疑只作记录：达不到阈值就不该动手（§12-B1「饼干姐」卡就是这条纪律的由来）
    suspect: ad.suspect,
    adScore: ad.score,
    keywordHits: kw.hits,
    keywordErrors: kw.errors,
  };
}
