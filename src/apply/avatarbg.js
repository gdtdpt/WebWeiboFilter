/**
 * 应用层：头像图片 → 整行背景水印（§7.5.5 β 变体，2026-10-16 用户定稿）
 *
 * ── 需求从哪来 ──────────────────────────────────────────────────────
 * 用户原话澄清（2026-10-16，纠正 M2 的 β 误实现）：
 *   「将头像的**图片**（不是 html 元素）作为整行（从日期列开始）的背景，
 *     在左上向右下正常比例消失，不是现在这样将头像元素作为第二列」
 * ⇒ β 的正确形态：
 *   · 取卡 header 里头像 img 的 src（**读数据，不是搬节点** —— 红线允许）；
 *   · 写成 article 的 CSS 变量 `--spb-avatar-bg`；
 *   · 绘制交给 l2.js 的 `article::before`（左上角、正方形不变形、135° mask 渐隐、
 *     z-index:-1 沉到正文之下、pointer-events:none 不挡点击）；
 *   · 原头像元素由 CSS `visibility:hidden` 退场（保留占位 ⇒ 卡高零变化）。
 *
 * ── 为什么用 CSS 变量当桥 ───────────────────────────────────────────
 * `::before` 伪元素**收不到内联 style**，唯一能让 JS 把动态 URL 递进伪元素的
 * 通道就是自定义属性（`var(--spb-avatar-bg)`）。背景盒的尺寸 / 渐隐全部在 CSS
 * 侧声明（l2.js），JS 只负责「这张卡现在该显示哪个头像」这一个动态事实。
 *
 * ── 幂等与可逆（与 time.js / summary.js 同一套纪律）─────────────────
 *   · 已标记且 URL 没变 ⇒ 一个字节都不写（避免自触发循环）；
 *   · 槽位复用换了卡 ⇒ URL 跟着新卡的 header 头像重算；
 *   · 🔴 新卡**没有** header 头像（推荐关注 / 话题大卡等）⇒ 必须把上一张卡
 *     留下的水印**清掉** —— 否则 A 作者的水印挂在 B 卡上（串号）；
 *   · 关档（非 L2 β）逐卡清；停管线 removeAvatarBackgrounds() 全页清。
 *
 * ⚠️ 只读 header 的主头像：选择器限定 `article > div > header` ⇒ 转发块里的
 *    小头像不参与（它保持 L1 的降饱和形态）。
 */

/** 自有标记（复用 `data-spb` 属性名 —— 低调纪律：DOM 不新增自述属性名） */
export const AVATAR_BG_ATTR = 'data-spb';

/** `data-spb` 的取值：头像背景水印（与 hidden / ad / stats 并列） */
export const AVATAR_BG_MARK = 'avatarbg';

/** 水印标记选择器（全页清理 / 诊断计数用） */
export const AVATAR_BG_SEL = [`[${AVATAR_BG_ATTR}="${AVATAR_BG_MARK}"]`];

/** CSS 变量名（l2.js 的 `article::before` 消费端用同一个来源） */
export const AVATAR_BG_VAR = '--spb-avatar-bg';

/** 卡 header 主头像（与 l2.js 的 β 隐藏规则同作用域：转发块小头像不参与） */
const HEADER_AVATAR_SEL = 'article > div > header img.woo-avatar-img';

/**
 * src → CSS url() 值（**纯函数**）。
 * 头像 URL 理论上不含引号，但 `url("…")` 里的 `"` 和 `\` 必须转义，否则整条
 * 内联样式会被截断（自造注入面）。
 */
export function avatarBgUrl(src) {
  if (!src) return '';
  const s = String(src).replace(/\\/g, '\\\\').replace(/"/g, '%22');
  return 'url("' + s + '")';
}

function setBg(article, val) {
  if (article.style && typeof article.style.setProperty === 'function') {
    article.style.setProperty(AVATAR_BG_VAR, val);
  } else {
    // 无 CSSOM 的极端环境兜底：直接拼内联样式（测试 DOM 也能走通）
    const cur = article.getAttribute('style') || '';
    article.setAttribute('style', cur + (cur ? ';' : '') + AVATAR_BG_VAR + ':' + val);
  }
  article.setAttribute(AVATAR_BG_ATTR, AVATAR_BG_MARK);
}

function clearBg(article) {
  if (article.style && typeof article.style.removeProperty === 'function') {
    article.style.removeProperty(AVATAR_BG_VAR);
  }
  article.removeAttribute(AVATAR_BG_ATTR);
}

function currentBg(article) {
  if (article.style && typeof article.style.getPropertyValue === 'function') {
    return article.style.getPropertyValue(AVATAR_BG_VAR) || '';
  }
  return '';
}

/**
 * 对一张卡做头像背景水印的**幂等**建立 / 更新 / 摘除。
 *
 * @param {Element} card  `.wbpro-scroller-item`
 * @param {boolean} on    L2 且 avatarVariant === 'beta'（false ⇒ 摘除水印）
 * @returns {{set:number, cleared:number}}
 */
export function applyAvatarBackground(card, on) {
  const out = { set: 0, cleared: 0 };
  if (!card || !card.querySelector) return out;
  const article = card.querySelector('article');
  if (!article) return out;

  const marked = article.getAttribute(AVATAR_BG_ATTR) === AVATAR_BG_MARK;

  if (!on) {
    if (marked) { clearBg(article); out.cleared++; }
    return out;
  }

  // 读 header 主头像的 src（只读数据，不搬节点）。
  // 取不到（卡型没有 header 头像 / src 还没就绪）⇒ 清掉旧水印 —— 槽位复用防串号。
  const img = article.querySelector(HEADER_AVATAR_SEL);
  const src = img ? (img.currentSrc || img.getAttribute('src') || '') : '';
  if (!src) {
    if (marked) { clearBg(article); out.cleared++; }
    return out;
  }

  const val = avatarBgUrl(src);
  // 幂等：已标记且值没变 ⇒ 一个字节都不写
  if (marked && currentBg(article) === val) return out;

  setBg(article, val);
  out.set++;
  return out;
}

/** 全页摘除水印（停管线时用） */
export function removeAvatarBackgrounds(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || !d.querySelectorAll) return 0;

  let n = 0;
  const list = d.querySelectorAll(AVATAR_BG_SEL[0]);
  for (let i = 0; i < list.length; i++) {
    clearBg(list[i]);
    n++;
  }
  return n;
}

/** 当前页面上的水印数（诊断用） */
export function countAvatarBackgrounds(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || !d.querySelectorAll) return 0;
  return d.querySelectorAll(AVATAR_BG_SEL[0]).length;
}
