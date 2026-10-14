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
 * @param {string} html  页面 HTML（真实快照或合成页）
 * @param {object} [win] 可选的**已预处理过的** window（比如已经把 getBoundingClientRect 桩掉）——
 *                       传了就不再从 html 重建，避免桩被覆盖
 */
function bootRecon(html, win) {
  const { window, document } = win || parseHTML(html);
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

test('recon 冒烟：probeTheme() 在真实快照上跑得通并产出关键字段（M2 取样用）', { skip }, () => {
  const file = fixtures.find((f) => f.includes('1440')) || fixtures[0];
  const html = readFileSync(join(FIXTURE_DIR, file), 'utf8');
  const { recon, downloads } = bootRecon(html);

  const theme = recon.probeTheme();

  assert.equal(typeof theme.varRuleCount, 'number');
  assert.equal(typeof theme.rootVarCount, 'number');
  assert.ok(Array.isArray(theme.brandVars), 'brandVars 必须是数组（哪怕为空）');
  assert.ok(Array.isArray(theme.warmElements));
  assert.ok(Array.isArray(theme.varRules));

  // 外壳：logo 是全站的，必然存在；取不到就说明锚点写错了
  assert.ok(theme.shell, 'shell 段缺失');
  assert.ok(theme.shell.logo, `${file}: 顶栏 logo 没取到（a[href="/"][aria-label] 可能已失效）`);
  assert.equal(typeof theme.shell.logo.sig, 'string');
  for (const key of ['top', 'left', 'right', 'bottom', 'rightAny', 'bottomAny']) {
    assert.ok(Array.isArray(theme.shell[key]), `shell.${key} 必须是数组`);
  }

  // 主题段（2026-10-13 新增）：深色/浅色必须以 <html data-theme> 形式记录下来 ——
  // 它是「颜色一律走主题令牌」这条纪律的事实依据（PROJECT.md §12-B9）
  assert.ok(theme.theme, 'theme 段缺失');
  assert.equal(theme.theme.htmlAttrs.theme, 'dark',
    '夹具的 <html data-theme="dark"> 没被读到 —— 主题锚点解析可能坏了');
  assert.equal(typeof theme.theme.tokens, 'object');

  // 布局模式：靠 --main-width / --simple-width 的算术判定，不靠猜
  assert.ok(theme.layout, 'layout 段缺失');
  assert.equal(typeof theme.layout.mode, 'string');
  assert.equal(typeof theme.layout.contentWidth, 'number');

  // 时间锚点：夹具里每张卡都有帖子直链
  assert.ok(theme.timeAnchors.total > 0, '一个时间锚点都没取到 —— 直链正则可能写错了');
  assert.ok(theme.timeAnchors.absoluteTitle > 0, '没有任何锚点带「YYYY-MM-DD HH:mm」格式的 title');

  // 我方规则命中数：必须真的数到卡片（否则说明选择器与前缀对不上）
  assert.ok(theme.ourRuleHits.cards > 0, 'ourRuleHits.cards 不该为 0');
  assert.ok(theme.ourRuleHits.avatar > 0, 'ourRuleHits.avatar 不该为 0');
  assert.equal(_countIconFamily(theme.wooIconFamily) > 0, true, 'woo-icon 家族一个都没扫到');

  assert.ok(downloads.some((d) => d.name.indexOf('probe-theme-') === 0),
    'probeTheme() 跑完应自动下载 JSON');
});

function _countIconFamily(family) {
  return Object.keys(family || {}).length;
}

// ── 回归：`probeHeightCache` 的核心判据（「槽位尺寸缓存 = 实测高度」）──────────────────────────
//
// 2026-10-14 新增。它回答的是 **L1 剩余 4 项 + 整个 L2 重排能不能做** 这个前置问题
// （PROJECT.md §13-M2「决定改高度项生死的一个未测假设」）。判据本体是纯计算，
// 所以这里用**合成虚拟列表**把它焊住 —— 真机读数只跑一次，逻辑出错没人发现得了。
//
// ⚠️ linkedom 不做布局：`getBoundingClientRect()` 恒返回 0。所以这里**桩掉**它，
//    用元素上的 `data-h` / `data-top` 喂进「高度」与「视觉位置」，再把内联 `translateY`
//    当作微博预计算的槽位位置。三组数据分别对应三种世界：
//    ① 缓存 = 实测高度（d ≈ h）· ② 缓存 = 固定步长（d ≠ h）· ③ 夹一个回收位（必须被排除）。

/**
 * 桩掉布局：用元素上的 `data-h` / `data-top` 喂进「高度」与「视觉位置」。
 *
 * `opts.shrinkAfterPass` / `opts.slotCount`：模拟「**第一次采样之后**注入的 CSS 才生效」——
 * 计数**只在 `window.__spbArm = true` 之后开始**（recon.js 载入时会自动跑一次 `report()`，
 * 那也会查矩形，不设这个闸门就会把计数吃掉）。
 * 第 `slotCount` 次之后的 `item-view` 矩形查询一律矮 `shrinkAfterPass`。
 * `item-view` 里的卡片（内层 `data-h`）**不变**，所以「卡片高 − 槽高」正好等于注入量 ——
 * 这正是 `injectSelfProof()` 的判据。
 */
function stubRects(window, opts) {
  opts = opts || {};
  window.__spbShrink = 0;
  window.__spbSeen = 0;
  window.__spbArm = false;
  window.Element.prototype.getBoundingClientRect = function () {
    const cls = this.getAttribute('class') || '';
    const isSlot = cls.includes('vue-recycle-scroller__item-view');
    if (isSlot && window.__spbArm && opts.shrinkAfterPass && !window.__spbShrink) {
      window.__spbSeen += 1;
      if (window.__spbSeen >= (opts.slotCount || 0)) window.__spbShrink = opts.shrinkAfterPass;
    }
    const top = Number(this.getAttribute('data-top') || 0);
    const base = Number(this.getAttribute('data-h') || 0);
    const h = isSlot ? base - window.__spbShrink : base;
    return { x: 0, y: top, top, left: 0, right: 0, bottom: top + h, width: 0, height: h };
  };
}

/** 把 vm 里造的数组搬回测试作用域（跨 realm 的数组 deepEqual 会因原型不同而失败） */
function plain(v) {
  return JSON.parse(JSON.stringify(v));
}

/**
 * 造一个虚拟信息流：`slots` = [{ index, ty, h }]（`ty` 是内联 translateY，`h` 是实测高度）。
 *
 * ⚠️ `data-index` 刻意放在**内层的 `.wbpro-scroller-item`** 上 —— 这是 2026-10-14 真机核实过的
 * 真实结构（`item-view > .wbpro-scroller-item[data-index] > article`）。
 * 之前这个合成列表把 `data-index` 放在 `item-view` 上，于是**掩盖**了 recon.js 里
 * 「在错的那一层读下标 ⇒ 恒为 null ⇒ 注入自检算出空数组 ⇒ 报假警」这个 bug。
 * 结构必须与真实一致，否则测试只是在替错误背书。
 */
function syntheticVirtualList(slots) {
  const inner = slots.map((s) => `<div class="vue-recycle-scroller__item-view" ` +
    `data-h="${s.h}" data-top="${s.ty}" style="transform: translateY(${s.ty}px) translateX(0px); opacity: 1;">` +
    `<div class="wbpro-scroller-item" data-index="${s.index}" data-h="${s.h}">` +
    '<article><div class="wbpro-feed-ogText">卡</div></article></div></div>').join('');
  return '<!DOCTYPE html><html><head><title>t</title></head><body>' +
    '<div class="vue-recycle-scroller"><div class="vue-recycle-scroller__item-wrapper" ' +
    `style="min-height: 4000px;">${inner}</div></div></body></html>`;
}

/** 采样分析：跑 recon 的真实现（`_sampleSlots` → `_analyzeSlots`），只桩掉矩形 */
function analyzeFixture(html) {
  const { window } = parseHTML(html);
  stubRects(window);
  const { recon } = bootRecon(html, window);
  return recon._analyzeSlots(recon._sampleSlots());
}

test('recon 冒烟：尺寸缓存「量 DOM」时 —— d(i) 与 h(i) 吻合、无洞（⇒ 改高度可行）', { skip }, () => {
  // 高度带小数：287.6px 这种值只可能来自实测，不可能来自固定值 / 接口
  const heights = [287.6, 588.2, 300.4, 412.3];
  let acc = 0;
  const slots = heights.map((h, i) => {
    const s = { index: i, ty: Math.round(acc), h };
    acc += h;
    return s;
  });

  const a = analyzeFixture(syntheticVirtualList(slots));

  assert.equal(a.liveSlots, 4, '活槽数不对 —— 回收位过滤可能把正常槽也吃了');
  assert.equal(a.pairs, 3, '相邻对应为 3 对');
  assert.equal(a.matchRate, 1, `d 与 h 应完全吻合，实际 ${a.exact}/${a.pairs}（中位误差 ${a.medianAbsErr}）`);
  assert.ok(a.medianAbsErr <= 2, '取整误差应在 2px 内');
  assert.equal(a.gapHasHole, false, '不该有洞');
  assert.ok(Math.abs(a.gapAvg) <= 2, `平均视觉空隙应≈0，实际 ${a.gapAvg}`);
  assert.equal(a.hHasDecimal, true, '小数位是「实测」的关键旁证，必须被记录');
  assert.equal(a.hDistinct, 4, '四张卡高度各不相同');
});

test('recon 冒烟：尺寸缓存「预先定好」时 —— d 是固定步长、与 h 脱节、并且看得到洞', { skip }, () => {
  // 槽位按固定 400px 排布，但卡片实际高度五花八门 ⇒ 缓存与渲染高度无关
  const heights = [287.6, 588.2, 300.4, 412.3];
  const slots = heights.map((h, i) => ({ index: i, ty: i * 400, h }));

  const a = analyzeFixture(syntheticVirtualList(slots));

  assert.equal(a.pairs, 3);
  assert.equal(a.matchRate, 0, `d 与 h 应完全脱节，实际 ${a.exact}/${a.pairs}`);
  assert.ok(a.medianAbsErr > 50, '中位误差应很大');
  assert.equal(a.gapHasHole, true, '固定步长下必然出现洞 —— 这是「不可行」的可视证据');
});

test('recon 冒烟：回收位（translateY(-9999px) / opacity:0）必须被排除在比对之外', { skip }, () => {
  const html = syntheticVirtualList([
    { index: 0, ty: 0, h: 300 },
    { index: 1, ty: 300, h: 300 },
    { index: 98, ty: -9999, h: 300 },              // 回收位（位置被挪走）
    { index: 99, ty: -9999, h: 300 },
  ]);

  const { window } = parseHTML(html);
  stubRects(window);
  const { recon } = bootRecon(html, window);

  // 先把回收位的 opacity 也设成 0（走另一条判定分支）
  const slots = window.document.querySelectorAll('.vue-recycle-scroller__item-view');
  slots[3].setAttribute('style', 'transform: translateY(-9999px) translateX(0px); opacity: 0;');

  const rows = recon._sampleSlots();
  assert.equal(rows.length, 4, '采样应把全部槽都记下来（含回收位）');
  assert.equal(rows.filter((r) => r.recycled).length, 2, '两个回收位都应被标记');

  const a = recon._analyzeSlots(rows);
  assert.equal(a.liveSlots, 2, '分析时只能剩 2 个活槽');
  assert.equal(a.pairs, 1, '活槽 0/1 构成 1 对');
  assert.equal(a.matchRate, 1, '排除回收位后应完全吻合（否则位置被挪走的槽会污染判据）');
});

// ── 回归：槽位下标 `data-index` 在**内层**，必须从那一层读 ────────────────────────────────
//
// 2026-10-14 真机打脸：真实结构是 `item-view > .wbpro-scroller-item[data-index] > article`，
// 而上一版在 `item-view` 上读 ⇒ 恒为 null ⇒ ① 相邻配对静默退回 DOM 顺序（碰巧结论一样，
// 所以一直没暴露）② `probeHeightCache()` 的注入自检算出**空数组** ⇒ 报出
// 「⚠️ CSS 没按预期生效 —— 后面读数不可信」的**假警**
// （就是 `probe-height-cache-baseline-20261014-1157.json` 里那句）。
// 下面两条把「在正确的那一层读」焊死，并让合成列表的结构与真机一致。

test('recon 冒烟：槽位下标从内层 `.wbpro-scroller-item` 读出（真机结构回归）', { skip }, () => {
  const html = syntheticVirtualList([
    { index: 7, ty: 0, h: 300 }, { index: 8, ty: 300, h: 320 },
  ]);
  const { window } = parseHTML(html);
  stubRects(window);
  const { recon } = bootRecon(html, window);

  const slots = recon._feedItems();
  assert.equal(slots[0].getAttribute('data-index'), null, '合成列表的槽位本身不该带 data-index（与真机一致）');
  assert.equal(recon._slotIndexOf(slots[0]), '7', '下标没从内层读出来 —— 注入自检会退化成假警');
  assert.deepEqual(plain(recon._sampleSlots().map((r) => r.dataIndex)), ['7', '8']);
  assert.equal(recon._analyzeSlots(recon._sampleSlots()).pairs, 1);
});

test('recon 冒烟：注入自检 —— 配上槽 + 高度真变了，才算 `cssApplied`', { skip }, () => {
  const html = syntheticVirtualList([
    { index: 0, ty: 0, h: 300 }, { index: 1, ty: 300, h: 320 }, { index: 2, ty: 620, h: 280 },
  ]);
  const { window } = parseHTML(html);
  // 模拟「第一次采样之后注入的 CSS 才生效」：第二遍起槽高 −60，卡片本身不变
  stubRects(window, { shrinkAfterPass: 60, slotCount: 3 });
  const { recon } = bootRecon(html, window);
  window.__spbArm = true;                   // 从这里开始计数（载入期的 report() 不算）

  const first = recon.probeHeightCache();
  assert.equal(first.consistency.matchRate, 1, '注入前 d 与 h 应完全吻合');
  assert.equal(first.consistency.gapHasHole, false, '注入前不该有洞');
  assert.equal(first.injectDelta.pairedSlots, 3, '三个槽都应配上（下标配对路径）');
  assert.equal(first.injectDelta.medianHeightShrink, -60, '注入后每个槽矮 60px');
  assert.equal(first.injectDelta.cssApplied, true,
    '这次必须判「CSS 生效」—— 上一版在这里报假警（下标读错层 ⇒ 配对表为空）');
  assert.equal(first.injectDelta.selfProof.median, 60, '结构自证：卡片高 − 槽高 = 60');
  assert.equal(first.injectDelta.selfProof.ok, true);
  assert.equal(first.afterInject.gapHasHole, true, '渲染后改高度 ⇒ 必然出现 ~60px 的洞（B2 已证）');
  recon.probeHeightCache({ clear: true });
});

test('recon 冒烟：注入自检 —— 高度没变时只能说「没按预期生效」，不能含糊成「没配上」', { skip }, () => {
  const html = syntheticVirtualList([
    { index: 0, ty: 0, h: 300 }, { index: 1, ty: 300, h: 320 }, { index: 2, ty: 620, h: 280 },
  ]);
  const { window } = parseHTML(html);
  stubRects(window);                        // 不模拟注入 ⇒ 高度不变
  const { recon } = bootRecon(html, window);

  const first = recon.probeHeightCache();
  assert.equal(first.injectDelta.cssApplied, false);
  assert.equal(first.injectDelta.pairedSlots, 3, '配上 3 个槽、只是高度没变 —— 两者不可混淆');
  assert.match(first.injectDelta.note, /没按预期生效/);
  assert.doesNotMatch(first.injectDelta.note, /一个槽都没配上/);
  recon.probeHeightCache({ clear: true });
});

test('recon 冒烟：`_heightShrink()` 配不上槽时返回空数组（调用方靠 length 区分两者）', { skip }, () => {
  const html = syntheticVirtualList([{ index: 0, ty: 0, h: 300 }]);
  const { window } = parseHTML(html);
  stubRects(window);
  const { recon } = bootRecon(html, window);
  const rows = recon._sampleSlots();

  assert.deepEqual(plain(recon._heightShrink([], rows)), [], '没有可比的前一组 ⇒ 空数组');
  const changed = rows.map((r) => Object.assign({}, r, { h: r.h - 60 }));
  assert.deepEqual(plain(recon._heightShrink(rows, changed)), [-60], '下标配对路径应算出 −60');
});

test('recon 冒烟：`probeHeightCache()` 两段式跑得通并各自下载 JSON（状态机 + 导出通道）', { skip }, () => {
  const html = syntheticVirtualList([
    { index: 0, ty: 0, h: 300 }, { index: 1, ty: 300, h: 320 }, { index: 2, ty: 620, h: 280 },
  ]);
  const { window } = parseHTML(html);
  stubRects(window);
  const { recon, downloads } = bootRecon(html, window);

  const first = recon.probeHeightCache();
  assert.equal(first.stage, 'baseline', '第一段应标记 stage=baseline');
  assert.ok(first.consistency && typeof first.consistency.matchRate === 'number');
  assert.ok(first.injectDelta, '第一段必须带「CSS 是否真的改变了高度」的自证字段');
  assert.ok(window.document.getElementById('spb-recon-hprobe'), '第一段应注入 -60px 的实验 CSS');
  assert.ok(downloads.some((d) => d.name.startsWith('probe-height-cache-baseline-')),
    `第一段应下载基线 JSON，实际=${JSON.stringify(downloads)}`);

  const second = recon.probeHeightCache();
  assert.equal(second.stage, 'after-remount', '第二段应标记 stage=after-remount');
  assert.ok(second.baseline && second.remount, '第二段必须同时给出基线与复量两组读数');
  assert.equal(typeof second.remountDetected, 'boolean');
  assert.ok(second.verdict.length > 0, '第二段必须给出结论');
  assert.equal(window.document.getElementById('spb-recon-hprobe'), null, '第二段跑完必须撤掉注入的 CSS');
  assert.ok(downloads.some((d) => d.name.startsWith('probe-height-cache-remount-')),
    `第二段应下载复量 JSON，实际=${JSON.stringify(downloads)}`);

  // 中止通道：清掉基线后，再跑一次应回到第一段
  const cleared = recon.probeHeightCache({ clear: true });
  assert.equal(cleared.stage, 'cleared');
  assert.equal(recon.probeHeightCache().stage, 'baseline', 'clear 之后应能重新开始');
});
