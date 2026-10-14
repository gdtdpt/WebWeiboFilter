/**
 * 时间改写的端到端测试（调度层 + 应用层；L1 第二批 · §7.5 D 组）
 *
 * 覆盖四件事：
 *   ① **改写**：L1（或蕴含 L1 的 L2）开启时，相对时间变成绝对短格式，原文存进 `data-spb-t`
 *   ② **幂等**：连扫多遍不会二次改写、也不会把改写结果当原文存下来（这是最常见的写坏方式）
 *   ③ **还原**：档位关掉 / `stop()` 之后文本逐字回到微博原文
 *   ④ **槽位复用**：槽位换了内容，新卡的时间照样被改写（旧卡的属性不残留）
 *
 * 合成页用真实结构（`.vue-recycle-scroller__item-wrapper` → `item-view` → `.wbpro-scroller-item`），
 * 另外在**真夹具**上跑一遍整体改写率。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createScheduler } from '../src/scheduler.js';
import { applyAbsoluteTimes, countTimes, TIME_ATTR } from '../src/apply/time.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { FIXTURE_DIR, fixtures } from './_fixture-expect.mjs';

let parseHTML = null;
try {
  ({ parseHTML } = await import('linkedom'));
} catch (_e) {
  parseHTML = null;
}

const skip = parseHTML ? false : 'linkedom 未安装 —— 运行 npm install 后重试';

function cfg(appearance = {}, filter = {}) {
  return {
    ...DEFAULT_CONFIG,
    appearance: { ...DEFAULT_CONFIG.appearance, l1: false, l2: false, ...appearance },
    filter: { ...DEFAULT_CONFIG.filter, ...filter },
  };
}

/** 合成一条信息流；cards = [{ title, text }] */
function feed(cards) {
  const slots = cards.map((c) => `
    <div class="vue-recycle-scroller__item-view" style="transform: translateY(0px); opacity: 1;">
      <div class="wbpro-scroller-item"><article>
        <header>
          <a usercard="1"><span title="某人">某人</span></a>
          <a title="${c.title}" href="https://weibo.com/1/Abc123">${c.text}</a>
        </header>
        <div class="wbpro-feed-ogText">正文</div>
      </article></div>
    </div>`).join('');

  return `<!DOCTYPE html><html><head><title>t</title></head><body>
    <div id="homeWrap"><div id="scroller" class="vue-recycle-scroller">
      <div class="vue-recycle-scroller__item-wrapper">${slots}</div>
    </div></div>
  </body></html>`;
}

function boot(html, config) {
  const { document } = parseHTML(html);
  const scheduler = createScheduler(document, config);
  scheduler.start();
  return { document, scheduler };
}

const anchorOf = (document, i = 0) => document.querySelectorAll('a[title^="20"]')[i];

// ── ① 改写 ──────────────────────────────────────────────────────────────

test('时间改写：L1 开启 ⇒ 相对时间变绝对短格式，原文存进 data-spb-t', { skip }, () => {
  const { document } = boot(feed([
    { title: '2026-10-13 08:13', text: '6小时前' },
    { title: '2026-10-12 09:40', text: '昨天 09:40' },
  ]), cfg({ l1: true }));

  const a0 = anchorOf(document, 0);
  assert.equal(a0.textContent, '10-13 08:13', '相对时间应被改写成绝对短格式');
  assert.equal(a0.getAttribute(TIME_ATTR), '6小时前', '原文必须存下来（还原要用）');

  const a1 = anchorOf(document, 1);
  assert.equal(a1.textContent, '10-12 09:40');
  assert.equal(a1.getAttribute(TIME_ATTR), '昨天 09:40');
  assert.equal(countTimes(document), 2);
});

test('时间改写：L2 蕴含 L1 —— 开 L2 也要生效；两档都关时不碰文本', { skip }, () => {
  const withL2 = boot(feed([{ title: '2026-10-13 08:13', text: '6小时前' }]), cfg({ l2: true }));
  assert.equal(anchorOf(withL2.document, 0).textContent, '10-13 08:13', 'L2 蕴含 L1（§7.5.2）');

  const off = boot(feed([{ title: '2026-10-13 08:13', text: '6小时前' }]), cfg({}));
  assert.equal(anchorOf(off.document, 0).textContent, '6小时前', '档位关着时不许动文本');
  assert.equal(countTimes(off.document), 0);
});

test('时间改写：跨年锚点不动（旧帖本就是绝对日期）', { skip }, () => {
  const { document } = boot(feed([
    { title: '2024-05-01 12:00', text: '2024-05-01 12:00' },
  ]), cfg({ l1: true }));

  const a = anchorOf(document, 0);
  assert.equal(a.textContent, '2024-05-01 12:00', '跨年不许改');
  assert.equal(a.getAttribute(TIME_ATTR), null, '没改写就不该留下属性');
});

test('时间改写：作者昵称等非日期 title 不许误伤', { skip }, () => {
  const html = `<!DOCTYPE html><html><head><title>t</title></head><body>
    <div id="homeWrap"><div id="scroller" class="vue-recycle-scroller">
      <div class="vue-recycle-scroller__item-wrapper">
        <div class="vue-recycle-scroller__item-view">
          <div class="wbpro-scroller-item"><article>
            <header>
              <a href="/u/1" title="2026届毕业的某某">2026届毕业的某某</a>
              <a title="2026-10-13 08:13" href="https://weibo.com/1/Abc123">6小时前</a>
            </header>
            <div class="wbpro-feed-ogText">正文</div>
          </article></div>
        </div>
      </div>
    </div></div>
  </body></html>`;
  const { document } = boot(html, cfg({ l1: true }));

  const nick = document.querySelector('a[href="/u/1"]');
  assert.equal(nick.textContent, '2026届毕业的某某', '昵称链接被误改了');
  assert.equal(nick.getAttribute(TIME_ATTR), null);
  assert.equal(countTimes(document), 1, '只应改写真正的时间锚点');
});

// ── ② 幂等 ──────────────────────────────────────────────────────────────

test('时间改写：连扫三遍不二次改写、不污染原文属性（幂等）', { skip }, () => {
  const { document, scheduler } = boot(feed([
    { title: '2026-10-13 08:13', text: '6小时前' },
  ]), cfg({ l1: true }));

  const a = anchorOf(document, 0);
  assert.equal(a.getAttribute(TIME_ATTR), '6小时前');

  scheduler.rescan();
  scheduler.rescan();
  scheduler.rescan();

  assert.equal(a.textContent, '10-13 08:13', '重复扫描不该改变结果');
  assert.equal(a.getAttribute(TIME_ATTR), '6小时前',
    '原文属性被覆盖成了改写结果 —— 还原时会写回「10-13 08:13」这种假原文');
  assert.equal(countTimes(document), 1);
});

// ── ③ 还原 ──────────────────────────────────────────────────────────────

test('时间改写：档位关掉 ⇒ 还原成微博原文（逐字一致）', { skip }, () => {
  const { document } = boot(feed([
    { title: '2026-10-13 08:13', text: '6小时前' },
    { title: '2026-10-12 09:40', text: '昨天 09:40' },
  ]), cfg({ l1: true }));

  const a0 = anchorOf(document, 0);
  const a1 = anchorOf(document, 1);
  assert.equal(a0.textContent, '10-13 08:13');

  const card = document.querySelector('.wbpro-scroller-item');
  const res = applyAbsoluteTimes(card, new Date(), false);
  assert.equal(res.restored, 1, '本卡只应有 1 个锚点被还原');

  // 调度层是**逐卡**调用的 —— 第二张卡的锚点要自己那一轮处理
  for (const c of document.querySelectorAll('.wbpro-scroller-item')) {
    applyAbsoluteTimes(c, new Date(), false);
  }

  assert.equal(a0.textContent, '6小时前', '必须逐字还原');
  assert.equal(a1.textContent, '昨天 09:40');
  assert.equal(countTimes(document), 0, '还原后不该残留属性');
});

test('时间改写：stop() 之后文本全部还原（§7.4 约束 3 可逆）', { skip }, () => {
  const { document, scheduler } = boot(feed([
    { title: '2026-10-13 08:13', text: '6小时前' },
  ]), cfg({ l1: true }));

  assert.equal(anchorOf(document, 0).textContent, '10-13 08:13');
  scheduler.stop();

  assert.equal(anchorOf(document, 0).textContent, '6小时前', '停管线应还原被改写的文本');
  assert.equal(countTimes(document), 0);
  assert.equal(scheduler.stats().times, 0);
});

// ── ④ 槽位复用 ──────────────────────────────────────────────────────────

test('时间改写：槽位换了内容后照常改写，旧属性不残留', { skip }, () => {
  const { document } = boot(feed([
    { title: '2026-10-13 08:13', text: '6小时前' },
  ]), cfg({ l1: true }));

  const slot = document.querySelector('.vue-recycle-scroller__item-view');
  assert.equal(anchorOf(document, 0).textContent, '10-13 08:13');

  // 模拟虚拟列表把该槽位复用成另一条微博：微博重渲染 ⇒ 新的 `<a>`（无我们的属性）
  slot.querySelector('article').innerHTML = `
    <header><a title="2026-10-10 14:29" href="https://weibo.com/9/Xyz789">10-10   14:29</a></header>
    <div class="wbpro-feed-ogText">另一条正文</div>`;

  const { createScheduler: _cs } = { createScheduler };
  const s2 = _cs(document, cfg({ l1: true }));
  s2.start();

  const a = anchorOf(document, 0);
  assert.equal(a.textContent, '10-10 14:29', '复用后的新卡时间也要改写');
  assert.equal(a.getAttribute(TIME_ATTR), '10-10   14:29', '原文应是新卡自己的原文（带原空格）');
  assert.equal(countTimes(document), 1, '不应残留 2 个改写点');
  s2.stop();
});

// ── 真夹具整体改写率 ────────────────────────────────────────────────────

const fixtureFile = fixtures.find((f) => f.includes('1440')) || fixtures[0];

test('时间改写：真夹具上「时间锚点 = 卡片数」（一览表里每卡一个时间）', { skip: skip || !fixtureFile }, () => {
  const { document } = boot(readFileSync(join(FIXTURE_DIR, fixtureFile), 'utf8'), cfg({ l1: true }));

  const cards = document.querySelectorAll('.wbpro-scroller-item').length;
  const anchors = document.querySelectorAll('a[title^="20"]').length;
  const rewritten = countTimes(document);

  assert.ok(cards > 0, `${fixtureFile}: 一张卡都没取到`);
  assert.ok(anchors >= cards, `${fixtureFile}: 时间锚点 ${anchors} 少于卡片数 ${cards} —— 选择器可能失效`);
  assert.ok(rewritten > 0, `${fixtureFile}: 一个时间都没改写 —— 管线可能没接上`);

  // 改写后的文本必须都是「M-D HH:MM」形状（同年）
  for (const el of document.querySelectorAll(`[${TIME_ATTR}]`)) {
    assert.match(el.textContent.replace(/\s+/g, ' '), /^\d{1,2}-\d{1,2} \d{2}:\d{2}$/,
      `${fixtureFile}: 改写结果格式不对：${JSON.stringify(el.textContent)}`);
    assert.equal(el.getAttribute(TIME_ATTR).length > 0, true, '原文属性不该为空');
  }
});
