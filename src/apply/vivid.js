/**
 * 应用层：主区 vivid 收尾（去橙红的运行时补刀 · §12-B22；2026-10-16 个人页适配）
 *
 * ── 取证（probeProfile，weibo.com/u/5611387865）─────────────────────
 *   · themeVars 核验：:root 上我们的 26 个哑色**在个人页全部生效**（hsl(28,…)）⇒
 *     变量覆盖是全站的，不用补；
 *   · 残余鲜橙全部是**写死颜色**（不走变量，CSS 表达不了「这个组件用了写死色」）：
 *       数据胶囊 `._tag_1yc79_149`  color/border #ea8011（s=86，哈希类 ⛔ 不可锚）
 *       侧栏消息数 `.woo-badge-msg` rgb(250,108,1)（s=99，有库类但语义=未读计数）
 *       「下载动图」hover 钮         bg 蓝 rgb(24,95,165)（s=75）
 *       置顶角标                    probeProfile 没抓到 —— 疑似 SVG **fill** 上色
 *                                   （fill 不在 color 通道：「涂料三族」教训再加一员）；
 *   · 反向锚点：rgb(172,138,108)（s=28）= **我们哑色 hsl(28,28%,55%) 的本尊**
 *     （tab 下划线 / 管理钮 / 关注钮）—— 不是问题，是设计值，判定必须放过它。
 *
 * ── 手法：全文档 vivid 扫描（顶栏同款，阈值不同）────────────────────
 *   · 阈值 **minS=0.5**（isVividRGB 参数化）：只抓写死鲜色（s 75~99），自动放过
 *     我们自己的哑色（s 28~30）与哑砖红（s 30）—— 0.25 阈值会把设计值一起灰掉；
 *   · 四通道：color / backgroundColor / borderTopColor / **fill**（SVG），
 *    外加 background-image 渐变串里的 rgb 逐个判（发布按钮 gradient 同族）；
 *   · 命中 ⇒ `filter:grayscale(1)` 内联（**零布局影响**）+ `data-spb-vq` 标记幂等
 *     + 内存台账还原（topbar.js 同款）；跳过顶栏 bar 子树（topbar.js 已管，避免双台账）
 *     和 `article` 子树（**用户内容红线**：卡内媒体/头像的降饱和走 CSS ③族，不归这里）；
 *   · **全站生效**（不只个人页）—— 以后微博任何页面写死橙色都被这网兜住。
 *   · gate = appearanceOn && vividQuiet!==false（跟 themeCss 去橙红同层：F 组去色的运行时半边）。
 */

import { isVividRGB, findTopbar } from './topbar.js';

/** 我方标记（防重复套用；还原时据此找元素） */
export const VIVID_MARK = 'data-spb-vq';

/**
 * 纯函数：background-image 串里的 rgb 色是否带鲜色（渐变/图片 URL 只能这么判——
 * URL 串解析不出颜色 ⇒ 无 rgb 字样即不判 vivid，不误伤背景图元素）。
 */
export function paintIsVivid(bgImage, minS) {
  if (typeof bgImage !== 'string' || bgImage === '' || bgImage === 'none') return false;
  const re = /rgba?\([^)]+\)/g;
  let m;
  while ((m = re.exec(bgImage)) !== null) {
    if (isVividRGB(m[0], minS)) return true;
  }
  return false;
}

/* 会话内台账：{ el, filter } —— 还原内联 filter 用 */
const records = [];

function computedStyle(el) {
  try { return getComputedStyle(el); } catch (_e) { return null; }
}

/** 是否在 article 子树内（用户内容红线：卡内一律不碰） */
function inArticle(el) {
  let cur = el;
  while (cur) {
    if ((cur.tagName || '').toLowerCase() === 'article') return true;
    cur = cur.parentElement;
  }
  return false;
}

/** 对一个元素套灰度（幂等；首次套时把原 filter 记入台账） */
function grayOut(el) {
  if (el.getAttribute && el.getAttribute(VIVID_MARK)) return false;
  records.push({ el, filter: el.style ? el.style.filter : '' });
  if (el.setAttribute) el.setAttribute(VIVID_MARK, '1');
  el.style.filter = 'grayscale(1)';
  return true;
}

/**
 * 一轮主区 vivid 收尾 / 还原（**幂等**）。
 *
 * @param {Document} doc
 * @param {boolean} on true = 套用；false = 还原
 * @returns {{grayed:number, restored:number}}
 */
export function applyVividQuiet(doc, on) {
  const out = { grayed: 0, restored: 0 };
  if (!doc || !doc.querySelectorAll) return out;

  if (!on) return Object.assign(out, { restored: restoreVividQuiet(doc) });

  // 顶栏 bar 子树跳过 —— topbar.js 已按自己的台账管过，二次入账会互相覆盖还原值
  const bar = findTopbar(doc);
  const inBar = (el) => !!(bar && bar.contains && bar.contains(el));

  let all;
  try { all = doc.body.querySelectorAll('*'); } catch (_e) { return out; }
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (inBar(el) || inArticle(el)) continue;
    if (el.getAttribute && el.getAttribute(VIVID_MARK)) continue;
    const cs = computedStyle(el);
    if (!cs) continue;
    const vivid = isVividRGB(cs.color, 0.5)
      || isVividRGB(cs.backgroundColor, 0.5)
      || isVividRGB(cs.borderTopColor, 0.5)
      || isVividRGB(cs.fill, 0.5)
      || paintIsVivid(cs.backgroundImage, 0.5);
    if (vivid && grayOut(el)) out.grayed++;
  }
  return out;
}

/** 全量还原（off / stop()）：按台账恢复原内联 filter、摘标记 */
export function restoreVividQuiet(_doc) {
  let n = 0;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    try {
      const el = r.el;
      if (!el || typeof el.setAttribute !== 'function') continue;
      if (r.filter) el.style.filter = r.filter; else el.style.removeProperty('filter');
      if (el.getAttribute) el.removeAttribute(VIVID_MARK);
      n++;
    } catch (_e) { /* 单条失败不影响其余 */ }
  }
  records.length = 0;
  return n;
}

/** 当前存活的套用数（诊断 / stats 用） */
export function countVividQuiet(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || !d.querySelectorAll) return 0;
  try { return d.querySelectorAll('[' + VIVID_MARK + ']').length; } catch (_e) { return 0; }
}
