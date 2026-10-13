/**
 * 微博首页时间线 —— 适配层（PROJECT.md §6 第 ③ 层的输入端）
 *
 * 职责：**只读地把 DOM 翻成结构化信号包**，交给判定核心（src/core/）。
 * 本模块**不做判定、不改页面** —— 判定在 core，改写由应用层负责。
 *
 * 选择器纪律（§12-B4 实测）：
 *   ✅ 只锚稳定类名：`wbpro-*` / `woo-*` / `vue-*` / `vjs-*`，以及 `id`（`#homeWrap` / `#scroller`）
 *   ⛔ 绝不锚构建哈希 `_name_hash_lineno`（如 `_nick_ygi5b_25`、`_normal_ecgcn_34`）—— 构建一变即失效
 *   ⛔ 绝不锚 `__yawf_*` —— 那是外部脚本（上游油猴脚本）运行时注入的，不是微博的
 *   ⚠️ 头区（作者 / 时间 / 来源）在真实 DOM 里**没有语义类名** ⇒ 一律走「多级回退 + 文本兜底」
 *
 * 每条适配规则都配有探针（§6.1），见文件末尾 PROBES。
 */

// 判据常量**只从判定核心引**，绝不在适配层复刻 —— 两处各写一份必然漂移。
import { AD_IMG_HOSTS, matchAdHost } from '../core/ad-detect.js';

// ============================================================ 选择器（含回退）

/**
 * 信息流容器。`#scroller` 是实测存在的 id（`div#scroller.vue-recycle-scroller`）。
 * 回退顺序：id → 虚拟列表类名。
 */
export const SEL_SCROLLER = ['#scroller', '.vue-recycle-scroller'];

/** 虚拟「槽位」——节点复用的单位，隐藏要落在这一层才不影响数据 */
export const SEL_ITEM_VIEW = ['.vue-recycle-scroller__item-view'];

/** 卡片根 —— 稳定类名，实测每卡一个 */
export const SEL_CARD = ['.wbpro-scroller-item'];

/**
 * 首页主栏 —— **A 类广告位的收口锚点**。
 * 实测结构：`#homeWrap` 依次是「发布器卡 → A 类广告位（匿名 div）→ 时间线容器」，
 * 所以「收掉整块 banner」= 把标记打在**它的直接子节点**上（见 scheduler 的 pageAdContainer）。
 */
export const SEL_HOME_WRAP = ['#homeWrap'];

/** 原创正文 / 转发原文（§12-A3 关键词字段白名单的落点） */
export const SEL_OG_TEXT = ['.wbpro-feed-ogText'];
export const SEL_RE_TEXT = ['.wbpro-feed-reText'];

/** 头像（§7.5.5 三个变体的落点） */
export const SEL_AVATAR = ['img.woo-avatar-img'];

/** 答案选择：返回第一个命中的元素 */
function pick(root, selectors) {
  for (const s of selectors) {
    const el = root.querySelector(s);
    if (el) return el;
  }
  return null;
}

/** 答案选择：返回第一个命中的元素集合 */
function pickAll(root, selectors) {
  for (const s of selectors) {
    const list = root.querySelectorAll(s);
    if (list && list.length) return Array.prototype.slice.call(list);
  }
  return [];
}

/**
 * 元素是否有以 prefix 开头的 class 令牌（用于躲开构建哈希但又要认组件）。
 *
 * ⚠️ 用 `getAttribute('class')` 而不是 `classList` / `className`：
 *   - SVG 元素的 `className` 是 `SVGAnimatedString`，不是字符串；
 *   - `classList` 在部分 DOM 实现（如测试用的 linkedom）里不可按下标访问。
 *   字符串解析在浏览器与 Node 测试环境里行为一致。
 */
function hasClassPrefix(el, prefix) {
  return classTokens(el).some((c) => c.indexOf(prefix) === 0);
}

/** 取元素的 class 令牌数组（跨浏览器 / 跨 DOM 实现安全） */
function classTokens(el) {
  if (!el || typeof el.getAttribute !== 'function') return [];
  const raw = el.getAttribute('class') || '';
  return raw.split(/\s+/).filter(Boolean);
}

/** 绝对化 href（微博大量使用 `//weibo.com/...` 协议相对写法） */
function absUrl(href, base) {
  if (!href) return '';
  if (/^https?:/i.test(href) || href.indexOf('//') === 0) {
    return href.indexOf('//') === 0 ? 'https:' + href : href;
  }
  try {
    return new URL(href, base || 'https://weibo.com/').href;
  } catch (_e) {
    return href;
  }
}

// ============================================================ 卡片信号

/**
 * 取卡片的「帖子 ID」= 时间链接 `https://weibo.com/<uid>/<bid>` 里的 bid。
 * 实测：每卡恰好一个（§12-B3）。取不到时返回 null（**不要退回 hashCode/位置序号**，
 * 否则节点复用后会串号 —— §5.2 第 ④ 步要求标记跟着数据走）。
 */
export function readCardId(card) {
  const as = card.querySelectorAll('a[href]');
  for (let i = 0; i < as.length; i++) {
    const href = as[i].getAttribute('href') || '';
    const m = /weibo\.com\/\d+\/([A-Za-z0-9]+)/.exec(absUrl(href));
    if (m) return m[1];
  }
  return null;
}

/**
 * 抽一张卡的信号包，交给 core/ad-detect 判定。
 * @param {Element} card  `.wbpro-scroller-item` 或其内部的 `article`
 * @returns {Object} 与 core/ad-detect `FeedItemSignals` 对齐，外加 id/文本等字段
 */
export function readCardSignals(card) {
  const base = 'https://weibo.com/';

  const urls = [];
  const as = card.querySelectorAll('a[href]');
  for (let i = 0; i < as.length; i++) {
    urls.push(absUrl(as[i].getAttribute('href'), base));
  }

  const imgSrcs = [];
  const imgs = card.querySelectorAll('img');
  for (let i = 0; i < imgs.length; i++) {
    imgSrcs.push(imgs[i].currentSrc || imgs[i].getAttribute('src') || '');
  }

  // 标签槽：div.wbpro-tag*（注意 wbpro-tag-img 是认证图标，属自然卡，靠 matchAdTag 整串比对挡掉）
  const tagTexts = [];
  const tagNodes = card.querySelectorAll('[class*="wbpro-tag"]');
  for (let i = 0; i < tagNodes.length; i++) {
    const el = tagNodes[i];
    if (hasClassPrefix(el, 'wbpro-tag-img')) continue;   // 认证图标，跳过
    const t = (el.textContent || '').trim();
    if (t) tagTexts.push(t);
  }

  // 「关注」按钮：class 含 _followbtn_ 的 button，回退到头部里文案为「关注」的 button
  let hasFollowButton = false;
  const btns = card.querySelectorAll('button');
  for (let i = 0; i < btns.length; i++) {
    if (classTokens(btns[i]).some((c) => c.indexOf('_followbtn_') === 0)) { hasFollowButton = true; break; }
  }
  if (!hasFollowButton) {
    const header = card.querySelector('header');
    if (header) {
      const hb = header.querySelectorAll('button');
      for (let i = 0; i < hb.length; i++) {
        if ((hb[i].textContent || '').trim().indexOf('关注') !== -1) { hasFollowButton = true; break; }
      }
    }
  }

  const og = pick(card, SEL_OG_TEXT);
  const re = pick(card, SEL_RE_TEXT);

  return {
    id: readCardId(card),
    urls,
    imgSrcs,
    tagTexts,
    hasFollowButton,
    text: og ? (og.textContent || '') : '',
    repostText: re ? (re.textContent || '') : '',
    author: readAuthor(card),
  };
}

/** 作者昵称：多级回退 —— usercard 链接里的 span[title] → 头像 aria-label */
function readAuthor(card) {
  const header = card.querySelector('header');
  if (!header) return '';
  const named = header.querySelector('a[usercard] span[title]');
  if (named) return named.textContent || '';
  const label = header.querySelector('a[aria-label]');
  if (label) return label.getAttribute('aria-label') || '';
  return '';
}

// ============================================================ 页面级广告位

/**
 * 找 A 类广告位（页面级 banner）。
 *
 * 实测结构（`snapshot-20261013-1505.html`）：
 *   div#app
 *     …
 *       div#homeWrap
 *         div                       ← 匿名容器（无 class）
 *           div.woo-box-flex.woo-box-alignCenter.woo-box-justifyCenter   ← 组件（类名是构建哈希）
 *             div.woo-picture-main…
 *               img[src*="kadmimage.biz.weibo.com"]
 *
 * 策略：**不锚结构，锚媒体来源** —— 凡是 src 落在广告 CDN 上的 img，
 * 它的容器就是广告位。这样构建哈希、层次变动都不影响。
 *
 * @returns {Array<{el: Element, imgSrc: string, inFeed: boolean, hasCloseIcon: boolean}>}
 */
export function findPageAdSlots(doc) {
  const out = [];
  const imgs = doc.querySelectorAll('img');
  for (let i = 0; i < imgs.length; i++) {
    const src = imgs[i].currentSrc || imgs[i].getAttribute('src') || '';
    if (!src) continue;
    // 用判定核心的判据预筛 —— 不在适配层复刻一份（否则两处必然漂移）
    if (!matchAdHost(src)) continue;
    const holder = imgs[i].closest('div') || imgs[i].parentElement;
    out.push({
      el: holder,
      imgSrc: src,
      inFeed: Boolean(imgs[i].closest('.wbpro-scroller-item')),
      hasCloseIcon: hasCloseIconNear(holder),
    });
  }
  return out;
}

/** 广告位自带的关闭图标是否就在这个容器里（实测：`…/948/2022/09/21/close.png`） */
export function hasCloseIconNear(el) {
  if (!el) return false;
  const root = el.closest('div') || el;
  const imgs = root.querySelectorAll('img');
  for (let i = 0; i < imgs.length; i++) {
    const s = imgs[i].getAttribute('src') || '';
    if (s.indexOf('948/2022/09/21/close.png') !== -1) return true;
  }
  return false;
}

// ============================================================ 探针注册表（§6.1）

/**
 * 每条适配规则配一个探针：不报错、只回答「我的选择器现在还能命中吗」。
 * 面板「诊断」页遍历执行（M3）。`expect: 'cards'` 表示「命中数量应当 ≥ 信息流项数」。
 */
export const PROBES = [
  {
    id: 'scroller',
    desc: '信息流容器 #scroller',
    selector: SEL_SCROLLER.join(' / '),
    expect: 'exists',
    failMeans: '容器选择器失效 ⇒ 整条过滤管线停摆（广告不会被过滤，但也不会报错）',
  },
  {
    id: 'item-view',
    desc: '虚拟槽位（节点复用单位）',
    selector: SEL_ITEM_VIEW.join(' / '),
    expect: 'exists',
    failMeans: '槽位选择器失效 ⇒ 无法在正确层级落样式，可能误改卡片内部结构',
  },
  {
    id: 'card',
    desc: '卡片根 .wbpro-scroller-item',
    selector: SEL_CARD.join(' / '),
    expect: 'exists',
    failMeans: '卡片选择器失效 ⇒ 逐卡判定与隐藏全部停摆',
  },
  {
    id: 'home-wrap',
    desc: '首页主栏 #homeWrap（A 类 banner 的收口锚点）',
    selector: SEL_HOME_WRAP.join(' / '),
    expect: 'optional',
    failMeans: 'A 类收口锚点失效 ⇒ banner 只会退回到「收图片那一层」，可能残留外层 padding 的空白（B 类过滤不受影响，因为用不到它）',
  },
  {
    id: 'og-text',
    desc: '原创正文（关键词字段白名单）',
    selector: SEL_OG_TEXT.join(' / '),
    expect: 'exists',
    failMeans: '正文字段失效 ⇒ 关键词过滤漏判（正文读不到）',
  },
  {
    id: 're-text',
    desc: '转发原文（关键词字段白名单）',
    selector: SEL_RE_TEXT.join(' / '),
    expect: 'optional',
    failMeans: '转发原文字段失效 ⇒ 转发链内容不参与关键词匹配（偏保守，可接受）',
  },
  {
    id: 'avatar',
    desc: '头像 img.woo-avatar-img',
    selector: SEL_AVATAR.join(' / '),
    expect: 'exists',
    failMeans: '头像选择器失效 ⇒ §7.5.5 三个头像变体全部不生效',
  },
  {
    id: 'tag-slot',
    desc: '卡片头部标签槽 [class*=wbpro-tag]',
    selector: '[class*="wbpro-tag"]',
    expect: 'optional',
    failMeans: '标签槽失效 ⇒ 推广标签这条广告判据失效（还有另外三条兜底）',
  },
  {
    id: 'follow-btn',
    desc: '卡内「关注」按钮 button[_followbtn_*]',
    selector: 'button[class*="_followbtn_"]',
    expect: 'optional',
    failMeans: '关注按钮判据失效（还有链接埋点等兜底）',
  },
  {
    id: 'ad-cdn',
    desc: '广告 CDN 图片（A 类 banner）',
    selector: `img[src*="${AD_IMG_HOSTS[0]}"]`,
    expect: 'variable',   // 实测：间歇投放，有时为空 —— 为空**不代表失效**
    failMeans: '⚠️ 本探针为空属正常（实测间歇投放）。只有当页面上肉眼可见广告却命中 0 时才算失效',
  },
];

/**
 * 执行探针（只读，§6.1）。M3 的诊断页会调用它。
 * @param {Document} doc
 * @returns {Array<{id:string,desc:string,count:number,status:'ok'|'warn'|'fail',failMeans:string}>}
 */
export function runProbes(doc) {
  return PROBES.map((p) => {
    let count = 0;
    try {
      count = doc.querySelectorAll(p.selector.split(' / ')[0]).length;
    } catch (_e) {
      count = 0;
    }
    let status;
    if (p.expect === 'variable') status = 'ok';
    else if (count > 0) status = 'ok';
    else status = p.expect === 'optional' ? 'warn' : 'fail';
    return { id: p.id, desc: p.desc, count, status, failMeans: p.failMeans };
  });
}
