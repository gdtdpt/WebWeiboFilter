/**
 * 顶栏降显著（apply/topbar.js + l2.js ⓪）的守卫（§7.5-F，2026-10-16）
 *
 * 测五件事：
 *   ① `isVividRGB` 纯函数的判据（probeTopbar 实测锚点：徽章 bg vivid / 按钮 bg 不）；
 *   ①b `hasPaintSource` 纯函数（二轮补丁：发布圆钮的橙在 background-image / 伪元素上，
 *       颜色通道读不到 —— backgroundImage 非 none 即「有涂料」）；
 *   ② l2.js ⓪ 分类条规则存在（.wbpro-tab2 display:none，库类锚 + 首帧防闪烁）；
 *   ③ linkedom（无 gBCR / getComputedStyle）下安全降级：不崩、分类条整行照收（不依赖计算色）；
 *   ④ 可逆：还原后标记摘除、display 复原。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyTopbarQuiet, restoreTopbarQuiet, countTopbarQuiet, isVividRGB, hasPaintSource, TOPBAR_MARK,
} from '../src/apply/topbar.js';
import { l2Css } from '../src/features/l2.js';

/* ── ① vivid 判据 ────────────────────────────────────────────────── */

test('isVividRGB：probeTopbar 实测锚点', () => {
  assert.equal(isVividRGB('rgb(175, 121, 106)'), true, '消息徽章 bg（哑色映射后仍 s≈30）应判 vivid');
  assert.equal(isVividRGB('rgb(255, 130, 0)'), true, '微博原版橙应判 vivid');
  assert.equal(isVividRGB('rgb(44, 44, 44)'), false, '顶栏按钮 bg（哑色映射后）不判');
  assert.equal(isVividRGB('rgb(211, 211, 211)'), false, '灰不判');
  assert.equal(isVividRGB('rgba(0, 0, 0, 0)'), false, '透明不判');
  assert.equal(isVividRGB('rgb(255, 255, 255)'), false, '白不判');
  assert.equal(isVividRGB('rgb(0, 0, 0)'), false, '黑不判');
  assert.equal(isVividRGB(''), false);
  assert.equal(isVividRGB(null), false);
  assert.equal(isVividRGB('not-a-color'), false);
});

/* ── ①b 涂料判据（二轮补丁：发布圆钮的橙在 background-image / 伪元素上）── */

test('hasPaintSource：background-image 非 none 即「有涂料」', () => {
  assert.equal(hasPaintSource({ backgroundImage: 'linear-gradient(rgb(248, 100, 0), rgb(200, 80, 0))' }),
    true, '橙色渐变背景 = 发布圆钮的橙，必须判中');
  assert.equal(hasPaintSource({ backgroundImage: 'url("https://img.example/bg.png")' }), true, '背景图算涂料');
  assert.equal(hasPaintSource({ backgroundImage: 'none' }), false);
  assert.equal(hasPaintSource({ backgroundImage: '' }), false, '空串当 none（浏览器常态）');
  assert.equal(hasPaintSource({}), false);
  assert.equal(hasPaintSource(null), false);
  assert.equal(hasPaintSource(undefined), false);
});

/* ── ② 分类条 CSS 规则 ───────────────────────────────────────────── */

test('l2Css：.wbpro-tab2 整条隐藏规则存在（库类锚 + display 安全）', () => {
  const css = l2Css({ appearance: {} });
  const ruleLine = css.split('\n').find((l) => l.includes('.wbpro-tab2'));
  assert.ok(ruleLine, 'l2Css 应含 .wbpro-tab2 规则');
  assert.ok(/display:\s*none\s*!important/.test(ruleLine), '应为 display:none !important');
  assert.ok(!/[#.]_slot_/.test(ruleLine), '🔴 禁止把 _slot_ 哈希类写进 CSS 选择器');
});

/* ── ③④ DOM 行为（linkedom）────────────────────────────────────── */

let parseHTML = null;
try {
  ({ parseHTML } = await import('linkedom'));
} catch (_e) {
  parseHTML = null;
}

if (!parseHTML) {
  test('topbar：缺 linkedom，DOM 用例跳过', () => { assert.ok(true); });
} else {
  function makeDoc() {
    const { document } = parseHTML('<html><body></body></html>');
    const body = document.body;
    // logo 锚 + bar 骨架（无 gBCR ⇒ findTopbar 找不到 bar，走降级路径）
    const bar = document.createElement('div');
    const left = document.createElement('div');
    const logo = document.createElement('a');
    logo.setAttribute('href', '/');
    logo.setAttribute('aria-label', 'SpecBase');
    left.appendChild(logo);
    bar.appendChild(left);
    body.appendChild(bar);
    // 分类条：_slot_ 祖先行（哈希类）> 匿名 > .wbpro-tab2
    const slot = document.createElement('div');
    slot.setAttribute('class', '_slot_14sig_16');
    const anon = document.createElement('div');
    const tab2 = document.createElement('div');
    tab2.setAttribute('class', 'wbpro-tab2');
    anon.appendChild(tab2);
    slot.appendChild(anon);
    body.appendChild(slot);
    return { document, bar, slot, tab2 };
  }

  test('linkedom 降级：不依赖 gBCR / 计算色也能收掉分类条整行', () => {
    const ctx = makeDoc();
    const r = applyTopbarQuiet(ctx.document, true);
    assert.equal(r.collapsed, 1, '分类条 _slot_ 行应被收掉');
    assert.equal(r.grayed, 0, 'bar 不可定位（无 gBCR）⇒ 灰度 0，不崩');
    assert.equal(ctx.slot.getAttribute(TOPBAR_MARK), '1');
    assert.equal(ctx.slot.style.display, 'none');
    assert.ok(countTopbarQuiet(ctx.document) >= 1);

    // 幂等：重跑不再新增
    const r2 = applyTopbarQuiet(ctx.document, true);
    assert.equal(r2.collapsed, 0);

    // 还原
    const r3 = applyTopbarQuiet(ctx.document, false);
    assert.equal(r3.restored, 1);
    assert.equal(ctx.slot.getAttribute(TOPBAR_MARK), null);
    assert.notEqual(ctx.slot.style.display, 'none');
    assert.equal(countTopbarQuiet(ctx.document), 0);
  });

  test('分类条不存在时安全空转', () => {
    const { document } = parseHTML('<html><body></body></html>');
    const r = applyTopbarQuiet(document, true);
    assert.equal(r.collapsed, 0);
    assert.equal(r.grayed, 0);
    restoreTopbarQuiet(document);
  });
}
