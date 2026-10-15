/**
 * 现场探针 v2：评论面板结构 + 信息流黑图取证 + 被过滤卡扫描（2026-10-15，Console 用）
 *
 * ── v2 改了什么（依据首轮读数的三个缺口）──────────────────────────
 * ① **可疑图补记 `cardMarked`**：首轮 14 张可疑图全部「加载成功 + 几何健康」，
 *    黑图不是没加载。头号新假设：用户看到的「黑图」其实是**被过滤卡的等高空位**
 *    （`data-spb="hidden"` = visibility:hidden 保高，深色主题 #191919 ≈ 纯黑；
 *    长图卡特别高 ⇒ 空位特别大）。首轮没记卡的标记 ⇒ 补上。
 * ② **遮挡检测（coverCheck）**：对每张可疑图在自己中心点跑 elementFromPoint ——
 *    若站在它上面的是别的元素，记下那个元素的 class 与背景色（黑 = 被深色层盖住）。
 * ③ **被过滤卡扫描**：全页 `[data-spb="hidden"]` 逐卡记高度 / 帖 ID / 视口位置
 *    —— 直接回答「那块黑是不是被过滤的卡」。
 * ④ **评论面板图采样修正**：v1 从 textarea 走到卡体根，采到的是**整卡**的图
 *    （含信息流自己的图，`hasPictureMain` 因此失真）。v2 只采「不在 feed-content /
 *    retweet / header 里」的图 = 真正属于评论面板的图。
 *
 * ── 用法 ──────────────────────────────────────────────────────────
 *   ① 微博首页信息流（登录态），F12 → Console 粘贴本文件全部内容
 *   ② 跑：`copy(await probeComments())`（结果进剪贴板，直接粘贴回传）
 *   ③ 配套：看到黑块时顺手跑 `copy(JSON.stringify(__spb.recent(), null, 2))`
 *      —— 看那些卡是不是被判了过滤、理由是什么（可解释性出口）。
 */

async function probeComments() {
  var clip = function (s, n) {
    s = (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
    n = n || 80;
    return s.length > n ? s.slice(0, n) + '…' : s;
  };
  var clsOf = function (e) {
    var c = e.getAttribute && e.getAttribute('class');
    return c ? clip(c, 160) : '';
  };
  var postIdOf = function (card) {
    var as = card.querySelectorAll('a[href]');
    for (var i = 0; i < as.length; i++) {
      var m = /weibo\.com\/\d+\/([A-Za-z0-9]+)/.exec(as[i].getAttribute('href') || '');
      if (m) return m[1];
    }
    return null;
  };

  var out = { script: 'specbase-comments-probe-v2', ts: Date.now(), innerWidth: window.innerWidth || 0 };
  var cards = document.querySelectorAll('.wbpro-scroller-item');

  // ── ① 评论面板定位（面板根 = textarea 往上到卡的直接子）────────
  var panels = [];
  var seenPanelRoots = [];
  for (var ci = 0; ci < cards.length; ci++) {
    var card = cards[ci];
    var tas = card.querySelectorAll('textarea');
    for (var ti = 0; ti < tas.length; ti++) {
      var root = tas[ti];
      while (root && root.parentNode !== card && root !== card) root = root.parentNode;
      if (!root || root === card || seenPanelRoots.indexOf(root) >= 0) continue;
      seenPanelRoots.push(root);

      // v2：只采**真正属于评论面板**的图（不在正文区 / 转发块 / 头部里）
      var pimgs = [];
      var im = root.querySelectorAll('img');
      var panelImgTotal = 0;
      for (var ii = 0; ii < im.length; ii++) {
        var g = im[ii];
        if (g.closest('.wbpro-feed-content')) continue;
        if (g.closest('.retweet')) continue;
        if (g.closest('header')) continue;
        panelImgTotal++;
        if (pimgs.length >= 6) continue;
        var r = g.getBoundingClientRect();
        var parents = [];
        var p = g.parentElement;
        for (var pi = 0; p && pi < 4; pi++, p = p.parentElement) {
          parents.push({ cls: clsOf(p), inline: clip(p.getAttribute('style') || '', 160) });
        }
        pimgs.push({
          cls: clsOf(g),
          src: clip((g.getAttribute('src') || ''), 60),
          dataSrc: g.getAttribute('data-src') == null ? null : clip(g.getAttribute('data-src'), 40),
          natural: g.naturalWidth + 'x' + g.naturalHeight,
          complete: g.complete,
          rect: { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) },
          parents: parents,
        });
      }
      panels.push({
        rootCls: clsOf(root),
        insideFeedContent: !!root.closest('.wbpro-feed-content'),
        insideRetweet: !!root.closest('.retweet'),
        imgCount: im.length,
        panelImgTotal: panelImgTotal,
        imgs: pimgs,
      });
    }
  }
  out.panels = panels;
  out.panelCount = panels.length;

  // ── ② 信息流黑图取证（v2：补 cardMarked + 遮挡检测）────────────
  var suspects = [];
  for (var cj = 0; cj < cards.length; cj++) {
    var c2 = cards[cj];
    var im2 = c2.querySelectorAll('img');
    for (var ij = 0; ij < im2.length; ij++) {
      var g2 = im2[ij];
      if (g2.closest('header')) continue;
      if (g2.closest('[class*="wbpro-tag-img"]')) continue;
      var r2 = g2.getBoundingClientRect();
      if (r2.width && r2.width <= 48) continue;   // 小图标
      var src2 = g2.getAttribute('src') || '';
      var dsrc = g2.getAttribute('data-src');
      var bad =
        (dsrc != null && dsrc === 'false') ||
        src2.indexOf('data:') === 0 ||
        g2.naturalWidth === 0;
      if (!bad) continue;
      var marked = c2.getAttribute('data-spb') || null;
      // 遮挡检测：图自己中心点最顶上的元素是谁（null = 在视口外）
      var cover = null;
      var cx = r2.left + r2.width / 2, cy = r2.top + r2.height / 2;
      if (r2.width && cx >= 0 && cy >= 0 && cx <= window.innerWidth && cy <= window.innerHeight) {
        var topEl = document.elementFromPoint(cx, cy);
        if (topEl && topEl !== g2 && !g2.contains(topEl)) {
          var tb = getComputedStyle(topEl).backgroundColor;
          cover = { topCls: clsOf(topEl), topBg: tb, sameCard: !!topEl.closest('.wbpro-scroller-item') };
        }
      }
      suspects.push({
        post: postIdOf(c2),
        cardMarked: marked,
        inFeedContent: !!g2.closest('.wbpro-feed-content'),
        inRetweet: !!g2.closest('.retweet'),
        cls: clsOf(g2),
        src: clip(src2, 70),
        dataSrc: dsrc == null ? null : clip(dsrc, 40),
        natural: g2.naturalWidth + 'x' + g2.naturalHeight,
        complete: g2.complete,
        rect: { w: Math.round(r2.width), h: Math.round(r2.height), top: Math.round(r2.top) },
        imgInline: clip(g2.getAttribute('style') || '', 120),
        cover: cover,
      });
    }
  }
  out.suspects = suspects;
  out.suspectCount = suspects.length;
  out.suspectInMarkedCards = suspects.filter(function (s) { return s.cardMarked === 'hidden'; }).length;

  // ── ③ 被过滤卡扫描（直接回答「那块黑是不是被过滤的卡」）────────
  var markedCards = [];
  var allMarked = document.querySelectorAll('[data-spb="hidden"]');
  for (var mi = 0; mi < allMarked.length; mi++) {
    var mc = allMarked[mi];
    var r3 = mc.getBoundingClientRect();
    markedCards.push({
      post: postIdOf(mc),
      tag: mc.tagName.toLowerCase(),
      cls: clsOf(mc),
      rect: { w: Math.round(r3.width), h: Math.round(r3.height), top: Math.round(r3.top) },
      inViewport: r3.bottom > 0 && r3.top < window.innerHeight,
    });
  }
  out.markedHiddenCards = markedCards;
  out.markedHiddenCount = markedCards.length;

  // ── ④ 样式版本自检 ────────────────────────────────────────────
  var st = document.getElementById('spb-style');
  out.styleCheck = st
    ? {
        present: true,
        scopedMedia: (st.textContent.match(/wbpro-feed-content \.woo-picture-main/g) || []).length,
        bareMedia: (st.textContent.match(/\{\.wbpro-scroller-item \.woo-picture-main\}/) ? 1 : 0),
      }
    : { present: false };

  return out;
}
