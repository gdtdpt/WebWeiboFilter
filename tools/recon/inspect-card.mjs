#!/usr/bin/env node
/**
 * A0 取样（离线）—— 解析真机快照，把**卡片内部结构**打印成树，为「隐藏统计行 / 隐藏互动按钮行」
 * 以及 L2 重排定锚点。
 *
 * 为什么离线做：锚点是**结构**信息（class 层级），静态快照里就有，不必来回跑真机。
 * 真机只在最后验收时用（量「藏了之后卡片矮多少 / 有没有洞」）。
 *
 * 用法：
 *   node tools/recon/inspect-card.mjs              # 打印结构树 + 结构指纹（默认 maxDepth=4）
 *   node tools/recon/inspect-card.mjs -d 6         # 看得更深
 *   node tools/recon/inspect-card.mjs --json       # 额外落一份 JSON 到 fixtures/（便于回看）
 *
 * 约定：`class` 里 `<下划线><单词>_<hash>_<行号>` 形态的是**构建哈希**（不可锚），
 * 脚本会把它标成 `«hash»`；`woo-* / wbpro-* / vjs-* / vue-*` 是**库前缀**（可锚）。
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let parseHTML = null;
try {
  ({ parseHTML } = await import('linkedom'));
} catch (_e) {
  console.error('需要 linkedom：请在仓库根跑 npm install');
  process.exit(1);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const FIX = join(ROOT, 'tests', 'fixtures');

const argv = process.argv.slice(2);
const MAX_DEPTH = (() => {
  const i = argv.findIndex((a) => a === '-d' || a === '--depth');
  return i >= 0 ? Number(argv[i + 1]) || 4 : 4;
})();
const WANT_JSON = argv.includes('--json');
/** `--find <文本>`：定位「含该文本的最深层元素」，打印祖先链 + 子树（用来找「N 人赞过」这类锚点） */
const FIND = (() => {
  const i = argv.findIndex((a) => a === '--find');
  return i >= 0 ? argv[i + 1] : null;
})();

const CLIP = 130;
const TXT = 26;

const getAttr = (el, n) => (el && el.getAttribute ? el.getAttribute(n) || '' : '');
const tagOf = (el) => String((el && el.tagName) || '').toLowerCase();

/** 库类名（可锚）：woo-* / wbpro-* / vue-* / vjs_* … */
const LIB_SEG = /^(woo|wbpro|vue|vjs|Woo|Wbpro|Vue|Vjs)/;
/** 第三方脚本注入的语义别名（**不可锚**：用户卸掉那个脚本就没了）—— 快照里是 `__yawf_*` */
const EXTERNAL_SEG = /^__/;
/**
 * 构建哈希类名（**不可锚**）：微博 vue 组件编译产物，形态 `_name_<短hash>_<行号>`，
 * 且**名字自带下划线**（`_content_wrap_ygi5b_114`）⇒ 不能只按「三段」判。
 * 库前缀必须优先排除 —— 否则 `vjs_video_3` 会被误判成哈希（它是 video.js 的真类名）。
 */
const isHashSeg = (s) => !LIB_SEG.test(s) && !EXTERNAL_SEG.test(s) && /_[a-z0-9]{4,8}_\d+$/.test(s);
const isExternalSeg = (s) => EXTERNAL_SEG.test(s);

function labelOf(el) {
  const c = getAttr(el, 'class').trim();
  const id = getAttr(el, 'id');
  let s = tagOf(el);
  if (id) s += '#' + id;
  if (c) {
    const parts = c.split(/\s+/).map((p) => {
      if (isExternalSeg(p)) return '⛔' + p.replace(/^_+/, '');
      if (isHashSeg(p)) return '«hash»';
      return p;
    });
    s += '.' + parts.join('.');
  }
  return s.length > CLIP ? s.slice(0, CLIP) + '…' : s;
}

function textOf(el) {
  const t = String(el.textContent || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return ' «' + (t.length > TXT ? t.slice(0, TXT) + '…' : t) + '»';
}

/** 这个元素自身（不含后代）的直接文本 */
function ownTextOf(el) {
  let s = '';
  for (const n of el.childNodes || []) {
    if (n.nodeType === 3 || n.nodeType === 4) s += n.textContent || '';
  }
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return '{' + (s.length > TXT ? s.slice(0, TXT) + '…' : s) + '}';
}

function walk(el, depth, lines, prefix) {
  const kids = Array.from(el.children || []);
  const mark = kids.length ? ` [${kids.length}]` : '';
  lines.push(prefix + labelOf(el) + mark + ownTextOf(el) + (kids.length ? '' : textOf(el)));
  if (depth >= MAX_DEPTH) {
    if (kids.length) {
      lines.push(prefix + '  └ …（更深 ' + kids.length + ' 个子块）');
    }
    return;
  }
  for (const k of kids) walk(k, depth + 1, lines, prefix + '  ');
}

/** 结构指纹：只取 class 的「可锚部分」（库前缀 + 标签名），哈希段统一成 «hash» —— 用来判断「结构是否一致」 */
function structuralShape(el, depth, max) {
  const c = getAttr(el, 'class')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => (isHashSeg(p) ? '«hash»' : p))
    .sort()
    .join('.');
  const self = tagOf(el) + (c ? '.' + c : '');
  if (depth >= max) return self;
  const kids = Array.from(el.children || []).map((k) => structuralShape(k, depth + 1, max));
  return kids.length ? self + '(' + kids.join(',') + ')' : self;
}

/** class 词频：整体统计「哪些类名可用作锚」 */
function classStats(el, acc) {
  const c = getAttr(el, 'class').trim();
  if (c) {
    for (const p of c.split(/\s+/)) {
      if (!p) continue;
      const key = isHashSeg(p) ? '«hash»' : isExternalSeg(p) ? '«⛔外部脚本注入·不可锚»' : p;
      acc.set(key, (acc.get(key) || 0) + 1);
    }
  }
  for (const k of Array.from(el.children || [])) classStats(k, acc);
  return acc;
}

/** `--only <子串>`：只分析文件名含该子串的快照（调试时省得刷屏） */
const ONLY = (() => {
  const i = argv.findIndex((a) => a === '--only');
  return i >= 0 ? argv[i + 1] : null;
})();

const files = existsSync(FIX)
  ? readdirSync(FIX)
      .filter((f) => /^snapshot-.*\.html$/.test(f))
      .filter((f) => !ONLY || f.includes(ONLY))
      .sort()
  : [];

if (!files.length) {
  console.error('没找到 snapshot-*.html 夹具（tests/fixtures/ 下）。');
  process.exit(1);
}

const dump = { generatedAt: new Date().toISOString(), maxDepth: MAX_DEPTH, fixtures: [] };

for (const f of files) {
  const html = readFileSync(join(FIX, f), 'utf8');
  const { document } = parseHTML(html);

  const arts = Array.from(document.querySelectorAll('article'));
  const cards = arts.filter((a) => {
    // 只取「信息流里的卡」：祖先链上有 .wbpro-scroller-item 或 .vue-recycle-scroller
    let p = a.parentElement;
    while (p) {
      const c = getAttr(p, 'class');
      if (/wbpro-scroller-item|vue-recycle-scroller/.test(c)) return true;
      p = p.parentElement;
    }
    return false;
  });

  const shapeCount = new Map();
  const footChildCount = new Map();
  const acc = new Map();

  for (const a of cards) {
    const sh = structuralShape(a, 0, 3);
    shapeCount.set(sh, (shapeCount.get(sh) || 0) + 1);
    classStats(a, acc);
    const foot = Array.from(a.children).find((c) => tagOf(c) === 'footer');
    if (foot) {
      const n = foot.children.length;
      footChildCount.set(n, (footChildCount.get(n) || 0) + 1);
    }
  }

  console.log('\n' + '='.repeat(78));
  console.log(`# ${f}  —— article ${arts.length} 个，其中信息流卡 ${cards.length} 张`);
  console.log('='.repeat(78));

  // ① footer 直接子块数量分布
  console.log('\n## ① 每张卡 `article > footer` 的直接子块数分布');
  for (const [n, cnt] of [...footChildCount.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`   ${n} 个子块 × ${cnt} 张卡`);
  }

  // ② 结构指纹去重
  console.log('\n## ② 结构指纹（前三层）—— 有几种形态');
  console.log(`   共 ${shapeCount.size} 种形态（共 ${cards.length} 张卡）`);
  let idx = 0;
  for (const [sh, cnt] of [...shapeCount.entries()].sort((a, b) => b[1] - a[1])) {
    idx++;
    const short = sh.length > 900 ? sh.slice(0, 900) + '…' : sh;
    console.log(`   [形态${idx}] ${cnt} 张卡：${short}`);
    if (idx >= 4) {
      console.log('   …（更多形态略）');
      break;
    }
  }

  // ③ 第一张卡的结构树
  if (cards.length) {
    console.log(`\n## ③ 第 1 张卡的结构树（深度 ≤ ${MAX_DEPTH}；«hash» = 构建哈希，不可锚；{…} = 本节点直连文本）`);
    const lines = [];
    walk(cards[0], 0, lines, '   ');
    console.log(lines.join('\n'));
    console.log(`\n## ③b 第 1 张卡的 \`article > footer\` 子树`);
    const foot = Array.from(cards[0].children).find((c) => tagOf(c) === 'footer');
    if (foot) {
      const fl = [];
      walk(foot, 0, fl, '   ');
      console.log(fl.join('\n'));
    } else {
      console.log('   （这张卡没有 footer）');
    }
  }

  // ④ class 词频 top
  console.log('\n## ④ 卡内 class 词频（前 30，«hash» 是构建哈希的合计）');
  const top = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  console.log('   ' + top.map(([k, v]) => `${k}×${v}`).join('  '));

  // ⑤ 按文本定位（--find）
  if (FIND) {
    console.log(`\n## ⑤ 文本定位：「${FIND}」（只列最深层命中，即自身不含该文本的后代）`);
    const all = Array.from(document.querySelectorAll('*'));
    const hits = all.filter(
      (el) =>
        String(el.textContent || '').includes(FIND) &&
        !Array.from(el.children || []).some((k) => String(k.textContent || '').includes(FIND))
    );
    console.log(`   全文档最深命中 ${hits.length} 个`);
    hits.slice(0, 3).forEach((el, i) => {
      const chain = [];
      let p = el;
      while (p && tagOf(p) !== 'article') {
        chain.unshift(labelOf(p));
        p = p.parentElement;
      }
      if (p) chain.unshift('article  ← 卡根');
      console.log(`\n   [命中 ${i + 1}] 祖先链（从卡根往下）：`);
      chain.forEach((c, j) => console.log('      ' + '  '.repeat(j) + c));
      console.log('      自身子树：');
      const l = [];
      walk(el, 0, l, '      ');
      console.log(l.join('\n'));
    });
  }

  dump.fixtures.push({
    file: f,
    articleCount: arts.length,
    cardCount: cards.length,
    footChildCount: Object.fromEntries(footChildCount),
    shapes: shapeCount.size,
    classTop: Object.fromEntries(top),
  });
}

if (WANT_JSON) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const name = `card-structure-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
  writeFileSync(join(FIX, name), JSON.stringify(dump, null, 2));
  console.log(`\n已落盘：tests/fixtures/${name}`);
}
