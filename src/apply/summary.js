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

import { readActionBar } from '../adapters/weibo-home.js';

/** 摘要条的自有标记（复用 `data-spb` 属性名 —— 低调纪律：DOM 不新增自述属性名） */
export const SUMMARY_ATTR = 'data-spb';

/** `data-spb` 的取值：摘要条（与 hidden / ad 并列；CSS 按取值分流，互不干扰） */
export const SUMMARY_MARK = 'stats';

/** 摘要条选择器（l1.js 的样式规则与这里的查询共用一个来源） */
export const SUMMARY_SEL = [`[${SUMMARY_ATTR}="${SUMMARY_MARK}"]`];

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
 * 对一张卡做摘要条的**幂等**建立 / 更新 / 摘除。
 *
 * @param {Element} card  `.wbpro-scroller-item`
 * @param {boolean} on    L1/L2 档位是否开启（false ⇒ 摘除已有摘要条）
 * @returns {{created:number, updated:number, removed:number}}
 */
export function applyActionBarSummary(card, on) {
  const out = { created: 0, updated: 0, removed: 0 };
  if (!card || !card.querySelector) return out;

  const existing = card.querySelector(SUMMARY_SEL[0]);

  if (!on) {
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
      out.removed++;
    }
    return out;
  }

  const bar = readActionBar(card);
  // 没有 footer 的卡型（推荐关注 / 话题大卡等，A0 未覆盖）⇒ **宁可不动**：
  // 摘要条锚不到计数、CSS 的 footer 规则也收不掉什么，硬插只会制造噪音。
  if (!bar) return out;

  const text = summaryText(bar.counts);
  const href = bar.href || null;

  if (existing) {
    const sameHref = (existing.getAttribute('href') || null) === href;
    if (existing.textContent === text && sameHref) return out;   // 已是目标 ⇒ 不写
    existing.textContent = text;
    if (href) existing.setAttribute('href', href);
    else existing.removeAttribute('href');
    out.updated++;
    return out;
  }

  // 与 footer 同层（article）—— l1.js 已把 article 设为 relative 定位上下文
  const parent = bar.footer.parentNode;
  if (!parent || !parent.appendChild) return out;
  const doc = card.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc || !doc.createElement) return out;

  const a = doc.createElement('a');
  a.setAttribute(SUMMARY_ATTR, SUMMARY_MARK);
  a.textContent = text;
  if (href) a.setAttribute('href', href);
  parent.appendChild(a);
  out.created++;
  return out;
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
