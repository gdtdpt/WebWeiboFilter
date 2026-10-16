/**
 * 应用层：品牌文案换中性（低调模式 L2 · §7.5-F「顶栏 / 标识文案换中性」+ §7.5-G 成套要求）
 *
 * ── 依据（2026-10-16 probeBrand 真机读数，§12-B20）──────────────────
 *   · 可见 chrome 文本只有 1 处「最新微博」（右侧栏 tab）；
 *   · 卡内 31 处含「微博」的文本**全是平台文案**（「来自 微博网页版 / 微博视频号 /
 *     微博bb机」= header 来源行；「原微博」= 转发条链接），不是用户正文；
 *   · 属性 58 处 = chrome（搜索微博 placeholder / 发微博 title / 定时微博 title+alt）
 *     + 卡内徽章 tooltip（微博会员 / 微博创作者经营会员 / …）；
 *   · logo = `a[href="/"][aria-label="Weibo"]` 内的**纯 SVG path**（无文本、无位图）。
 *
 * ── 手法：pattern 驱动幂等改写 ──────────────────────────────────────
 *   只改**整段精确命中白名单模板**的文本 / 属性值（用户正文是长文本节点，
 *   不会整段等于这些平台模板 ⇒ 天然免疫，绝不篡改内容）。改写结果不再命中
 *   任何模式 ⇒ 重扫自动跳过（幂等无需标记）。原文记在内存 records 里，
 *   `stop()` / 关档时逐条还原（与 apply/time.js 同一套「幂等 + 可逆」纪律）。
 *
 * ── logo ───────────────────────────────────────────────────────────
 *   SVG 矢量字没法改文本 ⇒ 整体接管：锚内 SVG 换成 `SpecBase` 中性文字标
 *   （颜色走 var(--w-main)，深浅主题都成立），aria-label "Weibo" 一并改掉
 *   （也是品牌泄漏点）。原文节点存 records，可完整还原。
 *   定位用已验证的唯一属性锚 `a[href="/"][aria-label]`，且 aria-label 必须
 *   匹配 Weibo/微博 才动手 —— 不匹配就跳过（防误伤）。
 *
 * ── 性能 ───────────────────────────────────────────────────────────
 *   每轮扫描全文档走一遍（文本节点递归收集 + 属性四元组查询）。信息流是
 *   虚拟列表（常驻节点几十个），全页文本节点量千级，单轮亚毫秒到几毫秒。
 *   调度层只 observe childList/characterData ⇒ 我方写文本/属性不会自触发。
 */

/** 中性身份词（§7.5-G：与 L0 title/favicon 同一套，禁用 "Wiki" 字样） */
export const LOGO_WORD = 'SpecBase';

/**
 * 文本节点改写规则（**整段匹配**，按序取首个命中）。
 * ⚠️ 不变量：每条规则的输出不得再命中任何规则（幂等的根基，tests 守着）。
 */
export const BRAND_TEXT_RULES = [
  { re: /^最新微博$/, to: '最新' },          // 右侧栏 tab（probeBrand 唯一可见 chrome 文本）
  { re: /^原微博$/, to: '原文' },            // 转发条链接标签
  { re: /^来自 微博(.+)$/, to: '来自 $1' },  // 卡 header 来源行（网页版 / 视频号 / bb机…）
];

/**
 * 属性改写规则（title / aria-label / placeholder / alt）。
 * `badgeOnly: true` = 仅当元素带徽章特征时才生效（库类 woo-icon-* 或哈希
 * 前缀 _icon_/_fans_/_verify_）—— 防「去掉微博前缀」误伤任意 title。
 */
export const BRAND_ATTR_RULES = [
  { attr: 'placeholder', re: /^搜索微博$/, to: '搜索' },
  { attr: 'title', re: /^最新微博$/, to: '最新' },
  { attr: 'title', re: /^发微博$/, to: '发布' },
  { attr: 'aria-label', re: /^发微博$/, to: '发布' },
  { attr: 'title', re: /^定时微博$/, to: '定时发布' },
  { attr: 'alt', re: /^定时微博$/, to: '定时发布' },
  { attr: 'title', re: /^来自 微博(.+)$/, to: '来自 $1' },
  { attr: 'aria-label', re: /^Weibo$/i, to: LOGO_WORD },  // logo 锚（也兜其他潜在同名点）
  { attr: 'title', re: /^微博(.+)$/, to: '$1', badgeOnly: true },  // 徽章 tooltip 去前缀
];

/** 徽章特征：库类直接认；哈希前缀按 classList 逐项判（JS 运行时可以，CSS 选择器不行） */
function isBadgeEl(el) {
  if (!el || typeof el.getAttribute !== 'function') return false;
  const cls = el.getAttribute('class') || '';
  const parts = cls.split(/\s+/);
  for (let i = 0; i < parts.length; i++) {
    const c = parts[i];
    if (c === 'woo-icon-wrap' || c === 'woo-icon-opacity') return true;
    if (/^_(icon|fans|verify)_/.test(c)) return true;
  }
  return false;
}

/** 规则是否允许作用在该元素上 */
function ruleAllows(rule, el) {
  return !rule.badgeOnly || isBadgeEl(el);
}

/** 展开替换模板里的 $1 —— 直接用 String.replace(re, to)，无需自写 */

/**
 * 纯函数：一个文本节点值的目标改写（无命中 ⇒ null）。测试与扫描共用。
 */
export function brandTextTarget(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (!t) return null;
  for (let i = 0; i < BRAND_TEXT_RULES.length; i++) {
    const rule = BRAND_TEXT_RULES[i];
    if (rule.re.test(t)) return t.replace(rule.re, rule.to);
  }
  return null;
}

/**
 * 纯函数：一个属性值的目标改写（无命中 / 规则不允许该元素 ⇒ null）。
 */
export function brandAttrTarget(attr, value, el) {
  if (typeof value !== 'string' || !value) return null;
  const v = value.trim();
  if (!v) return null;
  for (let i = 0; i < BRAND_ATTR_RULES.length; i++) {
    const rule = BRAND_ATTR_RULES[i];
    if (rule.attr !== attr) continue;
    if (rule.re.test(v) && ruleAllows(rule, el)) return v.replace(rule.re, rule.to);
  }
  return null;
}

/* ── 会话内改写台账（还原 / 计数用；不落盘，刷新即清 —— 与「最近命中」同纪律） ── */
const records = [];

/** 递归收集文本节点（跳过 script/style；不用 TreeWalker —— linkedom 支持面不确定） */
function collectTextNodes(root, out) {
  const kids = root.childNodes;
  if (!kids) return;
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    // nodeType：3 = TEXT，1 = ELEMENT（字面量，不依赖 Node 常量在 linkedom 的挂法）
    if (n.nodeType === 3) {
      const p = n.parentElement;
      const tag = p ? p.tagName : '';
      if (tag !== 'SCRIPT' && tag !== 'STYLE') out.push(n);
    } else if (n.nodeType === 1) {
      collectTextNodes(n, out);
    }
  }
}

/** logo 锚：唯一属性锚 `a[href="/"][aria-label]` + aria-label 校验（Weibo/微博 才认） */
function findLogoAnchor(doc) {
  if (!doc.querySelectorAll) return null;
  let list;
  try {
    list = doc.querySelectorAll('a[href="/"][aria-label]');
  } catch (_e) {
    return null;
  }
  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    const label = (el.getAttribute('aria-label') || '').trim();
    if (/^weibo$/i.test(label) || label.indexOf('微博') !== -1) return el;
  }
  return null;
}

const LOGO_SPAN_MARK = 'data-spb-brand-logo';
const LOGO_SPAN_STYLE = 'font:600 18px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;'
  + 'color:var(--w-main);letter-spacing:.5px;';

/** logo 整体接管（幂等；原文节点与 aria-label 记入 records） */
function applyLogo(doc) {
  const anchor = findLogoAnchor(doc);
  if (!anchor || !anchor.querySelector) return false;
  if (anchor.querySelector('[' + LOGO_SPAN_MARK + ']')) return false; // 已是我方文字标

  const nodes = [];
  const kids = anchor.childNodes;
  if (kids) for (let i = 0; i < kids.length; i++) nodes.push(kids[i]);
  const label = anchor.getAttribute('aria-label');

  const span = doc.createElement('span');
  span.setAttribute(LOGO_SPAN_MARK, '1');
  span.setAttribute('style', LOGO_SPAN_STYLE);
  span.textContent = LOGO_WORD;

  while (anchor.firstChild) anchor.removeChild(anchor.firstChild);
  anchor.appendChild(span);
  anchor.setAttribute('aria-label', LOGO_WORD);

  records.push({ kind: 'logo', anchor, nodes, label });
  return true;
}

/** 还原 logo（records 驱动） */
function restoreLogo(record) {
  const { anchor, nodes, label } = record;
  if (!anchor || !anchor.parentNode) return; // 锚已被微博换掉 ⇒ 无可还原
  const mine = anchor.querySelector('[' + LOGO_SPAN_MARK + ']');
  if (mine) anchor.removeChild(mine);
  for (let i = 0; i < nodes.length; i++) anchor.appendChild(nodes[i]);
  if (label !== null) anchor.setAttribute('aria-label', label);
}

/**
 * 一轮品牌文案改写 / 还原（**幂等**）。
 *
 * @param {Document|Element} doc  扫描根（全页；chrome 在卡片外，不能逐卡扫）
 * @param {boolean} on true = 改写；false = 还原本轮之前已改写的
 * @returns {{textChanged:number, attrChanged:number, logo:number, restored:number}}
 */
export function applyBrandText(doc, on) {
  const out = { textChanged: 0, attrChanged: 0, logo: 0, restored: 0 };
  const root = doc && (doc.body || doc.documentElement || doc);
  if (!root) return out;

  if (!on) return Object.assign(out, { restored: restoreBrandText(doc) });

  // ① logo 文字标 —— 必须在属性改写**之前**：findLogoAnchor 靠 aria-label "Weibo"
  //    认锚，属性规则先把 aria-label 改成 SpecBase 的话锚就丢了（2026-10-16 自测抓到）。
  if (applyLogo(doc)) out.logo++;

  // ② 文本节点
  const texts = [];
  collectTextNodes(root, texts);
  for (let i = 0; i < texts.length; i++) {
    const node = texts[i];
    const target = brandTextTarget(node.nodeValue);
    if (target === null || node.nodeValue === target) continue;
    records.push({ kind: 'text', node, original: node.nodeValue });
    node.nodeValue = target;
    out.textChanged++;
  }

  // ② 属性（title / aria-label / placeholder / alt）
  let els;
  try {
    els = root.querySelectorAll('[title],[aria-label],[placeholder],[alt]');
  } catch (_e) {
    els = [];
  }
  const ATTRS = ['title', 'aria-label', 'placeholder', 'alt'];
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    for (let a = 0; a < ATTRS.length; a++) {
      const attr = ATTRS[a];
      const value = el.getAttribute(attr);
      if (value === null) continue;
      const target = brandAttrTarget(attr, value, el);
      if (target === null || value === target) continue;
      records.push({ kind: 'attr', el, attr, original: value });
      el.setAttribute(attr, target);
      out.attrChanged++;
    }
  }

  return out;
}

/**
 * 全量还原（`stop()` / 关档兜底）。逐条按台账还原；条目对应的节点可能已被
 * 微博重渲染替换掉 —— 还原动作对游离节点无害，直接跳过。
 * @returns {number} 还原条数
 */
export function restoreBrandText(_doc) {
  let n = 0;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    try {
      if (r.kind === 'text') {
        if (r.node && typeof r.node.nodeValue === 'string') r.node.nodeValue = r.original;
      } else if (r.kind === 'attr') {
        if (r.el && typeof r.el.setAttribute === 'function') {
          if (r.original === null) r.el.removeAttribute(r.attr);
          else r.el.setAttribute(r.attr, r.original);
        }
      } else if (r.kind === 'logo') {
        restoreLogo(r);
      }
      n++;
    } catch (_e) { /* 单条失败不影响其余 */ }
  }
  records.length = 0;
  return n;
}

/** 当前存活的改写条数（诊断 / stats 用） */
export function countBrandText() {
  return records.length;
}
