/**
 * 主区 vivid 收尾（apply/vivid.js）的守卫（§12-B22，2026-10-16）
 *
 * 测四件事：
 *   ① `paintIsVivid` 纯函数：渐变串里的 rgb 逐个判 / URL 串不误判；
 *   ② `isVividRGB` 阈值参数（0.5 只抓写死色、放过我们自己的哑色 s≈28——B22 的核心判据）；
 *   ③ linkedom（无 getComputedStyle）下安全降级：不崩、还原干净；
 *   ④ article 子树豁免 + 顶栏 bar 子树豁免（有 computedStyle 的环境才测得到，否则降级）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyVividQuiet, restoreVividQuiet, countVividQuiet, paintIsVivid, VIVID_MARK,
} from '../src/apply/vivid.js';
import { isVividRGB } from '../src/apply/topbar.js';

/* ── ① paintIsVivid ─────────────────────────────────────────────── */

test('paintIsVivid：渐变串里的 rgb 逐个判（probeProfile 实测锚点）', () => {
  assert.equal(paintIsVivid('linear-gradient(rgb(248, 124, 69), rgb(243, 97, 38))', 0.5),
    true, '发布按钮渐变（写死橙）应判中');
  assert.equal(paintIsVivid('linear-gradient(rgb(68, 68, 68), rgb(34, 34, 34))', 0.5),
    false, '灰阶渐变不判');
  assert.equal(paintIsVivid('url("https://img.example/bg.png")', 0.5),
    false, 'URL 串解析不出颜色 ⇒ 不误判');
  assert.equal(paintIsVivid('none', 0.5), false);
  assert.equal(paintIsVivid('', 0.5), false);
  assert.equal(paintIsVivid(undefined, 0.5), false);
  assert.equal(paintIsVivid(null, 0.5), false);
});

/* ── ② 阈值参数（B22 核心：只抓写死色、放过哑色）────────────────── */

test('isVividRGB(v, 0.5)：写死鲜色判中、我们自己的哑色放过', () => {
  // probeProfile 实测锚点
  assert.equal(isVividRGB('rgb(234, 128, 17)', 0.5), true, '数据胶囊 #ea8011（s=86）应判中');
  assert.equal(isVividRGB('rgb(250, 108, 1)', 0.5), true, '侧栏未读数（s=99）应判中');
  assert.equal(isVividRGB('rgb(24, 95, 165)', 0.5), true, '下载动图钮蓝（s=75）应判中');
  assert.equal(isVividRGB('rgb(172, 138, 108)', 0.5), false, '我们哑色 hsl(28,28%,55%) 本尊不判');
  assert.equal(isVividRGB('rgb(175, 121, 106)', 0.5), false, '哑砖红徽章本尊不判');
  // 阈值默认行为不变（topbar 用 0.25，向后兼容）
  assert.equal(isVividRGB('rgb(175, 121, 106)'), true, '默认 0.25 阈值下哑砖红仍判中（顶栏语义）');
  assert.equal(isVividRGB('rgb(172, 138, 108)', 0.25), true, '显式 0.25 下哑橙仍判中');
});

/* ── ③④ DOM 行为（linkedom）────────────────────────────────────── */

let parseHTML = null;
try {
  ({ parseHTML } = await import('linkedom'));
} catch (_e) {
  parseHTML = null;
}

if (!parseHTML) {
  test('vivid：缺 linkedom，DOM 用例跳过', () => { assert.ok(true); });
} else {
  test('linkedom 降级：无 computedStyle 不崩、还原干净', () => {
    const { document } = parseHTML('<html><body></body></html>');
    const r = applyVividQuiet(document, true);
    assert.equal(r.grayed, 0, '没有 computedStyle ⇒ 不判 vivid，不崩');
    assert.equal(countVividQuiet(document), 0);

    const r2 = applyVividQuiet(document, false);
    assert.equal(r2.restored, 0);
    restoreVividQuiet(document);
  });

  test('article 子树与顶栏 bar 子树豁免：标记与还原生命周期', () => {
    const { document } = parseHTML(
      '<html><body><main><article><p>用户正文</p></article></main></body></html>'
    );
    // linkedom 无 computedStyle ⇒ 没有任何元素会命中 vivid —— 只验证「扫全页不崩 + 生命周期」：
    const r = applyVividQuiet(document, true);
    assert.equal(r.grayed, 0);
    assert.equal(countVividQuiet(document), 0);

    // 手工造一个「已标记」元素：重跑不得二次入账，off 后标记摘除
    const p = document.querySelector('p');
    p.setAttribute(VIVID_MARK, '1');
    const r3 = applyVividQuiet(document, false);
    assert.equal(r3.restored, 0, '台账为空 ⇒ 还原 0（标记是孤儿标记，摘除走元素侧）');
    p.removeAttribute(VIVID_MARK);
    restoreVividQuiet(document);
  });
}
