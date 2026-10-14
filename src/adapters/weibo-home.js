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
 *
 * ⚠️ **2026-10-14 真机事故后修正的错误认知**（原文写的是「`#homeWrap` 依次是
 * 「发布器卡 → A 类广告位（匿名 div）→ 时间线容器」」）：
 * 真实结构是**广告与时间线住在同一个匿名 div 里**，它们是兄弟，不是上下级：
 *
 *   `#homeWrap`
 *     ├ `div.woo-panel-main…`（发布器卡，含 textarea）
 *     └ `div`（匿名）                          ← 旧实现把它当成"A 类广告位"，大错
 *         ├ `div.woo-box-flex…`（**A 类广告 banner 本体**，实测高 85px）  ← 该收的是它
 *         ├ `div._visable_*`（另一块，含 `wbpro-tab2` 卡片 —— **不是广告**）
 *         └ `div` → `#scroller.vue-recycle-scroller`（**整条时间线**）
 *
 * ⇒ 旧实现「从广告图往上走到 `#homeWrap` 的直接子块」取到的落点**含着整条时间线**，
 *   打上 `display:none` 后信息流整页空白（用户真机现象；ffprobe 读数表现为所有槽位
 *   的 `getBoundingClientRect()` 全为 0 ⇒ `h=0/top=0/gap=0`）。
 *   ⇒ 现在改为 `resolvePageAdContainer()`：**往上走到「再上一层就开始装信息流」为止**。
 */
export const SEL_HOME_WRAP = ['#homeWrap'];

/** 原创正文 / 转发原文（§12-A3 关键词字段白名单的落点） */
export const SEL_OG_TEXT = ['.wbpro-feed-ogText'];
export const SEL_RE_TEXT = ['.wbpro-feed-reText'];

/** 头像（§7.5.5 三个变体的落点） */
export const SEL_AVATAR = ['img.woo-avatar-img'];

/** 正文截断容器（"展开全文"的宿主，正文链接也可能落在它里面） */
export const SEL_TEXTCUT = ['.wbpro-textcut'];

/**
 * 媒体容器（单图 / 九宫格共用，实测 `woo-picture-main`）。
 * L1 的降饱和规则打在这上面（§7.5 B 组）。
 * ⚠️ **盖不到视频卡** —— 视频走 video.js，见下面的 `SEL_VIDEO_*`。
 * ⚠️ 用 `[class*=]` 部分匹配而不是完整类名：`woo-picture-main` 之外还有
 * `woo-picture-*` 家族成员，且部分匹配对新增变体更宽容（`woo-` 是稳定前缀，不是构建哈希）。
 */
export const SEL_MEDIA = ['[class*="woo-picture"]'];

/**
 * 视频播放器 —— L1 视频降饱和的落点。
 *
 * ⚠️ **视频卡不是 `woo-picture`**（2026-10-14 复核四份夹具）：真实结构是
 *   `div._videoBox_12xiz_132`（构建哈希）→ `div._placeholder_*` → `div._feedVideo_*`（构建哈希）
 *     → `div#vjs_video_*`**.video-js**.vjs-paused…      ← video.js 播放器根
 *       → `video.vjs-tech`                              ← 视频本体
 *       → `div.vjs-poster` → `picture.vjs-poster` → `img[src=wx*.sinaimg.cn/…]`  ← 封面
 *   ⇒ 只锚 `woo-picture` 的媒体规则**盖不到视频** ⇒ 视频封面一直全彩（用户反馈的现象）。
 *
 * ✅ 可锚的是 **`vjs-*`**：它们来自 **video.js 库**（不是微博的 CSS Modules 构建哈希）⇒
 *    与 `woo-*` / `wbpro-*` 同级的抗改版锚点；外层的 `_videoBox_*` / `_feedVideo_*` 才是构建哈希。
 * ℹ️ 包装元素上另有 Vue 渲染的 `video-active="true|false"` 属性（可读、但语义未验）⇒
 *    **播放状态以 video.js 的 `vjs-playing` / `vjs-paused` 为准**（那是库保证会翻转的类）。
 */
export const SEL_VIDEO_PLAYER = ['.video-js'];
export const SEL_VIDEO_POSTER = ['.vjs-poster'];
export const SEL_VIDEO_TECH = ['video.vjs-tech'];

/**
 * 卡内时间锚点（L1「相对时间 → 绝对短格式」的落点，§7.5 D 组）。
 *
 * ⚠️ 时间链接的类名是构建哈希（`_time_1tpft_33` / `_time_1t79r_33` 两种都见过）⇒ 不可用。
 * 唯一可靠的特征是 **`title` 属性**：恒为 `YYYY-MM-DD HH:MM`（给鼠标悬停提示用的，
 * 微博一定会保留）。这里先用 `a[title^="20"]` 粗筛缩小范围（避免遍历全部 `a`），
 * 再由 `core/time-text.js` 的正则**复核** —— 双重判别，零误伤（作者昵称等 title 匹配不上）。
 */
export const SEL_TIME_ANCHOR = ['a[title^="20"]'];

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

// ============================================================ A 类收口落点

/**
 * 「一旦被收进 A 类落点就出事」的东西 —— **A 类收口的唯一红线**。
 *
 *   · `.vue-recycle-scroller` / `.wbpro-scroller-item` → 信息流（收掉 = 整页空白）
 *   · `textarea` / `[contenteditable]`                → 发布器（收掉 = 用户写不了微博）
 *
 * ⚠️ 为什么必须是**包含性**判据而不是"往上走几层"：微博的结构随时会变
 *   （2026-10-14 就是"广告与时间线同住一个匿名 div"这种反直觉的排布），
 *   而"A 类落点里不许有信息流"这条**不依赖任何层级假设**。
 */
export const AD_SWALLOW_GUARD = [
  '.vue-recycle-scroller',
  '.wbpro-scroller-item',
  'textarea',
  '[contenteditable="true"]',
].join(',');

/** 这个元素一旦被 `display:none`，会不会连带收掉信息流 / 发布器 */
export function swallowsFeed(el) {
  return !!(el && el.querySelector && el.querySelector(AD_SWALLOW_GUARD));
}

/**
 * A 类 banner 该收到哪一块上：**从广告图所在的那层往上走，走到「再上一层就开始装信息流」为止**。
 *
 * 好处是同时满足两个互相拉扯的目标：
 *   · 收得干净 —— 能一路收到 banner 自己的根（真机 = `div.woo-box-flex…`），不残留外层间距；
 *   · 收得安全 —— 绝不越过"含信息流／发布器"的那条线（`swallowsFeed`）。
 *
 * @param {Document} doc
 * @param {Element} holder 广告图所在的最小容器（`findPageAdSlots` 给的 `el`）
 * @returns {Element|null} 落点；**返回 `null` = 找不到安全落点，调用方必须放弃收掉**
 *   （宁可露出广告，也绝不许吞掉时间线 —— 这是刻意选的失败方向）
 */
export function resolvePageAdContainer(doc, holder) {
  if (!holder || !holder.parentElement) return null;

  const wrap = doc && doc.querySelector ? doc.querySelector(SEL_HOME_WRAP[0]) : null;
  let cur = holder;
  while (cur.parentElement && cur.parentElement !== wrap) {
    if (swallowsFeed(cur.parentElement)) break;
    cur = cur.parentElement;
  }

  // 兜底自检：走到哪都不能出红线（含 holder 本来就病态的情形）
  if (swallowsFeed(cur)) return null;
  return cur;
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
  {
    id: 'media',
    desc: '媒体容器 [class*=woo-picture]（L1 图片降饱和落点）',
    selector: SEL_MEDIA.join(' / '),
    expect: 'optional',   // 纯文字微博本就没有图 ⇒ 为空不算失效
    failMeans: '媒体锚点失效 ⇒ L1 的图片降饱和不生效（不影响过滤）',
  },
  {
    id: 'video',
    desc: '视频播放器 .video-js（L1 视频降饱和落点，video.js 库类名）',
    selector: SEL_VIDEO_PLAYER.join(' / '),
    expect: 'optional',   // 纯文字 / 纯图片的首页本就没有视频 ⇒ 为空不算失效
    failMeans: '视频锚点失效 ⇒ 视频封面与暂停帧不再降饱和（不影响过滤）',
  },
  {
    id: 'text-link',
    desc: '正文内链接（L1 去蓝落点：话题 / @ / 外链）',
    selector: `${SEL_OG_TEXT[0]} a / ${SEL_TEXTCUT[0]} a`,
    expect: 'optional',   // 没有链接的微博很常见
    failMeans: '正文链接锚点失效 ⇒ L1 的话题/@/外链去蓝不生效（不影响过滤）',
  },
  {
    id: 'time-anchor',
    desc: '卡内时间锚点（靠 title 的日期格式判别，L1 时间改绝对格式的落点）',
    selector: SEL_TIME_ANCHOR.join(' / '),
    expect: 'exists',   // 时间锚点与卡片一一对应：卡片在，时间就必然在 ⇒ 为空即失效
    failMeans: '时间锚点失效 ⇒ L1「相对时间 → 绝对短格式」不生效（不影响过滤）',
  },
];

/**
 * 执行探针（只读，§6.1）。M3 的诊断页会调用它。
 *
 * @param {Document} doc
 * @param {Array} [list] 探针表；缺省用本层（信息流 / 容器层）的 `PROBES`。
 *   M3 诊断页应把各层的表拼起来跑：`runProbes(doc, [...PROBES, ...PROBES_SHELL])`。
 * @returns {Array<{id:string,desc:string,count:number,status:'ok'|'warn'|'fail',failMeans:string}>}
 */
export function runProbes(doc, list) {
  return (list || PROBES).map((p) => {
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
