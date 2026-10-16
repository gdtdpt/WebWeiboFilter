/**
 * 应用层：顶栏降显著（低调模式 L2 · §7.5-F；2026-10-16 用户诉求 + probeTopbar 真机取证）
 *
 * ── 取证结论（2026-10-16 probeTopbar）────────────────────────────────
 *   · 顶栏 bar = logo 锚的祖先 `._main_18dhr_65`（h≈57）；头像 = bar 内唯一的
 *     `img`（`._avatar_` 哈希类，无库类可锚）；发布按钮的橙在**内部 svg** 上
 *     （按钮 bg 透明、计算色全灰）—— 主题变量映射管不到写死的图标色；
 *   · 消息未读徽章（`.woo-badge-bubble`，库类）bg 已被哑色映射但仍 s≈30 偏红；
 *   · 分类条 = `.wbpro-tab2`（库类）⇒ 隐藏走 l2.js CSS（首帧、无闪烁）；它的
 *     `_slot_` 祖先行里还装着「高级搜索」等残余 ⇒ JS 顺祖先收整条。
 *
 * ── 手法 ────────────────────────────────────────────────────────────
 *   为什么是 JS 而不是 CSS：可锚的库类在这里缺席（_avatar_/_pub_ 全是哈希），
 *   「哪些元素还鲜艳」只能在运行时算计算色 —— CSS 表达不了「彩度 > 25%」。
 *   ⇒ 找 bar → 头像 img 一律灰度；bar 子树里计算色 vivid（HSL s>0.25 且峰谷差>30）
 *   的元素逐个 `filter:grayscale(1)`。内联 filter **零布局影响**（不碰尺寸属性）。
 *   原内联 filter 存内存台账，off/stop 逐条还原；`data-spb-tb` 标记防重复。
 *   每轮扫描重跑（幂等）：SPA 重建顶栏后标记消失 ⇒ 自动重新套用。
 */

/** 品牌锚（与 apply/brandtext.js 同款：唯一属性锚） */
const SEL_LOGO = 'a[href="/"][aria-label]';

/** 我方标记（防重复套用；还原时据此找元素） */
export const TOPBAR_MARK = 'data-spb-tb';

/**
 * 纯函数：一个计算色值是否「鲜艳」（HSL 饱和度 > 0.25 且峰谷差 > 30）。
 * probeTopbar 实测锚点：徽章 bg rgb(175,121,106) → vivid；按钮 bg rgb(44,44,44) → 不。
 */
export function isVividRGB(v) {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(typeof v === 'string' ? v : '');
  if (!m) return false;
  const r = +m[1], g = +m[2], b = +m[3];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn <= 30) return false;
  const l = (mx + mn) / 510;
  const denom = 1 - Math.abs(2 * l - 1);
  if (denom <= 0) return false;
  return (mx - mn) / 255 / denom > 0.25;
}

/* 会话内台账：{ el, filter } —— 还原内联 filter 用 */
const records = [];

function computedStyle(el) {
  try { return getComputedStyle(el); } catch (_e) { return null; }
}

/** 从 logo 锚向上找 bar：h∈[40,80] 且 w≥600 的第一个祖先（probeTopbar 同判据） */
function findTopbar(doc) {
  let logo = null;
  try { logo = doc.querySelector(SEL_LOGO); } catch (_e) { return null; }
  if (!logo) return null;
  let cur = logo;
  while (cur && cur !== doc.body) {
    let r = null;
    try { r = cur.getBoundingClientRect(); } catch (_e) { return null; }
    if (r && r.height >= 40 && r.height <= 80 && r.width >= 600) return cur;
    cur = cur.parentElement;
  }
  return null;
}

/** 对一个元素套灰度（幂等；首次套时把原 filter 记入台账） */
function grayOut(el) {
  if (el.getAttribute && el.getAttribute(TOPBAR_MARK)) return false;
  const cs = computedStyle(el);
  records.push({ el, filter: cs ? el.style.filter : '' });
  if (el.setAttribute) el.setAttribute(TOPBAR_MARK, '1');
  el.style.filter = 'grayscale(1)';
  return true;
}

/** 分类条整行收掉：.wbpro-tab2 的第一个 `_slot_` 祖先（行里还装着「高级搜索」残余） */
function collapseChannelRow(doc) {
  let tab2 = null;
  try { tab2 = doc.querySelector('.wbpro-tab2'); } catch (_e) { return false; }
  if (!tab2) return false;
  let p = tab2.parentElement;
  while (p && p !== doc.body && !/_slot_/.test(p.getAttribute('class') || '')) {
    p = p.parentElement;
  }
  if (!p || p === doc.body) return false;
  if (p.getAttribute && p.getAttribute(TOPBAR_MARK)) return false;
  const cs = computedStyle(p);
  records.push({ el: p, filter: cs ? p.style.filter : '', display: cs ? p.style.display : '' });
  p.setAttribute(TOPBAR_MARK, '1');
  p.style.display = 'none';
  return true;
}

/**
 * 一轮顶栏降显著 / 还原（**幂等**）。
 *
 * @param {Document} doc
 * @param {boolean} on true = 套用；false = 还原
 * @returns {{grayed:number, collapsed:number, restored:number}}
 */
export function applyTopbarQuiet(doc, on) {
  const out = { grayed: 0, collapsed: 0, restored: 0 };
  if (!doc || !doc.querySelectorAll) return out;

  if (!on) return Object.assign(out, { restored: restoreTopbarQuiet(doc) });

  const bar = findTopbar(doc);

  // ① 头像（bar 内唯一的 img）与 ② vivid 图标 / 徽章 —— 都走灰度
  if (bar) {
    let imgs;
    try { imgs = bar.querySelectorAll('img'); } catch (_e) { imgs = []; }
    for (let i = 0; i < imgs.length; i++) {
      if (grayOut(imgs[i])) out.grayed++;
    }
    let all;
    try { all = bar.querySelectorAll('*'); } catch (_e) { all = []; }
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (el.getAttribute && el.getAttribute(TOPBAR_MARK)) continue;
      const cs = computedStyle(el);
      if (!cs) continue;
      if (isVividRGB(cs.backgroundColor) || isVividRGB(cs.color) || isVividRGB(cs.borderTopColor)) {
        if (grayOut(el)) out.grayed++;
      }
    }
  }

  // ③ 分类条整行（含「高级搜索」残余）
  if (collapseChannelRow(doc)) out.collapsed++;

  return out;
}

/** 全量还原（off / stop()）：按台账恢复原内联值、摘标记 */
export function restoreTopbarQuiet(_doc) {
  let n = 0;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    try {
      const el = r.el;
      if (!el || typeof el.setAttribute !== 'function') continue;
      if (r.filter) el.style.filter = r.filter; else el.style.removeProperty('filter');
      if ('display' in r) {
        if (r.display) el.style.display = r.display; else el.style.removeProperty('display');
      }
      if (el.getAttribute) el.removeAttribute(TOPBAR_MARK);
      n++;
    } catch (_e) { /* 单条失败不影响其余 */ }
  }
  records.length = 0;
  return n;
}

/** 当前存活的套用数（诊断 / stats 用） */
export function countTopbarQuiet(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || !d.querySelectorAll) return 0;
  try { return d.querySelectorAll('[' + TOPBAR_MARK + ']').length; } catch (_e) { return 0; }
}
