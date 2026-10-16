/**
 * 品牌文案换中性（apply/brandtext.js）的守卫（§7.5-F/G，§12-B20）
 *
 * 测五件事：
 *   ① 规则表契约：每条样例的改写值**不得再命中任何规则**（pattern 幂等的根基）；
 *   ② 🟢 用户正文免疫：含「微博」的长句 / 非徽章元素的 title 一律不命中；
 *   ③ DOM 生命周期：改写 → 重扫幂等（计数不变）→ 还原逐字一致；
 *   ④ logo：SVG 换 SpecBase 文字标 + aria-label 改写；aria-label 非 Weibo 的锚不动；
 *   ⑤ 徽章门：badgeOnly 规则只认 woo-icon-* / _icon_/_fans_/_verify_ 特征元素。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyBrandText, restoreBrandText, countBrandText,
  brandTextTarget, brandAttrTarget,
  BRAND_TEXT_RULES, BRAND_ATTR_RULES, LOGO_WORD,
} from '../src/apply/brandtext.js';

let parseHTML = null;
try {
  ({ parseHTML } = await import('linkedom'));
} catch (_e) {
  parseHTML = null;
}

/* ── ① 规则表契约 ─────────────────────────────────────────────────── */

test('brandTextTarget：白名单样例命中', () => {
  assert.equal(brandTextTarget('最新微博'), '最新');
  assert.equal(brandTextTarget('原微博'), '原文');
  assert.equal(brandTextTarget('来自 微博网页版'), '来自 网页版');
  assert.equal(brandTextTarget('来自 微博视频号'), '来自 视频号');
  assert.equal(brandTextTarget('来自 微博bb机'), '来自 bb机');
});

test('brandTextTarget：用户正文免疫（🔴 红线：内容不可篡改）', () => {
  assert.equal(brandTextTarget('今天发了一条微博，很开心'), null);
  assert.equal(brandTextTarget('微博 wedding 现场直击！转发抽奖'), null);
  assert.equal(brandTextTarget('原微博说的是这个意思，大家理性讨论'), null);
  assert.equal(brandTextTarget('转发微博'), null);  // 转发语前缀 —— 不在白名单，宁可放过
  assert.equal(brandTextTarget(''), null);
  assert.equal(brandTextTarget(null), null);
});

test('规则表幂等根基：每个样例的输出不再命中任何规则', () => {
  const textSamples = ['最新微博', '原微博', '来自 微博网页版', '来自 微博bb机'];
  for (const s of textSamples) {
    const t = brandTextTarget(s);
    assert.notEqual(t, null, `样例 ${s} 应命中`);
    assert.equal(brandTextTarget(t), null, `输出「${t}」不得再命中（幂等根基）`);
  }
  const attrSamples = [
    ['placeholder', '搜索微博', null], ['title', '最新微博', null],
    ['title', '发微博', null], ['title', '定时微博', null], ['alt', '定时微博', null],
    ['title', '来自 微博网页版', null],
    ['title', '微博会员', 'badge'], ['title', '微博创作者经营会员', 'badge'],
    ['aria-label', 'Weibo', null],
  ];
  for (const [attr, s, mode] of attrSamples) {
    const el = mode === 'badge' ? { getAttribute: () => 'woo-icon-wrap _icon_x_2' }
                                : { getAttribute: () => '' };
    const t = brandAttrTarget(attr, s, el);
    assert.notEqual(t, null, `样例 ${attr}=${s} 应命中`);
    assert.equal(brandAttrTarget(attr, t, el), null, `输出「${t}」不得再命中（幂等根基）`);
  }
});

/* ── ② 属性规则 + 徽章门 ─────────────────────────────────────────── */

test('brandAttrTarget：chrome 属性命中', () => {
  const el = { getAttribute: () => '' };
  assert.equal(brandAttrTarget('placeholder', '搜索微博', el), '搜索');
  assert.equal(brandAttrTarget('title', '发微博', el), '发布');
  assert.equal(brandAttrTarget('title', '定时微博', el), '定时发布');
  assert.equal(brandAttrTarget('alt', '定时微博', el), '定时发布');
  assert.equal(brandAttrTarget('title', '来自 微博网页版', el), '来自 网页版');
  assert.equal(brandAttrTarget('aria-label', 'Weibo', el), LOGO_WORD);
  assert.equal(brandAttrTarget('aria-label', 'weibo', el), LOGO_WORD); // 大小写不敏感
});

test('brandAttrTarget：badgeOnly 门 —— 非徽章元素的「微博X」title 不动', () => {
  assert.equal(brandAttrTarget('title', '微博会员', { getAttribute: () => 'woo-icon-wrap _icon_w4fta_2' }), '会员');
  assert.equal(brandAttrTarget('title', '微博社区委员', { getAttribute: () => '_fans_1qsx1_2' }), '社区委员');
  assert.equal(brandAttrTarget('title', '微博优质创作者', { getAttribute: () => 'woo-icon-opacity _verify_1h76l_64' }), '优质创作者');
  assert.equal(brandAttrTarget('title', '微博会员', { getAttribute: () => 'woo-box-flex' }), null);
  assert.equal(brandAttrTarget('title', '微博会员', { getAttribute: () => '' }), null);
});

/* ── ③④ DOM 生命周期 ────────────────────────────────────────────── */

/** 合成一个对齐 probeBrand 读数的页面骨架 */
function makeDoc() {
  const { document } = parseHTML('<html><body></body></html>');
  const body = document.body;

  // logo 锚（SVG 矢量字 + aria-label Weibo）
  const logo = document.createElement('a');
  logo.setAttribute('href', '/');
  logo.setAttribute('aria-label', 'Weibo');
  const svg = document.createElement('svg');
  const path = document.createElement('path');
  svg.appendChild(path);
  logo.appendChild(svg);

  // 右栏 tab（chrome 文本 + title）
  const tab = document.createElement('span');
  tab.textContent = '最新微博';
  const tabWrap = document.createElement('div');
  tabWrap.setAttribute('title', '最新微博');
  tabWrap.appendChild(tab);

  // 搜索框
  const input = document.createElement('input');
  input.setAttribute('class', 'woo-input-main');
  input.setAttribute('placeholder', '搜索微博');

  // 卡内平台文案：来源行（text + title）+ 转发条链接 + 徽章
  const source = document.createElement('div');
  source.textContent = '来自 微博网页版';
  source.setAttribute('title', '来自 微博网页版');
  const origLink = document.createElement('a');
  origLink.textContent = '原微博';
  const badge = document.createElement('span');
  badge.setAttribute('class', 'woo-icon-wrap woo-icon-opacity _icon_w4fta_2');
  badge.setAttribute('title', '微博创作者经营会员');

  // 用户正文（🔴 不可动）
  const post = document.createElement('div');
  post.textContent = '今天发了一条微博，很开心';

  body.appendChild(logo);
  body.appendChild(tabWrap);
  body.appendChild(input);
  const card = document.createElement('div');
  card.setAttribute('class', 'wbpro-scroller-item');
  card.appendChild(source);
  card.appendChild(origLink);
  card.appendChild(badge);
  card.appendChild(post);
  body.appendChild(card);

  return { document, logo, svg, tab, tabWrap, input, source, origLink, badge, post };
}

if (!parseHTML) {
  test('brandtext：缺 linkedom，DOM 用例跳过', () => { assert.ok(true); });
} else {
  test('DOM 生命周期：改写 → 幂等 → 还原逐字一致', () => {
    const ctx = makeDoc();
    const { document } = ctx;

    const r1 = applyBrandText(document, true);
    assert.ok(r1.textChanged >= 3);   // tab / 来源行 / 原微博（+ 我们 span 内不含）
    assert.ok(r1.attrChanged >= 4);   // tabWrap title / placeholder / source title / badge title（logo 的 aria-label 走 logo 步骤，不重复计）
    assert.equal(r1.logo, 1);

    // 改写结果
    assert.equal(ctx.tab.textContent, '最新');
    assert.equal(ctx.tabWrap.getAttribute('title'), '最新');
    assert.equal(ctx.input.getAttribute('placeholder'), '搜索');
    assert.equal(ctx.source.textContent, '来自 网页版');
    assert.equal(ctx.source.getAttribute('title'), '来自 网页版');
    assert.equal(ctx.origLink.textContent, '原文');
    assert.equal(ctx.badge.getAttribute('title'), '创作者经营会员');
    assert.equal(ctx.logo.getAttribute('aria-label'), LOGO_WORD);
    assert.ok(ctx.logo.querySelector('[data-spb-brand-logo]'));
    // 🔴 用户正文逐字不动
    assert.equal(ctx.post.textContent, '今天发了一条微博，很开心');

    // 重扫幂等：计数全部归零（无新增改写）
    const r2 = applyBrandText(document, true);
    assert.equal(r2.textChanged, 0);
    assert.equal(r2.attrChanged, 0);
    assert.equal(r2.logo, 0);
    assert.ok(countBrandText() > 0); // 台账仍在（供还原）

    // 关档还原
    // 台账：logo 1 + 文本 3（tab/来源行/原微博）+ 属性 4（tabWrap/placeholder/来源 title/徽章）= 8
    const r3 = applyBrandText(document, false);
    assert.equal(r3.restored, 8);
    assert.equal(countBrandText(), 0);
    assert.equal(ctx.tab.textContent, '最新微博');
    assert.equal(ctx.tabWrap.getAttribute('title'), '最新微博');
    assert.equal(ctx.input.getAttribute('placeholder'), '搜索微博');
    assert.equal(ctx.source.textContent, '来自 微博网页版');
    assert.equal(ctx.source.getAttribute('title'), '来自 微博网页版');
    assert.equal(ctx.origLink.textContent, '原微博');
    assert.equal(ctx.badge.getAttribute('title'), '微博创作者经营会员');
    assert.equal(ctx.logo.getAttribute('aria-label'), 'Weibo');
    // logo 原节点回来、我方 span 摘除
    assert.equal(ctx.logo.querySelector('[data-spb-brand-logo]'), null);
    assert.ok(ctx.logo.querySelector('svg'));
    assert.equal(ctx.post.textContent, '今天发了一条微博，很开心');
  });

  test('logo 安全门：aria-label 非 Weibo/微博 的锚不动', () => {
    const { document } = parseHTML('<html><body></body></html>');
    const a = document.createElement('a');
    a.setAttribute('href', '/');
    a.setAttribute('aria-label', '首页');
    a.textContent = 'x';
    document.body.appendChild(a);
    const r = applyBrandText(document, true);
    assert.equal(r.logo, 0);
    assert.equal(a.textContent, 'x');
    assert.equal(a.getAttribute('aria-label'), '首页');
    restoreBrandText(document);
  });

  test('stop() 后再开档：台账已清空，重新改写不冲突', () => {
    const ctx = makeDoc();
    const { document } = ctx;
    applyBrandText(document, true);
    restoreBrandText(document);
    const r = applyBrandText(document, true);
    assert.ok(r.textChanged >= 3);
    assert.equal(ctx.tab.textContent, '最新');
    restoreBrandText(document);
    assert.equal(ctx.tab.textContent, '最新微博');
  });
}
