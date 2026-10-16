/**
 * 应用层：打标记 / 撤销标记（PROJECT.md §6 第 ③ 层出口）
 *
 * ── 唯一一条纪律（§5.2 第 ④ 条）────────────────────────────────
 *   「标记**跟着数据走，不挂在 DOM 节点上**；节点复用后重新判定。」
 *
 * 这条纪律是**硬性**的，因为微博的信息流是虚拟列表：`.vue-recycle-scroller__item-view`
 * 这个**槽位节点会被回收复用**（实测回收态为 `transform: translateY(-9999px); opacity: 0`）。
 * 也就是说：**没有任何 DOM 标记能天然跟着某条微博走**。
 *
 * ⇒ 所以这里所有函数都是**幂等设置器**，不是状态存储器：
 *   调度层每一轮扫描都会对每个槽位**重新判定**，然后调用 `markSlot(slot, 该不该隐藏)`。
 *   真正的状态只有判定结果本身（每轮重算），DOM 属性只是它的投影。
 *
 * ⚠️ 绝不能写成「第一次判定为广告就打标记，以后不再管」——槽位换了一条普通微博之后，
 *    那条普通微博就会被莫名其妙地隐藏。这正是 §5.2 第 ④ 条要防的事。
 */

import { MARK_ATTR, MARK_HIDDEN, MARK_PAGE_AD } from './style.js';

/** B 类：信息流内的卡 —— 压缩为一行细条（§12-B19；旧「保高度隐藏」已被推翻） */
export function markSlot(slotEl, hide) {
  if (!slotEl || !slotEl.setAttribute) return false;
  const has = slotEl.hasAttribute(MARK_ATTR) && slotEl.getAttribute(MARK_ATTR) === MARK_HIDDEN;

  if (hide) {
    if (has) return false;
    slotEl.setAttribute(MARK_ATTR, MARK_HIDDEN);
    return true;
  }
  if (has) {
    slotEl.removeAttribute(MARK_ATTR);
    return true;
  }
  return false;
}

/** A 类：页面级 banner（流式布局，收掉不留洞） */
export function markPageAd(el, hide) {
  if (!el || !el.setAttribute) return false;
  const has = el.hasAttribute(MARK_ATTR) && el.getAttribute(MARK_ATTR) === MARK_PAGE_AD;

  if (hide) {
    if (has) return false;
    el.setAttribute(MARK_ATTR, MARK_PAGE_AD);
    return true;
  }
  if (has) {
    el.removeAttribute(MARK_ATTR);
    return true;
  }
  return false;
}

/**
 * 清掉页面上**所有**标记 —— 关闭开关 / 停止调度时的总撤销。
 * @param {Document} doc
 * @returns {number} 清掉的元素数
 */
export function clearAll(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || !d.querySelectorAll) return 0;

  let n = 0;
  const list = d.querySelectorAll('[' + MARK_ATTR + ']');
  for (let i = 0; i < list.length; i++) {
    list[i].removeAttribute(MARK_ATTR);
    n++;
  }
  return n;
}

/**
 * 当前页面上被标记的元素数（诊断用）。
 * @param {Document} doc
 * @returns {{hidden:number, pageAd:number}}
 */
export function countMarks(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  const out = { hidden: 0, pageAd: 0 };
  if (!d || !d.querySelectorAll) return out;
  out.hidden = d.querySelectorAll(`[${MARK_ATTR}="${MARK_HIDDEN}"]`).length;
  out.pageAd = d.querySelectorAll(`[${MARK_ATTR}="${MARK_PAGE_AD}"]`).length;
  return out;
}
