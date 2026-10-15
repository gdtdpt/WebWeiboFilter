/**
 * 应用层：互动按钮行 → 摘要条（A1 · §12-B15，2026-10-15 用户拍板方案 ②）
 *
 * ── 需求从哪来 ──────────────────────────────────────────────────────
 * A1 原计划是「隐藏互动按钮行」（§7.5），真机落地前用户补充了关键诉求（原话）：
 *   「我还是希望看到原微博的转发评论列表，但是又不想用 hover 这种容易被误触的方式」
 * ⇒ 转发 / 评论**列表在详情页**，footer 上只是入口 ⇒ 方案定为：
 *   footer 整行收掉（卡真实矮 40px，改高度项），原位置叠一条**摘要条**：
 *     「52 转发 · 3 评论 · 21 赞」 —— 整条是一个 <a>，**点一下**直达详情页。
 *   刻意点击、没有 hover ⇒ 不误触；入口保住了，高度收益也拿到了。
 *
 * ── 分工 ────────────────────────────────────────────────────────────
 *   CSS（features/l1.js，首帧注入）：
 *     · footer display:none        ⇒ 卡真实变矮 —— §12-B12 已验「首帧注入会被
 *                                   算进虚拟列表尺寸缓存」⇒ 缓存按矮卡建，预期无洞。
 *     · 摘要条绝对定位             ⇒ **不占布局** ⇒ 它的插入/更新永远不改卡片高度。
 *   JS（本模块，每轮扫描幂等）：
 *     · 读 footer 的计数与详情链接 → 建/更新/摘除摘要条（模式同 time.js）。
 *
 * ── 幂等与可逆 ──────────────────────────────────────────────────────
 * 摘要条用自有标记 `data-spb="stats"` 定位：
 *   · 已存在且文本 / 链接都没变 ⇒ 一个字节都不写（避免自触发循环）；
 *   · 槽位复用换了卡 ⇒ 计数与链接跟着重算（textContent / href 不一致就更新）；
 *   · 关档（L1/L2 关）逐卡摘除；停管线 removeSummaries() 全页摘除。
 *
 * ⚠️ 摘要条是**我方元素**，样式全在自己的 CSS 里 ⇒ 不碰微博的内联 style；
 *    绝对定位挂 `bottom:0`，定位上下文由 l1.js 给 `article` 补 `position:relative`。
 */

import { readActionBar, readRetweetActionBar } from '../adapters/weibo-home.js';

/** 摘要条的自有标记（复用 `data-spb` 属性名 —— 低调纪律：DOM 不新增自述属性名） */
export const SUMMARY_ATTR = 'data-spb';

/** `data-spb` 的取值：摘要条（与 hidden / ad 并列；CSS 按取值分流，互不干扰） */
export const SUMMARY_MARK = 'stats';

/** 摘要条选择器（l1.js 的样式规则与这里的查询共用一个来源；卡自身 / 转发块共用一套样式） */
export const SUMMARY_SEL = [`[${SUMMARY_ATTR}="${SUMMARY_MARK}"]`];

/** 卡自身摘要条的**作用域**选择器（挂 article 直下）；转发块摘要条挂 .retweet 内部 */
export const CARD_SUMMARY_SEL = [`article > ${SUMMARY_SEL[0]}`];
export const RETWEET_SUMMARY_SEL = [`.retweet ${SUMMARY_SEL[0]}`];

/** 转发块摘要条的文本前缀 —— 与卡自身的摘要条区分（两者计数不同：卡 vs 原微博） */
export const RETWEET_PREFIX = '原微博';

/**
 * 计数 → 摘要文本（**纯函数**）。
 * 某个计数缺失（微博对 0 常不显示数字）⇒ 只显示词；整行永远三段齐全 ——
 * 文本稳定 ⇒ 槽位复用后「内容没变的卡」不会触发无谓的 DOM 写入。
 *
 * @param {{repost?:string|null, comment?:string|null, like?:string|null}} counts
 * @returns {string} 如 `52 转发 · 3 评论 · 21 赞` / `转发 · 评论 · 赞`
 */
export function summaryText(counts) {
  const c = counts || {};
  return [
    c.repost ? c.repost + ' 转发' : '转发',
    c.comment ? c.comment + ' 评论' : '评论',
    c.like ? c.like + ' 赞' : '赞',
  ].join(' · ');
}

/**
 * 对一张卡做摘要条的**幂等**建立 / 更新 / 摘除（2026-10-15 起同时管两条：
 * 卡自身的 + 转发原文的 —— 同一套设计语言，用户拍板）。
 *
 * @param {Element} card  `.wbpro-scroller-item`
 * @param {boolean} on    L1/L2 档位是否开启（false ⇒ 摘除已有摘要条）
 * @returns {{created:number, updated:number, removed:number}}
 */
export function applyActionBarSummary(card, on) {
  const out = { created: 0, updated: 0, removed: 0 };
  if (!card || !card.querySelector) return out;

  // ── ① 卡自身的按钮行 ──
  const existing = card.querySelector(CARD_SUMMARY_SEL[0]);
  if (!on) {
    // 关档 ⇒ 两条一起摘（转发块的那条见下）
    const rtOff = card.querySelector(RETWEET_SUMMARY_SEL[0]);
    if (existing && existing.parentNode) { existing.parentNode.removeChild(existing); out.removed++; }
    if (rtOff && rtOff.parentNode) { rtOff.parentNode.removeChild(rtOff); out.removed++; }
    return out;
  }

  const bar = readActionBar(card);
  // 没有 footer 的卡型（推荐关注 / 话题大卡等，A0 未覆盖）⇒ **宁可不动**：
  // 摘要条锚不到计数、CSS 的 footer 规则也收不掉什么，硬插只会制造噪音。
  if (bar) {
    upsert(existing, bar.footer.parentNode, summaryText(bar.counts), bar.href || null, out);
  }

  // ── ② 转发原文的按钮行（同一套设计语言；没有转发块的卡自然跳过）──
  const rt = readRetweetActionBar(card);
  if (rt) {
    const text = RETWEET_PREFIX
      + (rt.timeText ? ' · ' + rt.timeText : '')
      + ' · ' + summaryText(rt.counts);
    upsert(card.querySelector(RETWEET_SUMMARY_SEL[0]), rt.footer.parentNode, text, rt.href || null, out);
  }

  return out;
}

/** 幂等 upsert 一条摘要条（卡自身 / 转发块共用；已是目标 ⇒ 一个字节都不写） */
function upsert(existing, parent, text, href, out) {
  if (!parent || !parent.appendChild) return;

  if (existing) {
    const sameHref = (existing.getAttribute('href') || null) === href;
    if (existing.textContent === text && sameHref) return;   // 已是目标 ⇒ 不写
    existing.textContent = text;
    if (href) existing.setAttribute('href', href);
    else existing.removeAttribute('href');
    out.updated++;
    return;
  }

  const doc = parent.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc || !doc.createElement) return;

  const a = doc.createElement('a');
  a.setAttribute(SUMMARY_ATTR, SUMMARY_MARK);
  a.textContent = text;
  if (href) a.setAttribute('href', href);
  parent.appendChild(a);
  out.created++;
}

/** 全页摘除摘要条（停管线时用）—— 与逐卡摘除等价，给「stop()」一个整页出口。 */
export function removeSummaries(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || !d.querySelectorAll) return 0;

  let n = 0;
  const list = d.querySelectorAll(SUMMARY_SEL[0]);
  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    if (el.parentNode) {
      el.parentNode.removeChild(el);
      n++;
    }
  }
  return n;
}

/** 当前页面上的摘要条数（诊断用） */
export function countSummaries(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || !d.querySelectorAll) return 0;
  return d.querySelectorAll(SUMMARY_SEL[0]).length;
}
