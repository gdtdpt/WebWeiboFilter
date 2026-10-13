/**
 * 端到端管线测试：调度层 + 判定核心 + 应用层（PROJECT.md §6 三层合起来跑）
 *
 * 跑在**真实 DOM 快照**上（linkedom 建 DOM，私有不入库），断言：
 *   ① 判为广告的卡，其**槽位**被打了 `data-spb="hidden"`；干净卡一个标记都没有
 *   ② A 类页面级 banner 走另一套（`data-spb="ad"`，真正收掉）——两种广告不能混为一谈
 *   ③ **幂等**：连扫两遍结果完全一致
 *   ④ **可逆**：`stop()` 之后页面上一个标记都不剩（§7.4 约束 3）
 *   ⑤ **槽位复用**：槽位换了内容之后标记必须跟着走（§5.2 第 ④ 条）
 *
 * 期望值复用 `tests/_fixture-expect.mjs` —— 与侦察（§12-B1）、夹具回放共用同一张表。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createScheduler } from '../src/scheduler.js';
import { ensureStyle, removeStyle, STYLE_ID, MARK_ATTR } from '../src/apply/style.js';
import { clearAll, countMarks } from '../src/apply/mark.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { FIXTURE_DIR, fixtures, expectFor } from './_fixture-expect.mjs';

let parseHTML = null;
try {
  ({ parseHTML } = await import('linkedom'));
} catch (_e) {
  parseHTML = null;
}

const skip = !fixtures.length
  ? 'fixtures/ 为空（.gitignore 里的私有数据）—— 跳过管线测试'
  : (!parseHTML ? 'linkedom 未安装 —— 运行 npm install 后重试' : false);

function makeConfig(patch = {}) {
  return { ...DEFAULT_CONFIG, filter: { ...DEFAULT_CONFIG.filter, ...patch } };
}

/** 用真实快照起一条管线 */
function bootFixture(file, patch) {
  const { document } = parseHTML(readFileSync(join(FIXTURE_DIR, file), 'utf8'));
  ensureStyle(document);
  const scheduler = createScheduler(document, makeConfig(patch));
  scheduler.start();
  return { document, scheduler };
}

// ── ① ~ ② 逐夹具：标记数与侦察期望一致 ──────────────────────────────────

for (const file of fixtures) {
  const exp = expectFor(file);
  if (!exp) continue;

  test(`管线：${file} — ${exp.desc}`, { skip }, () => {
    const { document, scheduler } = bootFixture(file);
    const marks = countMarks(document);
    const stats = scheduler.stats();

    // 管线必须真的看到卡片（否则标记数为 0 是「静默失效」而不是「没广告」）
    const cardCount = document.querySelectorAll('.wbpro-scroller-item').length;
    assert.ok(cardCount > 0, `${file}: 适配层一张卡都没取到 —— SEL_CARD 可能已失效`);
    assert.equal(stats.slots, cardCount,
      `${file}: 被判定的槽位数 ${stats.slots} 与页面上卡片数 ${cardCount} 不一致 —— 有卡被漏判`);

    assert.equal(marks.hidden, exp.feedAds,
      `${file}: 被隐藏的槽位数期望 ${exp.feedAds}、实际 ${marks.hidden}`);
    assert.equal(marks.pageAd, exp.bannerAds,
      `${file}: 被收掉的页面 banner 数期望 ${exp.bannerAds}、实际 ${marks.pageAd}`);

    // 只有「隐藏」与「收掉 banner」两种取值，不能混用
    const all = Array.from(document.querySelectorAll(`[${MARK_ATTR}]`))
      .map((el) => el.getAttribute(MARK_ATTR));
    assert.ok(all.every((v) => v === 'hidden' || v === 'ad'),
      `${file}: 出现了非法标记值 ${JSON.stringify([...new Set(all)])}`);

    // 标记必须落在**槽位**上（不是卡片内部）—— 这是 §5.2/B2 的层级要求
    const hiddenEls = Array.from(document.querySelectorAll(`[${MARK_ATTR}="hidden"]`));
    for (const el of hiddenEls) {
      assert.ok((el.getAttribute('class') || '').includes('vue-recycle-scroller__item-view'),
        `${file}: hidden 标记落在了非槽位元素上：${el.getAttribute('class')}`);
    }
  });
}

// ── ③ 幂等 ──────────────────────────────────────────────────────────────

test('管线：连扫两遍结果完全一致（幂等）', { skip }, () => {
  const file = fixtures.find((f) => f.includes('1449')) || fixtures[0];
  const { document, scheduler } = bootFixture(file);

  const first = countMarks(document);
  const firstRecords = scheduler.recent().length;

  scheduler.rescan();
  scheduler.rescan();

  assert.deepEqual(countMarks(document), first, '重复扫描不得改变标记');
  assert.equal(scheduler.recent().length, firstRecords, '重复扫描不得重复记「最近命中」');
});

// ── ④ 可逆 ──────────────────────────────────────────────────────────────

test('管线：stop() 之后页面上一个标记都不剩（§7.4 约束 3 可逆）', { skip }, () => {
  const file = fixtures.find((f) => f.includes('1505 (1)')) || fixtures[0];
  const { document, scheduler } = bootFixture(file);

  assert.ok(countMarks(document).hidden > 0 || countMarks(document).pageAd > 0,
    '这份夹具本该有命中，才谈得上验证可逆');

  scheduler.stop();

  assert.deepEqual(countMarks(document), { hidden: 0, pageAd: 0 }, '停止后必须清空全部标记');
  assert.equal(document.querySelectorAll(`[${MARK_ATTR}]`).length, 0);
  assert.equal(scheduler.isRunning(), false);
});

test('样式注入：ensureStyle 幂等，removeStyle 能清干净', { skip }, () => {
  const file = fixtures[0];
  const { document } = bootFixture(file);

  assert.equal(document.getElementById(STYLE_ID) !== null, true);
  const el = document.getElementById(STYLE_ID);
  assert.equal(ensureStyle(document), false, '第二次注入应为 no-op');
  assert.equal(document.querySelectorAll(`#${STYLE_ID}`).length, 1, '不得出现两个样式表');

  // 样式表内容必须覆盖两种标记
  assert.ok(el.textContent.includes('visibility:hidden'), 'B 类样式缺失');
  assert.ok(el.textContent.includes('display:none'), 'A 类样式缺失');

  assert.equal(removeStyle(document), true);
  assert.equal(document.getElementById(STYLE_ID), null);
});

test('clearAll 返回清理数量，且在无标记页面上安全返回 0', { skip }, () => {
  const file = fixtures.find((f) => f.includes('1449')) || fixtures[0];
  const { document, scheduler } = bootFixture(file);
  const n = countMarks(document).hidden + countMarks(document).pageAd;

  assert.equal(clearAll(document), n);
  assert.equal(clearAll(document), 0, '再清一次应为 0（幂等）');
  scheduler.stop();
});

// ── ⑤ 合成页：关键词过滤 + 槽位复用 ─────────────────────────────────────

/** 造一个最小信息流；cards = [{ author, text }] */
function syntheticFeed(cards) {
  const slots = cards.map((c) => `
    <div class="vue-recycle-scroller__item-view" style="transform: translateY(0px) translateX(0px); opacity: 1;">
      <div class="wbpro-scroller-item">
        <article>
          <header><a usercard="1"><span title="${c.author}">${c.author}</span></a></header>
          <div class="wbpro-feed-ogText">${c.text}</div>
        </article>
      </div>
    </div>`).join('');

  return `<!DOCTYPE html><html><head><title>t</title></head><body>
    <div id="homeWrap">
      <div id="scroller" class="vue-recycle-scroller">
        <div class="vue-recycle-scroller__item-wrapper">${slots}</div>
      </div>
    </div>
  </body></html>`;
}

/** 取槽位里正文节点（模拟"槽位被复用、内容被换掉"） */
function setSlotText(document, index, text) {
  const wrapper = document.querySelector('.vue-recycle-scroller__item-wrapper');
  const slot = wrapper.children[index];
  slot.querySelector('.wbpro-feed-ogText').textContent = text;
  return slot;
}

test('管线：关键词命中落在正确的槽位上', { skip }, () => {
  const { document } = parseHTML(syntheticFeed([
    { author: '甲', text: '正常内容' },
    { author: '乙', text: '一起来抽奖' },
    { author: '丙', text: '也是正常内容' },
  ]));
  const scheduler = createScheduler(document, makeConfig({ keywords: [{ content: '抽奖', action: 'hide' }] }));
  scheduler.start();

  const wrapper = document.querySelector('.vue-recycle-scroller__item-wrapper');
  assert.equal(wrapper.children.length, 3);
  assert.equal(wrapper.children[0].getAttribute(MARK_ATTR), null);
  assert.equal(wrapper.children[1].getAttribute(MARK_ATTR), 'hidden', '命中卡应被隐藏');
  assert.equal(wrapper.children[2].getAttribute(MARK_ATTR), null);
  assert.equal(countMarks(document).hidden, 1);
});

test('管线：槽位复用后标记必须跟着内容走（§5.2 第 ④ 条）', { skip }, () => {
  const { document } = parseHTML(syntheticFeed([
    { author: '甲', text: '一起来抽奖' },   // 初始命中
    { author: '乙', text: '正常内容' },     // 初始不命中
  ]));
  const scheduler = createScheduler(document, makeConfig({ keywords: [{ content: '抽奖', action: 'hide' }] }));
  scheduler.start();

  const wrapper = document.querySelector('.vue-recycle-scroller__item-wrapper');
  assert.equal(wrapper.children[0].getAttribute(MARK_ATTR), 'hidden', '初始应命中 0 号槽');
  assert.equal(wrapper.children[1].getAttribute(MARK_ATTR), null);

  // 模拟虚拟列表把两个槽位的内容互换（节点复用）
  setSlotText(document, 0, '正常内容');
  setSlotText(document, 1, '一起来抽奖');
  scheduler.rescan();

  assert.equal(wrapper.children[0].getAttribute(MARK_ATTR), null,
    '0 号槽换了正常内容后必须撤销标记 —— 否则普通微博会被误隐藏（这正是要防的事）');
  assert.equal(wrapper.children[1].getAttribute(MARK_ATTR), 'hidden', '1 号槽应被标记');
  assert.equal(countMarks(document).hidden, 1, '总数仍应为 1');
});

test('管线：A 类 banner 与 B 类卡用不同标记收掉/隐藏', { skip }, () => {
  const html = `<!DOCTYPE html><html><head><title>t</title></head><body>
    <div id="homeWrap">
      <div><div class="woo-picture-main">
        <img class="woo-picture-img" src="https://kadmimage.biz.weibo.com/ad.png">
        <img src="https://h5.sinaimg.cn/upload/1005/948/2022/09/21/close.png">
      </div></div>
      <div id="scroller" class="vue-recycle-scroller">
        <div class="vue-recycle-scroller__item-wrapper">
          <div class="vue-recycle-scroller__item-view" style="transform: translateY(0px);">
            <div class="wbpro-scroller-item"><article>
              <header><a usercard="1"><span title="甲">甲</span></a></header>
              <div class="wbpro-feed-ogText">一起来抽奖</div>
            </article></div>
          </div>
        </div>
      </div>
    </div>
  </body></html>`;

  const { document } = parseHTML(html);
  const scheduler = createScheduler(document, makeConfig({ keywords: [{ content: '抽奖', action: 'hide' }] }));
  scheduler.start();

  const marks = countMarks(document);
  assert.equal(marks.pageAd, 1, 'A 类 banner 应被收掉');
  assert.equal(marks.hidden, 1, 'B 类卡应被保高度隐藏');

  const pageAdEl = document.querySelector('[data-spb="ad"]');
  assert.equal(pageAdEl.parentElement.id, 'homeWrap',
    'A 类应收到 #homeWrap 的直接子块上（只收图片层会留下外层空白）');
  assert.equal(pageAdEl.querySelector('textarea'), null, '安全网：绝不能把发布器收掉');
});
