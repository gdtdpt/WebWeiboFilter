/**
 * SpecBase Helper · DOM 快照离线分析器（M0 交付物之三：结构报告）
 * =============================================================
 * 输入：recon.js 的 `saveSnapshot()` 产物（真实页面 HTML）
 * 输出：① class 词汇表（稳定 / 构建哈希 / 外部注入）
 *       ② 逐卡对照表（每张卡的类型修饰符 + 内容特征 + 广告线索）—— 用来判「哪些是广告卡」
 *       ③ 卡片层级骨架 · ④ 帖子 ID 线索
 *
 * 用法：
 *   node tools/recon/analyze-snapshot.mjs <snapshot.html> [report.json]
 *
 * 纯正则、零依赖（不引 jsdom）：只为「看结构」，不追求完整 DOM 语义。
 */

import { readFileSync, writeFileSync } from 'node:fs';

const VOID_TAGS = new Set([
  'img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'track', 'wbr', 'area', 'base', 'col', 'embed', 'param',
  // SVG
  'path', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'use', 'stop', 'image', 'mask', 'feBlend',
  'feColorMatrix', 'feOffset', 'feGaussianBlur', 'animate', 'animateTransform',
]);

const MARKERS = [
  '推广', '广告', '荐读', '热门', '赞助', '置顶', '微博广告', 'Sponsored', 'Promoted', '关注推荐', '推荐阅读',
];

/**
 * class 令牌分类（§12-B4 的结论）：
 *   stable   —— 微博稳定输出的类名，可作选择器锚点
 *   hashed   —— 构建时哈希类名（_name_hash_lineno），**禁止**写进选择器
 *   injected —— ⚠️ 非微博所有：同一次构建下时有时无（`__yawf_*`），是**运行时被外部脚本注入**的，绝不能依赖
 */
function classifyToken(t) {
  if (/^__yawf_/.test(t)) return 'injected';
  if (/^wbpro[-_]/.test(t)) return 'stable';
  if (/^woo-/.test(t)) return 'stable';
  if (/^vue-/.test(t)) return 'stable';
  if (/^vjs-/.test(t)) return 'stable';
  if (/^_[A-Za-z0-9-]+_[a-z0-9]{4,}_\d+$/.test(t)) return 'hashed';
  return 'other';
}

function stripCode(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
}

function plainText(fragment) {
  return stripCode(fragment).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function collectClasses(html) {
  const counts = new Map();
  const re = /class="([^"]*)"/g;
  let m;
  while ((m = re.exec(html))) for (const t of m[1].split(/\s+/)) if (t) counts.set(t, (counts.get(t) || 0) + 1);
  const byCat = { stable: [], hashed: [], injected: [], other: [] };
  for (const [t, n] of counts) byCat[classifyToken(t)].push({ token: t, count: n });
  for (const k of Object.keys(byCat)) byCat[k].sort((a, b) => b.count - a.count);
  return byCat;
}

/** 逐卡对照表 —— 回答「哪些是广告卡」的核心视图 */
function cardRows(html, limit = 20) {
  const segs = html.split(/<div[^>]*class="[^"]*vue-recycle-scroller__item-view[^"]*"[^>]*>/);
  const rows = [];
  for (let i = 1; i < segs.length && rows.length < limit; i++) {
    const seg = segs[i];
    const artTag = (seg.match(/<article[^>]*>/) || [''])[0];
    const artClass = (artTag.match(/class="([^"]*)"/) || [, ''])[1];
    const mods = artClass.split(/\s+/).filter((t) => classifyToken(t) === 'hashed');
    const text = plainText(seg);
    rows.push({
      n: rows.length + 1,
      articleMods: mods,
      markers: MARKERS.filter((w) => text.includes(w)),
      img: (seg.match(/<img/g) || []).length,
      video: (seg.match(/<video/g) || []).length,
      ogText: seg.includes('wbpro-feed-ogText'),
      reText: seg.includes('wbpro-feed-reText'),
      textSample: text.slice(0, 72),
    });
  }
  return rows;
}

/** 汇总「卡片类型修饰符」的分布 —— 少数派就是嫌疑广告卡 */
function modifierHistogram(rows) {
  const hist = new Map();
  for (const r of rows) {
    const key = r.articleMods.join(' ') || '(none)';
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  return [...hist.entries()].map(([mods, count]) => ({ mods, count })).sort((a, b) => b.count - a.count);
}

/** 把 HTML 片段展开成「层级骨架」：只保留稳定 class 的节点 */
function outline(fragment, opts = {}) {
  const maxLines = opts.maxLines || 60;
  const lines = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let depth = 0;
  let m;
  while ((m = tagRe.exec(fragment)) && lines.length < maxLines) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    if (closing) { depth = Math.max(0, depth - 1); continue; }
    const selfClose = /\/\s*$/.test(attrs) || VOID_TAGS.has(tag);
    const cls = (attrs.match(/class="([^"]*)"/) || [, ''])[1];
    const stable = cls.split(/\s+/).filter((t) => classifyToken(t) === 'stable');
    const hashed = cls.split(/\s+/).filter((t) => classifyToken(t) === 'hashed');
    if (stable.length) lines.push({ depth, tag, stable, hashedCount: hashed.length });
    if (!selfClose) depth++;
  }
  return lines;
}

function collectHrefs(fragment) {
  const set = new Map();
  const re = /href="([^"]*)"/g;
  let m;
  while ((m = re.exec(fragment))) set.set(m[1], (set.get(m[1]) || 0) + 1);
  return [...set.entries()].map(([href, count]) => ({ href, count }));
}

/** 帖子 ID 线索：新微博卡片的稳定 ID = 时间链接 `https://weibo.com/<uid>/<bid>` 里的 bid */
function postIdHints(html) {
  const hints = [];
  const patterns = [
    ['time-link(uid/bid)', /href="(https?:\/\/weibo\.com\/\d+\/[A-Za-z0-9]{5,})"/g],
    ['detail-link', /href="([^"]*\/(?:detail|status)\/[A-Za-z0-9]+[^"]*)"/g],
    ['attr-mid', /\s(?:mid|data-mid|data-id|data-bid)="([^"]*)"/g],
  ];
  for (const [kind, re] of patterns) {
    const found = new Set();
    let m;
    while ((m = re.exec(html))) found.add(m[1].slice(0, 120));
    if (found.size) hints.push({ kind, total: found.size, samples: [...found].slice(0, 5) });
  }
  return hints;
}

// ---- main -----------------------------------------------------------------------------------

const [, , file, outFile] = process.argv;
if (!file) {
  console.error('用法: node tools/recon/analyze-snapshot.mjs <snapshot.html> [report.json]');
  process.exit(1);
}

const html = readFileSync(file, 'utf8');
const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [, ''])[1].trim();
const segs = html.split(/<div[^>]*class="[^"]*vue-recycle-scroller__item-view[^"]*"[^>]*>/);

const rows = cardRows(html);
const report = {
  source: file,
  sizeKB: Math.round(html.length / 1024),
  title,
  markerCounts: Object.fromEntries(MARKERS.map((w) => [w, (html.split(w).length - 1)])),
  injectedTokenPresent: html.includes('__yawf_'),
  classVocabulary: collectClasses(html),
  cards: rows,
  modifierHistogram: modifierHistogram(rows),
  hrefs: collectHrefs(html).sort((a, b) => b.count - a.count).slice(0, 15),
  postIdHints: postIdHints(html),
  firstCardOutline: outline(segs[1] || '', { maxLines: 50 }),
};

// ---- 终端输出（人读）------------------------------------------------------------------------

const line = (s = '') => console.log(s);
line('='.repeat(78));
line(`结构报告  ${file}`);
line(`标题: ${title}   ·   体积: ${report.sizeKB} KB   ·   卡片数: ${rows.length}`);
line('='.repeat(78));

line('\n【广告线索】');
const nonZero = Object.entries(report.markerCounts).filter(([, n]) => n > 0);
line('  marker 文案: ' + (nonZero.length ? nonZero.map(([w, n]) => `${w}=${n}`).join('  ') : '全 0 —— 本快照不含带广告文案的卡'));
report.modifierHistogram.forEach((h) => line(`  类型修饰符  ${h.mods}  ×${h.count}`));

line('\n【逐卡对照表】');
line('  #  图 视 正文 转发  类型修饰符                       文案线索     正文片段');
for (const r of rows) {
  line(
    '  ' + String(r.n).padEnd(3) +
    String(r.img).padEnd(3) + String(r.video).padEnd(3) +
    (r.ogText ? '✓ ' : '– ') + '  ' + (r.reText ? '✓ ' : '– ') + '   ' +
    r.articleMods.join(' ').padEnd(32) +
    (r.markers.join(',') || '–').padEnd(13) +
    r.textSample
  );
}

line('\n【class 词汇表】');
line('  stable  : ' + report.classVocabulary.stable.slice(0, 20).map((x) => `${x.token}(${x.count})`).join(' '));
line('  hashed  : ' + report.classVocabulary.hashed.slice(0, 10).map((x) => `${x.token}(${x.count})`).join(' '));
line('  injected: ' + (report.classVocabulary.injected.length
  ? `⚠️ 存在 ${report.classVocabulary.injected.length} 个 __yawf_* 令牌 —— 非微博所有（外部脚本运行时注入），禁止依赖`
  : '无'));
line('  ⛔ hashed 类名含构建哈希（如 _num_198pe_46）—— 禁止写进选择器。');

line('\n【帖子 ID 线索】');
line(report.postIdHints.length ? report.postIdHints.map((h) => `${h.kind}(${h.total})  e.g. ${h.samples[0]}`).join('\n') : '  （未找到）');

line('\n【首卡层级骨架】(缩进=层级, 只列稳定 class)');
for (const n of report.firstCardOutline) {
  line('  ' + '  '.repeat(n.depth) + `<${n.tag}> ` + n.stable.join(' ') + (n.hashedCount ? ` [+${n.hashedCount} hashed]` : ''));
}

if (outFile) {
  writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');
  line(`\n[analyze] JSON 已写出：${outFile}`);
}
