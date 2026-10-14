// ==UserScript==
// @name         SpecBase · M2 首帧改高度验证 v3（一次性，用完即卸）
// @script       specbase-recon
// @version      3.0.0
// @description  在 document-start 注入「真实缩短卡片内容高度」的 CSS，看虚拟列表的槽位位置会不会跟着走。装上 → 刷新一次 → 自动出结论并下载 JSON。
// @match        https://weibo.com/*
// @match        https://*.weibo.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * 这个脚本回答什么
 * ----------------
 * L1 第二批的 4 项（媒体缩略化 / 隐藏统计行 / 隐藏互动按钮行 / 字号行距）与整个 L2 重排，
 * 都会**改卡片高度**。而微博的信息流是虚拟列表：槽位用内联 `translateY` 绝对定位，
 * 位置来自一份「尺寸」数据。所以问题是：
 *
 *   我们在 @run-at document-start 注入的 CSS，会不会被微博一起量进那份尺寸里？
 *   ✅ 会 ⇒ 改高度可行（规则照常写，页面不留洞）
 *   ❌ 不会 ⇒ 改高度整批砍掉
 *
 * v2 那次测错了什么（2026-10-14，务必先读）
 * ----------------------------------------
 * v2 注入的是 `.wbpro-scroller-item{margin-bottom:-60px}`。它把**槽位**压矮了 60px
 * （自证：卡片高 − 槽高 = 60，5/5 通过），但**卡片的边框盒高度一点没变** ——
 * 而 `margin` 本来就不进 `getBoundingClientRect()`。
 *
 * 实测读数（first 四对）：d = 281/837/407/421，槽高 = 221/777.9/347.6/361.5，
 * 卡片高 = 槽高 + 60 = 281/837.9/407.6/421.5 —— **d 与「卡片高」逐对吻合（误差 ≤1px）**。
 * 也就是说：微博记的是**卡片的边框盒高度**，我们的 margin 它根本看不见。
 * ⇒ 那个 60px 的洞是**注入手法自己造出来的**，与「微博是否支持改高度」无关。
 *
 * 时间线上也不支持「注入太晚」这个解释：本脚本记录的 `styleAttached.attachedAt`
 * 比槽位元素首次出现**早约 1.7 秒**（见 JSON 的 `timeline`），而元素被测量不可能早于它被创建。
 *
 * v3 改了什么
 * -----------
 *   ① 注入的是**真实缩短卡片内容**的规则（隐藏内容主体 + 统计行）—— 卡片自己的边框盒真的变矮。
 *   ② 判据从「有没有洞」升级成**两态对撞**，不靠阈值猜：
 *        · A 态 = 注入态（首帧就生效）→ 每对量 d、槽高、**卡片高**；
 *        · 撤掉样式 → B 态 = 自然态 → 量同一个条目的**自然卡片高**。
 *      两个候选值相差几百 px，谁贴近 d 就是谁：
 *        d ≈ A 态卡片高 ⇒ 尺寸**跟着我们的 CSS 走** ⇒ ✅ 改高度可行；
 *        d ≈ B 态卡片高 ⇒ 尺寸**停在注入前的高度** ⇒ ❌ 只能砍掉。
 *   ③ 自证换了一招（旧的内外高差自证在 v3 不适用了）：检查「B 态卡片高 − A 态卡片高」的中位数
 *      —— 它必须明显 > 0，否则说明规则没命中，整组读数作废（防「规则没生效 ⇒ 自然没有洞」的假阳性）。
 *   ④ 顺手加一道**反 v2 错误的守卫**：要求「卡片高 ≈ 槽高」（中位差 ≤ 2px）。
 *      一旦我们又在改槽而不改卡，这道闸会直接把读数判为无效，而不是给出一个看似合理的方向。
 *
 * 怎么用（2 步，约 1 分钟）
 * ------------------------
 *   1. 装本脚本 → 打开 https://weibo.com/home → **刷新一次**（首帧注入才会生效）
 *   2. 等信息流出来（**不要滚动**），Console 自动打出结论并下载 `ffprobe-firstframe-*.json`
 *   3. ⚠️ 测完请**卸载本脚本**并刷新一次（它会把卡片内容一直藏着）
 *
 * ⚠️ 与正式脚本（specbase-helper）可以共存：本脚本只加一条 style，不碰别的。
 */

(function () {
  'use strict';

  var VERSION = '3.0.0';
  var STYLE_ID = 'spb-ffprobe-style';

  // ⚠️ 只允许改**卡片自己的内容**（display:none 掉真实存在的内容块 ⇒ 边框盒真的变矮）。
  //    ⛔ 绝不能用 margin / transform / clip 这类「不动边框盒」的手法 —— v2 就是这么测错的。
  //    两个落点都在四份真夹具里「每张卡恰好一个」（tests/ffprobe-rule.test.mjs 守着）。
  var CSS =
    '.wbpro-scroller-item .wbpro-feed-content{display:none !important}' +
    '.wbpro-scroller-item article > footer{display:none !important}';

  var MIN_SHRINK = 8;      // 自证下限：B 态卡片高 − A 态卡片高 的中位数至少要比它大
  var CARD_GAP_TOL = 2;    // 反 v2 守卫：「卡片高 − 槽高」的中位差不得超过它
  var MATCH_TOL = 3;       // 判 d 贴近哪个候选值的容差
  var LOG = '[首帧探针 v3] ';

  // ───────────────────────────────────────────────────────────────────────────
  // ① 首帧注入（必须早于微博的任何一次渲染）
  // ───────────────────────────────────────────────────────────────────────────

  function attachStyle() {
    var s = document.getElementById(STYLE_ID);
    if (!s) {
      s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent = CSS;
    }
    var root = (document.head && document.head.appendChild ? document.head : null) ||
      (document.documentElement && document.documentElement.appendChild ? document.documentElement : null);
    if (!root) return false;
    if (s.parentNode !== root) root.appendChild(s);
    return true;
  }

  function detachStyle() {
    var s = document.getElementById(STYLE_ID);
    if (s && s.parentNode) s.parentNode.removeChild(s);
  }

  var attachedAt = null, attachedAtMs = null, attachTries = 0;
  (function tryAttach() {
    if (attachStyle()) {
      if (!attachedAt) { attachedAt = new Date().toISOString(); attachedAtMs = Date.now(); }
      return;
    }
    // 首帧可能连 <html> 都还没建出来 ⇒ 每 50ms 再试（上限 20 秒）。
    // 刻意用「成功即停」而不是 setInterval —— 否则后面撤样式做 B 态时会被它偷偷挂回去。
    if (++attachTries > 400) return;
    setTimeout(tryAttach, 50);
  })();

  // ── 时间线自证：记录「槽位元素第一次出现」的时刻 ────────────────────────────
  // 元素被测量不可能早于它被创建 ⇒ 只要 attachedAt 早于 firstSlotAt，
  // 就能排除「微博在我们注入之前就量完了」这个解释（v2 那次正是靠它排除的）。
  var firstSlotAt = null, firstSlotAtMs = null, slotObserver = null;
  (function watchFirstSlot() {
    if (document.querySelector('.vue-recycle-scroller__item-view')) {
      firstSlotAt = new Date().toISOString(); firstSlotAtMs = Date.now();
      return;
    }
    try {
      slotObserver = new MutationObserver(function () {
        if (firstSlotAtMs !== null) return;
        if (document.querySelector('.vue-recycle-scroller__item-view')) {
          firstSlotAt = new Date().toISOString(); firstSlotAtMs = Date.now();
          if (slotObserver) slotObserver.disconnect();
        }
      });
      slotObserver.observe(document.documentElement || document, { childList: true, subtree: true });
    } catch (e) { /* 观测不了就算了，时间线只是旁证 */ }
    setTimeout(function () { if (slotObserver) slotObserver.disconnect(); }, 30000);
  })();

  // ───────────────────────────────────────────────────────────────────────────
  // ② 采样
  // ───────────────────────────────────────────────────────────────────────────

  function round1(n) { return Math.round(n * 10) / 10; }

  function medianOf(arr) {
    if (!arr || !arr.length) return null;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : round1((a[mid - 1] + a[mid]) / 2);
  }

  function uniq(arr) {
    var seen = {}, out = [];
    for (var i = 0; i < arr.length; i++) { if (!seen[arr[i]]) { seen[arr[i]] = 1; out.push(arr[i]); } }
    return out;
  }

  /** 槽位内联 `transform: translateY(Npx)` 的 N —— 微博预计算的槽位位置 */
  function parseTranslateY(el) {
    var t = String((el && el.getAttribute && el.getAttribute('style')) || '');
    var m = /translateY\(\s*(-?[\d.]+)px\s*\)/.exec(t);
    return m ? parseFloat(m[1]) : null;
  }

  /** 回收位（滚出视口后被挪走的槽）：`translateY(-9999px)` 或 `opacity:0` */
  function isRecycled(el) {
    var ty = parseTranslateY(el);
    if (ty !== null && ty <= -9990) return true;
    var op = window.getComputedStyle(el).opacity;
    return !!op && parseFloat(op) === 0;
  }

  function feedSlots() {
    var w = document.querySelector('.vue-recycle-scroller__item-wrapper');
    if (!w) return [];
    var out = [];
    for (var i = 0; i < w.children.length; i++) {
      var el = w.children[i];
      if (String(el.getAttribute('class') || '').indexOf('vue-recycle-scroller__item-view') !== -1) out.push(el);
    }
    return out;
  }

  /**
   * `data-index` 在 **`.wbpro-scroller-item`** 上（槽位的直接子元素），不在 `item-view` 上。
   * 2026-10-14 在 Console 探针里就是踩了这个坑（读到 null ⇒ 自检算出空数组 ⇒ 假警）。
   */
  function slotIndex(el) {
    if (!el || !el.getAttribute) return null;
    var own = el.getAttribute('data-index');
    if (own !== null && own !== '') return own;
    var inner = el.firstElementChild;
    if (inner && inner.getAttribute) {
      var v = inner.getAttribute('data-index');
      if (v !== null && v !== '') return v;
    }
    return null;
  }

  function sample() {
    var list = feedSlots(), rows = [];
    for (var i = 0; i < list.length; i++) {
      var el = list[i], r = el.getBoundingClientRect();
      var card = el.firstElementChild;
      var cr = (card && card.getBoundingClientRect) ? card.getBoundingClientRect() : null;
      rows.push({
        order: i,
        dataIndex: slotIndex(el),
        ty: parseTranslateY(el),
        h: round1(r.height),                 // 槽位自身高度
        cardH: cr ? round1(cr.height) : null, // 卡片边框盒高度（**改高度的真正落点**）
        top: round1(r.top),
        bottom: round1(r.bottom),
        recycled: isRecycled(el)
      });
    }
    return rows;
  }

  function analyze(rows) {
    var live = [], i;
    for (i = 0; i < rows.length; i++) if (!rows[i].recycled && rows[i].ty !== null) live.push(rows[i]);

    var byIdx = {}, keys = [];
    for (i = 0; i < live.length; i++) {
      if (live[i].dataIndex === null) continue;
      byIdx[live[i].dataIndex] = live[i];
      var n = Number(live[i].dataIndex);
      if (!isNaN(n) && keys.indexOf(n) === -1) keys.push(n);
    }
    keys.sort(function (a, b) { return a - b; });

    var pairs = [], k, matched = keys.length > 0;
    function mk(a, b) {
      var d = round1(b.ty - a.ty);
      return { d: d, h: a.h, cardH: a.cardH, from: a.dataIndex, to: b.dataIndex,
        err: round1(Math.abs(d - a.h)), cardErr: a.cardH === null ? null : round1(Math.abs(d - a.cardH)),
        gap: round1(b.top - a.bottom) };
    }
    if (keys.length >= 2) {
      for (k = 0; k < keys.length - 1; k++) {
        if (keys[k + 1] !== keys[k] + 1) continue;
        pairs.push(mk(byIdx[String(keys[k])], byIdx[String(keys[k] + 1)]));
      }
    }
    if (!pairs.length && live.length >= 2) {
      for (k = 0; k < live.length - 1; k++) pairs.push(mk(live[k], live[k + 1]));
    }

    var gaps = pairs.map(function (p) { return p.gap; });
    var hs = live.map(function (r) { return r.h; });
    // 反 v2 守卫：卡片高与槽高必须一致。若我们的注入又在「改槽不改卡」，这里会露出来。
    var cardGaps = [];
    for (i = 0; i < live.length; i++) {
      if (live[i].cardH !== null) cardGaps.push(round1(live[i].cardH - live[i].h));
    }

    // 全体槽位「量不到盒子」⇒ 页面处于异常态（某个祖先被 display:none），读数无意义。
    // 2026-10-14 第一次跑本脚本就是这种读数（真因：A 类收口吞掉整条时间线，§12-B10）。
    var boxesMissing = live.length > 0 && live.every(function (r) {
      return r.h === 0 && r.top === 0 && r.bottom === 0;
    });

    return {
      liveSlots: live.length,
      boxesMissing: boxesMissing,
      pairedBy: matched ? 'data-index' : 'DOM 顺序（下标取不到 —— 结论要打折扣）',
      pairs: pairs.length,
      cardGapMedian: medianOf(cardGaps),
      cardGapOk: cardGaps.length > 0 && Math.abs(medianOf(cardGaps)) <= CARD_GAP_TOL,
      gapAvg: gaps.length ? round1(gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length) : null,
      gapHasHole: gaps.some(function (g) { return g > 8; }),
      hAvg: hs.length ? round1(hs.reduce(function (a, b) { return a + b; }, 0) / hs.length) : null,
      hAvgCard: (function () {
        var cs = live.map(function (r) { return r.cardH; }).filter(function (v) { return v !== null; });
        return cs.length ? round1(cs.reduce(function (a, b) { return a + b; }, 0) / cs.length) : null;
      })(),
      hDistinct: uniq(hs).length,
      samples: pairs.slice(0, 12)
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ③ 导出
  // ───────────────────────────────────────────────────────────────────────────

  function download(name, text) {
    try {
      var url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      console.log(LOG + '已导出：' + name);
    } catch (e) { console.warn(LOG + '导出失败（结果仍打印在下面）', e); }
  }

  function stamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ④ 主流程
  //    A 态（注入）→ 撤掉样式 → B 态（自然）→ 两态对撞判读
  // ───────────────────────────────────────────────────────────────────────────

  function waitForSlots(timeoutMs) {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function tick() {
        var live = sample().filter(function (r) { return !r.recycled; });
        if (live.length >= 3) return resolve(true);
        if (Date.now() - t0 > timeoutMs) return resolve(false);
        setTimeout(tick, 300);
      })();
    });
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var RESULTS = {};

  /** 两态对撞：d 到底是贴近 A 态卡片高，还是贴近 B 态卡片高 */
  function collide(rowsA, rowsB) {
    var a = analyze(rowsA);
    var bByIdx = {};
    for (var i = 0; i < rowsB.length; i++) {
      var r = rowsB[i];
      if (!r.recycled && r.dataIndex !== null && r.cardH !== null) bByIdx[r.dataIndex] = r;
    }
    var shrink = [], nA = 0, nB = 0, n = 0, skipped = 0, detail = [];
    for (i = 0; i < a.samples.length; i++) {
      var s = a.samples[i];
      var rb = bByIdx[s.from];
      if (!rb || s.cardH === null) { skipped++; continue; }
      var dA = Math.abs(s.d - s.cardH);       // 贴近「注入态卡片高」？
      var dB = Math.abs(s.d - rb.cardH);      // 贴近「自然态卡片高」？
      n++;
      if (dA <= MATCH_TOL) nA++;
      if (dB <= MATCH_TOL) nB++;
      shrink.push(round1(rb.cardH - s.cardH));
      detail.push({ from: s.from, d: s.d, cardH_A: s.cardH, cardH_B: rb.cardH,
        errA: round1(dA), errB: round1(dB) });
    }
    var med = medianOf(shrink);
    return {
      pairs: n,
      skippedNoBaseline: skipped,
      matchInjected: n > 0 ? Math.round(nA / n * 100) / 100 : null,
      matchNatural: n > 0 ? Math.round(nB / n * 100) / 100 : null,
      shrinkMedian: med,
      selfProofOk: n > 0 && med !== null && med >= MIN_SHRINK,
      detail: detail.slice(0, 12),
      analysisA: a
    };
  }

  function run() {
    console.log(LOG + '等微博信息流渲染并让首屏稳定…（请**不要滚动**）');
    waitForSlots(30000).then(function (ok) {
      if (!ok) {
        console.warn(LOG + '30 秒内没等到 ≥3 个信息流槽位 —— 确认页面是 https://weibo.com/home 且已登录。'
          + '取到之后再手动跑一次 window.__ffprobe.run()。');
        return null;
      }
      // A 态：注入已经生效（首帧就挂着）——等信息流与图片稳定
      return sleep(2500).then(function () {
        RESULTS.rowsA = sample();
        console.log('%c' + LOG + 'A 态（注入中）已采', 'background:#2f3e34;color:#fff;padding:1px 4px',
          analyze(RESULTS.rowsA));

        // B 态：撤掉样式，让卡片恢复自然高度（槽位位置不会动 —— 那正是我们要看的）
        detachStyle();
        if (slotObserver) slotObserver.disconnect();
        return sleep(1400).then(function () {
          RESULTS.rowsB = sample();
          console.log('%c' + LOG + 'B 态（自然）已采', 'background:#2f3e34;color:#fff;padding:1px 4px',
            analyze(RESULTS.rowsB));
          attachStyle();   // 恢复成 A 态，页面保持单一稳定状态
          return null;
        });
      });
    }).then(function () {
      if (!RESULTS.rowsA) return;

      var c = collide(RESULTS.rowsA, RESULTS.rowsB);
      RESULTS.collide = c;
      var a = c.analysisA;
      RESULTS.timeline = {
        styleAttachedAt: attachedAt,
        firstSlotElementAt: firstSlotAt,
        msStyleBeforeFirstSlot: (attachedAtMs !== null && firstSlotAtMs !== null)
          ? firstSlotAtMs - attachedAtMs : null,
        note: '元素被测量不可能早于它被创建 ⇒ 上面这个差值为正，就排除了「微博在我们注入之前就量完了」'
      };

      var verdict;
      if (a.boxesMissing) {
        verdict = '⛔ **读数无效**：' + a.liveSlots + ' 个活槽位的盒子全都量不到（height/top/bottom 全 0）'
          + '⇒ 页面处于异常态（某祖先被 display:none）。最常见是产品脚本的 A 类收口吞了时间线'
          + '（PROJECT.md §12-B10）—— 跑 `__spb.stats()` 看 `pageAds` / `pageAdsRefused`，'
          + '确认是它就 `__spb.off()` 后刷新重跑。';
      } else if (!a.cardGapOk) {
        verdict = '⛔ **读数无效（又踩了 v2 的坑）**：卡片高 − 槽高的中位数是 ' + a.cardGapMedian
          + 'px（要求 ≤ ' + CARD_GAP_TOL + 'px）⇒ 我们的注入是在改**槽位**而不是改**卡片**，'
          + '而微博记的是卡片高 ⇒ 这组数据只能证明「改槽位没用」，证明不了「改高度没用」。';
      } else if (!c.selfProofOk) {
        verdict = '⛔ **读数无效**：B 态卡片高 − A 态卡片高 的中位数是 ' + c.shrinkMedian
          + 'px（要求 ≥ ' + MIN_SHRINK + 'px）⇒ 注入的规则没真正把卡片压矮（可能锚点变了），'
          + '此时「没有洞」只是假阳性。把 JSON 发给开发者换规则重测。';
      } else if (c.pairs < 2) {
        verdict = '⚠️ 可比对太少（' + c.pairs + ' 对，跳过 ' + c.skippedNoBaseline
          + '）—— 先把信息流滚出内容再手动跑 window.__ffprobe.run()。';
      } else if (c.matchInjected !== null && c.matchInjected >= 0.8 && c.matchNatural !== null && c.matchNatural <= 0.2) {
        verdict = '✅ **改高度可行**：卡片被真实压矮了 ' + c.shrinkMedian + 'px，'
          + '而槽位位置跟着一起走（d 贴近「注入态卡片高」' + c.matchInjected * 100 + '% 对，'
          + '贴近自然卡高只有 ' + c.matchNatural * 100 + '% 对）'
          + '⇒ 微博是在**首帧按卡片实际渲染高度**建立尺寸的，我们在 document-start 注入的 CSS 会被算进去。'
          + ' ⇒ **L1 剩余 4 项与 L2 重排都能做。**';
      } else if (c.matchNatural !== null && c.matchNatural >= 0.8 && c.matchInjected !== null && c.matchInjected <= 0.2) {
        verdict = '❌ **尺寸不跟我们的 CSS 走**：卡片被真实压矮了 ' + c.shrinkMedian + 'px，'
          + '但槽位位置仍停在**自然卡高**（d 贴近自然卡高 ' + c.matchNatural * 100 + '% 对，'
          + '贴近注入态只有 ' + c.matchInjected * 100 + '% 对）'
          + '⇒ 微博不按当前渲染高度建尺寸 ⇒ **改高度这一整批（L1 剩余 4 项 + L2 重排）只能砍掉**，'
          + 'M2 以「L0 伪装 + L1 素净 + 去橙红」收官。';
      } else {
        verdict = '⚠️ **证据混杂**：d 贴近注入态卡高 ' + (c.matchInjected === null ? '—' : c.matchInjected * 100)
          + '% 对、贴近自然卡高 ' + (c.matchNatural === null ? '—' : c.matchNatural * 100) + '% 对'
          + '（压矮 ' + c.shrinkMedian + 'px，' + c.pairs + ' 对）—— 建议刷新重跑，或把 JSON 发给开发者判读。';
      }
      if (RESULTS.timeline.msStyleBeforeFirstSlot !== null) {
        verdict += ' ｜ 时间线旁证：CSS 比第一个槽位元素早出现 '
          + RESULTS.timeline.msStyleBeforeFirstSlot + 'ms。';
      }
      RESULTS.verdict = verdict;

      console.log('%c' + LOG + '结论', 'background:#2f3e34;color:#fff;padding:1px 4px', verdict);

      download('ffprobe-firstframe-' + stamp() + '.json', JSON.stringify({
        script: 'specbase-firstframe-probe',
        version: VERSION,
        generatedAt: new Date().toISOString(),
        page: { url: location.href, title: document.title },
        tag: 'firstframe',
        result: {
          question: '在 document-start 注入「真实缩短卡片内容」的 CSS，虚拟列表的槽位位置会不会跟着走？',
          injectedCss: CSS,
          method: '两态对撞：A 态（首帧注入）量 d 与卡片高；撤掉样式后 B 态量同一批条目的自然卡片高；'
            + '看 d 贴近哪一个。两候选值相差 ' + c.shrinkMedian + 'px，不靠阈值猜。',
          styleAttached: {
            present: !!document.getElementById(STYLE_ID),
            parent: (function () {
              var s = document.getElementById(STYLE_ID);
              if (!s || !s.parentNode) return null;
              var p = s.parentNode;
              if (p === document.head) return 'head';
              if (p === document.documentElement) return 'documentElement';
              return String(p.nodeName || '').toLowerCase();
            })(),
            attachedAt: attachedAt
          },
          timeline: RESULTS.timeline,
          collide: {
            pairs: c.pairs,
            skippedNoBaseline: c.skippedNoBaseline,
            matchInjected: c.matchInjected,
            matchNatural: c.matchNatural,
            shrinkMedian: c.shrinkMedian,
            selfProofOk: c.selfProofOk,
            detail: c.detail
          },
          stateA_injected: a,
          stateB_natural: analyze(RESULTS.rowsB),
          verdict: verdict,
          cleanup: '测完请**卸载本脚本**并刷新一次（它会把卡片内容一直藏着）。'
        }
      }, null, 2));
    }).catch(function (e) {
      console.error(LOG + '跑挂了：', e);
    });
  }

  window.__ffprobe = {
    version: VERSION,
    run: run,
    injectedCss: CSS,
    sample: function () { return analyze(sample()); },
    rows: sample,
    clear: function () { detachStyle(); console.log(LOG + '已撤掉注入（刷新一次页面恢复干净）。'); },
    reattach: function () { attachStyle(); console.log(LOG + '已重新挂上注入。'); }
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(run, 300);
  } else {
    window.addEventListener('DOMContentLoaded', function () { setTimeout(run, 300); });
  }
})();
