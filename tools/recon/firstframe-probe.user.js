// ==UserScript==
// @name         SpecBase · M2 首帧改高度验证（一次性，用完即卸）
// @namespace    specbase-recon
// @version      1.0.0
// @description  回答一个决定 L1 剩余 4 项与整个 L2 能否落地的问题：在 document-start（= 微博渲染之前）注入「卡片变矮 60px」的 CSS，卡片之间会不会留洞。跑两次（on / off）自动对比。
// @match        https://weibo.com/*
// @match        https://*.weibo.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * 为什么需要「独立的油猴脚本」而不是 Console 探针
 * ------------------------------------------------
 * Console 探针只能在页面**已经渲染完之后**注入 CSS —— 那正是 B2 四组实验的情形，
 * 结论已知（留洞、后续项不上移）。而我们要问的是「**渲染之前**注入是否有效」
 * （PROJECT.md §7.5.4 押在这上面）。要做到「早于微博的首次测量」，只有 `@run-at document-start`
 * 的油猴脚本这条路 —— 也正因为如此，这个脚本**故意不并进 recon.js**（recon 是粘贴式的 Console 脚本）。
 *
 * 怎么用（3 步，约 2 分钟）
 * ------------------------
 *   1. 装本脚本 → 打开 https://weibo.com/home → **刷新一次**（首帧注入生效）
 *   2. 等信息流出来、滚两屏，看 Console：脚本会自动量并下载 `ffprobe-on-*.json`
 *   3. 把下面的 MODE 改成 'off'（对照组：不注入任何 CSS）→ 保存 → **再刷新一次**
 *      → 脚本会自动把两次结果**对比**并下载 `ffprobe-compare-*.json`
 *
 * 怎么看结论
 * ----------
 *   · **on 组卡片之间没有洞（gapAvg ≈ 0）** ⇒ 微博把「缩小后的高度」一起量进去了
 *     ⇒ **首帧注入改高度有效** ⇒ L1 剩余 4 项与 L2 重排都能做。
 *   · **on 组卡片之间看得到 ~60px 的洞** ⇒ 尺寸缓存与我们的 CSS 无关 ⇒ 改高度会留洞。
 *   · 对照组（off）的卡片高度应比 on 组高约 60px —— 这是「CSS 真的生效了」的证明
 *     （否则整组读数都是假的：规则没命中，自然也就没有洞）。
 *
 * ⚠️ 与本项目正式脚本（specbase-helper）可以共存：它只加一条 style，不碰别的东西。
 * ⚠️ 测完请**卸载本脚本**（它会在每一帧都改卡片高度）。
 */

(function () {
  'use strict';

  // ── 唯一需要改的地方 ─────────────────────────────────────────────────────────
  // 'on'  = 实验组：document-start 注入「卡片变矮 60px」
  // 'off' = 对照组：什么都不注入
  var MODE = 'on';
  // ────────────────────────────────────────────────────────────────────────────

  var VERSION = '1.0.0';
  var DELTA = 60;
  var STYLE_ID = 'spb-ffprobe-style';
  var CSS = '.wbpro-scroller-item{margin-bottom:-' + DELTA + 'px !important}';
  var STORE_KEY = 'spb-ffprobe-last';
  var LOG = '[首帧探针] ';

  var RESULTS = {};

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

  // ---- ① 首帧注入（document-start，早于微博 Vue app 挂载）------------------------------------

  if (MODE === 'on') {
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
    // document-start 时 head 可能还不存在，插到 documentElement 上；若微博重建 head 会连带丢掉 ⇒ 保险起见盯着补
    var guard = setInterval(function () {
      if (!document.getElementById(STYLE_ID)) {
        try { (document.head || document.documentElement).appendChild(style); } catch (e) { /* noop */ }
      }
    }, 500);
    setTimeout(function () { clearInterval(guard); }, 15000);
  }

  // ---- ② 采样（与 recon.js 的 probeHeightCache 同一套判据）-----------------------------------

  function parseTranslateY(el) {
    var t = String((el && el.getAttribute && el.getAttribute('style')) || '');
    var m = /translateY\(\s*(-?[\d.]+)px\s*\)/.exec(t);
    return m ? parseFloat(m[1]) : null;
  }

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
      var cls = String(el.getAttribute('class') || '');
      if (cls.indexOf('vue-recycle-scroller__item-view') !== -1) out.push(el);
    }
    return out;
  }

  function sample() {
    var list = feedSlots();
    var rows = [];
    for (var i = 0; i < list.length; i++) {
      var el = list[i], r = el.getBoundingClientRect();
      rows.push({
        dataIndex: el.getAttribute('data-index') || null,
        ty: parseTranslateY(el),
        h: round1(r.height),
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
    return {
      mode: MODE,
      injectedCss: MODE === 'on' ? CSS : null,
      liveSlots: live.length,
      pairs: pairs.length,
      exact: exact,
      matchRate: pairs.length ? Math.round(exact / pairs.length * 100) / 100 : null,
      medianAbsErr: medianOf(errs),
      hAvg: hs.length ? round1(hs.reduce(function (a, b) { return a + b; }, 0) / hs.length) : null,
      hMin: hs.length ? Math.min.apply(null, hs) : null,
      hMax: hs.length ? Math.max.apply(null, hs) : null,
      hDistinct: uniq(hs).length,
      hHasDecimal: hs.some(function (v) { return Math.abs(v - Math.round(v)) > 0.05; }),
      gapAvg: gaps.length ? round1(gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length) : null,
      gapMax: gaps.length ? Math.max.apply(null, gaps) : null,
      gapHasHole: gaps.some(function (g) { return g > 8; }),
      gapHistogram: gaps.map(function (g) { return Math.round(g / 10) * 10; }),
      samples: pairs.slice(0, 12)
    };
  }

  // ---- ③ 导出 ------------------------------------------------------------------------------

  function download(name, text, mime) {
    try {
      var url = URL.createObjectURL(new Blob([text], { type: mime || 'application/json' }));
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

  function payload(tag, result) {
    return JSON.stringify({
      script: 'specbase-firstframe-probe', version: VERSION,
      generatedAt: new Date().toISOString(),
      page: { url: location.href, title: document.title },
      tag: tag, result: result
    }, null, 2);
  }

  // ---- ④ 等信息流稳定 → 采样 → 判读 → 与上一次对比 --------------------------------------------

  function waitForSlots(timeoutMs) {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function tick() {
        var rows = sample().filter(function (r) { return !r.recycled; });
        if (rows.length >= 2) return resolve(true);
        if (Date.now() - t0 > timeoutMs) return resolve(false);
        setTimeout(tick, 300);
      })();
    });
  }

  function run() {
    console.log(LOG + 'MODE=' + MODE + ' —— 等微博信息流渲染…（请**不要滚动**，避免读数被半截卡污染）');
    waitForSlots(25000).then(function (ok) {
      if (!ok) {
        console.warn(LOG + '25 秒内没等到信息流槽位 —— 确认页面是 https://weibo.com/home 且已登录。');
        return;
      }
      // 再等一拍，让首屏图片 / 字号稳定下来再量
      return new Promise(function (r) { setTimeout(r, 2000); }).then(function () {
        var res = analyze(sample());
        RESULTS[MODE] = res;

        console.log('%c' + LOG + '结果（MODE=' + MODE + '）', 'background:#2f3e34;color:#fff;padding:1px 4px', res);
        if (res.pairs === 0) {
          console.warn(LOG + '没取到可比的相邻槽 —— 把信息流滚出内容再手动跑 window.__ffprobe.run()');
        } else if (MODE === 'on') {
          console.log(LOG + (res.gapHasHole
            ? '❌ 卡片之间有洞（gapAvg=' + res.gapAvg + 'px / gapMax=' + res.gapMax + 'px）'
              + ' ⇒ 首帧注入的「变矮」没被量进缓存 ⇒ 改高度会留洞。'
            : '✅ 卡片之间**没有洞**（gapAvg=' + res.gapAvg + 'px）'
              + ' ⇒ 微博按**实际渲染高度**建的缓存 ⇒ 首帧注入改高度**有效**。'));
        }

        // 与上一次（另一种 MODE）的对比 —— 这是「CSS 真的生效」的证明
        var prev = null;
        try { prev = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { prev = null; }
        if (prev && prev.mode !== MODE) {
          var on = MODE === 'on' ? res : prev;
          var off = MODE === 'on' ? prev : res;
          var cmp = {
            control: '两次运行对比 —— 用于确认「注入的 CSS 真的改变了卡片高度」',
            on: on, off: off,
            heightDeltaAvg: (on.hAvg !== null && off.hAvg !== null) ? round1(on.hAvg - off.hAvg) : null,
            expectedHeightDelta: -DELTA,
            cssApplied: (on.hAvg !== null && off.hAvg !== null) && Math.abs((on.hAvg - off.hAvg) + DELTA) <= 8,
            gapDeltaAvg: (on.gapAvg !== null && off.gapAvg !== null) ? round1(on.gapAvg - off.gapAvg) : null,
            verdict: ''
          };
          if (!cmp.cssApplied) {
            cmp.verdict = '⚠️ 两组卡片高度只差 ' + cmp.heightDeltaAvg + 'px（期望 -' + DELTA + 'px）'
              + ' ⇒ **CSS 可能没生效**（.wbpro-scroller-item 这个锚点失效？）⇒ 整组读数作废，别据此下结论。';
          } else if (on.gapHasHole) {
            cmp.verdict = '❌ CSS 确认生效（卡片矮了 ' + Math.abs(cmp.heightDeltaAvg) + 'px），'
              + '但卡片之间出现 ' + on.gapAvg + 'px 的洞 ⇒ 尺寸缓存**不含**我们的 CSS ⇒ 改高度会留洞。';
          } else {
            cmp.verdict = '✅ CSS 确认生效（卡片矮了 ' + Math.abs(cmp.heightDeltaAvg) + 'px）'
              + '且**没有洞**（gapAvg=' + on.gapAvg + 'px）⇒ 首帧注入改高度有效。';
          }
          console.log('%c' + LOG + '对比结果', 'background:#2f3e34;color:#fff;padding:1px 4px', cmp);
          console.log(LOG + cmp.verdict);
          download('ffprobe-compare-' + stamp() + '.json', payload('compare', cmp));
        } else {
          download('ffprobe-' + MODE + '-' + stamp() + '.json', payload(MODE, res));
          console.log(LOG + '把文件发给开发者后，请将 MODE 改成 ' + (MODE === 'on' ? "'off'" : "'on'")
            + ' 并刷新一次，才能拿到「CSS 确实生效」的对照。');
        }

        try { localStorage.setItem(STORE_KEY, JSON.stringify(res)); } catch (e) { /* noop */ }
      });
    });
  }

  // 手动重跑（滚出内容后再量一次）
  window.__ffprobe = {
    version: VERSION,
    mode: MODE,
    run: run,
    sample: function () { return analyze(sample()); },
    clear: function () {
      var s = document.getElementById(STYLE_ID);
      if (s && s.parentNode) s.parentNode.removeChild(s);
      try { localStorage.removeItem(STORE_KEY); } catch (e) { /* noop */ }
      console.log(LOG + '已撤掉注入的 CSS 并清掉本地记录。');
    }
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') run();
  else window.addEventListener('DOMContentLoaded', function () { setTimeout(run, 500); });
})();
