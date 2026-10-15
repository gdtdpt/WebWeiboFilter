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
  findCommentToggle,
  SUMMARY_ATTR, SUMMARY_MARK, SUMMARY_SEL, CARD_SUMMARY_SEL, RETWEET_SUMMARY_SEL,
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
function makeCard(doc, { repost, comment, like, href, retweet } = {}) {
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

  function btn(parent, iconCls, countSel, countText) {
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
    parent.appendChild(a);
    return a;
  }

  btn(footer, 'woo-font woo-font--retweet', null, repost);
  btn(footer, 'woo-font woo-font--comment', null, comment);
  if (like != null) btn(footer, 'woo-like-main', 'woo-like-count', like);
  else {
    const likeBtn = doc.createElement('a');
    const icon = doc.createElement('i');
    icon.setAttribute('class', 'woo-like-main');
    likeBtn.appendChild(icon);
    footer.appendChild(likeBtn);
  }

  article.appendChild(header);
  article.appendChild(footer);

  // 可选：转发块（结构对齐真机：.retweet > [正文, footer(原微博计数)]）
  if (retweet) {
    const block = doc.createElement('div');
    block.setAttribute('class', 'retweet');
    const body = doc.createElement('div');
    body.textContent = retweet.text || '@某人：原微博内容';
    block.appendChild(body);
    const rtFooter = doc.createElement('footer');
    btn(rtFooter, 'woo-font woo-font--retweet', null, retweet.repost);
    btn(rtFooter, 'woo-font woo-font--comment', null, retweet.comment);
    if (retweet.like != null) btn(rtFooter, 'woo-like-main', 'woo-like-count', retweet.like);
    if (retweet.timeTitle) {
      const rtTime = doc.createElement('a');
      rtTime.setAttribute('title', retweet.timeTitle);
      rtTime.setAttribute('href', retweet.timeHref || 'https://weibo.com/789/ROrigBid1');
      rtTime.textContent = retweet.timeText || '7-11 17:30';
      rtFooter.appendChild(rtTime);
    }
    block.appendChild(rtFooter);
    article.appendChild(block);
  }

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

// ── 转发块摘要条（2026-10-15 三轮拍板：与卡自身同一套设计语言）─────────

test('转发块摘要条：原文计数 + 「原微博」前缀 + 时间；与卡自身的并存', () => {
  const { document } = freshDoc();
  const card = makeCard(document, {
    repost: '1', comment: null, like: '2',
    retweet: { repost: '18', comment: '8', like: '156', timeTitle: '2026-07-11 17:30', timeText: '7-11 17:30' },
  });
  document.body.appendChild(card);

  const res = applyActionBarSummary(card, true);
  assert.equal(res.created, 2, '卡自身 + 转发块各一条');

  const bars = card.querySelectorAll(SUMMARY_SEL[0]);
  assert.equal(bars.length, 2);
  const cardBar = card.querySelector(CARD_SUMMARY_SEL[0]);
  const rtBar = card.querySelector(RETWEET_SUMMARY_SEL[0]);
  assert.ok(cardBar && rtBar, '两条都应存在');
  assert.equal(cardBar.textContent, '1 转发 · 评论 · 2 赞');
  assert.equal(rtBar.textContent, '原微博 · 7-11 17:30 · 18 转发 · 8 评论 · 156 赞');
  assert.equal(rtBar.getAttribute('href'), 'https://weibo.com/789/ROrigBid1',
    '转发摘要条必须指向**原微博**详情页');
  assert.equal(rtBar.parentNode.getAttribute('class'), 'retweet',
    '转发摘要条应挂在转发块内部（footer 原位）');
});

test('转发块摘要条：无时间锚时省略时间段；关档两条一起摘', () => {
  const { document } = freshDoc();
  const card = makeCard(document, {
    repost: '1', comment: '1', like: '1',
    retweet: { repost: '3', comment: '13', like: null },
  });
  document.body.appendChild(card);
  applyActionBarSummary(card, true);
  const rtBar = card.querySelector(RETWEET_SUMMARY_SEL[0]);
  assert.equal(rtBar.textContent, '原微博 · 3 转发 · 13 评论 · 赞',
    '快照实测转发 footer 常无时间锚 ⇒ 省略时间段、不瞎猜');

  const res = applyActionBarSummary(card, false);
  assert.equal(res.removed, 2, '关档必须两条一起摘');
  assert.equal(card.querySelectorAll(SUMMARY_SEL[0]).length, 0);
});

test('转发块摘要条：幂等（第二遍全零）+ 计数变化原地更新', () => {
  const { document } = freshDoc();
  const card = makeCard(document, {
    repost: '1', comment: '1', like: '1',
    retweet: { repost: '18', comment: '8', like: '156', timeTitle: '2026-07-11 17:30' },
  });
  document.body.appendChild(card);
  applyActionBarSummary(card, true);
  assert.deepEqual(applyActionBarSummary(card, true), { created: 0, updated: 0, removed: 0 },
    '第二遍必须零写入');

  // 槽位复用：转发块计数被微博换成新内容
  card.querySelector('.retweet footer span').textContent = '99';
  const res = applyActionBarSummary(card, true);
  assert.equal(res.updated, 1, '只有转发条该更新');
  assert.equal(card.querySelector(RETWEET_SUMMARY_SEL[0]).textContent,
    '原微博 · 7-11 17:30 · 99 转发 · 8 评论 · 156 赞');
});

// ── ③′ 点击代理（§12-B15 四轮定稿：摘要条点击 → 转发给原生评论开关）────

test('findCommentToggle：卡自身摘要条 → 卡的直接子 footer；转发块摘要条 → 转发块 footer（互不串）', () => {
  const { document } = freshDoc();
  const card = makeCard(document, {
    repost: '1', comment: '1', like: '1',
    retweet: { repost: '18', comment: '8', like: '156' },
  });
  document.body.appendChild(card);
  applyActionBarSummary(card, true);

  const cardBar = card.querySelector(CARD_SUMMARY_SEL[0]);
  const rtBar = card.querySelector(RETWEET_SUMMARY_SEL[0]);
  const cardFooter = card.querySelector('article > footer');
  const rtFooter = card.querySelector('.retweet footer');

  const cardIcon = findCommentToggle(cardBar);
  const rtIcon = findCommentToggle(rtBar);
  assert.ok(cardIcon, '卡摘要条必须锚到评论开关');
  assert.ok(rtIcon, '转发摘要条必须锚到评论开关');
  assert.equal(cardIcon.parentNode.parentNode, cardFooter,
    '卡摘要条必须锚到**卡自己的** footer（不能误中转发块内部的）');
  assert.equal(rtIcon.parentNode.parentNode, rtFooter,
    '转发摘要条必须锚到转发块自己的 footer');
});

test('findCommentToggle：退化输入给 null（不抛异常）', () => {
  const { document } = freshDoc();
  assert.equal(findCommentToggle(null), null);
  const bare = document.createElement('a');
  document.body.appendChild(bare);
  assert.equal(findCommentToggle(bare), null, '不在卡内 / 转发块内的摘要条 ⇒ null');
});

test('摘要条点击代理：拦截导航 + 转发给原生评论开关（卡自身 / 转发块各自验证）', () => {
  const { document } = freshDoc();
  const card = makeCard(document, {
    repost: '1', comment: '1', like: '1',
    retweet: { repost: '18', comment: '8', like: '156' },
  });
  document.body.appendChild(card);
  applyActionBarSummary(card, true);

  const fakeEvt = {
    prevented: 0, stopped: 0,
    preventDefault() { this.prevented++; },
    stopPropagation() { this.stopped++; },
  };
  function spy(icon) {
    let calls = 0;
    icon.click = function () { calls++; };
    return () => calls;
  }

  const cardBar = card.querySelector(CARD_SUMMARY_SEL[0]);
  const cardCount = spy(findCommentToggle(cardBar));
  const ret = cardBar.onclick.call(cardBar, fakeEvt);
  assert.equal(ret, false, 'handler 必须 return false（双保险拦导航）');
  assert.equal(fakeEvt.prevented, 1, '必须 preventDefault（拦下 href 跳详情）');
  assert.equal(fakeEvt.stopped, 1, '必须 stopPropagation（不惊动微博自己的委托监听）');
  assert.equal(cardCount(), 1, '必须恰好转发一次 click 给原生评论图标');

  // 转发块摘要条 → 转发块自己的开关
  const rtBar = card.querySelector(RETWEET_SUMMARY_SEL[0]);
  const rtCount = spy(findCommentToggle(rtBar));
  cardBar.onclick.call(cardBar, fakeEvt); // 先把卡侧再点一次，确认 spy 计数独立
  assert.equal(cardCount(), 2);
  const evt2 = { preventDefault() {}, stopPropagation() {} };
  rtBar.onclick.call(rtBar, evt2);
  assert.equal(rtCount(), 1, '转发摘要条只该触发转发块的开关');
});

test('摘要条点击代理：锚不到开关时静默放弃（拦导航但不抛错、不瞎点）', () => {
  const { document } = freshDoc();
  const card = makeCard(document, { repost: '1', comment: '1', like: '1' });
  document.body.appendChild(card);
  applyActionBarSummary(card, true);
  const bar = card.querySelector(CARD_SUMMARY_SEL[0]);
  // 拆掉评论图标（模拟未知卡型锚不到）
  const icon = findCommentToggle(bar);
  icon.parentNode.parentNode.removeChild(icon.parentNode);
  const evt = { preventDefault() { evt.pd = true; }, stopPropagation() {} };
  assert.doesNotThrow(() => bar.onclick.call(bar, evt));
  assert.ok(evt.pd, '即使放弃转发也必须拦下导航');
});

test('摘要条创建时就带 onclick；第二遍幂等判定包含 onclick（接线不会丢）', () => {
  const { document } = freshDoc();
  const card = makeCard(document, { repost: '1', comment: '1', like: '1' });
  document.body.appendChild(card);
  applyActionBarSummary(card, true);
  const bar = card.querySelector(CARD_SUMMARY_SEL[0]);
  assert.equal(typeof bar.onclick, 'function', 'create 路径必须接线');

  // 人为拆掉 onclick 模拟「旧版摘要条」—— 槽位复用 / 升级覆盖场景
  bar.onclick = null;
  const res = applyActionBarSummary(card, true);
  assert.equal(res.updated, 1, 'onclick 丢失 ⇒ 必须判为需更新并重新接线');
  assert.equal(typeof card.querySelector(CARD_SUMMARY_SEL[0]).onclick, 'function', '重新接线成功');
  // 再跑一遍：已接线 + 内容没变 ⇒ 零写入
  assert.deepEqual(applyActionBarSummary(card, true), { created: 0, updated: 0, removed: 0 });
});

// ── ④ 真快照回放 ────────────────────────────────────────────────────────

test('真快照回放：有 footer 的卡恰好一条摘要条、链接对齐时间锚、第二遍全零', { skip: skipFixture }, () => {
  for (const file of fixtures) {
    const { document } = parseHTML(readFileSync(join(FIXTURE_DIR, file), 'utf8'));
    const cards = document.querySelectorAll('.wbpro-scroller-item');
    if (!cards.length) continue;

    let withFooter = 0, withRetweet = 0;
    for (const card of cards) {
      const res = applyActionBarSummary(card, true);
      const hasFooter = Boolean(card.querySelector('article > footer'));
      const hasRetweetFooter = Boolean(card.querySelector('.retweet footer'));
      const expectBars = (hasFooter ? 1 : 0) + (hasRetweetFooter ? 1 : 0);
      if (hasFooter) {
        withFooter++;
        assert.equal(card.querySelectorAll(CARD_SUMMARY_SEL[0]).length, 1,
          `${file}: 有 footer 的卡必须建出摘要条`);
        const a = card.querySelector(CARD_SUMMARY_SEL[0]);
        assert.ok(a && a.textContent.includes('转发'), `${file}: 摘要条文本不应为空`);
        const timeA = card.querySelector('article > header a[title^="20"], article header a[title^="20"]');
        if (timeA) {
          assert.equal(a.getAttribute('href'), timeA.getAttribute('href'),
            `${file}: 摘要条链接必须与时间锚（详情页）一致`);
        }
      } else {
        assert.equal(card.querySelectorAll(CARD_SUMMARY_SEL[0]).length, 0,
          `${file}: 没有 footer 的卡不许插摘要条`);
      }
      if (hasRetweetFooter) {
        withRetweet++;
        const rt = card.querySelector(RETWEET_SUMMARY_SEL[0]);
        assert.ok(rt, `${file}: 有转发块 footer 的卡必须建出转发摘要条`);
        assert.match(rt.textContent, /^原微博 /, `${file}: 转发摘要条必须带「原微博」前缀`);
      }
      assert.equal(card.querySelectorAll(SUMMARY_SEL[0]).length, expectBars,
        `${file}: 摘要条总数应为「卡自身 + 转发块」各自至多一条`);
    }

    assert.ok(withFooter > 0,
      `${file}: 这份快照居然一张有 footer 的卡都没有 —— 夹具或锚点需复核`);

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
