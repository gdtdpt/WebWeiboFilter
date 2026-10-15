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

import { l1Css, L1_RULE_COUNT } from '../src/features/l1.js';
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
 *   ② `article > footer` 的 `display:none`：**A1 互动按钮行**（§12-B15，2026-10-15 用户拍板）
 *      —— 本项目**第一个登记的改高度项**：卡真实变矮 40px，前提是 §12-B12
 *      （首帧注入的 CSS 会被算进虚拟列表尺寸缓存 ⇒ 缓存按矮卡建）；真机复验「不留洞」是唯一防线。
 *   ③ `article` 的 `position:relative`：摘要条的定位上下文 —— relative 只挪坐标原点、
 *      盒子留在原处 ⇒ 不参与高度。
 *   ④ `[data-spb="stats"]`（摘要条）整条放行：它是我方**绝对定位浮层**，脱离文档流
 *      ⇒ 建 / 更新 / 摘除永远不改卡片高度（§12-B15）。
 */
const SIZE_EXEMPT = [
  { sel: /woo-icon|woo-font--/, prop: 'display', val: 'none', why: '行内叶子图标（认证角标 / 字体图标）' },
  { sel: /article > footer$/, prop: 'display', val: 'none', why: 'A1 互动按钮行 —— 登记改高度项（§12-B15）' },
  { sel: /\.wbpro-scroller-item article$/, prop: 'position', val: 'relative', why: '摘要条定位上下文，不占布局' },
  { sel: /\[data-spb="stats"\]/, prop: '*', val: '*', why: '我方绝对定位摘要条 —— 不进布局流（§12-B15）' },
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

test('L1：SIZE_EXEMPT 的 display:none 只许「行内叶子图标」和「A1 footer」—— 不许开后门', () => {
  // 反向守卫：如果哪天登记表被扩成"什么都放行"，这条会红。
  const rules = parseRules(l1Css()).filter((r) => r.decls.some(
    (d) => d.prop === 'display' && d.value.replace(/\s*!important$/, '').trim() === 'none'));

  assert.ok(rules.length > 0, 'L1 里应当还有 display:none 的登记项（图标 / A1 footer）');
  for (const r of rules) {
    assert.ok(
      /woo-icon|woo-font--/.test(r.selector) || /article > footer$/.test(r.selector),
      `${r.selector}：display:none 只允许用在登记过的目标上（行内叶子图标 / A1 互动按钮行）`);
  }
});

test('L1：A1 互动按钮行 —— footer 规则必须直接子 + 限定卡内；摘要条必须绝对定位', () => {
  const css = l1Css();

  // footer 规则恰好一条、直接子、带 SEL_CARD 前缀（页面其它 footer 不能被误伤）
  const footer = parseRules(css).filter((r) => /article > footer/.test(r.selector));
  assert.equal(footer.length, 1, 'footer 规则应恰好一条');
  assert.match(footer[0].selector, /^\.wbpro-scroller-item article > footer$/,
    `${footer[0].selector}：必须「卡内 + article 直接子」—— 裸锚会误伤转发块内部的 footer 与页面其它 footer`);
  assert.match(footer[0].decls.find((d) => d.prop === 'display').value, /none/,
    'footer 必须 display:none（A1 的改高量 = 卡片真实变矮 40px）');

  // 摘要条：绝对定位 + bottom:0（不进布局流 ⇒ 建/更/摘不改卡片高度）+ 可点击（不许 pointer-events:none）
  const summary = parseRules(css).filter((r) => r.selector.includes('data-spb="stats"'));
  assert.equal(summary.length, 1, '摘要条规则应恰好一条');
  const props = Object.fromEntries(summary[0].decls.map((d) => [d.prop, d.value]));
  assert.match(props.position, /absolute/, '摘要条必须绝对定位 —— 否则它的插入会改卡片高度');
  assert.match(props.bottom, /0/, '摘要条必须贴卡底（footer 腾出的位置）');
  assert.ok(!props['pointer-events'], '摘要条是详情页入口，必须可点（不许 pointer-events:none）');
  assert.match(props.color, /var\(--w-sub\)/, '摘要条颜色必须走主题令牌（禁写死，§12-B9）');
  // 2026-10-15 真机反馈：视频卡上摘要条被播放器压住 ⇒ 必须不透明底色 + 高 z 序
  assert.match(props.background, /var\(--w-card-background\)/,
    '摘要条缺不透明底色 —— 压在视频 / 图片上会不可读（§12-B15）');
  assert.ok(Number.parseInt(props['z-index'], 10) >= 10,
    '摘要条 z-index 必须压过播放器自建的层叠上下文（真机 1 不够）');

  // 定位上下文：article 必须 relative（否则摘要条会飘到更外层的定位祖先上去）
  assert.match(css, /\.wbpro-scroller-item article\{position:relative/,
    '缺少 article 的 relative 定位上下文 —— 摘要条的 bottom:0 将以槽位为基准');
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

test('appearanceCss：L2 蕴含 L1；两个都关时一条规则都不注入', () => {
  const l1 = appearanceCss({ appearance: { l1: true, l2: false } });
  const l2 = appearanceCss({ appearance: { l1: false, l2: true } });
  const off = appearanceCss({ appearance: { l1: false, l2: false } });

  assert.ok(l1.length > 0);
  assert.equal(l2, l1, 'L2 必须蕴含 L1（§7.5.2）');
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
