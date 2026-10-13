/**
 * 夹具回放测试（PROJECT.md §6.1 的「离线版体检」）
 *
 * 拿真实的微博 DOM 快照（tests/fixtures/snapshot-*.html，**私有不入库**）在 Node 里回放，
 * 用真 DOM（linkedom）跑**适配层 + 判定核心**的完整链路：
 *   readCardSignals() → classifyFeedItem()   （信息流推广卡）
 *   findPageAdSlots() → classifyPageAdSlot() （页面级 banner 广告位）
 *
 * 价值：改版时「跑一遍测试就知道哪条适配规则失效了」，而不是肉眼比对猜哪里坏了。
 *
 * 夹具不存在时（如 clone 到新机器）整个文件自动跳过，不会让 `npm test` 变红。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { classifyFeedItem, classifyPageAdSlot } from '../src/core/ad-detect.js';
import { SEL_CARD, readCardSignals, findPageAdSlots } from '../src/adapters/weibo-home.js';
import { FIXTURE_DIR, fixtures, EXPECT, expectFor } from './_fixture-expect.mjs';

// ── 环境探测：夹具 + DOM 实现 ────────────────────────────────────────────
let parseHTML = null;
try {
  ({ parseHTML } = await import('linkedom'));
} catch (_e) {
  parseHTML = null;
}

const skip = !fixtures.length
  ? 'fixtures/ 为空（.gitignore 里的私有数据）—— 跳过夹具回放'
  : (!parseHTML ? 'linkedom 未安装 —— 运行 npm install 后重试' : false);

function loadDoc(file) {
  const html = readFileSync(join(FIXTURE_DIR, file), 'utf8');
  return parseHTML(html).document;
}

/** 跑一遍完整链路，返回明细（便于断言与排障） */
function analyzeDoc(doc) {
  const cards = Array.from(doc.querySelectorAll(SEL_CARD[0]));
  const feedVerdicts = cards.map((card) => {
    const sig = readCardSignals(card);
    return { id: sig.id, author: sig.author, verdict: classifyFeedItem(sig) };
  });

  const bannerVerdicts = findPageAdSlots(doc).map((slot) => ({
    imgSrc: slot.imgSrc,
    inFeed: slot.inFeed,
    hasCloseIcon: slot.hasCloseIcon,
    verdict: classifyPageAdSlot({ imgSrcs: [slot.imgSrc], hasCloseIcon: slot.hasCloseIcon, inFeed: slot.inFeed }),
  }));

  return { cardCount: cards.length, feedVerdicts, bannerVerdicts };
}

// ── 逐夹具断言 ───────────────────────────────────────────────────────────

for (const file of fixtures) {
  const exp = expectFor(file);
  const label = exp ? `${file} — ${exp.desc}` : `${file} — 未知夹具（冒烟）`;

  test(`夹具回放：${label}`, { skip }, () => {
    const doc = loadDoc(file);
    const r = analyzeDoc(doc);

    // 结构性前提：能取到卡片，否则说明适配层的选择器已经失效
    assert.ok(r.cardCount > 0, `${file}: 适配层一张卡都没取到 —— SEL_CARD 可能已失效`);

    // 每张自然卡都必须有 ID（§5.2 第 ④ 步「标记跟着数据走」的前提）
    const noId = r.feedVerdicts.filter((x) => !x.id);
    assert.equal(noId.length, 0, `${file}: ${noId.length} 张卡取不到 bid`);

    const feedAds = r.feedVerdicts.filter((x) => x.verdict.isAd);
    const feedSuspects = r.feedVerdicts.filter((x) => !x.verdict.isAd && x.verdict.suspect);
    const banners = r.bannerVerdicts.filter((x) => x.verdict.isAd && !x.inFeed);

    // 判定必须可解释（§9）：判为广告**或**判为存疑，都必须给出理由
    for (const a of [...feedAds, ...feedSuspects]) {
      assert.ok(a.verdict.reasons.length > 0, `${file}: ${a.id} 有判定结果但没给理由`);
    }

    if (exp) {
      assert.equal(feedAds.length, exp.feedAds,
        `${file}: 信息流推广卡数期望 ${exp.feedAds}、实际 ${feedAds.length}\n` +
        `  明细: ${JSON.stringify(r.feedVerdicts.map((x) => ({ id: x.id, ad: x.verdict.isAd, s: x.verdict.score, why: x.verdict.reasons })), null, 2)}`);
      if (exp.feedSuspects !== undefined) {
        assert.equal(feedSuspects.length, exp.feedSuspects,
          `${file}: 存疑卡数期望 ${exp.feedSuspects}、实际 ${feedSuspects.length}\n` +
          `  明细: ${JSON.stringify(feedSuspects.map((x) => ({ id: x.id, author: x.author, s: x.verdict.score, why: x.verdict.reasons })), null, 2)}`);
      }
      assert.equal(banners.length, exp.bannerAds,
        `${file}: 页面广告位数期望 ${exp.bannerAds}、实际 ${banners.length}`);
    }
  });
}

// ── 判定核心的纯单测之外，再给「适配层提取是否正确」几条硬断言 ──────────

test('适配层：能把实测推广卡的 URL 埋点与「关注」按钮抽出来', { skip }, () => {
  const file = fixtures.find((f) => f.includes('1505 (1)'));
  if (!file) return;   // 缺这份夹具就不断言（不制造假红）

  const doc = loadDoc(file);
  const cards = Array.from(doc.querySelectorAll(SEL_CARD[0]));
  const ads = cards
    .map((c) => readCardSignals(c))
    .filter((s) => classifyFeedItem(s).isAd);

  assert.equal(ads.length, 1);
  const sig = ads[0];
  assert.equal(sig.author, '叫我老伯');                                  // 昵称回退链有效
  assert.ok(sig.urls.some((u) => u.includes('reallog_mark_ad')));        // 外链埋点被抓到
  assert.ok(sig.tagTexts.includes('荐读'));                              // 文字标签被抓到
  assert.equal(sig.hasFollowButton, true);                               // 关注按钮被抓到
  assert.ok(sig.text.includes('京东') || sig.text.includes('红包'));      // 原创正文落点正确
});

test('适配层：自然卡的认证图标 wbpro-tag-img 不得进入 tagTexts', { skip }, () => {
  const file = fixtures.find((f) => f.includes('1449'));
  if (!file) return;

  const doc = loadDoc(file);
  const cards = Array.from(doc.querySelectorAll(SEL_CARD[0]));
  const allTags = cards.flatMap((c) => readCardSignals(c).tagTexts);
  // icon_auth_black.png 是**自然卡**的认证图标，适配层必须跳过 img 型标签
  assert.ok(!allTags.some((t) => t === ''), '不应有空标签');
  assert.ok(!allTags.includes('认证'), 'img 型标签不应被当作文案标签');
});

test('适配层：转发原文上的埋点要抓到，但该卡只判存疑（1449 饼干姐）', { skip }, () => {
  const file = fixtures.find((f) => f.includes('1449'));
  if (!file) return;

  const doc = loadDoc(file);
  const cards = Array.from(doc.querySelectorAll(SEL_CARD[0]));
  const sigs = cards.map((c) => readCardSignals(c));

  const biscuit = sigs.find((s) => s.author === '饼干姐');
  assert.ok(biscuit, '应能取到饼干姐的卡');
  assert.ok(biscuit.urls.some((u) => u.includes('WeiboADNatural')),
    '应抓到转发原文视频链接上的原生广告埋点');
  // 该卡的「原创正文」不应包含埋点 —— 说明埋点确实来自转发原文
  assert.ok(!/reallog_mark_ad|WeiboADNatural/.test(biscuit.text),
    '埋点在转发原文，原创正文里不该有');

  // 该卡在页面上**没有任何**可见广告标识 —— 这是它必须走埋点判据的原因
  assert.deepEqual(biscuit.tagTexts, [], '不应有推广标签');
  assert.equal(biscuit.hasFollowButton, false, '不应有「关注」按钮');

  // 判定结论（2026-10-13 用户人工核对后定）：存疑，不判广告
  const v = classifyFeedItem(biscuit);
  assert.equal(v.isAd, false, '内容经人工核对不像广告，不得判为广告');
  assert.equal(v.suspect, true, '但应保留为存疑线索');

  // 同一份快照里 OiiOii 那张仍是确定的广告 —— 降级没有波及真正的广告
  const oii = sigs.find((s) => s.author === 'OiiOii_AI');
  assert.ok(oii, '应能取到 OiiOii 的卡');
  assert.equal(classifyFeedItem(oii).isAd, true, 'OiiOii 卡（商业投放埋点）仍应判为广告');
});
