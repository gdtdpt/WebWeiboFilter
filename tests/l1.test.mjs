/**
 * L1「素净」的规则守卫（PROJECT.md §7.5 第一批 · 零高度影响子集）
 *
 * 这个文件测的不是"CSS 长什么样"，而是**两条纪律**（它们比具体规则值钱得多）：
 *
 *   ① **零高度影响** —— B2 已证虚拟列表位置来自预计算的 `translateY` 缓存、从不重测尺寸
 *      ⇒ 这一批任何改动卡片高度的属性都可能留洞 / 漂移。所以用一张「会改尺寸的属性」黑名单
 *      逐条扫描 `l1Css()`：谁不小心写了 `font-size` / `padding` / `border` / `height`，测试立刻红。
 *      （唯一的白名单：`display:none`，但只允许出现在行内角标规则上 —— 行内小图标不占行高。）
 *
 *   ② **锚点纪律** —— 选择器里不许出现构建哈希（`_logo_18dhr_77`）或 `__yawf_*`（外部注入）。
 *      这两样一出现，微博改版 / 关掉别的脚本后就静默失效，而且很难查。
 *
 * 另测 `appearanceCss()` 的档位语义（L2 蕴含 L1）与 `ensureStyle()` 的幂等 / 更新行为。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { l1Css, L1_RULE_COUNT } from '../src/features/l1.js';
import { appearanceCss } from '../src/features/appearance.js';
import { composeCss, ensureStyle, FILTER_CSS, STYLE_ID } from '../src/apply/style.js';

let parseHTML = null;
try {
  ({ parseHTML } = await import('linkedom'));
} catch (_e) {
  parseHTML = null;
}

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

/** 会改变盒子尺寸（进而改变项高度）的属性 —— 这一批里一个都不许出现 */
const SIZE_AFFECTING = [
  'height', 'min-height', 'max-height', 'width', 'min-width', 'max-width',
  'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
  'border', 'border-top', 'border-bottom', 'border-width', 'border-style',
  'font-size', 'font-family', 'line-height', 'letter-spacing', 'word-spacing',
  'position', 'top', 'left', 'right', 'bottom', 'overflow', 'flex', 'order',
];

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

test('L1：零高度影响 —— 不许出现任何会改变盒子尺寸的属性', () => {
  for (const r of parseRules(l1Css())) {
    for (const d of r.decls) {
      if (!SIZE_AFFECTING.includes(d.prop)) continue;
      const bare = d.value.replace(/\s*!important$/, '').trim();
      const whitelisted = d.prop === 'display' && bare === 'none' && r.selector.includes('woo-icon');
      assert.ok(whitelisted,
        `${r.selector} 用了会改尺寸的属性「${d.prop}: ${bare}」—— 这一批必须零高度影响（§12-B2）`);
    }
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
  assert.match(css, /\.wbpro-feed-ogText/, '正文规则丢了');
  assert.match(css, /\.wbpro-scroller-item/, '卡片规则丢了');
  assert.match(css, /a\[href="\/"\]\[aria-label\]/, 'logo 规则丢了');
  // 分割线必须用 box-shadow 的写法（border-bottom 会占 1px 布局 ⇒ 改高度）
  assert.match(css, /box-shadow:0 1px 0/, '卡片分割线没有用 box-shadow');
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
    if (r.selector.includes('woo-avatar-img') || r.selector.includes('woo-picture')) {
      assert.match(body, /saturate\((?:0?\.[1-9])\)/, `${r.selector} 缺 saturate(α) 降饱和`);
    }
  }
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
