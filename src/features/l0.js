/**
 * L0 · 标签页伪装（PROJECT.md §7.3 / §7.5-G）
 *
 * L0 是**零页面适配成本**的一档：只改 `document.title` 与 favicon，
 * 完全不碰 DOM 结构、不依赖任何选择器 ⇒ 微博改版也不会让它失效。
 * 它覆盖 3 米层唯一的暴露点，因此独立成一个开关（与 L1/L2 正交）。
 *
 * 本文件上半部分是**纯函数**（title / favicon / 页名选择），可在 Node 里 import 单测；
 * 下半部分才碰 DOM（applyL0）。
 */

// ---- 身份常量（与 §7.5-G 成套：title / favicon / logo / 顶栏标识同属 SpecBase）----------------

export const BRAND = 'SpecBase';
export const DEFAULT_PAGE_NAME = 'Reference Overview';

/** 页名轮换池（§7.5-G 已定） */
export const PAGE_NAMES = [
  'Reference Overview',
  'Specs',
  'Drafts',
  'Changelog',
  'API Reference',
];

/** favicon：深色圆角方块底色（§7.5-G 已定） */
export const FAVICON_BG = '#2f3e34';

// ---- 纯函数 -------------------------------------------------------------------------------

/** 标题格式：`SpecBase - <页面名>`（§7.5-G） */
export function makeTitle(pageName) {
  const name = typeof pageName === 'string' && pageName.trim() ? pageName.trim() : DEFAULT_PAGE_NAME;
  return `${BRAND} - ${name}`;
}

/** favicon SVG：深色圆角方块 + 白色方框，16px 下仍可辨（§7.5-G） */
export function faviconSvg(size = 32) {
  const s = size;
  const radius = Math.round(s * 0.22);
  const inset = Math.round(s * 0.28);
  const stroke = Math.max(2, Math.round(s * 0.09));
  const box = s - inset * 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">` +
    `<rect width="${s}" height="${s}" rx="${radius}" ry="${radius}" fill="${FAVICON_BG}"/>` +
    `<rect x="${inset}" y="${inset}" width="${box}" height="${box}" fill="none" ` +
    `stroke="#ffffff" stroke-width="${stroke}"/>` +
    `</svg>`
  );
}

/** favicon 的 data: URI（优先方案；可能被微博 CSP 拦截，运行期有 blob 兜底） */
export function faviconDataUri(size = 32) {
  return 'data:image/svg+xml,' + encodeURIComponent(faviconSvg(size));
}

/** 32 位字符串哈希（用于「未知路径」时确定性地挑一个页名，保证同一路径每次得到同一个名字） */
export function hashString(str) {
  let h = 2166136261;
  const s = String(str == null ? '' : str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 已知路径 → 固定页名；未知路径 → 按 pathname 哈希在轮换池里确定性挑选 */
export function pickPageName(pathname) {
  const path = String(pathname || '/');
  if (/^\/(home)?(\?|$)/.test(path) || path === '/') return 'Reference Overview';
  if (/\/(detail|status|comment)\b/.test(path)) return 'Specs';
  if (/^\/(u|n|p)\b/.test(path)) return 'API Reference';
  if (/\/messages\b/.test(path)) return 'Changelog';
  if (/\/(profile|setting)\b/.test(path)) return 'Drafts';
  return PAGE_NAMES[hashString(path) % PAGE_NAMES.length] || DEFAULT_PAGE_NAME;
}

// ---- DOM 侧（浏览器）-----------------------------------------------------------------------

const OWN_ATTR = 'data-specbase-icon';

/** 只保留一个我们自己的 favicon link，并清掉微博原有的图标 */
function setFavicon(doc) {
  const head = doc.head || doc.getElementsByTagName('head')[0];
  if (!head) return false;

  const href = faviconDataUri(32);
  const links = head.querySelectorAll(
    'link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'
  );
  let owner = null;
  for (const link of Array.from(links)) {
    if (link.getAttribute(OWN_ATTR) === '1') {
      owner = link;
    } else {
      // 微博自己的图标：直接移除，避免浏览器仍挑到它的橙色 logo
      link.parentNode && link.parentNode.removeChild(link);
    }
  }
  if (!owner) {
    owner = doc.createElement('link');
    owner.setAttribute(OWN_ATTR, '1');
    owner.setAttribute('rel', 'icon');
    owner.setAttribute('type', 'image/svg+xml');
    head.appendChild(owner);
  }
  if (owner.getAttribute('href') !== href) owner.setAttribute('href', href);
  return true;
}

/**
 * 应用 L0。返回实际写入的标题（便于冒烟时在控制台核对）。
 * @param {Document} doc
 * @param {string} [pageName] 不传则按 pathname 自动挑
 */
export function applyL0(doc, pageName) {
  if (!doc) return null;
  const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
  const path = win && win.location ? win.location.pathname : '/';
  const title = makeTitle(pageName || pickPageName(path));

  try {
    if (doc.title !== title) doc.title = title;
  } catch (_e) {
    /* 文档尚未到可写阶段，交给 observer / DOMContentLoaded 再补 */
  }
  setFavicon(doc);

  installDefensiveObserver(doc, title);
  return title;
}

// ---- §12-B7：微博自身会不会改写 title / favicon --------------------------------------------

let observer = null;
let timer = null;

/**
 * 防御性校正：微博可能在新消息时把标题改成 `(1) 我的首页 微博`、把 favicon 换成带红角标的。
 * 若如此，启动时写一次是不够的 ⇒ 盯 <head> 的 childList，发现被改写就补回来。
 * 去抖 + 只处理我们关心的两种节点，避免自触发死循环。
 */
function installDefensiveObserver(doc, title) {
  const win = doc.defaultView;
  if (!win || typeof win.MutationObserver !== 'function') return;
  if (observer) observer.disconnect();

  let applying = false;
  const reassert = () => {
    if (applying) return;
    applying = true;
    try {
      if (doc.title !== title) doc.title = title;
      setFavicon(doc);
    } finally {
      applying = false;
    }
  };

  observer = new win.MutationObserver((mutations) => {
    let touched = false;
    for (const m of mutations) {
      if (m.type === 'childList' && m.target && m.target.nodeName === 'TITLE') touched = true;
      for (const n of m.addedNodes || []) {
        if (!n || n.nodeType !== 1) continue;
        const tag = n.nodeName;
        if (tag === 'TITLE') touched = true;
        if (tag === 'LINK' && !n.hasAttribute(OWN_ATTR)) {
          const rel = (n.getAttribute('rel') || '').toLowerCase();
          if (rel.indexOf('icon') !== -1) touched = true;
        }
      }
    }
    if (!touched) return;
    win.clearTimeout(timer);
    timer = win.setTimeout(reassert, 50);
  });

  // 观察点：优先 documentElement；document-start 极早期可能还没有，则退到 Document 节点。
  const target = doc.documentElement || doc;
  try {
    observer.observe(target, { childList: true, subtree: true });
  } catch (_e) {
    /* 观察不可用时放弃防御，不影响一次性写入 */
  }
}
