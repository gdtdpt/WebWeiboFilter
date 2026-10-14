/**
 * `tools/recon/firstframe-probe.user.js`（v3）**判词**的夹具测试。
 *
 * 为什么值得测：这条判词会直接决定「L1 剩余 4 项 + L2 重排」做还是砍，
 * 而它上一版（v2）给出的「❌」已经被证明是**注入手法**的否证、不是结论的否证。
 * 这里造四个世界喂给它，把「它到底会说什么」焊死：
 *
 *   ① 尺寸跟着注入走            ⇒ ✅ 改高度可行
 *   ② 尺寸停在注入前的高度      ⇒ ❌ 只能砍掉
 *   ③ 只压矮槽位、不动卡片（v2 那个坑）⇒ ⛔ 读数无效
 *   ④ 注入其实没生效            ⇒ ⛔ 读数无效（防「规则没命中 ⇒ 自然没有洞」的假阳性）
 *
 * 世界怎么搭：`getBoundingClientRect` 被桩掉 —— 槽位高度与卡片高度都从元素上的 `data-h` 读，
 * 并按「注入样式是否在文档里」决定要不要减去 `shrinkSlot` / `shrinkCard`。
 * 槽位的内联 `translateY` 步长则代表**微博那份尺寸缓存**，由各世界自己选。
 * 时间用立即执行的 `setTimeout` 顶着，所以整条流水线（等槽位 → 采样 → 撤样式 → 再采样）跑得飞快。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PROBE = join(ROOT, 'tools', 'recon', 'firstframe-probe.user.js');
const STYLE_ID = 'spb-ffprobe-style';

let parseHTML = null;
try {
  ({ parseHTML } = await import('linkedom'));
} catch (_e) {
  parseHTML = null;
}

const skip = parseHTML ? false : 'linkedom 未安装 —— 运行 npm install 后重试';

/**
 * 造一个虚拟信息流并对齐现实：
 *   · 槽位（`.vue-recycle-scroller__item-view`）高度 = 规范高度 − shrinkSlot
 *   · 卡片（`.wbpro-scroller-item`）高度 = 规范高度 − shrinkCard
 *   · 槽位内联 `translateY` 步长 = 微博的尺寸缓存（各世界自选）
 * `natural` 为每张卡的「规范高度」（槽 == 卡，正常页面本就如此）。
 */
function world(opts) {
  const natural = opts.natural || [300, 300, 300, 300];
  let acc = 0;
  const inner = natural.map((nat, i) => {
    const ty = Math.round(acc);
    acc += opts.cacheStep === 'injected' ? (nat - opts.shrinkCard) : nat;
    return `<div class="vue-recycle-scroller__item-view" data-h="${nat}" data-top="${ty}" ` +
      `style="transform: translateY(${ty}px) translateX(0px); opacity: 1;">` +
      `<div class="wbpro-scroller-item" data-index="${i}" data-h="${nat}">` +
      '<article><div class="wbpro-feed-ogText">卡</div></article></div></div>';
  }).join('');
  return '<!DOCTYPE html><html><head><title>t</title></head><body>' +
    '<div class="vue-recycle-scroller"><div class="vue-recycle-scroller__item-wrapper" ' +
    `style="min-height: 4000px;">${inner}</div></div></body></html>`;
}

/** 跑一遍探针，返回它导出的 JSON（`result` 段） */
async function runProbe(html, opts) {
  const { window, document } = parseHTML(html);

  // ⚠️ 探针里用的是 `window.getComputedStyle`（浏览器里必然存在，linkedom 没有）—— 单独补上
  window.getComputedStyle = () => ({ opacity: '1', getPropertyValue: () => '' });

  // 桩掉布局：高度来自 data-h，是否缩短取决于注入样式还在不在
  window.Element.prototype.getBoundingClientRect = function () {
    const cls = this.getAttribute('class') || '';
    const nat = Number(this.getAttribute('data-h') || 0);
    const injected = !!document.getElementById(STYLE_ID);
    let h = nat;
    if (injected) {
      if (cls.includes('vue-recycle-scroller__item-view')) h = nat - opts.shrinkSlot;
      else if (cls.includes('wbpro-scroller-item')) h = nat - opts.shrinkCard;
    }
    const top = Number(this.getAttribute('data-top') || 0);
    return { x: 0, y: top, top, left: 0, right: 0, bottom: top + h, width: 0, height: h };
  };

  const downloads = [];
  const src = readFileSync(PROBE, 'utf8').replace(
    'function download(name, text) {',
    'function download(name, text) { __capture(name, text);'
  );

  const sandbox = {
    window, document,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    navigator: {}, location: { href: 'https://weibo.com/home' },
    getComputedStyle: () => ({ opacity: '1', getPropertyValue: () => '' }),
    MutationObserver: class { observe() {} disconnect() {} },
    Blob: class { constructor(parts) { this.parts = parts; } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    // 立即执行的定时器：把「等槽位 → 睡 2.5s → 采样 → 撤样式 → 睡 1.4s → 采样」压成几拍
    setTimeout: (fn) => setImmediate(fn),
    clearTimeout() {}, setInterval: (fn) => setImmediate(fn), clearInterval() {},
    __capture: (name, text) => downloads.push({ name, text }),
  };
  sandbox.globalThis = sandbox;
  // 探针把把手挂在 window 上（它自己就是 `window.__ffprobe = …`）
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'firstframe-probe.user.js' });

  assert.ok(window.__ffprobe, '探针没挂上把手 —— 载入就挂了？');
  window.__ffprobe.run();

  for (let i = 0; i < 3000 && !downloads.length; i++) await new Promise((r) => setImmediate(r));
  assert.equal(downloads.length, 1, '没等到导出结果（判词没算出来？）');

  const payload = JSON.parse(downloads[0].text);
  assert.equal(payload.script, 'specbase-firstframe-probe');
  return payload.result;
}

test('首帧探针 v3：尺寸跟着注入走 ⇒ 判「✅ 改高度可行」', { skip }, async () => {
  const r = await runProbe(world({ shrinkSlot: 60, shrinkCard: 60, cacheStep: 'injected' }),
    { shrinkSlot: 60, shrinkCard: 60 });

  assert.equal(r.stateA_injected.liveSlots, 4);
  assert.equal(r.collide.pairs, 3);
  assert.equal(r.collide.shrinkMedian, 60, 'B 态卡片高 − A 态卡片高 应为 60');
  assert.equal(r.collide.selfProofOk, true);
  assert.equal(r.collide.matchInjected, 1, 'd 应当贴近「注入态卡片高」');
  assert.equal(r.collide.matchNatural, 0, '不该贴近自然卡高');
  assert.equal(r.stateA_injected.cardGapOk, true, '卡片高 == 槽高，不能误报成「改槽不改卡」');
  assert.match(r.verdict, /✅ \*\*改高度可行\*\*/);
});

test('首帧探针 v3：尺寸停在注入前的高度 ⇒ 判「❌ 只能砍掉」', { skip }, async () => {
  const r = await runProbe(world({ shrinkSlot: 60, shrinkCard: 60, cacheStep: 'natural' }),
    { shrinkSlot: 60, shrinkCard: 60 });

  assert.equal(r.collide.shrinkMedian, 60, '注入确实生效了（否则会走「读数无效」那条）');
  assert.equal(r.collide.selfProofOk, true);
  assert.equal(r.collide.matchInjected, 0);
  assert.equal(r.collide.matchNatural, 1, 'd 停在自然卡高 ⇒ 尺寸没跟着我们的 CSS 走');
  assert.match(r.verdict, /❌ \*\*尺寸不跟我们的 CSS 走\*\*/);
});

test('首帧探针 v3：只压矮槽位、不动卡片（v2 那个坑）⇒ 判「⛔ 读数无效」而不是给结论', { skip }, async () => {
  const r = await runProbe(world({ shrinkSlot: 60, shrinkCard: 0, cacheStep: 'natural' }),
    { shrinkSlot: 60, shrinkCard: 0 });

  assert.equal(r.stateA_injected.cardGapMedian, 60, '卡片高 − 槽高 = 60，正是 v2 的形态');
  assert.equal(r.stateA_injected.cardGapOk, false);
  assert.match(r.verdict, /⛔ \*\*读数无效（又踩了 v2 的坑）\*\*/);
  assert.doesNotMatch(r.verdict, /改高度这一整批/, '绝不能在这种形态下给出「砍掉」的结论');
});

test('首帧探针 v3：注入其实没生效 ⇒ 判「⛔ 读数无效」（防假阳性）', { skip }, async () => {
  const r = await runProbe(world({ shrinkSlot: 0, shrinkCard: 0, cacheStep: 'natural' }),
    { shrinkSlot: 0, shrinkCard: 0 });

  assert.equal(r.collide.shrinkMedian, 0, '卡片高度没变');
  assert.equal(r.collide.selfProofOk, false);
  assert.match(r.verdict, /⛔ \*\*读数无效\*\*/);
  assert.doesNotMatch(r.verdict, /改高度可行/, '没有洞只是「规则没命中」的假阳性，不许当好消息');
});
