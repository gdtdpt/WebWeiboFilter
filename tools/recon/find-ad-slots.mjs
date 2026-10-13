/**
 * find-ad-slots.mjs —— 离线「广告位定位器」（M0 侦察工具之一）
 *
 * 输入：一份微博 DOM 快照 HTML（tests/fixtures/snapshot-*.html）
 * 输出（stdout）：页面上所有广告位/推广卡的精确位置、祖先链与**稳定签名**。
 *
 * 为什么单独写：`analyze-snapshot.mjs` 是正则驱动的粗粒度「体检」，
 * 无法回答「这个节点的第 N 级祖先是谁」。本工具用 parse5 建真 DOM 树，
 * 因此可以做祖先链、深度、兄弟序号这类精确查询。
 *
 * 用法：
 *   node tools/recon/find-ad-slots.mjs tests/fixtures/snapshot-xxx.html
 *   node tools/recon/find-ad-slots.mjs tests/fixtures/snapshot-xxx.html --json out.json
 *
 * 依赖：parse5（devDependency，只在开发机跑；用户侧零依赖）
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'parse5';

// ---------------------------------------------------------------- 常量

/** 微博广告投放 CDN —— 出现在 img/src 里即为强广告信号 */
const AD_CDN = [
  'kadmimage.biz.weibo.com',   // 广告图（首页顶部 banner 实测来源）
  'kadm.biz.weibo.com',
  'ad.sina.com.cn',
  'sax.sina.com.cn',
  'sinaads',
];

/** 广告跳转埋点 —— 出现在 href 里即为强广告信号（实测：自然卡用 h5/goods，广告卡用 h5/sclick+mark_ad） */
const AD_HREF_MARKERS = [
  'reallog_mark_ad',
  'mark_ad=',
  '/h5/sclick/',
  'spm_mark=',
];

/** 卡片头部可能出现「广告 / 推广 / 荐读」标签的稳定容器类名 */
const TAG_CLASS_RE = /(^|\s)wbpro-tag(-|$|\s)/;

/** 已知自然内容的图片 CDN（用于反向发现「不属于任何已知自然来源」的图） */
const NATURAL_IMG_HOSTS = /(^|\.)(sinaimg\.cn|sinajs\.cn|weibo\.com|weibo\.cn|sina\.com\.cn|geetest\.com|126\.net)$/;

/** 构建哈希类名：_name_hash_lineno，如 _wrap_ecgcn_2 / _followbtn_1sy5n_2 / _num_198pe_46 */
const HASHED_CLASS_RE = /^_[A-Za-z][A-Za-z0-9]*_[a-z0-9]{5}_\d+$/;

// ---------------------------------------------------------------- DOM 助手

function attr(node, name) {
  const a = node.attrs?.find((x) => x.name === name);
  return a ? a.value : null;
}
function tagOf(node) {
  return node.tagName || node.nodeName || '?';
}
function classesOf(node) {
  const c = attr(node, 'class');
  return c ? c.trim().split(/\s+/).filter(Boolean) : [];
}
function stableClasses(node) {
  return classesOf(node).filter((c) => !HASHED_CLASS_RE.test(c));
}
function hashedClasses(node) {
  return classesOf(node).filter((c) => HASHED_CLASS_RE.test(c));
}

/** 单行签名：tag + #id + 稳定 class（+ 哈希数量） */
function sig(node) {
  if (!node.tagName) return `(${node.nodeName})`;
  let s = tagOf(node);
  const id = attr(node, 'id');
  if (id) s += `#${id}`;
  const sc = stableClasses(node);
  if (sc.length) s += '.' + sc.join('.');
  const hc = hashedClasses(node);
  if (hc.length) s += `  [+${hc.length} hashed: ${hc.join(' ')}]`;
  return s;
}

/** 从 html 到 node 的祖先链（含 node 自身），带深度 */
function chainOf(node) {
  const out = [];
  let cur = node;
  while (cur) {
    out.unshift(cur);
    cur = cur.parentNode && cur.parentNode.tagName ? cur.parentNode : null;
  }
  return out;
}

/** 深度优先遍历所有元素节点 */
function walk(node, fn, depth = 0) {
  for (const child of node.childNodes || []) {
    if (child.tagName) {
      fn(child, depth);
      walk(child, fn, depth + 1);
    } else {
      walk(child, fn, depth);
    }
  }
}

function textOf(node) {
  let s = '';
  (function rec(n) {
    for (const c of n.childNodes || []) {
      if (c.nodeName === '#text') s += c.value;
      else if (c.tagName) rec(c);
    }
  })(node);
  return s.replace(/\s+/g, ' ').trim();
}

/** 取 node 的「自顶向下缩进祖先链」文本 */
function renderChain(node, { withSelf = true } = {}) {
  const chain = chainOf(node);
  const lines = [];
  for (let i = 0; i < chain.length; i++) {
    if (!withSelf && i === chain.length - 1) break;
    const indent = '  '.repeat(i);
    const mark = i === chain.length - 1 ? ' ← ' : '   ';
    lines.push(`${indent}${mark}${sig(chain[i])}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- 主体

function analyze(html) {
  const doc = parse(html);
  const root = doc;

  const report = {
    adImages: [],      // 广告 CDN 图片
    adLinks: [],       // 带广告埋点的链接
    tagSlots: [],      // 卡片头部标签槽（广告/推广/荐读）
    followButtons: [], // 卡内「关注」按钮（未关注账号 = 可能是被插入的推广/推荐）
    unknownImages: [], // 不属于任何已知自然 CDN 的图片
    suspiciousClasses: [],
    scrollerCss: [],
    stat: {},
  };

  // ---- 1. 广告 CDN 图片
  walk(root, (node) => {
    if (tagOf(node) !== 'img') return;
    const src = attr(node, 'src') || attr(node, 'data-src') || '';
    const hit = AD_CDN.find((d) => src.includes(d));
    if (!hit) return;
    report.adImages.push({
      host: hit,
      src: src.slice(0, 200),
      alt: attr(node, 'alt'),
      cls: attr(node, 'class'),
      depth: chainOf(node).length,
      chain: renderChain(node),
    });
  });

  // ---- 2. 带广告埋点的链接
  walk(root, (node) => {
    if (tagOf(node) !== 'a') return;
    const href = attr(node, 'href') || '';
    const hits = AD_HREF_MARKERS.filter((m) => href.includes(m));
    if (!hits.length) return;
    report.adLinks.push({
      markers: hits,
      href: href.slice(0, 260),
      text: textOf(node).slice(0, 60),
      // 该链接所属卡片（最近的 .wbpro-scroller-item）
      chain: renderChain(node),
    });
  });

  // ---- 3. 卡片头部标签槽
  walk(root, (node) => {
    const cls = attr(node, 'class') || '';
    if (!TAG_CLASS_RE.test(cls)) return;
    report.tagSlots.push({
      class: cls,
      text: textOf(node).slice(0, 40),
      chain: renderChain(node),
    });
  });

  // ---- 4. 卡内「关注」按钮
  walk(root, (node) => {
    if (tagOf(node) !== 'button') return;
    const cls = attr(node, 'class') || '';
    if (!/_followbtn_/.test(cls)) return;
    const inCard = chainOf(node).some((n) => classesOf(n).includes('wbpro-scroller-item'));
    report.followButtons.push({
      class: cls,
      text: textOf(node).slice(0, 20),
      inFeedCard: inCard,
      chain: renderChain(node),
    });
  });

  // ---- 5. 非自然 CDN 图片（反向发现未知广告源）
  const hostCount = {};
  walk(root, (node) => {
    if (tagOf(node) !== 'img') return;
    const src = attr(node, 'src') || '';
    const m = /^https?:\/\/([^/]+)/.exec(src);
    if (!m) return;
    const host = m[1];
    hostCount[host] = (hostCount[host] || 0) + 1;
    if (AD_CDN.some((d) => host.includes(d))) return;   // 已在【1】报过
    if (NATURAL_IMG_HOSTS.test(host)) return;
    report.unknownImages.push({ host, src: src.slice(0, 140), chain: renderChain(node) });
  });
  report.stat.imgHosts = Object.entries(hostCount).sort((a, b) => b[1] - a[1]);

  // ---- 6. 疑似广告类名（class 里含 ad/promo/sponsor/recommend）
  const susMap = {};
  walk(root, (node) => {
    for (const c of classesOf(node)) {
      if (/(^|[-_])(ad|ads|advert|promo|sponsor|recommend)([-_]|$)/i.test(c)) {
        susMap[c] = (susMap[c] || 0) + 1;
      }
    }
  });
  report.suspiciousClasses = Object.entries(susMap).sort((a, b) => b[1] - a[1]);

  // ---- 7. 虚拟列表 CSS（回答 B2：隐藏一条会不会留洞）
  const styleText = [];
  walk(root, (node) => {
    if (tagOf(node) === 'style') styleText.push(textOf(node));
  });
  const css = styleText.join('\n');
  const want = [
    '.vue-recycle-scroller__item-wrapper',
    '.vue-recycle-scroller__item-view',
    '.vue-recycle-scroller',
  ];
  for (const sel of want) {
    const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g');
    let m;
    while ((m = re.exec(css)) !== null) {
      report.scrollerCss.push({ sel, body: m[1].replace(/\s+/g, ' ').trim() });
    }
  }
  // 内联 style 里的关键信息
  walk(root, (node) => {
    const cls = attr(node, 'class') || '';
    if (cls.includes('vue-recycle-scroller__item-wrapper')) {
      report.scrollerCss.push({ sel: 'div.vue-recycle-scroller__item-wrapper', body: 'inline: ' + (attr(node, 'style') || '') });
    }
    if (cls.includes('vue-recycle-scroller__item-view')) {
      report.scrollerCss.push({ sel: 'div.vue-recycle-scroller__item-view', body: 'inline: ' + (attr(node, 'style') || '') });
    }
  });

  return report;
}

// ---------------------------------------------------------------- 输出

function printReport(r, file) {
  const L = (s = '') => console.log(s);
  L('='.repeat(78));
  L(`广告位定位报告  ${file}`);
  L('='.repeat(78));

  L('');
  L(`【1】广告 CDN 图片（${r.adImages.length} 处）`);
  if (!r.adImages.length) L('  无');
  for (const a of r.adImages) {
    L(`  ◆ 来源 ${a.host}`);
    L(`    src  = ${a.src}`);
    L(`    alt  = ${a.alt ?? '(无)'}   class = ${a.cls ?? '(无)'}`);
    L('    祖先链（自顶向下，← 为自身）:');
    L(a.chain.split('\n').map((x) => '    ' + x).join('\n'));
  }

  L('');
  L(`【2】带广告埋点的链接（${r.adLinks.length} 处）`);
  if (!r.adLinks.length) L('  无');
  for (const a of r.adLinks.slice(0, 8)) {
    L(`  ◆ 标记 ${a.markers.join(' , ')}   文本「${a.text}」`);
    L(`    ${a.href}`);
    L('    祖先链:');
    L(a.chain.split('\n').map((x) => '    ' + x).join('\n'));
  }
  if (r.adLinks.length > 8) L(`  … 另有 ${r.adLinks.length - 8} 处`);

  L('');
  L(`【3】卡片头部标签槽（${r.tagSlots.length} 处）`);
  if (!r.tagSlots.length) L('  无');
  for (const t of r.tagSlots) {
    L(`  ◆ class="${t.class}"  文本「${t.text}」`);
    L('    祖先链:');
    L(t.chain.split('\n').map((x) => '    ' + x).join('\n'));
  }

  L('');
  L(`【4】卡内「关注」按钮（${r.followButtons.length} 处）`);
  if (!r.followButtons.length) L('  无');
  for (const b of r.followButtons) {
    L(`  ◆ class="${b.class}"  文本「${b.text}」  在信息流卡内: ${b.inFeedCard}`);
    L('    祖先链:');
    L(b.chain.split('\n').map((x) => '    ' + x).join('\n'));
  }

  L('');
  L(`【5】不属于已知自然 CDN 的图片（${r.unknownImages.length} 处）`);
  if (!r.unknownImages.length) L('  无');
  for (const u of r.unknownImages.slice(0, 12)) {
    L(`  ◆ ${u.host}   ${u.src}`);
  }

  L('');
  L('【6】class 里含 ad/promo/sponsor/recommend 的令牌');
  if (!r.suspiciousClasses.length) L('  无');
  for (const [c, n] of r.suspiciousClasses) L(`  ${String(n).padStart(4)}  ${c}`);

  L('');
  L('【7】虚拟列表 CSS（B2：隐藏一条会不会留洞）');
  if (!r.scrollerCss.length) L('  未在内联 <style> 里找到（可能在外部 CSS）');
  for (const s of r.scrollerCss) L(`  ${s.sel} { ${s.body} }`);

  L('');
  L('【8】图片宿主统计');
  for (const [h, n] of r.stat.imgHosts) L(`  ${String(n).padStart(4)}  ${h}`);
  L('');
}

// ---------------------------------------------------------------- CLI

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('用法: node tools/recon/find-ad-slots.mjs <snapshot.html> [--json out.json]');
  process.exit(1);
}
const jsonIdx = args.indexOf('--json');
const jsonOut = jsonIdx !== -1 ? args[jsonIdx + 1] : null;

const html = readFileSync(file, 'utf8');
const report = analyze(html);
printReport(report, file);

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(report, null, 2), 'utf8');
  console.log(`JSON 已写入 ${jsonOut}`);
}
