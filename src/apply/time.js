/**
 * 应用层：时间文本改写 / 还原（L1 第二批 · §7.5 D 组）
 *
 * ── 为什么不是纯 CSS ────────────────────────────────────────────────
 * 原计划走「`visibility:hidden` 原文 + `::after{content:attr(title)}`」——
 * 但隐藏的原文**仍占着位**，`::after` 只能接在它后面 ⇒ 渲染成「4 字空隙 + 绝对时间」。
 * 绕开它要动 `font-size:0` / `overflow:hidden`，都属「改尺寸」属性（B2 明令禁止）。
 * ⇒ 改走**文本改写**：把 `6小时前` 直接换成 `10-13 08:13`。宽度对齐微博自身格式，
 *   不碰任何尺寸属性，也不触碰「禁移 / 禁克隆 / 禁删节点」三条红线。
 *
 * ── 可逆性怎么保证 ──────────────────────────────────────────────────
 * 改写前把**原文**存进自有属性 `data-spb-t="6小时前"`（我们**不 observe attributes**，
 * 所以写它不会自触发）。还原时据此恢复文本并移除属性 ⇒ 与微博原文逐字一致。
 * 槽位被回收复用、微博重渲染出新的 `<a>` 时，属性自然消失 ⇒ 下一轮重新存原文，
 * 不会把「已改写的文本」误当成原文。
 *
 * ── 幂等性 ──────────────────────────────────────────────────────────
 * 每轮扫描都调一次：文本已是目标值 ⇒ 一个字节都不写（避免自触发循环）。
 */

import { SEL_TIME_ANCHOR } from '../adapters/weibo-home.js';
import { absoluteShortText, isTimeTitle } from '../core/time-text.js';

/** 存放**原文**的自有属性（诊断 / 还原用） */
export const TIME_ATTR = 'data-spb-t';

/** 找出一张卡里的时间锚点（按 title 格式判别，不依赖构建哈希类名） */
function timeAnchors(root) {
  const out = [];
  if (!root || !root.querySelectorAll) return out;

  // 先用最宽的锚点查询（`a[title^="20"]`），再用正则复核 —— 双保险
  let list;
  try {
    list = root.querySelectorAll(SEL_TIME_ANCHOR[0]);
  } catch (_e) {
    return out;
  }
  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    if (isTimeTitle(el.getAttribute && el.getAttribute('title'))) out.push(el);
  }
  return out;
}

/**
 * 把一张卡里的相对时间改写成绝对短格式（**幂等**）。
 *
 * @param {Element} root  卡片根（或任意子树）
 * @param {Date}    now   当前时间（注入以便单测）
 * @param {boolean} on    是否启用（false ⇒ 还原）
 * @returns {{total:number, changed:number, restored:number}}
 */
export function applyAbsoluteTimes(root, now, on) {
  const out = { total: 0, changed: 0, restored: 0 };
  const anchors = timeAnchors(root);
  out.total = anchors.length;
  if (!anchors.length) return out;

  for (const el of anchors) {
    const stored = el.getAttribute(TIME_ATTR);

    if (!on) {
      // 关档 ⇒ 还原原文（有存过才还原）
      if (stored !== null) {
        el.textContent = stored;
        el.removeAttribute(TIME_ATTR);
        out.restored++;
      }
      continue;
    }

    const target = absoluteShortText(el.getAttribute('title'), now);
    if (target === null) continue;           // 跨年 / 不该改
    if (el.textContent === target) continue;  // 已是目标 ⇒ 不写（幂等，避免自触发）

    // 首次改写时才存原文；后续轮次属性已在，绝不能覆盖（否则会把改写结果当成原文）
    if (stored === null) el.setAttribute(TIME_ATTR, el.textContent);
    el.textContent = target;
    out.changed++;
  }
  return out;
}

/**
 * 全页还原（`stop()` 时用）—— 与 `applyAbsoluteTimes(root, now, false)` 等价，
 * 单独给一个名字是因为「停管线」与「关档」是两件事，语义分开更好读。
 */
export function restoreTimes(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || !d.querySelectorAll) return 0;

  let n = 0;
  const list = d.querySelectorAll('[' + TIME_ATTR + ']');
  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    el.textContent = el.getAttribute(TIME_ATTR);
    el.removeAttribute(TIME_ATTR);
    n++;
  }
  return n;
}

/** 当前页面上被改写的时间锚点数（诊断用） */
export function countTimes(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || !d.querySelectorAll) return 0;
  return d.querySelectorAll('[' + TIME_ATTR + ']').length;
}
