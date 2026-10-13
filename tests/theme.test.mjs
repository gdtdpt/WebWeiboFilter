/**
 * 「全局去橙红」的纪律守卫（PROJECT.md §7.5 F 组）
 *
 * 这个模块的手法很特别 —— **一条选择器都不写**，只覆盖微博自己的 CSS 变量
 * （实测：`:root` 上 485 个生效变量里，橙红全由 5 个根变量级联而来）。
 * 手法越"轻"，越容易被后来者不小心写坏，所以这里守四条：
 *
 *   ① **只许出现自定义属性** —— 一旦有人往这张表里塞 `color:` / `font-size:` 这类真实属性，
 *      它就变成"一套碰尺寸的样式"，B2 那条零高度影响的前提当场失效。
 *   ② **取值只许是主题令牌或中性灰** —— 写死 `#ea8011` 之类等于没去橙红；写死 `#333`
 *      会在另一套主题上翻车（这正是 L1 第一批踩过的坑，见 §12-B9）。
 *   ③ **语义色必须放过** —— `--w-error` / `--w-color-red-2` 是**功能反馈**，
 *      按 §7.5.0「降显著度不是删除」，把错误提示也弄灰属功能退化。
 *   ④ **必须带 `!important`** —— 深色主题在 `[data-theme="dark"]:root` 里用字面量
 *      重定义同一批变量（优先级 0,1,1 > 我们的 0,1,0），不带 `!important` 就完全无效。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { themeCss, THEME_VAR_COUNT, NEUTRALIZE_VARS, THEME_SELECTOR } from '../src/features/theme.js';
import { appearanceCss } from '../src/features/appearance.js';

/** 拆出 [变量名, 取值] 列表（`themeCss()` 是单行 `:root{...}`） */
function decls() {
  const css = themeCss().trim();
  const open = css.indexOf('{');
  const body = css.slice(open + 1, css.lastIndexOf('}'));
  return body.split(';').filter(Boolean).map((d) => {
    const i = d.indexOf(':');
    return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
  });
}

test('theme：只有一个 :root 规则、零真实属性、条数与常量一致', () => {
  const css = themeCss();
  assert.equal(css.trim().split('\n').length, 1, '去橙红应当只有一条 :root 规则（多行说明有人加了选择器）');
  assert.ok(css.startsWith(`${THEME_SELECTOR}{`), `首选择器必须是 ${THEME_SELECTOR}`);
  assert.equal(decls().length, THEME_VAR_COUNT);
  assert.equal(THEME_VAR_COUNT, Object.keys(NEUTRALIZE_VARS).length);

  for (const [k] of decls()) {
    assert.ok(k.startsWith('--'), `表里混进了真实属性「${k}」—— 这里只许覆盖自定义属性`);
  }
});

test('theme：每条覆盖都带 !important（不带就压不过深色主题的 [data-theme="dark"]:root）', () => {
  for (const [, v] of decls()) {
    assert.match(v, /!important$/, `取值「${v}」缺 !important`);
  }
});

test('theme：取值只用主题令牌或中性灰，不许写死明暗色', () => {
  const ALLOWED_VAR = /^var\(--w-(main|sub)\)$/;
  const ALLOWED_NEUTRAL = /^rgba\((128,128,128|0,0,0),\.\d+\)$/;

  for (const [k, v] of decls()) {
    const bare = v.replace(/\s*!important$/, '');
    assert.ok(ALLOWED_VAR.test(bare) || ALLOWED_NEUTRAL.test(bare),
      `${k} 的取值「${bare}」不合规 —— 只许 var(--w-main) / var(--w-sub) 或中性半透明灰`);

    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(bare), `${k} 用了写死的十六进制色：${bare}`);
  }
});

test('theme：语义色必须放过（错误提示是功能反馈，不是装饰）', () => {
  for (const k of ['--w-error', '--w-color-red-2', '--w-tip-fill-error']) {
    assert.equal(Object.prototype.hasOwnProperty.call(NEUTRALIZE_VARS, k), false,
      `${k} 是语义色，不该被中性化（§7.5.0「降显著度不是删除」）`);
  }
});

test('theme：级联链的根变量确实被覆盖（否则浅色主题下改了中继层也没用）', () => {
  // 实测关系：orange-1→brand、orange-2→brand-hover、orange-3→alink、red→special
  for (const k of ['--w-color-orange-1', '--w-color-orange-2', '--w-color-orange-3', '--w-color-red']) {
    assert.ok(k in NEUTRALIZE_VARS, `级联链根 ${k} 没被覆盖`);
  }
  // 中继层也必须覆盖（深色主题用字面量重定义它们，链会断）
  for (const k of ['--w-brand', '--w-brand-hover', '--w-alink', '--w-special']) {
    assert.ok(k in NEUTRALIZE_VARS, `中继变量 ${k} 没被覆盖`);
  }
});

test('theme：随外观档一起注入，且两个档位都关时不注入', () => {
  const on = appearanceCss({ appearance: { l1: true } });
  assert.ok(on.includes(THEME_SELECTOR + '{'), 'L1 开启时应带上去橙红');

  const l2 = appearanceCss({ appearance: { l2: true } });
  assert.equal(l2, on, 'L2 蕴含 L1 ⇒ 也应带上去橙红（§7.5.2）');

  assert.equal(appearanceCss({ appearance: { l1: false, l2: false } }), '');
  assert.equal(appearanceCss(null), '');
});
