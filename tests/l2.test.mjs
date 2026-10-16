/**
 * L2「工单式重排」的规则守卫（PROJECT.md §7.5.2 / §7.5.4）
 *
 * 与 `l1.test.mjs` 同一套纪律，但 L2 **本身就是改高度批次**（时间列内边距、L2 字号、
 * γ 头像脱流都改卡高），所以这里的 SIZE_EXEMPT 不是「例外登记」而是**主体**：
 * 每一条改尺寸规则都必须写明「改的是什么、靠什么兜底」。锚点纪律与 L1 完全一致。
 *
 * 另测 appearanceCss 的档位语义（L2 蕴含 L1 且拼在其后）、头像三变体的开关矩阵。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  l2Css, L2_TEXT_FONT_SIZE, L2_TEXT_LINE_HEIGHT, AVATAR_VARIANTS,
  normalizeAvatarBgSize, AVATAR_BG_SIZE_DEFAULT,
} from '../src/features/l2.js';
import { l1Css } from '../src/features/l1.js';
import { appearanceCss } from '../src/features/appearance.js';

/** 逐行拆成 {selector, decls:[{prop,value}]}（`l2Css()` 保证一条规则一行） */
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

/** 会改变盒子尺寸的属性黑名单 —— 与 l1.test.mjs 同一张表（改一条记得同步另一条） */
const SIZE_AFFECTING = [
  'height', 'min-height', 'max-height', 'width', 'min-width', 'max-width',
  'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
  'border', 'border-top', 'border-bottom', 'border-width', 'border-style',
  'font-size', 'font-family', 'line-height', 'letter-spacing', 'word-spacing',
  'position', 'top', 'left', 'right', 'bottom', 'overflow', 'flex', 'order',
  'display',
];

/**
 * L2 改尺寸规则的登记表 —— L2 本来就是改高度批次，每条「有名有姓有理由」：
 * 兜底一律是**首帧注入机制**（§12-B12：document-start 注入的 CSS 会被算进
 * 虚拟列表预计算尺寸）+ 真机「不留洞」复验。
 */
const L2_SIZE_EXEMPT = [
  {
    sel: /^div\.woo-box-flex:has\(> \.grayTheme\):has\(main\.woo-box-flex\) > \.grayTheme$/,
    props: ['order'],
    why: '三列重排：左栏移最右 —— order 只改 flex 排列次序，列宽不变 ⇒ 期望零高度影响'
      + '（⚠️ 选择器禁止嵌套 :has() —— 两个并列 :has()，2026-10-16 真机根因 ①）',
  },
  {
    sel: /^div\.woo-box-flex:has\(> \.grayTheme\):has\(main\.woo-box-flex\)$/,
    props: ['width', 'max-width'],
    why: '_content_ 分栏层 width:100%（fit-content 收缩盒的宽度基准，真机根因 ②）⇒ 信息流列宽'
      + '变化 ⇒ 卡宽/卡高变化 —— 改高度项，首帧兜底',
  },
  {
    sel: /^main\.woo-box-flex > div:has\(\.wbpro-side-main\)$/,
    props: ['display'],
    why: '收右栏空壳（L1 ⑧ 只藏内容，壳仍占 282px）—— 虚拟列表之外的流式容器，A 类逻辑安全',
  },
  {
    sel: /^div:has\(> main\.woo-box-flex\)$/,
    props: ['flex', 'width', 'max-width'],
    why: '信息流加宽：包裹层放开定宽吃自由空间 ⇒ 列宽变化 ⇒ 卡宽/卡高变化 —— 改高度项，首帧兜底',
  },
  {
    sel: /^main\.woo-box-flex$/,
    props: ['width'],
    why: '信息流加宽：main 放开定宽跟随包裹层 —— 同上，改高度项，首帧兜底',
  },
  {
    sel: /^main\.woo-box-flex > div:has\(\.vue-recycle-scroller\)$/,
    props: ['flex', 'width', 'max-width'],
    why: '信息流加宽：主列 _full_ flex:1 吃掉右栏空出的 290px —— 改高度项，首帧兜底',
  },
  {
    sel: /\.wbpro-scroller-item article$/,
    props: ['padding-left'],
    why: '腾出时间列：正文换行数变化 ⇒ 卡高变化 —— 改高度项，首帧兜底（background 不在名单）',
  },
  {
    sel: /header a\[title\^="20"\]$/,
    props: ['position', 'top', 'left', 'width', 'font-family', 'font-size', 'line-height'],
    why: '时间成列：absolute 脱流不改卡高（header 原位剩来源条，probeL2 实测无塌陷）；'
      + '宽/字号只影响脱流后的自身盒子 —— 期望零高度影响',
  },
  {
    sel: /\.wbpro-feed-(ogText|reText)/,
    props: ['font-size', 'line-height'],
    why: 'L2 排版 13px/1.5（§7.5-C）：字号行距 = 卡高变化 —— 改高度项，首帧兜底（同 L1 ⑧）',
  },
  {
    sel: /\.wbpro-scroller-item article::before$/,
    props: ['position', 'top', 'left', 'width', 'height'],
    why: 'β 头像水印：::before 绝对定位 + pointer-events:none ⇒ 不占布局、零高度影响；'
      + '宽高 = 水印边长（avatarBgSize，正方形 cover 不变形）。图片数据由扫描管线写成'
      + ' --spb-avatar-bg（apply/avatarbg.js）',
  },
  {
    sel: /header \.woo-avatar-main$/,
    props: ['position', 'top', 'left', 'width', 'height'],
    why: 'γ 头像：整盒脱流挪进时间列 ⇒ header 高度塌缩（原 52px 由头像撑）—— 改高度项，'
      + '首帧兜底；仅 avatarVariant:"gamma" 时注入',
  },
];

test('L2 规则全部通过改尺寸审查（SIZE_EXEMPT 逐条登记）', () => {
  const rules = parseRules(l2Css({}));
  assert.ok(rules.length >= 7, `L2 至少 7 条规则，实际 ${rules.length}`);
  for (const r of rules) {
    const sizeProps = r.decls.filter((d) => SIZE_AFFECTING.includes(d.prop)).map((d) => d.prop);
    if (!sizeProps.length) continue;
    const reg = L2_SIZE_EXEMPT.find((x) => x.sel.test(r.selector));
    assert.ok(reg, `规则未登记改尺寸属性 [${sizeProps.join(',')}]: ${r.selector}`);
    for (const p of sizeProps) {
      assert.ok(reg.props.includes(p), `属性 ${p} 未在登记项里声明（${r.selector}）`);
    }
  }
});

test('L2 锚点纪律：禁构建哈希与外部注入类', () => {
  const css = l2Css({});
  assert.doesNotMatch(css, /_[a-z]+_[0-9]+[a-z0-9_]*[/\s,{]/, '出现构建哈希类');
  assert.doesNotMatch(css, /__yawf/, '出现外部脚本注入类');
  // 主题色纪律：颜色只走令牌；mask 渐隐的 black 是 alpha 遮罩、与主题无关（唯一放行）
  const hexColors = css.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(hexColors, [], `出现写死的十六进制颜色：${hexColors.join(',')}`);
  assert.match(css, /var\(--w-sub\)/, '时间列颜色走主题令牌');
});

test('布局三规则：左栏 order:2 / 右壳 display:none / 主列 flex:1', () => {
  const rules = parseRules(l2Css({}));
  const order = rules.find((r) => /\.grayTheme/.test(r.selector));
  assert.ok(order, '缺三列重排规则');
  assert.equal(order.decls.find((d) => d.prop === 'order').value, '2 !important');
  // 🔴 选择器禁嵌套 :has()（规范禁令，Chrome 丢整条规则 —— 2026-10-16 真机根因 ①）
  assert.doesNotMatch(order.selector, /:has\([^)]*:has\(/, '出现嵌套 :has()');
  assert.equal(order.selector,
    'div.woo-box-flex:has(> .grayTheme):has(main.woo-box-flex) > .grayTheme');

  // _content_ 宽度基准（真机根因 ②：fit-content 收缩盒）
  const content = rules.find((r) => r.selector === 'div.woo-box-flex:has(> .grayTheme):has(main.woo-box-flex)');
  assert.ok(content, '缺 _content_ 宽度基准规则');
  assert.equal(content.decls.find((d) => d.prop === 'width').value, '100% !important');

  const shell = rules.find((r) => r.selector === 'main.woo-box-flex > div:has(.wbpro-side-main)');
  assert.ok(shell, '缺右栏壳收口规则');
  assert.equal(shell.decls.find((d) => d.prop === 'display').value, 'none !important');

  const mainCol = rules.find((r) => r.selector === 'main.woo-box-flex > div:has(.vue-recycle-scroller)');
  assert.ok(mainCol, '缺主列加宽规则');
  assert.equal(mainCol.decls.find((d) => d.prop === 'flex').value, '1 1 auto !important');
  // 包裹层与 main 的放开规则
  assert.ok(rules.some((r) => r.selector === 'div:has(> main.woo-box-flex)'), '缺包裹层放开规则');
  assert.ok(rules.some((r) => r.selector === 'main.woo-box-flex'), '缺 main 放开规则');
});

test('时间列：absolute + 两行宽 48 + mono + 主题色', () => {
  const rules = parseRules(l2Css({}));
  const time = rules.find((r) => /a\[title\^="20"\]/.test(r.selector));
  assert.ok(time, '缺时间成列规则');
  const get = (p) => (time.decls.find((d) => d.prop === p) || {}).value;
  assert.match(get('position'), /absolute/);
  // left = 目标 14 - 衬距 90 = -76（定位上下文在衬距边缘 —— 2026-10-16 真机根因 ③）
  assert.equal(get('left'), '-76px !important');
  assert.equal(get('top'), '14px !important');
  assert.equal(get('width'), '48px !important');
  assert.match(get('font-family'), /monospace/);
  assert.equal(get('color'), 'var(--w-sub) !important');
  // 作用域：必须限定卡 header（article > div > header），防误捞转发块的时间锚
  assert.match(time.selector, /article > div > header/);
});

test('行代替卡 + 时间列腾位：article 透明 + padding-left', () => {
  const rules = parseRules(l2Css({}));
  const art = rules.find((r) => /\.wbpro-scroller-item article$/.test(r.selector));
  assert.ok(art, '缺 article 规则');
  assert.equal(art.decls.find((d) => d.prop === 'background').value, 'transparent !important');
  assert.equal(art.decls.find((d) => d.prop === 'padding-left').value, '90px !important');
});

test('L2 排版默认 13px/1.5；显式 config 值优先', () => {
  const def = parseRules(l2Css({})).find((r) => /\.wbpro-feed-ogText/.test(r.selector));
  assert.equal(def.decls.find((d) => d.prop === 'font-size').value, `${L2_TEXT_FONT_SIZE}px !important`);
  assert.equal(def.decls.find((d) => d.prop === 'line-height').value, `${L2_TEXT_LINE_HEIGHT} !important`);

  const over = parseRules(l2Css({ appearance: { textFontSize: 15, textLineHeight: 1.8 } }))
    .find((r) => /\.wbpro-feed-ogText/.test(r.selector));
  assert.equal(over.decls.find((d) => d.prop === 'font-size').value, '15px !important');
  assert.equal(over.decls.find((d) => d.prop === 'line-height').value, '1.8 !important');
});

test('头像三变体矩阵：beta 默认整行背景水印 / gamma 入时间列 / alpha 无规则 / 非法回退 beta', () => {
  // ── β（默认）：头像图片作整行背景（2026-10-16 用户二次定稿，推翻「元素 mask」）──
  const beta = parseRules(l2Css({}));
  const before = beta.find((r) => r.selector === '.wbpro-scroller-item article::before');
  assert.ok(before, '默认应为 beta（article::before 整行背景水印）');
  assert.match(before.decls.find((d) => d.prop === 'background-image').value,
    /var\(--spb-avatar-bg\)/, '水印图片必须来自 JS 写入的 CSS 变量');
  assert.match(before.decls.find((d) => d.prop === 'mask-image').value, /linear-gradient\(135deg/,
    '左上向右下 135° 渐隐');
  assert.equal(before.decls.find((d) => d.prop === 'z-index').value, '-1 !important',
    '水印必须沉到正文之下');
  assert.equal(before.decls.find((d) => d.prop === 'pointer-events').value, 'none !important',
    '水印不许挡点击');
  assert.equal(before.decls.find((d) => d.prop === 'left').value, '0 !important',
    '水印从 article 左缘起 = 日期列起点');
  assert.equal(before.decls.find((d) => d.prop === 'width').value, '120px !important');
  assert.equal(before.decls.find((d) => d.prop === 'height').value, '120px !important',
    '正方形 cover ⇒ 正常比例不变形');

  // β 还应把原头像元素藏起来（visibility 保留占位 ⇒ 卡高零变化）
  const hideEl = beta.find((r) => /header \.woo-avatar-main$/.test(r.selector));
  assert.ok(hideEl, 'β 应隐藏原头像元素');
  assert.equal(hideEl.decls.find((d) => d.prop === 'visibility').value, 'hidden !important');
  // β 需要 article 自成堆叠上下文（z-index:-1 不掉进卡片底色之下）。
  // ⚠️ article 有两条规则（③ 行代替卡 / ⑥ isolation）—— 要找带 isolation 的那条。
  const iso = beta.find((r) => r.selector === '.wbpro-scroller-item article'
    && r.decls.some((d) => d.prop === 'isolation'));
  assert.ok(iso, 'β 应给 article 建 stacking context');
  assert.equal(iso.decls.find((d) => d.prop === 'isolation').value, 'isolate !important');

  // ── γ：原样保留 ──
  const gamma = parseRules(l2Css({ appearance: { avatarVariant: 'gamma' } }));
  const gammaRule = gamma.find((r) => /header \.woo-avatar-main$/.test(r.selector));
  assert.ok(gammaRule, 'gamma 应挪头像盒');
  assert.equal(gammaRule.decls.find((d) => d.prop === 'left').value, '-76px !important',
    'γ 头像 left 走衬距补偿负值（根因 ③）');
  assert.equal(gammaRule.decls.find((d) => d.prop === 'width').value, '22px !important');
  assert.ok(!gamma.some((r) => r.selector.endsWith('article::before')),
    'gamma 不应再画整行水印');

  // ── α：无任何头像规则 ──
  const alpha = parseRules(l2Css({ appearance: { avatarVariant: 'alpha' } }));
  assert.ok(!alpha.some((r) => /woo-avatar/.test(r.selector)), 'alpha 应无头像规则');
  assert.ok(!alpha.some((r) => r.selector.endsWith('article::before')), 'alpha 无水印');

  // ── 非法回退 beta ──
  const bad = parseRules(l2Css({ appearance: { avatarVariant: 'wat' } }));
  assert.ok(bad.some((r) => r.selector === '.wbpro-scroller-item article::before'),
    '非法变体应回退 beta');
  assert.deepEqual(AVATAR_VARIANTS, ['alpha', 'beta', 'gamma']);
});

test('β 水印尺寸把手：默认 120 / 显式值生效 / 非法回退 / 越界夹回', () => {
  assert.equal(AVATAR_BG_SIZE_DEFAULT, 120);
  assert.equal(normalizeAvatarBgSize(undefined), 120);
  assert.equal(normalizeAvatarBgSize('x'), 120);
  assert.equal(normalizeAvatarBgSize(96), 96);
  assert.equal(normalizeAvatarBgSize(300), 300);
  assert.equal(normalizeAvatarBgSize(30), 64, '低于下限夹回 64');
  assert.equal(normalizeAvatarBgSize(999), 320, '高于上限夹回 320');

  const sized = parseRules(l2Css({ appearance: { avatarBgSize: 96 } }))
    .find((r) => r.selector === '.wbpro-scroller-item article::before');
  assert.equal(sized.decls.find((d) => d.prop === 'width').value, '96px !important');
});

test('appearanceCss 档位语义：L2 蕴含 L1 且拼在其后（同特异性 L2 胜）', () => {
  const l2Only = appearanceCss({ appearance: { l2: true, l1: false } });
  assert.match(l2Only, /\.grayTheme\{order:2/, 'L2 开启时重排规则在');
  assert.match(l2Only, /\.wbpro-side-main\{display:none/, 'L1 的右栏隐藏规则也在（蕴含）');

  const l1Only = appearanceCss({ appearance: { l1: true, l2: false } });
  assert.doesNotMatch(l1Only, /\.grayTheme\{order:2/, '只开 L1 不应有 L2 规则');

  // 顺序：L2 的 13px 必须出现在 L1 的 14px 之后（后者会被同特异性靠后者覆盖）
  const both = appearanceCss({ appearance: { l1: true, l2: true } });
  const iL1 = both.indexOf('font-size:14px !important;line-height:1.6 !important');
  const iL2 = both.indexOf('font-size:13px !important;line-height:1.5 !important');
  assert.ok(iL1 !== -1 && iL2 !== -1, '两档排版规则都应存在');
  assert.ok(iL2 > iL1, 'L2 排版规则必须拼在 L1 之后');

  const none = appearanceCss({ appearance: { l1: false, l2: false } });
  assert.doesNotMatch(none, /\.grayTheme/, '全关时无 L2 规则');
});
