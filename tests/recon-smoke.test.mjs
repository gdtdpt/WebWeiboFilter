/**
 * `tools/recon/recon.js` 的**无浏览器冒烟测试**
 *
 * 为什么要有它：recon.js 是「一次性侦察脚本」，但它其实是要长期用的（每次微博改版都要复跑）。
 * 它以前**完全没有测试覆盖**，改一次就得让用户重新粘一遍才知道有没有报错 —— 前几轮就是这么来回的。
 *
 * 做法：把 recon.js 放进 `node:vm` 的沙箱里执行（补上 `window` / `document` / `MutationObserver`
 * 等浏览器全局），页面就是**真实快照夹具**（linkedom 建的 DOM）。然后调 `probeAds()`，
 * 断言分类结果与 `_fixture-expect.mjs` 的期望值一致。
 *
 * 覆盖到的东西：
 *   ① 脚本在真实 DOM 上**不抛异常**（语法/选择器/工具函数都活得下来）
 *   ② `probeAds()` 的**广告 / 存疑 / 干净**三分类与核心判定一致
 *   ③ 导出通道（`exportResults()` / `copyResult()`）真的产出内容
 *
 * 夹具不存在时整个文件自动跳过（夹具是 gitignore 的私有数据）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIXTURE_DIR, fixtures, expectFor } from './_fixture-expect.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RECON_PATH = join(HERE, '..', 'tools', 'recon', 'recon.js');

let parseHTML = null;
try {
  ({ parseHTML } = await import('linkedom'));
} catch (_e) {
  parseHTML = null;
}

const skip = !fixtures.length
  ? 'fixtures/ 为空（.gitignore 里的私有数据）—— 跳过 recon 冒烟'
  : (!parseHTML ? 'linkedom 未安装 —— 运行 npm install 后重试' : false);

/** 记录 log/warn/error，同时保持不污染测试输出 */
function makeConsole(sink) {
  const push = (level) => (...args) => sink.push(level + ': ' + args.map(String).join(' '));
  return { log: push('log'), warn: push('warn'), error: push('error'), info: push('info'), debug: push('debug') };
}

/** 把 recon.js 的 download() 换成内存收集 —— 测试里不去真的触发 <a download> */
function patchDownload(source) {
  const needle = 'function download(name, text, mime) {';
  assert.ok(source.includes(needle), 'recon.js 的 download() 签名变了 —— 请同步这个测试里的补丁');
  return source.replace(
    needle,
    needle + ' window.__downloads = window.__downloads || []; window.__downloads.push({ name: name, bytes: text.length });'
  );
}

/**
 * 在沙箱里跑一遍 recon.js，返回 `{ recon, window, messages }`。
 * 沙箱里只补浏览器全局；标准内置对象由 vm context 自带。
 */
function bootRecon(html) {
  const { window, document } = parseHTML(html);
  const messages = [];
  const downloads = [];

  const sandbox = {
    window,
    document,
    console: makeConsole(messages),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    navigator: { clipboard: null, userAgent: 'node-recon-smoke' },
    location: { href: 'https://weibo.com/home' },
    // linkedom 不实现 MutationObserver —— 给个空壳（watchTitle 不在本测试范围内）
    MutationObserver: class { constructor(cb) { this.cb = cb; } observe() {} disconnect() {} },
    getComputedStyle: typeof window.getComputedStyle === 'function'
      ? window.getComputedStyle.bind(window)
      : () => ({ getPropertyValue: () => '' }),
    Blob,
    URL,
  };
  sandbox.globalThis = sandbox;
  // 让 download 的记录落在这个数组上（见 patchDownload）
  window.__downloads = downloads;

  vm.runInContext(patchDownload(readFileSync(RECON_PATH, 'utf8')), vm.createContext(sandbox), { filename: 'recon.js' });

  const errs = messages.filter((m) => m.startsWith('error:'));
  assert.deepEqual(errs, [], 'recon.js 在真实快照上抛了异常：\n  ' + errs.join('\n  '));

  return { recon: window.SpecBaseRecon, window, messages, downloads };
}

// ── 逐夹具：分类结果必须与期望一致 ────────────────────────────────────────

for (const file of fixtures) {
  const exp = expectFor(file);
  const label = exp ? `${file} — ${exp.desc}` : `${file} — 未知夹具（冒烟）`;

  test(`recon 冒烟：${label}`, { skip }, () => {
    const html = readFileSync(join(FIXTURE_DIR, file), 'utf8');
    const { recon, downloads } = bootRecon(html);

    assert.ok(recon && typeof recon.probeAds === 'function', 'window.SpecBaseRecon 没挂上');

    const ads = recon.probeAds();

    if (!exp) return;   // 未登记的夹具只做「不崩」冒烟

    const hit = ads.feedAds.map((x) => `${x.author}(${x.hits.join(',')}/${x.score})`).join(' | ');
    assert.equal(ads.feedAds.length, exp.feedAds,
      `${file}: 推广卡期望 ${exp.feedAds}、实际 ${ads.feedAds.length} —— ${hit}`);
    assert.equal(ads.feedSuspects.length, exp.feedSuspects,
      `${file}: 存疑卡期望 ${exp.feedSuspects}、实际 ${ads.feedSuspects.length} —— ` +
      ads.feedSuspects.map((x) => `${x.author}(${x.hits.join(',')}/${x.score})`).join(' | '));
    assert.equal(ads.pageAds.filter((x) => !x.inFeed).length, exp.bannerAds,
      `${file}: 页面广告位期望 ${exp.bannerAds}、实际 ${ads.pageAds.length}`);

    // 每张判为广告 / 存疑的卡都必须带可解释的命中理由（§9）
    for (const row of [...ads.feedAds, ...ads.feedSuspects]) {
      assert.ok(row.hits.length > 0, `${file}: ${row.author} 有判定结果但 hits 为空`);
    }

    // 导出通道必须真的产出内容（download 已被换成内存收集）
    const snapshot = recon.exportResults();
    assert.ok(snapshot.keys.includes('ads'), `exportResults 应包含 ads，实际 keys=${snapshot.keys.join(',')}`);
    assert.ok(downloads.some((d) => /^probe-all-.*\.json$/.test(d.name)),
      `exportResults 没有触发下载，实际=${JSON.stringify(downloads)}`);

    const copied = recon.copyResult();
    assert.ok(copied && copied.includes('"ads"'), 'copyResult 应返回包含 ads 的 JSON 文本');
  });
}

// ── 与夹具无关的硬断言：用**合成最小页面**验证权重表 ─────────────────────

/** 造一个只含一张卡的最小微博页面；`href` 就是这张卡正文里的外链 */
function syntheticPage(href) {
  return `<!DOCTYPE html><html><head><title>t</title></head><body>
    <div id="scroller" class="vue-recycle-scroller">
      <div class="vue-recycle-scroller__item-wrapper">
        <div class="vue-recycle-scroller__item-view">
          <div class="wbpro-scroller-item">
            <article>
              <header><a usercard="1"><span title="测试作者">测试作者</span></a></header>
              <div class="wbpro-feed-ogText">正文 <a href="${href}">链接</a></div>
            </article>
          </div>
        </div>
      </div>
    </div>
  </body></html>`;
}

test('recon 冒烟：合成页 —— `natural` 埋点单独出现只算存疑（不判广告）', { skip }, () => {
  const video = 'https://video.weibo.com/show?fid=1034:5352459179065379' +
                '&mark_id=999_reallog_mark_ad%3A999%7CWeiboADNatural';
  const { recon } = bootRecon(syntheticPage(video));
  const ads = recon.probeAds();

  assert.equal(ads.feedAds.length, 0, 'natural 单独出现不得判为广告');
  assert.equal(ads.feedSuspects.length, 1, 'natural 单独出现应记为存疑');
  assert.equal(ads.feedSuspects[0].score, 1, 'natural 权重应为 1');
  assert.ok(ads.feedSuspects[0].hits.includes('url:natural'));
});

test('recon 冒烟：合成页 —— `campaign` 商业投放埋点单独出现即判广告', { skip }, () => {
  const shop = 'https://shop.sc.weibo.com/h5/sclick/index?mark=3_reallog_mark_ad%3A8%7C3_179187' +
               '&spm_mark=dgActivity';
  const { recon } = bootRecon(syntheticPage(shop));
  const ads = recon.probeAds();

  assert.equal(ads.feedAds.length, 1, 'campaign 单独出现应判为广告');
  assert.ok(ads.feedAds[0].score >= 3, 'campaign 权重应为 3');
  assert.ok(ads.feedAds[0].hits.includes('url:campaign'));
  assert.equal(ads.feedSuspects.length, 0);
});

test('recon 冒烟：合成页 —— 干净外链不得命中任何埋点', { skip }, () => {
  const natural = 'https://shop.sc.weibo.com/h5/goods/index?iid=110016521844900003972961&vs=weibo_feed';
  const { recon } = bootRecon(syntheticPage(natural));
  const ads = recon.probeAds();

  assert.equal(ads.feedAds.length, 0);
  assert.equal(ads.feedSuspects.length, 0, '自然卡的电商链接不该命中');
  assert.equal(ads.cleanCards, 1);
});

// ── 回归：项集合必须是**信息流槽位**，不得钻进卡片内的九宫格图片格 ──────────────
//
// 2026-10-13 真实事故：`findContainers()` 按「≥3 个同签名子节点」打分，一个 9 宫格图片网格
// （9 个一模一样的 `woo-box-item-inlineBlock _item_a3hty_47 __yawf_feed-picture_item`，高 137px）
// 得分比信息流容器还高 ⇒ 抢走 primary ⇒ `testHeight()` 拿图片格做隐藏实验，打出
// `delta: 0 / residual: 137` 这种「看着像结论、其实无意义」的读数。
// 下面两条断言把这个坑焊死：无论从哪个入口取项，结果都必须是 `.vue-recycle-scroller__item-view`。

test('recon 冒烟：`_feedItems()` 只返回信息流槽位', { skip }, () => {
  for (const file of fixtures) {
    const html = readFileSync(join(FIXTURE_DIR, file), 'utf8');
    const { recon } = bootRecon(html);

    const items = recon._feedItems();
    assert.ok(items.length >= 2, `${file}: 未取到信息流槽位（应 ≥2）`);

    for (const it of items) {
      const cls = it.getAttribute('class') || '';
      assert.ok(cls.includes('vue-recycle-scroller__item-view'),
        `${file}: _feedItems 混入非槽位元素 —— ${JSON.stringify(cls)}`);
      assert.equal((it.parentElement.getAttribute('class') || '').includes('vue-recycle-scroller__item-wrapper'),
        true, `${file}: 槽位的父节点不是 item-wrapper`);
    }
  }
});

test('recon 冒烟：即使喂进「图片格网格」当容器，`_collectItems()` 也必须纠正回信息流槽位', { skip }, () => {
  const file = fixtures.find((f) => f.includes('1440')) || fixtures[0];
  const html = readFileSync(join(FIXTURE_DIR, file), 'utf8');
  const { recon, window } = bootRecon(html);

  // 找一张卡里的九宫格单元（`woo-box-item-inlineBlock` 是 woo-* 设计系统类，B4 认证稳定）
  const gridCell = [...window.document.querySelectorAll('.wbpro-scroller-item div')]
    .find((el) => /(^|\s)woo-box-item-inlineBlock(\s|$)/.test(el.getAttribute('class') || '') &&
                  el.querySelector('img'));
  assert.ok(gridCell, `${file}: 夹具里找不到九宫格单元 —— 这条断言失去意义，请检查夹具`);

  // 故意把「错容器」喂进去
  const items = recon._collectItems(gridCell);
  assert.ok(items.length >= 2, `${file}: 从错容器出发也该能纠正到信息流槽位`);

  for (const it of items) {
    const cls = it.getAttribute('class') || '';
    assert.ok(cls.includes('vue-recycle-scroller__item-view'),
      `${file}: _collectItems 未纠正 —— 返回了 ${JSON.stringify(cls)}`);
  }

  // 且绝不能把图片格本身当成项
  assert.equal(items.includes(gridCell), false, `${file}: 图片格被当成了信息流项`);
});
