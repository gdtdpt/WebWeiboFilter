/**
 * L1「素净」的规则守卫（PROJECT.md §7.5 第一批 · 零高度影响子集）
 *
 * 这个文件测的不是"CSS 长什么样"，而是**两条纪律**（它们比具体规则值钱得多）：
 *
 *   ① **零高度影响** —— B2 已证虚拟列表位置来自预计算的 `translateY` 缓存、从不重测尺寸
 *      ⇒ 这一批任何改动卡片高度的属性都可能留洞 / 漂移。所以用一张「会改尺寸的属性」黑名单
 *      逐条扫描 `l1Css()`：谁不小心写了 `font-size` / `padding` / `border` / `height`，测试立刻红。
 *      （白名单只有一类：**行内叶子图标**的 `display:none` —— 认证角标 `woo-icon*` 与字体图标
 *        `woo-font--*`。它们藏在 flex 行里，父容器高度由行盒 / 内边距决定 ⇒ 期望零布局变化。
 *        ⚠️ `display` 是 2026-10-14 才纳入审查的 —— 此前它**压根不在黑名单里**，是个盲区：
 *        意味着「有人把一个内容块 `display:none` 掉」这类改动**测试拦不住**。
 *        ⚠️ 而「期望零布局变化」≠「已验」：测试环境没有布局引擎 ⇒ **真机验收仍是唯一防线**。）
 *
 *   ② **锚点纪律** —— 选择器里不许出现构建哈希（`_logo_18dhr_77`）或 `__yawf_*`（外部注入）。
 *      这两样一出现，微博改版 / 关掉别的脚本后就静默失效，而且很难查。
 *
 * 另测 `appearanceCss()` 的档位语义（L2 蕴含 L1）与 `ensureStyle()` 的幂等 / 更新行为。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { l1Css, L1_RULE_COUNT, DEFAULT_MEDIA_MAX_H, DEFAULT_MEDIA_GRID_W,
  DEFAULT_TEXT_FONT_SIZE, DEFAULT_TEXT_LINE_HEIGHT } from '../src/features/l1.js';
import { appearanceCss } from '../src/features/appearance.js';
import { composeCss, ensureStyle, FILTER_CSS, STYLE_ID } from '../src/apply/style.js';
import { FIXTURE_DIR, fixtures } from './_fixture-expect.mjs';

let parseHTML = null;
try {
  ({ parseHTML } = await import('linkedom'));
} catch (_e) {
  parseHTML = null;
}

const skipVideo = !fixtures.length
  ? 'fixtures/ 为空（私有不入库）—— 跳过视频规则的真 DOM 校验'
  : (!parseHTML ? 'linkedom 未安装 —— 运行 npm install 后重试' : false);

/** 逐行拆成 {selector, decls:[{prop,value}]}（`l1Css()` 保证一条规则一行） */
function parseRules(css) {
  return css.trim().split('\n').filter(Boolean).map((line) => {
    const open = line.indexOf('{');
    const selector = line.slice(0, open).trim();
    const body = line.slice(open + 1, line.lastIndexOf('}'));
    const decls = body.split(';').filter(Boolean).map((d) => {
      const i = d.indexOf(':');
      return { prop: d.slice(0, i).trim().toLowerCase(), value: d.slice(i + 1).trim() };
    });
    return { selector, decls };
  });
}

/** 会改变盒子尺寸（进而改变项高度）的属性 —— 默认一个都不许出现 */
const SIZE_AFFECTING = [
  'height', 'min-height', 'max-height', 'width', 'min-width', 'max-width',
  'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
  'border', 'border-top', 'border-bottom', 'border-width', 'border-style',
  'font-size', 'font-family', 'line-height', 'letter-spacing', 'word-spacing',
  'position', 'top', 'left', 'right', 'bottom', 'overflow', 'flex', 'order',
  // ⚠️ 2026-10-14 补：`display` 此前不在名单里（盲区）—— 而 `display:none` 掉一个**内容块**
  //    当然是改高度（卡片直接变矮）。现在它会被逐条审查，例外见下面的 SIZE_EXEMPT 登记表。
  'display',
];

/**
 * 改尺寸属性的**登记表** —— 每一条都必须「有名有姓有理由」，测试按条复核：
 *   ① 行内叶子图标的 `display:none`：认证角标 `woo-icon*` / 字体图标 `woo-font--*`
 *      —— 不占行高，父容器尺寸另有来源 ⇒ 期望零布局变化（⚠️ 期望 ≠ 已验，真机仍要量）。
 *   ② `[data-spb="stats"]`（A1 摘要条）整条放行：它是我方**绝对定位浮层**，脱离文档流
 *      ⇒ 建 / 更新 / 摘除永远不改卡片高度（§12-B15）。
 *      ℹ️ 2026-10-15 二轮拍板：A1 footer 从 `display:none` 改回 `visibility:hidden`
 *      （40px 空位保留、摘要条永远落在空位上不遮挡内容）⇒ footer 规则**不再是改高度项**，
 *      此处已除名 —— visibility 不在 SIZE_AFFECTING，本来就不需要登记。
 */
const SIZE_EXEMPT = [
  { sel: /woo-icon|woo-font--/, prop: 'display', val: 'none', why: '行内叶子图标（认证角标 / 字体图标）' },
  { sel: /\.wbpro-scroller-item article$/, prop: 'position', val: 'relative', why: '摘要条定位上下文，不占布局' },
  { sel: /\.wbpro-scroller-item \.retweet$/, prop: 'position', val: 'relative', why: '转发摘要条定位上下文，不占布局' },
  { sel: /\[data-spb="stats"\]/, prop: '*', val: '*', why: '我方绝对定位摘要条 —— 不进布局流（§12-B15）' },
  { sel: /\.woo-picture-main$/, prop: 'max-height', val: `${DEFAULT_MEDIA_MAX_H}px`,
    why: '媒体缩略化 —— 登记改高度项（§12-B16；上限 = mediaMaxH，默认 90，2026-10-15 两轮下调）；'
      + '三轮收窄：作用域限定 feed-content/retweet（评论面板豁免，防误伤评论图）' },
  { sel: /\.woo-picture-main$/, prop: 'max-width', val: `${DEFAULT_MEDIA_MAX_H}px`,
    why: '⑦c 媒体压宽（B16 追记）：picture-main 带内联 width（单图 168 / 多图格 136.578），'
      + 'max-width 封顶（默认跟随 mediaMaxH = 方格）' },
  { sel: /\.wbpro-scroller-item \.(wbpro-feed-content|retweet) \.u-col-1$/, prop: 'max-width', val: `${DEFAULT_MEDIA_MAX_H}px`,
    why: '⑦c 宽度版「84px 空白」防线：单图行容器带内联 width:168（class max-width:168），'
      + '不压行宽 ⇒ 格子窄了行不窄，右侧死白' },
  { sel: /\.u-col-[134] > \*$/, prop: 'max-width', val: `${DEFAULT_MEDIA_MAX_H}px`,
    why: '⑦c 行子格压宽（probeMedia3 实测 13/13 flow：block + inline-block 无固定列数）'
      + ' ⇒ 压窄后自动换行挤进更多列；子格宽是百分比算的（maxWidth:none），max-width 直接封顶；'
      + '._item_ 是哈希类 ⛔ 只能用 u-col-N 直接子表达' },
  // ⑦c 二轮（2026-10-16「有一些卡片还是 4 个一行」）：多图网格专属压宽，单图不跟（用户拍板）
  { sel: /\.u-col-[34] > \*$/, prop: 'max-width', val: `${DEFAULT_MEDIA_GRID_W}px`,
    why: '⑦c 二轮网格专属压宽：u-col-3 容器定宽 409.75，90 方格只能装 4 列（5×94=470 装不下）'
      + ' ⇒ 网格 76（5×80=400 ≤ 409.75，u-col-4 容器 546 升 6 列）；只作用 u-col-3/4，单图行保持 90 方格' },
  { sel: /\.u-col-[34] \.woo-picture-main$/, prop: 'max-width', val: `${DEFAULT_MEDIA_GRID_W}px`,
    why: '⑦c 二轮网格专属压宽（picture-main 层）：宽度显式值三层重复声明，'
      + 'u-col-3/4 行内的 picture-main 必须与子格同压 76，漏层 = 宽度版 84px 空白（§12-B16 同源坑）' },
  // cover 全接管形态（B17 结案定稿）：配对内联（尺寸+负偏移）必须**整体**作废 ——
  // partial 形态（只压 height 留 top:auto）= B17 黑图凶手，严禁回潮。
  { sel: /\.woo-picture-main img$/, prop: 'width', val: '100%',
    why: 'cover 全接管：横图配对内联的 width:180% 必须作废（§12-B17）' },
  { sel: /\.woo-picture-main img$/, prop: 'height', val: '100%', why: 'img 跟随缩后的容器，cover 重算（§12-B16/B17）' },
  { sel: /\.woo-picture-main img$/, prop: 'top', val: '0',
    why: 'cover 全接管：竖图配对负偏移（top:-33%）整体作废 —— partial 的 top:auto = B17 黑图凶手，已废' },
  { sel: /\.woo-picture-main img$/, prop: 'left', val: '0',
    why: 'cover 全接管：横图配对负偏移（left:-34%）整体作废（§12-B17）' },
  { sel: /\.wbpro-scroller-item \.(wbpro-feed-content|retweet) \.u-col-1$/, prop: 'height', val: 'auto',
    why: '单图行容器带着与图相同的内联 height:224（2026-10-15 真机踩坑：只压内层留 84px 空白）'
      + ' —— auto 压掉重复声明、行回归内容高，不引入新裁切面（§12-B16）；'
      + '作用域限定 feed-content/retweet（评论面板豁免）' },
  { sel: /^\.wbpro-side-main$/, prop: 'display', val: 'none',
    why: '右栏整体隐藏（2026-10-15 用户定调）—— 虚拟列表之外的流式容器，display:none 不留洞'
      + '（A 类逻辑 §7.5.0）；B9 旧结论「无需落地」被宽窗口使用场景推翻（§12-B16 ⑧）' },
  // ⑧ 字号行距（2026-10-16 probeTypo 15 卡读数定案，§7.5-C L1 规范值）：改高度项，
  // 走首帧注入机制（§12-B12 闸门已开：注入 CSS 会被算进虚拟列表预计算尺寸）
  { sel: /\.wbpro-feed-(ogText|reText)$/, prop: 'font-size', val: `${DEFAULT_TEXT_FONT_SIZE}px`,
    why: '⑧ 正文字号统一 14px（og 原生 15 / re 原生 14）—— 改高度项，首帧注入 + 真机复验不留洞' },
  { sel: /\.wbpro-feed-(ogText|reText)$/, prop: 'line-height', val: `${DEFAULT_TEXT_LINE_HEIGHT}`,
    why: '⑧ 正文行距统一 1.6（og 原生 24/15=1.6、re 24/14=1.71 ⇒ 行盒 22.4px）—— 同上改高度项' },
];

function sizeExemptFor(rule, decl) {
  const bare = decl.value.replace(/\s*!important$/, '').trim();
  for (const e of SIZE_EXEMPT) {
    if (e.prop !== '*' && e.prop !== decl.prop) continue;
    if (e.val !== '*' && e.val !== bare) continue;
    if (!e.sel.test(rule.selector)) continue;
    return e;
  }
  return null;
}

/** 构建哈希（`_logo_18dhr_77` / `_wrap_ecgcn_2`）—— 禁止进选择器 */
const HASH_RE = /_[a-z0-9]+_[a-z0-9]{4,}_\d+/;

test('L1：规则条数与 `L1_RULE_COUNT` 一致（改了规则要同步改常量）', () => {
  assert.equal(parseRules(l1Css()).length, L1_RULE_COUNT);
});

test('L1：mediaCaps:false 只摘媒体尺寸规则组（B17 黑图归因开关，§12-B17）', () => {
  // 背景：黑图与媒体缩略化上线**时间相关**（用户：改尺寸前无黑图、开后有）；
  // 现场摘除（spbAB）洗不清「首帧布局干扰懒加载决策」的单向锁存路径 ⇒
  // 提供「刷新级」归因开关：false = 三条尺寸规则不注入，L1 其余一切保留。
  // ✅ 2026-10-15 用户实测：mediaCaps:false 刷新后无黑图 ⇒ 凶手锁定在三条规则内。
  const off = parseRules(l1Css({ appearance: { mediaCaps: false } }));

  assert.equal(off.length, L1_RULE_COUNT - 5,
    '恰好摘掉五条（img / u-col-1 行 / 行子格 / 网格专属压宽 / picture-main）');
  for (const r of off) {
    assert.ok(!/woo-picture-main/.test(r.selector),
      `mediaCaps:false 下不得出现 woo-picture-main 尺寸规则：${r.selector}`);
    assert.ok(!/u-col-1/.test(r.selector),
      `mediaCaps:false 下不得出现 u-col-1 尺寸规则：${r.selector}`);
    assert.ok(!/u-col-[34] > \*/.test(r.selector),
      `mediaCaps:false 下不得出现行子格压宽规则：${r.selector}`);
  }
  // 滤镜（②）刻意保留：saturate(.4)+opacity:.85 只降显著度、不可能造出「全黑」，
  // 且它是 L1 基线（「降彩度不灭色相」2026-10-14 用户定调）—— 归因时别把它混进来。
  assert.ok(off.some((r) => r.selector.includes('img') && r.decls.some((d) => d.prop === 'filter')),
    '媒体降饱和滤镜必须保留（归因变量只 isolate「改尺寸」这一族）');
  // 摘掉后不再有任何「改尺寸」规则 ⇒ SIZE_EXEMPT 登记的媒体诸项必然缺席
  const sizeProps = off.flatMap((r) => r.decls.map((d) => d.prop));
  assert.ok(!sizeProps.includes('max-height'), 'max-height 应随 mediaCaps 摘除');
  assert.ok(!sizeProps.includes('max-width'), 'max-width 应随 mediaCaps 摘除');
});

test('L1：mediaCaps 档位清理（B17 结案）—— 默认/未知值 = cover 全接管；partial 仅存法证对照', () => {
  const imgRuleOf = (css) => parseRules(css).find((r) => r.selector.includes('.woo-picture-main img'));
  // 默认家族（true / 缺省 / 'all' / 'cover' / 未知值容错）= cover 全接管，22 条全量
  for (const mc of [undefined, true, 'all', 'cover', 'bogus']) {
    const css = mc === undefined ? l1Css() : l1Css({ appearance: { mediaCaps: mc } });
    assert.equal(parseRules(css).length, L1_RULE_COUNT, `mediaCaps=${String(mc)} 应全量 ${L1_RULE_COUNT} 条`);
    const img = imgRuleOf(css);
    assert.ok(img && img.decls.some((d) => d.prop === 'object-fit'),
      `mediaCaps=${String(mc)} 的 img 规则必须是 cover 全接管`);
    assert.ok(img && !img.decls.some((d) => d.value.includes('auto')),
      `mediaCaps=${String(mc)} 不得残留 auto（partial 形态 = B17 黑图凶手，严禁回潮）`);
  }
  // 'partial' 法证对照档：22 条、img = height:100% + top:auto、无 object-fit（B17 复现用，勿用于日常）
  const partial = parseRules(l1Css({ appearance: { mediaCaps: 'partial' } }));
  assert.equal(partial.length, L1_RULE_COUNT, 'partial 档也应全量（只是 img 换回凶手形态）');
  const pimg = imgRuleOf(l1Css({ appearance: { mediaCaps: 'partial' } }));
  assert.ok(pimg, 'partial 档必须有 img 规则');
  assert.ok(pimg.decls.some((d) => d.prop === 'top' && d.value.includes('auto')),
    'partial 档 img 必须 top:auto（凶手形态特征，供法证复现）');
  assert.ok(!pimg.decls.some((d) => d.prop === 'object-fit'), 'partial 档不得有 object-fit');
});

test('L1：默认路径 = cover 全接管（B17 修复定稿，§12-B17）', () => {
  // 二分定论（2026-10-15）：'partial' 形态（height:100%+top:auto）= 黑图凶手 ——
  // 机制：微博 JS 裁切的「尺寸+负偏移」是**配对**内联，部分覆盖 ⇒ 加载器首帧
  // 读到自相矛盾的几何 → 单向锁存不挂 img。'cover' = 全接管，无残留可错。
  // ✅ 用户真机实测（2026-10-15）：'cover' 刷新后无黑图、其他正常 ⇒ 默认路径切 cover。
  const rules = parseRules(l1Css());
  assert.equal(rules.length, L1_RULE_COUNT, '默认档三条都在（img 换形态）');

  const imgRule = rules.find((r) => r.selector.includes('.woo-picture-main img'));
  assert.ok(imgRule, '默认档必须有 img 规则');
  const val = (p) => { const d = imgRule.decls.find((x) => x.prop === p); return d ? d.value.replace(/ !important$/, '') : null; };
  assert.equal(val('width'), '100%', '全接管必须 width:100%（配对内联的 width 也要作废）');
  assert.equal(val('height'), '100%', '全接管必须 height:100%');
  assert.equal(val('top'), '0', '全接管 top 必须归零（不是 auto —— 配对偏移整体作废）');
  assert.equal(val('left'), '0', '全接管 left 必须归零（横图配对内联的 left:-34% 也要作废）');
  assert.equal(val('object-fit'), 'cover', '必须 object-fit:cover 接管居中裁切');
  assert.ok(!imgRule.decls.some((d) => d.value.includes('auto')),
    '默认档 img 规则不得残留任何 auto（partial 形态的标志）');

  // u-col-1 与 max-height 在默认档都必须在（消 84px 空白 + 压高）
  assert.ok(rules.some((r) => r.selector.includes('u-col-1')), '默认档保留 u-col-1 height:auto');
  assert.ok(rules.some((r) => r.decls.some((d) => d.prop === 'max-height')), '默认档保留 max-height');
});

test('L1：mediaMaxH 可调（审美参数，2026-10-15 用户「图片还是过大」）—— 合法值生效、非法值回退', () => {
  assert.match(l1Css({ appearance: { mediaMaxH: 96 } }), /max-height:96px !important/,
    '合法数值必须直接生效（控制台试值用）');
  // 非法值（字符串 / 负数 / NaN）一律回退默认，绝不能把「NaNpx」打进 CSS
  for (const bad of ['x', -20, NaN, null]) {
    const css = l1Css({ appearance: { mediaMaxH: bad } });
    assert.match(css, new RegExp(`max-height:${DEFAULT_MEDIA_MAX_H}px !important`),
      `mediaMaxH=${String(bad)} 应回退默认 ${DEFAULT_MEDIA_MAX_H}px`);
  }
  // 越界值夹回 [40, 400]，不回退（用户手滑也不至于炸布局）
  assert.match(l1Css({ appearance: { mediaMaxH: 9999 } }), /max-height:400px !important/, '上限夹 400');
  assert.match(l1Css({ appearance: { mediaMaxH: 1 } }), /max-height:40px !important/, '下限夹 40');
});

test('L1：mediaMaxW 可调（⑦c 压宽）—— 缺省跟随 mediaMaxH（方格）、显式值独立生效、非法回退', () => {
  // 缺省（null / 不传）= 跟随高度上限 ⇒ 方格；改 H 时 W 跟着走
  assert.match(l1Css(), new RegExp(`max-width:${DEFAULT_MEDIA_MAX_H}px !important`),
    `缺省宽度必须跟随 mediaMaxH（默认 ${DEFAULT_MEDIA_MAX_H}，正方格）`);
  assert.match(l1Css({ appearance: { mediaMaxH: 96 } }), /max-width:96px !important/,
    'mediaMaxH 变了 W 必须跟（否则出非方格默认态）');
  // 显式数值独立生效（用户想压得比高度更窄、一行更多列）；行 / 子格 / picture-main 三层都要带上
  const css72 = l1Css({ appearance: { mediaMaxW: 72 } });
  assert.match(css72, /max-width:72px !important/, 'mediaMaxW 显式值必须生效');
  assert.ok((css72.match(/max-width:72px !important/g) || []).length >= 3,
    '行 / 行子格 / picture-main 三层规则都要带上 W（漏一层 = 宽度版 84px 空白）');
  // 非法值回退「跟随 H」，绝不把 NaN 打进 CSS
  for (const bad of ['x', -20, NaN]) {
    const css = l1Css({ appearance: { mediaMaxW: bad } });
    assert.match(css, new RegExp(`max-width:${DEFAULT_MEDIA_MAX_H}px !important`),
      `mediaMaxW=${String(bad)} 应回退跟随默认 ${DEFAULT_MEDIA_MAX_H}px`);
  }
  // 越界夹回 [40, 400]
  assert.match(l1Css({ appearance: { mediaMaxW: 9999 } }), /max-width:400px !important/, '宽度上限夹 400');
});

test('L1：mediaMaxWGrid 网格专属宽度（⑦c 二轮）—— 默认 76、单图不受影响、非法回退', () => {
  // 背景：u-col-3 容器定宽 409.75，90 方格只能装 4 列 ⇒ 用户「有一些卡片还是 4 个一行」
  const rules = parseRules(l1Css());
  const gridItem = rules.find((r) => /\.u-col-[34] > \*/.test(r.selector) && !r.selector.includes('.u-col-1'));
  assert.ok(gridItem, '缺网格专属压宽规则');
  assert.match(gridItem.decls.find((d) => d.prop === 'max-width').value,
    new RegExp(`^${DEFAULT_MEDIA_GRID_W}px !important`), `网格默认必须 ${DEFAULT_MEDIA_GRID_W}px`);

  // 单图行三处（行容器 / 子格 / picture-main）保持跟随 mediaMaxH（90），不跟网格值走
  const rowRule = rules.find((r) => /\.wbpro-scroller-item \.(wbpro-feed-content|retweet) \.u-col-1$/.test(r.selector));
  assert.match(rowRule.decls.find((d) => d.prop === 'max-width').value,
    new RegExp(`^${DEFAULT_MEDIA_MAX_H}px !important`), '单图行必须保持 90 方格（用户拍板不跟着变窄）');

  // 显式值独立生效；非法回退 76；越界夹 [40, 400]
  assert.match(l1Css({ appearance: { mediaMaxWGrid: 72 } }), /max-width:72px !important/, '显式网格宽必须生效');
  for (const bad of ['x', -5, NaN]) {
    const css = l1Css({ appearance: { mediaMaxWGrid: bad } });
    assert.match(css, new RegExp(`max-width:${DEFAULT_MEDIA_GRID_W}px !important`),
      `mediaMaxWGrid=${String(bad)} 应回退默认 ${DEFAULT_MEDIA_GRID_W}px`);
  }
  assert.match(l1Css({ appearance: { mediaMaxWGrid: 9999 } }), /max-width:400px !important/, '网格宽夹 400');
});

test('L1：字号行距 ⑧ —— 默认 14/1.6、只锚 og/re 两容器、非法回退越界夹取', () => {
  // probeTypo 15 卡读数定案（2026-10-16）：og 15px/24px、re 14px/24px ⇒ 统一 14px + 1.6
  const rules = parseRules(l1Css());
  // ⚠️ find 必须带卡前缀 —— ③ 的颜色规则（TEXT_SEL）也含 ogText/reText 片段，会抢先命中
  const typo = rules.find((r) => /\.wbpro-scroller-item \.wbpro-feed-(ogText|reText)/.test(r.selector));
  assert.ok(typo, '缺正文排版规则');
  // 选择器恰好两个变体（og / re，都带卡前缀）—— 不许顺带锚到截断容器 / 评论区
  const sels = typo.selector.split(',');
  assert.equal(sels.length, 2, 'og/re 两变体，不多不少');
  for (const s of sels) {
    assert.match(s, /^\.wbpro-scroller-item \.wbpro-feed-(ogText|reText)$/, `变体形状：${s}`);
  }
  const props = Object.fromEntries(typo.decls.map((d) => [d.prop, d.value]));
  assert.match(props['font-size'], new RegExp(`^${DEFAULT_TEXT_FONT_SIZE}px !important`), '默认字号 14');
  assert.match(props['line-height'], new RegExp(`^${DEFAULT_TEXT_LINE_HEIGHT} !important`), '默认行距 1.6');

  // 显式值生效；非法回退默认；越界夹取（字号 [12,20] 整数、行距 [1.2,2.2] 两位小数）
  const over = l1Css({ appearance: { textFontSize: 13, textLineHeight: 1.8 } });
  assert.match(over, /font-size:13px !important/, '显式字号生效');
  assert.match(over, /line-height:1.8 !important/, '显式行距生效');
  for (const bad of ['x', -3, NaN]) {
    const css = l1Css({ appearance: { textFontSize: bad, textLineHeight: bad } });
    assert.match(css, new RegExp(`font-size:${DEFAULT_TEXT_FONT_SIZE}px !important`),
      `textFontSize=${String(bad)} 应回退默认`);
    assert.match(css, new RegExp(`line-height:${DEFAULT_TEXT_LINE_HEIGHT} !important`),
      `textLineHeight=${String(bad)} 应回退默认`);
  }
  assert.match(l1Css({ appearance: { textFontSize: 99 } }), /font-size:20px !important/, '字号夹 20');
  assert.match(l1Css({ appearance: { textFontSize: 5 } }), /font-size:12px !important/, '字号夹 12');
  assert.match(l1Css({ appearance: { textFontSize: 13.6 } }), /font-size:14px !important/, '字号取整');
  assert.match(l1Css({ appearance: { textLineHeight: 3 } }), /line-height:2.2 !important/, '行距夹 2.2');
  assert.match(l1Css({ appearance: { textLineHeight: 0.5 } }), /line-height:1.2 !important/, '行距夹 1.2');
});

test('L1：媒体压宽 ⑦c —— 三层都压（行 u-col-1 / 行子格 u-col-N > * / picture-main），子格选择器 6 变体', () => {
  // probeMedia3 读数（2026-10-15，13 行全 flow）：子格宽在三层重复出现 ——
  // 单图 u-col-1 内联 width:168（行）+ class 168（子格）+ 内联 168（picture-main）；
  // 多图子格 136.578 是百分比（maxWidth:none）。漏任何一层就是「宽度版 84px 空白 / 溢出」。
  const css = l1Css();
  const rules = parseRules(css);

  // ① 单图行：height:auto 与 max-width 合并在同一条规则里（同选择器不同事）
  const rowRule = rules.find((r) => /\.wbpro-scroller-item \.(wbpro-feed-content|retweet) \.u-col-1$/.test(r.selector));
  assert.ok(rowRule, '缺单图行规则');
  const rowProps = Object.fromEntries(rowRule.decls.map((d) => [d.prop, d.value]));
  assert.match(rowProps.height, /auto/, 'u-col-1 必须 height:auto（⑦b 重复内联高度）');
  assert.match(rowProps['max-width'], new RegExp(`^${DEFAULT_MEDIA_MAX_H}px`),
    'u-col-1 必须 max-width（内联 width:168 的宽度版防线）');

  // ② 行子格：两条 —— base（u-col-1/3/4 全列、6 变体）+ 网格专属（u-col-3/4、8 变体，⑦c 二轮）
  const itemRules = rules.filter((r) => /\.u-col-[134] > \*/.test(r.selector));
  assert.equal(itemRules.length, 2, '子格压宽应有两条：base（含单图）+ 网格专属（⑦c 二轮）');
  const baseItem = itemRules.find((r) => r.selector.includes('.u-col-1 > *'));
  const gridItem = itemRules.find((r) => !r.selector.includes('.u-col-1 > *'));
  assert.ok(baseItem && gridItem, 'base 与网格专属各恰好一条');
  const variants = baseItem.selector.split(',');
  assert.equal(variants.length, 6, 'base 子格规则 = u-col-1/3/4 × 两作用域 = 6 变体');
  for (const v of variants) {
    assert.match(v, /^\.wbpro-scroller-item (\.(wbpro-feed-content|retweet)) \.u-col-[134] > \*$/,
      `${v}：必须卡内 + 内容区作用域 + u-col-N 直接子（._item_ 是哈希 ⛔）`);
  }
  assert.ok(baseItem.selector.includes('.u-col-1 > *')
    && baseItem.selector.includes('.u-col-3 > *')
    && baseItem.selector.includes('.u-col-4 > *'), '三种列数都要覆盖');
  // ②b 网格专属（⑦c 二轮 2026-10-16）：只锚 u-col-3/4、8 变体、值为 DEFAULT_MEDIA_GRID_W
  assert.equal(gridItem.selector.split(',').length, 8,
    '网格专属 = u-col-3/4 × 子格/picture-main × 两作用域 = 8 变体');
  assert.ok(!gridItem.selector.includes('.u-col-1'), '网格专属不得命中单图行（用户拍板：单图保持方格）');
  assert.match(gridItem.decls.find((d) => d.prop === 'max-width').value,
    new RegExp(`^${DEFAULT_MEDIA_GRID_W}px`),
    `网格子格必须压到 ${DEFAULT_MEDIA_GRID_W}px（u-col-3 容器 409.75 装 5 列的前提）`);
  assert.ok(gridItem.selector.includes('.u-col-3 .woo-picture-main')
    && gridItem.selector.includes('.u-col-4 .woo-picture-main'),
    '网格内的 picture-main 也要压到网格宽（三层重复声明，漏层 = 宽度版 84px 空白）');

  // ③ picture-main：max-height 与 max-width 同条规则（⚠️ 排除网格专属那条 —— 它也含 woo-picture-main）
  const picRule = rules.find((r) => r.selector.includes('.woo-picture-main')
    && !r.selector.includes(' img') && !/\.u-col-[34] \.woo-picture-main/.test(r.selector));
  assert.ok(picRule, '缺 picture-main 容器规则');
  const picProps = Object.fromEntries(picRule.decls.map((d) => [d.prop, d.value]));
  assert.match(picProps['max-height'], new RegExp(`^${DEFAULT_MEDIA_MAX_H}px`));
  assert.match(picProps['max-width'], new RegExp(`^${DEFAULT_MEDIA_MAX_H}px`), 'picture-main 的内联 width 也要封顶');

  // ⛔ 多图行容器 u-col-3/4 本体不许被压宽（撑满内容区是「多列」的前提）
  const cappedRows = rules.filter((r) => /\.u-col-[34]$/.test(r.selector));
  assert.equal(cappedRows.length, 0, 'u-col-3/4 行容器不得有尺寸规则（压了就没有多列）');
});

test('L1：每条规则都带 !important（这是一套覆盖微博主题的样式）', () => {
  for (const r of parseRules(l1Css())) {
    for (const d of r.decls) {
      assert.match(d.value, /!important$/, `${r.selector} 的 ${d.prop} 缺 !important`);
    }
  }
});

test('L1：改尺寸属性必须有 SIZE_EXEMPT 登记 —— 无名有姓才放行', () => {
  for (const r of parseRules(l1Css())) {
    for (const d of r.decls) {
      if (!SIZE_AFFECTING.includes(d.prop)) continue;
      const exempt = sizeExemptFor(r, d);
      assert.ok(exempt,
        `${r.selector} 用了会改尺寸的属性「${d.prop}: ${d.value}」`
        + ' —— 要么改掉，要么在 SIZE_EXEMPT 登记表里写明理由（§12-B2 / §12-B15）');
    }
  }
});

test('L1：SIZE_EXEMPT 的 display:none 只许「行内叶子图标」与「登记过的流外容器」—— 不许开后门', () => {
  // 反向守卫：如果哪天登记表被扩成"什么都放行"，这条会红。
  // ℹ️ A1 footer 曾在此列（display:none 改高度），2026-10-15 二轮拍板改为 visibility:hidden
  //    （空位摘要条，零高度影响）⇒ 已从登记表除名 —— 这里若再出现 footer 的 display:none 会红。
  // ℹ️ ⑧ 右栏 .wbpro-side-main 是登记过的例外：虚拟列表之外的流式容器（A 类逻辑），
  //    收掉不留洞 —— 卡内（.wbpro-scroller-item 之内）的 display:none 仍然一个都不许有。
  const rules = parseRules(l1Css()).filter((r) => r.decls.some(
    (d) => d.prop === 'display' && d.value.replace(/\s*!important$/, '').trim() === 'none'));

  assert.ok(rules.length > 0, 'L1 里应当还有行内图标的 display:none（认证角标 / 字体图标）');
  for (const r of rules) {
    const allowed = /woo-icon|woo-font--/.test(r.selector)
      || /^\.wbpro-side-main$/.test(r.selector);
    assert.ok(allowed,
      `${r.selector}：display:none 只允许用在行内叶子图标（woo-icon* / woo-font--*）`
      + '或登记过的流外容器（.wbpro-side-main）上');
  }
  // 🔴 关键红线：虚拟列表**之内**（卡内）不许出现任何 display:none —— 洞的根源
  for (const r of rules) {
    assert.ok(!r.selector.includes('.wbpro-scroller-item'),
      `${r.selector}：卡内 display:none 会改卡片高度留洞（§12-B2），一律禁止`);
  }
});

test('L1：A1 互动按钮行 —— 必须 visibility:hidden（空位摘要条），禁止 display:none；转发块 footer 同语言处理', () => {
  const css = l1Css();

  // footer 规则恰好一条、直接子、带 SEL_CARD 前缀（页面其它 footer 不能被误伤）
  const footer = parseRules(css).filter((r) => /article > footer/.test(r.selector)
    && !r.selector.includes('.retweet'));
  assert.equal(footer.length, 1, 'footer 规则应恰好一条');
  assert.match(footer[0].selector, /^\.wbpro-scroller-item article > footer$/,
    `${footer[0].selector}：必须「卡内 + article 直接子」—— 裸锚会误伤转发块内部的 footer 与页面其它 footer`);
  // 🔴 必须 visibility:hidden（空位保留 40px，摘要条落在空位上不遮挡内容）；
  //    display:none 是 2026-10-15 上午的旧稿（改高度、浮条随内容遮挡），用户二轮拍板废弃 —— 焊死。
  const v = footer[0].decls.find((d) => d.prop === 'visibility');
  const d = footer[0].decls.find((x) => x.prop === 'display');
  assert.ok(v && /hidden/.test(v.value), 'footer 必须 visibility:hidden（空位摘要条定稿，§12-B15）');
  assert.ok(!d, 'footer 禁止 display:none（2026-10-15 二轮拍板：遮挡随内容不一致，已废弃）');

  // 转发原文的按钮行：与卡自身**同一套设计语言**（2026-10-15 三轮拍板：初稿只中性化，
  // 用户指「与原版区别不大」且将来整个界面要走日志形态 ⇒ 统一为隐藏 + 摘要条）
  const retweet = parseRules(css).filter((r) => /\.retweet footer$/.test(r.selector));
  assert.equal(retweet.length, 1, '转发块 footer 规则应恰好一条');
  assert.match(retweet[0].selector, /^\.wbpro-scroller-item \.retweet footer$/,
    `${retweet[0].selector}：必须卡内限定（.retweet 是通用语义，裸锚有误伤面）`);
  const rv = retweet[0].decls.find((x) => x.prop === 'visibility');
  assert.ok(rv && /hidden/.test(rv.value),
    '转发块 footer 必须 visibility:hidden（与卡自身 footer 同语言，§12-B15 ⑥b）');
  assert.ok(!retweet[0].decls.find((x) => x.prop === 'display'),
    '转发块 footer 禁止 display:none（零高度影响纪律）');
  // 定位上下文：.retweet 必须 relative（转发摘要条的 bottom:0 以它为基准）
  assert.match(css, /\.wbpro-scroller-item \.retweet\{position:relative/,
    '缺少 .retweet 的 relative 定位上下文 —— 转发摘要条会以 article 为基准、落错位置');

  // 摘要条：绝对定位 + bottom:0（不进布局流 ⇒ 建/更/摘不改卡片高度）+ 可点击（不许 pointer-events:none）
  // （卡自身与转发块共用同一条属性选择器规则 —— 这就是「同一设计语言」的实现方式）
  const summary = parseRules(css).filter((r) => r.selector.includes('data-spb="stats"'));
  assert.equal(summary.length, 1, '摘要条规则应恰好一条（两种摘要条共用）');
  const props = Object.fromEntries(summary[0].decls.map((x) => [x.prop, x.value]));
  assert.match(props.position, /absolute/, '摘要条必须绝对定位 —— 否则它的插入会改卡片高度');
  assert.match(props.bottom, /0/, '摘要条必须贴卡底（footer 空位的位置）');
  assert.ok(!props['pointer-events'], '摘要条是详情页入口，必须可点（不许 pointer-events:none）');
  assert.match(props.color, /var\(--w-sub\)/, '摘要条颜色必须走主题令牌（禁写死，§12-B9）');
  // 兜底（空位定稿后正常不重叠，但保证万一重叠也不透字）
  assert.match(props.background, /var\(--w-card-background\)/,
    '摘要条缺不透明底色 —— 万一与内容重叠会不可读（§12-B15）');
  assert.ok(Number.parseInt(props['z-index'], 10) >= 10,
    '摘要条 z-index 必须压过播放器自建的层叠上下文');

  // 定位上下文：article 必须 relative（否则摘要条会飘到更外层的定位祖先上去）
  assert.match(css, /\.wbpro-scroller-item article\{position:relative/,
    '缺少 article 的 relative 定位上下文 —— 摘要条的 bottom:0 将以槽位为基准');
});

test('L1：媒体缩略化（§12-B16，改高度项）—— 数值法 max-height，锚库类，视频不在列', () => {
  // probeMedia() 真机读数（2026-10-15，11 卡 9 媒体块）：高度全是显式固定像素
  //（竖图 224 / 横图 126 / 九宫格格子 132.6），img absolute + object-fit:cover 内建
  // ⇒ 手法 = 容器 max-height 压过显式 height + img height:100% 跟随；只有高于阈值者被压。
  // 🔴 真机验收修正（同日）：**显式 height 有两处** —— 外层单图行 `.u-col-1` 带着同样的
  //    内联 height:224px，只压内层 woo-picture-main ⇒ 图缩了、卡片没矮、留 84px 空白。
  //    第三条规则 `u-col-1{height:auto}` 压掉重复声明（夹具 10/10：卡内 u-col-1 全部且仅是单图行）。
  // 🔴 三轮收窄（2026-10-15 真机实锤）：评论面板在**卡内**复用同一批组件类 ⇒ 裸「卡内」
  //    作用域会误伤评论图（错位 + 黑框，用户截图）⇒ 作用域必须限定 feed-content/retweet
  //    （夹具 61/61 + 10/10：卡内媒体类全部在这两个区域之内，收窄 = 信息流行为零变化）。
  const css = l1Css();
  // ⚠️ 网格专属压宽规则（⑦c 二轮）的选择器也含 woo-picture-main，须排除
  const rules = parseRules(css).filter((r) => r.selector.includes('woo-picture-main')
    && !/\.u-col-[34] \.woo-picture-main/.test(r.selector));

  assert.equal(rules.length, 2, '媒体缩略化应恰好两条（容器 + img）');
  const container = rules.find((r) => !r.selector.includes(' img'));
  const img = rules.find((r) => r.selector.includes(' img'));
  assert.ok(container && img, '容器与 img 各一条');

  // 作用域守卫：feed-content 与 retweet 两个变体都必须在（缺一个 = 转发图 / 正文图漏掉一个）
  for (const r of [container, img]) {
    assert.ok(r.selector.includes('.wbpro-feed-content .woo-picture-main'),
      `${r.selector}：缺 feed-content 变体`);
    assert.ok(r.selector.includes('.retweet .woo-picture-main'),
      `${r.selector}：缺 retweet 变体（转发原文的图也要缩）`);
    assert.ok(!/^\.wbpro-scroller-item \.woo-picture-main/.test(r.selector),
      `${r.selector}：不许退回裸「卡内」作用域 —— 会误伤评论面板（三轮真机实锤）`);
  }
  const containerSel = container.selector.split(',');
  const imgSel = img.selector.split(',');
  assert.ok(containerSel.length === 2 && imgSel.length === 2, '每条媒体规则 = 两个作用域变体');

  assert.match(containerSel[0], /^\.wbpro-scroller-item \.wbpro-feed-content \.woo-picture-main$/,
    '容器变体 ① 必须卡内 + feed-content 限定 + 库类锚（_picTall_/_inlineNum3_ 是哈希 ⛔）');
  assert.match(containerSel[1], /^\.wbpro-scroller-item \.retweet \.woo-picture-main$/,
    '容器变体 ② 必须卡内 + retweet 限定');
  assert.match(container.decls.find((d) => d.prop === 'max-height').value,
    new RegExp(`^${DEFAULT_MEDIA_MAX_H}px`),
    `容器 max-height 必须是默认 ${DEFAULT_MEDIA_MAX_H}px（mediaMaxH 控制，2026-10-15 用户「再小一点」）`);
  assert.match(img.decls.find((d) => d.prop === 'height').value, /^100%/,
    'img 必须 height:100% 跟随容器（否则 cover 仍按原 224px 框裁切）');
  assert.match(img.decls.find((d) => d.prop === 'top').value, /^0/,
    'img 必须 top:0 —— cover 全接管把配对负偏移整体作废'
    + '（旧 top:auto = B17 黑图凶手，严禁回潮，§12-B17）');
  assert.match(img.decls.find((d) => d.prop === 'object-fit').value, /^cover/,
    'img 必须 object-fit:cover（CSS 原生居中裁切接管微博的 JS 裁切，§12-B17）');

  // ⑦b 单图行容器：必须存在、必须 height:auto（不是再压一次 140）、必须同轮收窄的作用域
  const row = parseRules(css).find((r) => /\.wbpro-scroller-item \.(wbpro-feed-content|retweet) \.u-col-1$/.test(r.selector));
  assert.ok(row, '缺单图行规则 u-col-1{height:auto} —— 只压内层会留 84px 空白（真机实锤）');
  assert.ok(!/^\.wbpro-scroller-item \.u-col-1$/.test(row.selector),
    'u-col-1 规则不许退回裸「卡内」作用域 —— 会误伤评论面板');
  assert.match(row.decls.find((d) => d.prop === 'height').value, /^auto/,
    'u-col-1 必须用 height:auto（去掉重复的内联高度），不得引入新裁切面');

  // ⛔ 视频本轮不动（vjs 内部布局风险）—— 媒体缩略化规则里不得出现 video-js
  for (const r of [...rules, row]) {
    assert.ok(!r.selector.includes('video'), '媒体缩略化不得波及视频（二期单独评估，§12-B16）');
  }
});

test('L1：锚点纪律 —— 选择器里不许出现构建哈希或 __yawf_*', () => {
  for (const r of parseRules(l1Css())) {
    assert.ok(!HASH_RE.test(r.selector), `选择器含构建哈希：${r.selector}`);
    assert.ok(!r.selector.includes('__yawf'), `选择器依赖外部注入类名：${r.selector}`);
  }
});

test('L1：主题无关 —— 颜色只许走微博的中性令牌，不许写死明暗色', () => {
  // 起因（2026-10-13 真机取样，PROJECT.md §12-B9）：用户的微博跑在**深色主题**下，
  // 而这一批最初的 `color:#333` / `box-shadow:…#e6e6e6` 是按浅色写的 ⇒
  // 深色下分别成了「深灰字压深灰底 = 正文消失」与「一条白线」。
  // 这条守卫把"写死颜色"这个手脚钉死：只要出现十六进制色就变红。
  const css = appearanceCss({ appearance: { l1: true } });
  const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(hex, [],
    `外观 CSS 里出现了写死的十六进制颜色 ${hex.join(', ')} —— 请改用 var(--w-main) / var(--w-sub) / var(--w-dividing-line)`);

  // 关键的两个令牌必须真的用上（防止有人把它们顺手换掉）
  assert.match(css, /color:var\(--w-main\)/, '正文没用主题令牌 --w-main');
  assert.match(css, /color:var\(--w-sub\)/, '链接没用主题令牌 --w-sub');
  assert.match(css, /box-shadow:0 1px 0 var\(--w-dividing-line\)/, '分割线没用主题令牌 --w-dividing-line');
});

test('L1：关键规则确实覆盖了预期目标（防止"规则还在但选择器被改错"）', () => {
  const css = l1Css();
  assert.match(css, /woo-avatar-img/, '头像降饱和规则丢了');
  assert.match(css, /woo-icon-vipimg/, '认证角标规则丢了');
  assert.match(css, /woo-picture/, '媒体降饱和规则丢了');
  assert.match(css, /\.vjs-poster img/, '视频封面降饱和规则丢了（视频卡不是 woo-picture，必须单独一条）');
  assert.match(css, /\.video-js\.vjs-paused[^{]*video\.vjs-tech/, '视频暂停帧降饱和规则丢了');
  assert.match(css, /\.wbpro-feed-ogText/, '正文规则丢了');
  assert.match(css, /\.wbpro-scroller-item/, '卡片规则丢了');
  assert.match(css, /a\[href="\/"\]\[aria-label\]/, 'logo 规则丢了');
  // 分割线必须用 box-shadow 的写法（border-bottom 会占 1px 布局 ⇒ 改高度）
  assert.match(css, /box-shadow:0 1px 0/, '卡片分割线没有用 box-shadow');
});

test('L1：视频降饱和只许打在封面 img / video 本体上，且必须限定在卡内（不许碰播放器根 / 卡外播放器）', () => {
  // 两条来历：
  //   ① 给 `.video-js`（播放器根）加 filter 会**新建层叠上下文**，把播放按钮 / 控制条一起卷进滤镜，
  //      还会把整块播放器提成一个合成层 ⇒ 只允许落在 `.vjs-poster img` 与 `video.vjs-tech` 上。
  //   ② 卡片外挂着微博自己的**小窗播放器**（`div.mini-player` → `div#vjs_video_3`，每页恒定 1 个）
  //      —— 那是用户主动弹出来的，不该被我们的"时间线降显著度"顺手按掉 ⇒ 必须带 `SEL_CARD` 前缀。
  const videoRules = parseRules(l1Css())
    .filter((r) => r.decls.some((d) => d.prop === 'filter'))
    .filter((r) => /video-js|vjs-/.test(r.selector));

  assert.ok(videoRules.length >= 2, '视频降饱和规则不见了');
  for (const r of videoRules) {
    assert.match(r.selector, /vjs-poster img|video\.vjs-tech/,
      `${r.selector}：filter 落在播放器根 / 控制条上会新建层叠上下文 —— 请挪到封面 img 或 video 本体`);
    assert.match(r.selector, /^\.wbpro-scroller-item\b/,
      `${r.selector}：视频规则必须限定在信息流卡内 —— 否则会连卡外的小窗播放器一起淡化`);
  }
});

test('L1：播放中的视频必须恢复原色（靠 `.vjs-paused` 限定，而不是靠 filter:none 反向覆盖）', () => {
  const paused = parseRules(l1Css()).filter((r) => /vjs-paused/.test(r.selector));
  assert.ok(paused.length > 0, '暂停帧规则缺少 .vjs-paused 限定 —— 播放中也会被降饱和');
  for (const r of paused) {
    assert.ok(!/vjs-playing/.test(r.selector), `${r.selector}：不该出现 vjs-playing 的反向覆盖`);
  }
  // 全屏时用户是主动在看，不该淡化
  assert.match(paused[0].selector, /:not\(\.vjs-fullscreen\)/, '全屏播放时不该被淡化');
});

test('L1：降饱和纪律 —— grayscale(1) 只许出现在 logo（伪装层）；头像 / 媒体必须保色相', () => {
  // 起因（2026-10-14 用户定调）：全灰丢掉色相区分，「别那么鲜艳，但保留颜色」。
  // ⇒ 头像 / 媒体一律 saturate(α)（α>0 才保色相）；唯一的 grayscale 白名单是 logo ——
  //   它是伪装层（§7.5-G），品牌红的识别度必须压掉，属刻意例外。
  const rules = parseRules(l1Css());

  for (const r of rules) {
    const filters = r.decls.filter((d) => d.prop === 'filter');
    if (!filters.length) continue;
    const isLogo = r.selector.includes('a[href="/"]');
    const body = filters.map((d) => d.value).join(' ');

    if (isLogo) {
      assert.match(body, /grayscale\(1\)/, 'logo 应保持灰度（伪装层例外）');
      continue;
    }
    assert.ok(!/grayscale\((?:0?\.[1-9]|1)\)/.test(body),
      `${r.selector} 用了灰度滤镜 —— 内容配色请用 saturate(α) 降彩度、保色相（2026-10-14 用户定调）`);
    if (r.selector.includes('woo-avatar-img') || r.selector.includes('woo-picture')
      || r.selector.includes('vjs-poster') || r.selector.includes('vjs-tech')) {
      assert.match(body, /saturate\((?:0?\.[1-9])\)/, `${r.selector} 缺 saturate(α) 降饱和`);
    }
  }
});

test('L1：社交归因条是**保留**项 —— 只许中性化，绝不许把整行藏掉', () => {
  // 2026-10-14 用户定调：「xx 赞过 / xx 关注了」回答的是
  //   「这条我没关注的人发的微博，为什么会出现在这里」⇒ **信息必须保留**（§7.5-E）。
  // 这条守卫防止将来有人把它「顺手」并进隐藏名单 —— 它是 §12-B10 那类翻版的翻版
  //（一次误收就会把有用的来源信息整条抹掉，而且没人会立刻发现）。
  const css = l1Css();
  const social = parseRules(css)
    .filter((r) => r.selector.includes('feed-title_a'))
    .filter((r) => !r.selector.includes('angleDown'));   // 「更多」按钮那条**允许** display:none

  assert.ok(social.length >= 2, '社交归因条的中性化规则不见了（昵称 + 整行应各一条）');

  for (const r of social) {
    for (const d of r.decls) {
      const bare = d.value.replace(/\s*!important$/, '').trim();
      assert.ok(!(d.prop === 'display' && bare === 'none'),
        `${r.selector}：归因条是**刻意保留**项，不许 display:none（用户 2026-10-14 定调）`);
      assert.ok(!(d.prop === 'visibility' && bare === 'hidden'),
        `${r.selector}：归因条是**刻意保留**项，不许 visibility:hidden`);
    }
  }

  // 中性化的具体落点（防止「规则还在但改错了属性」）
  assert.match(css, /a\.feed-title_a\{color:var\(--w-sub\)/,
    '昵称链接没有转中性色 —— 它会继续是微博原生蓝');
  assert.match(css, /a\.feed-title_a\{[^}]*text-decoration:none/,
    '昵称链接没有去下划线');
  assert.match(css, /article > div:has\(a\.feed-title_a\)\{color:var\(--w-sub\)/,
    '归因条整行没有转中性色 ——「和」「关注了」这些文本节点会仍是原色');
});

test('L1：「更多」箭头的隐藏必须限定在归因条内（同名图标全页共用，裸锚会误伤）', () => {
  // 实测（四份快照）：`.woo-font--angleDown` 全页 12 个，其中只有 6 个属于归因条
  // ⇒ 裸锚 `.woo-font--angleDown{display:none}` 会把别处的展开箭头一起抹掉。
  const arrow = parseRules(l1Css()).filter((r) => r.selector.includes('angleDown'));

  assert.equal(arrow.length, 1, '「更多」箭头的规则应恰好一条');
  assert.match(arrow[0].selector, /^article > div:has\(a\.feed-title_a\) /,
    `${arrow[0].selector}：必须带归因条前缀 —— .woo-font--angleDown 是通用字体图标，裸锚会误伤别处`);

  // 🔴 必须用 `visibility:hidden` 而不是 `display:none` —— 真机实测（2026-10-14）：
  //    `display:none` 让归因条 35px → 34.5px（图标参与了 0.5px 行盒计算）。
  //    改高度是本项目红线，实测变了就退回 —— 这条断言把退回焊死，防止将来有人「优化」回去。
  const d = arrow[0].decls.find((x) => x.prop === 'display');
  const v = arrow[0].decls.find((x) => x.prop === 'visibility');
  assert.ok(!d, '「更多」箭头不许 display:none（实测会把归因条改矮 0.5px，§12-B2 红线）');
  assert.ok(v && /visibility/.test(v.prop) && /hidden/.test(v.value),
    '「更多」箭头必须是 visibility:hidden');
});

test('L1：社交归因条的选择器在真实快照上确实命中（不是空转规则）', { skip: skipVideo }, () => {
  const ROW = 'article > div:has(a.feed-title_a)';
  let sawRow = 0, sawArrowTotal = 0, sawArrowInRow = 0;

  for (const file of fixtures) {
    const { document } = parseHTML(readFileSync(join(FIXTURE_DIR, file), 'utf8'));
    const n = (s) => document.querySelectorAll(s).length;

    sawRow += n(ROW);
    sawArrowTotal += n('.woo-font--angleDown');
    sawArrowInRow += n(`${ROW} .woo-font--angleDown`);

    // 不变量 ①：命中的每个元素都真的含昵称链接 —— 同时验证 `:has()` 在本 DOM 实现下
    // 与浏览器语义一致（不一致 ⇒ 线上选择器会静默失效，而测试却绿）
    for (const el of document.querySelectorAll(ROW)) {
      assert.ok(el.querySelector('a.feed-title_a'),
        `${file}: 归因条命中了一个不含昵称链接的元素 —— :has() 语义与预期不符`);
      assert.equal(el.tagName.toLowerCase(), 'div', `${file}: 归因条应是 div`);
    }

    // 不变量 ②：归因条**不是**互动按钮行（footer）—— 后者是 A1 的隐藏目标，两者别混
    assert.equal(n('footer:has(a.feed-title_a)'), 0,
      `${file}: footer 里出现了昵称链接 —— 归因条与互动按钮行可能被搞混了`);
  }

  assert.ok(sawRow > 0,
    '所有夹具里都没有社交归因条 ⇒ 这条守卫在空转（锚点可能已失效，或夹具换了一批）');

  // 关键证据：`.woo-font--angleDown` 在归因条**之外**也存在 ⇒ 这就是「必须行内限定」的理由。
  // 若哪天这条不再成立（全部箭头都进了归因条），测试会红 —— 那是**复核**的信号，不是直接放开。
  assert.ok(sawArrowTotal > sawArrowInRow,
    `实测应存在归因条之外的 angleDown 图标（全页 ${sawArrowTotal} / 行内 ${sawArrowInRow}）`
    + ' —— 若已不存在，需重新评估这条限制');
});

test('L1：转发块 footer 的规则在真实快照上确实命中（不是空转规则）', { skip: skipVideo }, () => {
  // `.retweet` 是语义类（四份快照 13 处全部一致、每个恰好 1 个 footer，§12-B15 ⑥b）。
  // 这条守卫锁两件事：① 规则真的指到了东西；② 每个转发块内恰好 1 个 footer（结构不变量）。
  const SEL = '.wbpro-scroller-item .retweet footer';
  let total = 0;

  for (const file of fixtures) {
    const { document } = parseHTML(readFileSync(join(FIXTURE_DIR, file), 'utf8'));
    const n = document.querySelectorAll(SEL).length;
    const blocks = document.querySelectorAll('.wbpro-scroller-item .retweet');
    assert.equal(n, blocks.length,
      `${file}: 转发块 ${blocks.length} 个，但 footer 命中 ${n} 个 —— 每块应恰好 1 个`);
    total += n;
  }
  assert.ok(total > 0, '所有夹具都没有转发块 footer ⇒ 这条守卫在空转（夹具可能全是原创卡）');
});

test('appearanceCss：L2 蕴含 L1（L1 规则全在 + L2 增量）；两个都关时一条规则都不注入', () => {
  const l1 = appearanceCss({ appearance: { l1: true, l2: false } });
  const l2 = appearanceCss({ appearance: { l1: false, l2: true } });
  const off = appearanceCss({ appearance: { l1: false, l2: false } });

  assert.ok(l1.length > 0);
  // ⚠️ L2 曾是 L1 的别名（输出相等）；M2 起 L2 = L1 全量 + 重排增量（l2.test.mjs 细测），
  //    这里只锁蕴含语义：L1 的**每一条**规则文本都必须出现在 L2 输出里。
  for (const line of l1.trim().split('\n').filter(Boolean)) {
    assert.ok(l2.includes(line), `L2 必须蕴含 L1 规则：${line.slice(0, 80)}`);
  }
  assert.ok(l2.length > l1.length, 'L2 还应有增量规则');
  assert.equal(off, '');
  assert.equal(appearanceCss(null), '');
  assert.equal(appearanceCss({}), '');
});

test('composeCss：空段自动跳过，段之间换行拼接', () => {
  assert.equal(composeCss('a{}', '', null, undefined, 'b{}'), 'a{}\nb{}');
  assert.equal(composeCss(), '');
});

test('ensureStyle：注入 / 幂等 / 内容变化时更新（切档位用得上）', { skip: !parseHTML }, () => {
  const { document } = parseHTML('<!doctype html><html><head></head><body></body></html>');

  assert.equal(ensureStyle(document, 'a{}'), true, '首次应注入');
  assert.equal(ensureStyle(document, 'a{}'), false, '内容相同 ⇒ 幂等，不再改动');
  assert.equal(ensureStyle(document, 'a{}b{}'), true, '内容变了 ⇒ 更新');
  assert.equal(document.getElementById(STYLE_ID).textContent, 'a{}b{}');

  // 不传 CSS 时退回过滤规则（兼容既有调用）
  const { document: d2 } = parseHTML('<!doctype html><html><body></body></html>');
  ensureStyle(d2);
  assert.ok(d2.getElementById(STYLE_ID).textContent.includes('[data-spb='));
  assert.equal(FILTER_CSS.includes('[data-spb="hidden"]'), true);
});

test('L1：视频降饱和的选择器在真实快照上确实命中（不是空转规则）', { skip: skipVideo }, () => {
  // 起因（2026-10-14 用户反馈）：视频封面一直全彩 —— 根因是媒体规则只锚 `woo-picture`，
  // 而视频卡走 video.js。这条测试把「选择器真的指到了东西」焊死，并顺手锁住一条**实测不变量**：
  //   卡内播放器数 == 卡内封面数 == 卡内 video 本体数（四份夹具全部成立）
  // ⇒ 只要卡片里有视频，它的封面就一定被降饱和，不会漏掉一部分；改版把 poster 挪走时立刻变红。
  let sawFeedVideo = 0;

  for (const file of fixtures) {
    const { document } = parseHTML(readFileSync(join(FIXTURE_DIR, file), 'utf8'));
    const n = (s) => document.querySelectorAll(s).length;

    const players = n('.wbpro-scroller-item .video-js');
    sawFeedVideo += players;

    assert.equal(n('.wbpro-scroller-item .vjs-poster img'), players,
      `${file}: 卡内播放器 ${players} 个，但封面命中数不等 —— 有视频封面漏了降饱和`);
    assert.equal(n('.wbpro-scroller-item video.vjs-tech'), players,
      `${file}: 卡内播放器 ${players} 个，但 video 本体命中数不等 —— 有暂停帧漏了降饱和`);

    // 封面必须是 `<picture><img>` 写法（我们的规则锚的是 `img`）。若微博哪天改成
    // video.js 的经典写法（`div.vjs-poster` 内联 `background-image`），规则会静默漏掉 ⇒ 这里先红。
    for (const poster of document.querySelectorAll('.wbpro-scroller-item .vjs-poster')) {
      assert.equal(poster.querySelectorAll('img').length, 1,
        `${file}: 封面层不是 <picture><img> 写法（可能是 background-image）—— 降饱和规则会漏掉它`);
    }

    // video.js 的不变量：播放器根上 `vjs-paused` / `vjs-playing` 必居其一
    // ⇒ 我们的 `.vjs-paused` 限定在播放时**一定**会失效（颜色自动回来），不靠巧合
    assert.equal(
      n('.wbpro-scroller-item .video-js.vjs-paused, .wbpro-scroller-item .video-js.vjs-playing'),
      players,
      `${file}: 有播放器既没有 vjs-paused 也没有 vjs-playing —— 「播放中恢复原色」的前提被打破了`);

    // 卡外那个**小窗播放器**（每页恒定 1 个，静态 `display:none`）必须落在我们的规则之外 ——
    // 它是用户主动弹出的，不该被"时间线降显著度"按掉
    if (n('.video-js')) {
      assert.ok(n('.mini-player') >= 1,
        `${file}: 小窗播放器容器不在了 —— 「卡内 / 卡外」的作用域假设需要重新核对`);
      assert.equal(players + n('.mini-player .video-js'), n('.video-js'),
        `${file}: 出现了既不在卡内、也不在小窗里的播放器 —— 作用域假设需要重新核对`);
    }
  }

  assert.ok(sawFeedVideo > 0,
    '所有夹具里都没有卡内视频 ⇒ 这条守卫空转（视频锚点可能已失效，或夹具换了一批）');
});

test('L1：单图行规则确实命中真快照，且 u-col-1 在卡内全部是「带内联高度的单图行」（§12-B16 真机修正的不变量）', { skip: skipVideo }, () => {
  // 起因（2026-10-15 真机验收）：图片缩了、卡片没矮、图下留 84px 空白 ——
  // 根因是显式 height 有两处（.woo-picture-main 与外层行 .u-col-1 各一份内联 height:224px）。
  // 这条测试焊住两个不变量：
  //   ① `.wbpro-scroller-item .u-col-1` 在真快照里真的命中（规则不空转）；
  //   ② 卡内每个 u-col-1 都「含 woo-picture-main + 自带内联 height」——
  //      若微博哪天把 u-col-1 挪作他用，height:auto 会误伤 ⇒ 这里先红。
  let sawRow = 0;
  for (const file of fixtures) {
    const { document } = parseHTML(readFileSync(join(FIXTURE_DIR, file), 'utf8'));
    for (const row of document.querySelectorAll('.wbpro-scroller-item .u-col-1')) {
      sawRow++;
      assert.ok(row.querySelector('.woo-picture-main'),
        `${file}: 卡内 u-col-1 不含 woo-picture-main —— 它不再专属单图行，height:auto 会误伤，需重评`);
      const inline = row.getAttribute('style') || '';
      assert.match(inline, /height/,
        `${file}: 单图行 u-col-1 没有内联 height 了 —— 「重复声明」前提被打破（height:auto 或已无必要，或结构变了）`);
    }
  }
  assert.ok(sawRow > 0,
    '所有夹具里都没有卡内 u-col-1 ⇒ 规则空转（单图行锚点可能已失效，或夹具换了一批）');
});

test('L1：微博 JS 裁切方案确实存在「负 top 偏移」的竖图格（img 全接管 cover 的机制前提）', { skip: skipVideo }, () => {
  // 起因（2026-10-15 真机「九宫格有的缩有的不缩」）：微博按图片原始比例给 img 写内联
  // 「height:133% + top:-33%」做居中裁切 —— 旧的 partial 覆盖（height:100%+top:auto）
  // 会留下自相矛盾的几何，B17 实锤为黑图凶手 ⇒ 现行 cover 全接管把配对内联整体作废。
  // 这条测试焊住机制前提：夹具里必须能找到「负 top 偏移」的 img
  //（微博改掉这套方案时这里先红，届时 cover 的必要性需重评）。
  let sawOffset = 0;
  for (const file of fixtures) {
    const { document } = parseHTML(readFileSync(join(FIXTURE_DIR, file), 'utf8'));
    for (const img of document.querySelectorAll('.wbpro-scroller-item .woo-picture-main img')) {
      const inline = img.getAttribute('style') || '';
      if (/top:\s*-\d/.test(inline)) sawOffset++;
    }
  }
  assert.ok(sawOffset > 0,
    '夹具里没有负 top 偏移的图片格 —— 微博的 JS 裁切方案可能变了，img top:auto 的必要性需重评');
});

test('L1：卡内媒体类全部活在 feed-content / retweet 之内（媒体规则三轮收窄的前提，评论面板豁免的依据）', { skip: skipVideo }, () => {
  // 起因（2026-10-15 真机实锤）：评论面板（摘要条点开的评论区）在**卡内**、复用同一批组件类
  // ⇒ 裸「卡内 .woo-picture-main」会误伤评论图（错位 + 黑框，用户截图）。
  // 修法 = 作用域收窄到 .wbpro-feed-content / .retweet。这条测试焊住收窄的前提：
  // 卡内所有 woo-picture-main / u-col-1 必须在这两个区域之内 —— 若微博哪天把媒体放到
  // 别的位置（收窄后会漏掉它），这里先红。
  let sawPic = 0, sawRow = 0;
  for (const file of fixtures) {
    const { document } = parseHTML(readFileSync(join(FIXTURE_DIR, file), 'utf8'));
    for (const sel of ['.woo-picture-main', '.u-col-1']) {
      for (const el of document.querySelectorAll(`.wbpro-scroller-item ${sel}`)) {
        if (sel === '.woo-picture-main') sawPic++; else sawRow++;
        const scoped = el.closest('.wbpro-feed-content') || el.closest('.retweet');
        assert.ok(scoped,
          `${file}: 卡内 ${sel} 不在 feed-content / retweet 之内 —— 收窄后的媒体规则会漏掉它，需重评作用域`);
      }
    }
  }
  assert.ok(sawPic > 0, '所有夹具里都没有卡内 woo-picture-main ⇒ 这条守卫空转');
});

test('L1：卡内 u-col-N 只有 1/3/4（⑦c 子格选择器覆盖面的前提）', { skip: skipVideo }, () => {
  // ⑦c 行子格压宽只列了 u-col-1/3/4（probeMedia3 真机读数 13 行全是这三种）。
  // 若微博哪天引入别的列数（u-col-2 / u-col-5…），那些行不会被压宽 ⇒ 这里先红，需把新列数补进规则。
  const seen = new Set();
  let sawRow = 0;
  for (const file of fixtures) {
    const { document } = parseHTML(readFileSync(join(FIXTURE_DIR, file), 'utf8'));
    for (const el of document.querySelectorAll('.wbpro-feed-content [class*="u-col-"], .retweet [class*="u-col-"]')) {
      const m = /(?:^|\s)u-col-(\d+)/.exec(el.getAttribute('class') || '');
      if (m) { seen.add(m[1]); sawRow++; }
    }
  }
  assert.ok(sawRow > 0, '所有夹具里都没有 u-col-* 行 ⇒ 这条守卫空转');
  const unknown = [...seen].filter((n) => !['1', '3', '4'].includes(n));
  assert.deepEqual(unknown, [],
    `卡内出现了 ⑦c 未覆盖的列数 u-col-${unknown.join('/u-col-')} —— 请把它补进行子格压宽规则并重评`);
});
