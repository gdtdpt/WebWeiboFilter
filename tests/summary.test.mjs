/**
 * A1 摘要条的守卫（§12-B15，2026-10-15 用户拍板方案 ②）
 *
 * 测四件事：
 *   ① 纯函数 `summaryText` 的输出契约（文本稳定 ⇒ 槽位复用后不触发无谓 DOM 写入）；
 *   ② 适配层 `readActionBar` 的读数（计数 + 详情链接）；
 *   ③ `applyActionBarSummary` 的幂等 / 可逆生命周期（建 → 不重写 → 更新 → 摘除）；
 *   ④ 真快照回放：每张有 footer 的卡恰好一条摘要条、链接与时间锚一致、
 *      第二遍全零（幂等）、removeSummaries 清干净。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  summaryText, applyActionBarSummary, removeSummaries, countSummaries,
  SUMMARY_ATTR, SUMMARY_MARK, SUMMARY_SEL,
} from '../src/apply/summary.js';
import { readActionBar } from '../src/adapters/weibo-home.js';
import { FIXTURE_DIR, fixtures } from './_fixture-expect.mjs';

let parseHTML = null;
try {
  ({ parseHTML } = await import('linkedom'));
} catch (_e) {
  parseHTML = null;
}

const skipFixture = !fixtures.length
  ? 'fixtures/ 为空（私有不入库）—— 跳过真快照回放'
  : (!parseHTML ? 'linkedom 未安装 —— 运行 npm install 后重试' : false);

/** 合成一张带按钮行的卡（结构对齐 §12-B13 ①：card > article > [header, footer]） */
function makeCard(doc, { repost, comment, like, href } = {}) {
  const card = doc.createElement('div');
  card.setAttribute('class', 'wbpro-scroller-item');
  const article = doc.createElement('article');
  const header = doc.createElement('header');
  const time = doc.createElement('a');
  time.setAttribute('title', '2026-10-15 08:00');
  time.setAttribute('href', href || 'https://weibo.com/123/RTestBid1');
  time.textContent = '10-15 08:00';
  header.appendChild(time);
  const footer = doc.createElement('footer');

  function btn(iconCls, countSel, countText) {
    const a = doc.createElement('a');
    const icon = doc.createElement('i');
    icon.setAttribute('class', iconCls);
    a.appendChild(icon);
    if (countText != null) {
      const s = doc.createElement('span');
      if (countSel) s.setAttribute('class', countSel);
      s.textContent = countText;
      a.appendChild(s);
    }
    footer.appendChild(a);
    return a;
  }

  btn('woo-font woo-font--retweet', null, repost);
  btn('woo-font woo-font--comment', null, comment);
  if (like != null) btn('woo-like-main', 'woo-like-count', like);
  else {
    const likeBtn = doc.createElement('a');
    const icon = doc.createElement('i');
    icon.setAttribute('class', 'woo-like-main');
    likeBtn.appendChild(icon);
    footer.appendChild(likeBtn);
  }

  article.appendChild(header);
  article.appendChild(footer);
  card.appendChild(article);
  return card;
}

function freshDoc() {
  return parseHTML('<!doctype html><html><body></body></html>');
}

// ── ① 纯函数 ─────────────────────────────────────────────────────────────

test('summaryText：计数齐全 / 缺失 / 空对象，输出稳定', () => {
  assert.equal(summaryText({ repost: '52', comment: '3', like: '21' }), '52 转发 · 3 评论 · 21 赞');
  assert.equal(summaryText({ repost: '3.2万', comment: null, like: '21' }), '3.2万 转发 · 评论 · 21 赞');
  assert.equal(summaryText({}), '转发 · 评论 · 赞');
  assert.equal(summaryText(null), '转发 · 评论 · 赞');
});

// ── ② 适配层读数（合成 DOM）────────────────────────────────────────────

test('readActionBar：读出计数与详情链接；没有 footer ⇒ null', () => {
  const { document } = freshDoc();

  const card = makeCard(document, { repost: '52', comment: '3', like: '21' });
  document.body.appendChild(card);

  const bar = readActionBar(card);
  assert.ok(bar, '有 footer 的卡必须读出按钮行');
  assert.equal(bar.counts.repost, '52');
  assert.equal(bar.counts.comment, '3');
  assert.equal(bar.counts.like, '21');
  assert.equal(bar.href, 'https://weibo.com/123/RTestBid1');

  // 没有 footer 的卡型 ⇒ null（上层宁可不动）
  const bare = document.createElement('div');
  bare.setAttribute('class', 'wbpro-scroller-item');
  document.body.appendChild(bare);
  assert.equal(readActionBar(bare), null, '没有 article > footer 的卡必须返回 null');
});

test('readActionBar：数字缺失（微博对 0 不显示）时给 null，不瞎猜', () => {
  const { document } = freshDoc();
  const card = makeCard(document, { repost: '7', comment: null, like: null });
  document.body.appendChild(card);
  const bar = readActionBar(card);
  assert.equal(bar.counts.repost, '7');
  assert.equal(bar.counts.comment, null);
  assert.equal(bar.counts.like, null);
});

// ── ③ 生命周期：建 → 幂等 → 更新 → 摘除 ────────────────────────────────

test('applyActionBarSummary：建 → 重复调用不重写（幂等）→ off 摘除', () => {
  const { document } = freshDoc();
  const card = makeCard(document, { repost: '52', comment: '3', like: '21' });
  document.body.appendChild(card);

  const first = applyActionBarSummary(card, true);
  assert.deepEqual(first, { created: 1, updated: 0, removed: 0 });

  const a = card.querySelector(SUMMARY_SEL[0]);
  assert.ok(a, '摘要条应已插入');
  assert.equal(a.getAttribute(SUMMARY_ATTR), SUMMARY_MARK);
  assert.equal(a.textContent, '52 转发 · 3 评论 · 21 赞');
  assert.equal(a.getAttribute('href'), 'https://weibo.com/123/RTestBid1');
  // 与 footer 同层（都在 article 下）
  assert.equal(a.parentNode.tagName.toLowerCase(), 'article');

  assert.deepEqual(applyActionBarSummary(card, true), { created: 0, updated: 0, removed: 0 },
    '内容没变 ⇒ 第二遍必须零写入（幂等，否则自触发循环）');

  assert.deepEqual(applyActionBarSummary(card, false), { created: 0, updated: 0, removed: 1 },
    '关档 ⇒ 摘除');
  assert.equal(card.querySelector(SUMMARY_SEL[0]), null);
});

test('applyActionBarSummary：槽位复用换了卡（计数/链接变了）⇒ 原地更新，不另插新条', () => {
  const { document } = freshDoc();
  const card = makeCard(document, { repost: '52', comment: '3', like: '21' });
  document.body.appendChild(card);
  applyActionBarSummary(card, true);

  // 模拟槽位复用：footer 里的数字被微博换成了另一条微博的
  card.querySelector('footer a span').textContent = '99';
  const timeA = card.querySelector('a[title^="20"]');
  timeA.setAttribute('href', 'https://weibo.com/456/RNewBid99');

  const res = applyActionBarSummary(card, true);
  assert.equal(res.updated, 1, '内容变了必须原地更新');
  assert.equal(res.created, 0, '绝不允许再插一条（否则每轮扫描叠一条）');
  assert.equal(card.querySelectorAll(SUMMARY_SEL[0]).length, 1);
  assert.equal(card.querySelector(SUMMARY_SEL[0]).textContent, '99 转发 · 3 评论 · 21 赞');
  assert.equal(card.querySelector(SUMMARY_SEL[0]).getAttribute('href'), 'https://weibo.com/456/RNewBid99');
});

test('applyActionBarSummary：没有 footer 的卡 ⇒ 什么都不做（宁可不动）', () => {
  const { document } = freshDoc();
  const bare = document.createElement('div');
  bare.setAttribute('class', 'wbpro-scroller-item');
  document.body.appendChild(bare);
  assert.deepEqual(applyActionBarSummary(bare, true), { created: 0, updated: 0, removed: 0 });
  assert.equal(bare.querySelectorAll('a').length, 0);
});

test('removeSummaries / countSummaries：整页摘除并计数', () => {
  const { document } = freshDoc();
  for (let i = 0; i < 3; i++) {
    const card = makeCard(document, { repost: String(i), comment: '1', like: '2' });
    document.body.appendChild(card);
    applyActionBarSummary(card, true);
  }
  assert.equal(countSummaries(document), 3);
  assert.equal(removeSummaries(document), 3);
  assert.equal(countSummaries(document), 0);
  assert.equal(removeSummaries(document), 0, '再摘一遍应为 0（幂等）');
});

// ── ④ 真快照回放 ────────────────────────────────────────────────────────

test('真快照回放：有 footer 的卡恰好一条摘要条、链接对齐时间锚、第二遍全零', { skip: skipFixture }, () => {
  for (const file of fixtures) {
    const { document } = parseHTML(readFileSync(join(FIXTURE_DIR, file), 'utf8'));
    const cards = document.querySelectorAll('.wbpro-scroller-item');
    if (!cards.length) continue;

    let withFooter = 0;
    for (const card of cards) {
      const res = applyActionBarSummary(card, true);
      const hasFooter = Boolean(card.querySelector('article > footer'));
      if (hasFooter) {
        withFooter++;
        assert.equal(res.created, 1, `${file}: 有 footer 的卡必须建出摘要条`);
        const a = card.querySelector(SUMMARY_SEL[0]);
        assert.ok(a && a.textContent.includes('转发'), `${file}: 摘要条文本不应为空`);
        const timeA = card.querySelector('a[title^="20"]');
        if (timeA) {
          assert.equal(a.getAttribute('href'), timeA.getAttribute('href'),
            `${file}: 摘要条链接必须与时间锚（详情页）一致`);
        }
      } else {
        assert.equal(res.created, 0, `${file}: 没有 footer 的卡不许插摘要条`);
      }
      // 不变量：不变式 —— footer 数与摘要条数一一对应
      assert.equal(card.querySelectorAll(SUMMARY_SEL[0]).length, hasFooter ? 1 : 0,
        `${file}: 每张有 footer 的卡恰好一条摘要条`);
    }

    assert.ok(withFooter > 0, `${file}: 这份快照居然一张有 footer 的卡都没有 —— 夹具或锚点需复核`);

    // 第二遍全零（幂等）
    for (const card of cards) {
      const res = applyActionBarSummary(card, true);
      assert.deepEqual(res, { created: 0, updated: 0, removed: 0 },
        `${file}: 第二遍必须零写入（幂等）`);
    }

    // A1 的 CSS 侧前提：footer 锚点在真实快照上确实每卡恰好 1 个（§12-B13 ① 的不变量）
    assert.equal(document.querySelectorAll('.wbpro-scroller-item article > footer').length,
      withFooter, `${file}: article > footer 命中数应等于有 footer 的卡数`);
  }
});
