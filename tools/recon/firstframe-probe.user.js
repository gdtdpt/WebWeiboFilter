// ==UserScript==
// @name         SpecBase · M2 首帧改高度验证（一次性，用完即卸）
// @namespace    specbase-recon
// @version      2.0.0
// @description  回答一个决定 L1 剩余 4 项与整个 L2 能否落地的问题：在 document-start（= 微博渲染之前）注入「卡片变矮 60px」的 CSS，卡片之间会不会留洞。装上 → 刷新一次 → 自动出结论并下载 JSON。
// @match        https://weibo.com/*
// @match        https://*.weibo.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * 为什么必须是「独立的油猴脚本」而不是 Console 探针
 * ----------------------------------------------
 * 问题不是「改高度会不会留洞」（这个 B2 已经答了：渲染后改 ⇒ 必留洞），
 * 而是「**渲染之前**注入的 CSS，会不会被微博一起量进槽位尺寸缓存」——
 * PROJECT.md §7.5.4 押在「首帧注入则无害」上，而这条从来没被实测过。
 *
 * Console 探针**物理上做不到**这件事：它只能在页面已渲染完之后注入 CSS，
 * 那一刻微博早就把高度写进缓存了 ⇒ 无论怎么测都只会看到洞（= 退回 B2 的情形）。
 * 要早于微博的第一次测量，只有 `@run-at document-start` 这一条路。
 * 也正因为如此，这个脚本**故意不并进 recon.js**（recon 是粘贴式 Console 脚本）。
 *
 * 怎么用（2 步，约 1 分钟）
 * ------------------------
 *   1. 装本脚本 → 打开 https://weibo.com/home → **刷新一次**（首帧注入生效）
 *   2. 等信息流出来（**不要滚动**），Console 自动打出结论并下载
 *      `ffprobe-firstframe-*.json`（看完把 JSON 发给开发者）
 *   3. ⚠️ **测完请卸载本脚本** —— 它会把卡片高度一直压矮 60px
 *
 * 怎么看结论（脚本自己会判，这里说清依据）
 * ----------------------------------------
 *   · `selfProof.ok` ⇒ **CSS 真的生效了**（卡片高 − 槽高 ≈ 60px）。
 *     没有这一步，「没有洞」可能只是「规则没命中」的假阳性 —— 两件事必须分开证明。
 *   · `first.gapHasHole === false` ⇒ **首帧注入有效** ⇒ L1 剩余 4 项与 L2 重排都能做。
 *   · `first.gapHasHole === true`（洞 ≈ 60px）⇒ 尺寸缓存与我们的 CSS 无关 ⇒ 只能砍掉。
 *   · `deep` 是「往下滚 4 屏之后」的第二次读数，用来交叉验证（它应当与 first 同结论）。
 *
 * ⚠️ 与正式脚本（specbase-helper）可以共存：本脚本只加一条 style，不碰别的。
 */

(function () {
  'use strict';

  var VERSION = '2.0.0';
  var DELTA = 60;
  var STYLE_ID = 'spb-ffprobe-style';
  var CSS = '.wbpro-scroller-item{margin-bottom:-' + DELTA + 'px !important}';
  var LOG = '[首帧探针] ';

  // ───────────────────────────────────────────────────────────────────────────
  // ① 首帧注入 —— 必须在微博的任何一次渲染之前
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 把实验样式挂到文档上。
   * `document-start` 时 `<head>` 可能还不存在（甚至 `documentElement` 都还没有），
   * 所以按 head → documentElement 逐级退让；挂上就生效，挂不上就等下一拍。
   * ⚠️ 这里刻意与产品脚本 `src/apply/style.js#ensureStyle` 用同一套退让逻辑 ——
   *   不然「探针能过、产品过不了」这种情况就白测了。
   */
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

  var attachedAt = null;
  if (attachStyle()) attachedAt = new Date().toISOString();
  // 首帧可能连 <html> 都还没建出来 ⇒ 连补 20 秒（每 50ms 一次，成本可忽略）
  var guard = setInterval(function () {
    if (attachStyle() && !attachedAt) attachedAt = new Date().toISOString();
  }, 50);
  setTimeout(function () { clearInterval(guard); }, 20000);

  // ───────────────────────────────────────────────────────────────────────────
  // ② 采样（判据与 recon.js 的 probeHeightCache 保持一致）
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

  /** 读槽位内联 `transform: translateY(Npx)` 的 N —— 微博 JS 预计算的槽位位置 */
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
      var inner = el.firstElementChild;
      var innerH = (inner && inner.getBoundingClientRect) ? round1(inner.getBoundingClientRect().height) : null;
      rows.push({
        order: i,
        dataIndex: slotIndex(el),
        ty: parseTranslateY(el),
        h: round1(r.height),
        innerH: innerH,
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

    var pairs = [], k;
    function mk(a, b) {
      var d = round1(b.ty - a.ty);
      return { d: d, h: a.h, err: round1(Math.abs(d - a.h)), gap: round1(b.top - a.bottom) };
    }
    if (keys.length >= 2) {
      for (k = 0; k < keys.length - 1; k++) {
        if (keys[k + 1] !== keys[k] + 1) continue;
        pairs.push(mk(byIdx[String(keys[k])], byIdx[String(keys[k + 1])]));
      }
    }
    if (!pairs.length && live.length >= 2) {
      for (k = 0; k < live.length - 1; k++) pairs.push(mk(live[k], live[k + 1]));
    }

    var errs = pairs.map(function (p) { return p.err; });
    var gaps = pairs.map(function (p) { return p.gap; });
    var hs = live.map(function (r) { return r.h; });
    var exact = pairs.filter(function (p) { return p.err <= 2; }).length;
    var matched = keys.length > 0;
    return {
      liveSlots: live.length,
      pairedBy: matched ? 'data-index' : 'DOM 顺序（下标取不到 —— 结论要打折扣）',
      pairs: pairs.length,
      exact: exact,
      matchRate: pairs.length ? Math.round(exact / pairs.length * 100) / 100 : null,
      medianAbsErr: medianOf(errs),
      gapAvg: gaps.length ? round1(gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length) : null,
      gapMax: gaps.length ? Math.max.apply(null, gaps) : null,
      gapHasHole: gaps.some(function (g) { return g > 8; }),
      hAvg: hs.length ? round1(hs.reduce(function (a, b) { return a + b; }, 0) / hs.length) : null,
      hMin: hs.length ? Math.min.apply(null, hs) : null,
      hMax: hs.length ? Math.max.apply(null, hs) : null,
      hDistinct: uniq(hs).length,
      hHasDecimal: hs.some(function (v) { return Math.abs(v - Math.round(v)) > 0.05; }),
      samples: pairs.slice(0, 12)
    };
  }

  /**
   * 「CSS 真的生效了」的**结构自证**，不依赖任何下标：
   * `.wbpro-scroller-item` 自己挂 `margin-bottom:-60px` ⇒ 它父槽的高度 = 卡片高 − 60。
   * 规则没命中时也会「没有洞」，所以这一步是防假阳性的必需品。
   */
  function selfProof(rows) {
    var deltas = [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].recycled || rows[i].innerH === null) continue;
      deltas.push(round1(rows[i].innerH - rows[i].h));
    }
    var med = medianOf(deltas);
    return {
      expectation: '卡片高 − 槽高 应 ≈ ' + DELTA + 'px',
      n: deltas.length,
      median: med,
      samples: deltas.slice(0, 8),
      ok: deltas.length > 0 && med !== null && Math.abs(med - DELTA) <= 6
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
  // ④ 主流程：等信息流 → 首帧读数 → 自动下滚 4 屏再读数 → 判读 → 下载
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

  function run() {
    console.log(LOG + 'MODE=on（首帧注入 -' + DELTA + 'px）—— 等微博信息流渲染…'
      + '（请**不要滚动**，避免半截卡污染读数）');
    waitForSlots(30000).then(function (ok) {
      if (!ok) {
        console.warn(LOG + '30 秒内没等到 ≥3 个信息流槽位 —— 确认页面是 https://weibo.com/home 且已登录。'
          + '取到之后再手动跑一次 window.__ffprobe.run()。');
        return null;
      }
      return sleep(2500).then(function () {          // 让首屏图片 / 字号稳定下来
        var rows = sample();
        var first = analyze(rows), proof = selfProof(rows);
        RESULTS.first = first;
        RESULTS.selfProof = proof;

        console.log('%c' + LOG + '首帧读数', 'background:#2f3e34;color:#fff;padding:1px 4px', first);
        console.log('%c' + LOG + '注入自证', 'background:#2f3e34;color:#fff;padding:1px 4px', proof);

        // 二级读数：再往下滚 4 屏（那里是本次注入之后才第一次渲染的内容）
        return sleep(300).then(function () {
          var before = window.scrollY;
          window.scrollBy(0, Math.round(window.innerHeight * 4));
          return sleep(1800).then(function () {
            var deep = analyze(sample());
            RESULTS.deep = deep;
            RESULTS.deepScroll = {
              scrolledBy: Math.round(window.innerHeight * 4),
              scrollYBefore: Math.round(before), scrollYAfter: Math.round(window.scrollY)
            };
            console.log('%c' + LOG + '下滚 4 屏后的读数', 'background:#2f3e34;color:#fff;padding:1px 4px', deep);
            return null;
          });
        });
      });
    }).then(function () {
      if (!RESULTS.first) return;

      var first = RESULTS.first, proof = RESULTS.selfProof, deep = RESULTS.deep;
      var verdict;
      if (!proof.ok) {
        verdict = '⚠️ **注入自证没通过**（卡片高 − 槽高 中位数 ' + proof.median + 'px，期望 ' + DELTA
          + 'px，样本 ' + proof.n + ' 个）⇒ 无法确认 CSS 真的生效，**整组读数作废**。'
          + '先检查 `.wbpro-scroller-item` 这个锚点还在不在（把 JSON 发给开发者）。';
      } else if (first.pairs < 2) {
        verdict = '⚠️ 取不到可比的相邻槽（' + first.pairs + ' 对，活槽 ' + first.liveSlots
          + ' 个）—— 先把信息流滚出内容，然后手动跑 window.__ffprobe.run()。';
      } else if (!first.gapHasHole) {
        verdict = '✅ **首帧注入有效**：CSS 确认生效（卡片被压矮 ' + proof.median + 'px），'
          + '而卡片之间**没有洞**（' + first.pairs + ' 对全部吻合，中位误差 ' + first.medianAbsErr
          + 'px，平均空隙 ' + first.gapAvg + 'px）⇒ 微博把「缩小后的高度」一起量进了槽位缓存'
          + ' ⇒ **L1 剩余 4 项（媒体缩略化 / 隐藏统计行 / 隐藏互动按钮行 / 字号行距）与 L2 重排都能做**。';
      } else {
        verdict = '❌ **首帧注入也救不了**：CSS 确认生效（卡片被压矮 ' + proof.median + 'px），'
          + '但卡片之间出现了 ' + first.gapAvg + 'px 的洞（最大 ' + first.gapMax + 'px）'
          + '⇒ 尺寸缓存与我们的 CSS 无关（不是按渲染高度量的）⇒ **改高度这一整批（L1 剩余 4 项 + L2 重排）只能砍掉**，'
          + 'M2 以「L0 伪装 + L1 素净 + 去橙红」收官。';
      }
      if (deep && deep.pairs >= 2) {
        verdict += ' ｜ 交叉验证（下滚 4 屏后）：' + (deep.gapHasHole
          ? '那里出现了 ' + deep.gapAvg + 'px 的空隙 —— 但该区域可能混有「注入前就已缓存」的项，'
            + '**只能当旁证**，以首帧读数（first）为准。'
          : '那里同样没有洞（那一段是注入之后才第一次渲染的内容 ⇒ 与首帧结论一致）。');
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
          question: '在 document-start（= 微博渲染之前）注入「卡片变矮 60px」的 CSS，'
            + '卡片之间会不会留洞？（= 尺寸缓存是否按实际渲染高度建立）',
          injectedCss: CSS,
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
          first: first,
          selfProof: proof,
          deepScroll: RESULTS.deepScroll || null,
          deep: deep || null,
          verdict: verdict,
          cleanup: '测完请**卸载本脚本**（它会把卡片高度一直压矮 ' + DELTA + 'px）。'
        }
      }, null, 2));
    }).catch(function (e) {
      console.error(LOG + '跑挂了：', e);
    });
  }

  window.__ffprobe = {
    version: VERSION,
    run: run,
    sample: function () { return analyze(sample()); },
    rows: sample,
    clear: function () {
      detachStyle();
      clearInterval(guard);
      console.log(LOG + '已撤掉注入的 CSS（页面恢复原状；刷新一下更干净）。');
    }
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(run, 300);
  } else {
    window.addEventListener('DOMContentLoaded', function () { setTimeout(run, 300); });
  }
})();
