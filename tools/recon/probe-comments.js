/**
 * 现场探针：评论面板结构 + 面板图片 + 信息流黑图取证（2026-10-15，Console 用）
 *
 * ── 为什么有这个探针 ────────────────────────────────────────────────
 * ① **评论面板豁免验证**：用户真机实锤「评论中的图片会错位，也存在黑图」——
 *    面板在卡内、复用同一批组件类，被媒体缩略化规则误伤。已收窄作用域到
 *    feed-content/retweet，本探针钉死「面板不在那两个区域之内」（修复前提）
 *    并采样面板图片（修复后应当全 natural）。
 * ② **黑图取证升级**：probeFeed3 只记了 attrs，这次连**父链三层的内联样式 +
 *    computed 尺寸**一起记 —— 判断黑图是「img 没加载」（占位/失败）还是
 *    「img 加载了但被布局吃掉」（我们的规则干扰）。
 *
 * ── 用法 ──────────────────────────────────────────────────────────
 *   ① 微博首页信息流（登录态），F12 → Console 粘贴本文件全部内容
 *   ② 先把摘要条展开一两张有评论的卡（面板出现才有得采）
 *   ③ 跑：`copy(await probeComments())`（结果进剪贴板，直接粘贴回传）
 *      （老控制台不支持顶层 await 时：`probeComments().then(copy)`）
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

  var out = { script: 'specbase-comments-probe', ts: Date.now(), innerWidth: window.innerWidth || 0 };

  // ── ① 评论面板定位与归属 ──────────────────────────────────────
  // 面板根 = textarea 往上走到卡片的**直接子**为止（card 的 child）。
  var panels = [];
  var cards = document.querySelectorAll('.wbpro-scroller-item');
  var seenPanelRoots = [];
  for (var ci = 0; ci < cards.length; ci++) {
    var card = cards[ci];
    var tas = card.querySelectorAll('textarea');
    for (var ti = 0; ti < tas.length; ti++) {
      var root = tas[ti];
      while (root && root.parentNode !== card && root !== card) root = root.parentNode;
      if (!root || root === card || seenPanelRoots.indexOf(root) >= 0) continue;
      seenPanelRoots.push(root);

      // 面板根 → card 的祖先 class 链（从面板根自身往下记到 card 前一层）
      var chain = [];
      var cur = root;
      while (cur && cur !== card) { chain.push(clsOf(cur)); cur = cur.parentNode; }

      // 面板内的图片采样（最多 6 张）
      var pimgs = [];
      var im = root.querySelectorAll('img');
      for (var ii = 0; ii < im.length && pimgs.length < 6; ii++) {
        var g = im[ii];
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
        chain: chain,
        insideFeedContent: !!root.closest('.wbpro-feed-content'),
        insideRetweet: !!root.closest('.retweet'),
        hasPictureMain: !!root.querySelector('.woo-picture-main'),
        hasUcol1: !!root.querySelector('.u-col-1'),
        imgCount: im.length,
        imgs: pimgs,
      });
    }
  }
  out.panels = panels;
  out.panelCount = panels.length;

  // ── ② 信息流黑图取证（升级版：父链内联样式 + computed）────────
  // 可疑 = 占位图（src 是 data:）或没加载（naturalWidth===0）或加载器放弃（data-src="false"）。
  // ⚠️ 「纯黑」若是「加载了但被布局吃掉」，natural 会 >0 而 rect 异常 —— 都记全，回传人工比对。
  var suspects = [];
  for (var cj = 0; cj < cards.length; cj++) {
    var c2 = cards[cj];
    var postId = null, mm, as2 = c2.querySelectorAll('a[href]');
    for (var aj = 0; aj < as2.length && !postId; aj++) {
      mm = /weibo\.com\/\d+\/([A-Za-z0-9]+)/.exec(as2[aj].getAttribute('href') || '');
      if (mm) postId = mm[1];
    }
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
      var parents2 = [];
      var p2 = g2.parentElement;
      for (var pj = 0; p2 && pj < 3; pj++, p2 = p2.parentElement) {
        var cs = getComputedStyle(p2);
        parents2.push({
          cls: clsOf(p2),
          inline: clip(p2.getAttribute('style') || '', 200),
          disp: cs.display, pos: cs.position, ovf: cs.overflow,
          h: Math.round(p2.getBoundingClientRect().height),
        });
      }
      var cs2 = getComputedStyle(g2);
      suspects.push({
        post: postId,
        inFeedContent: !!g2.closest('.wbpro-feed-content'),
        inRetweet: !!g2.closest('.retweet'),
        cls: clsOf(g2),
        src: clip(src2, 70),
        dataSrc: dsrc == null ? null : clip(dsrc, 40),
        natural: g2.naturalWidth + 'x' + g2.naturalHeight,
        complete: g2.complete,
        loading: g2.getAttribute('loading') || null,
        rect: { w: Math.round(r2.width), h: Math.round(r2.height), top: Math.round(r2.top) },
        imgInline: clip(g2.getAttribute('style') || '', 200),
        imgComputed: { disp: cs2.display, pos: cs2.position, vis: cs2.visibility, op: cs2.opacity },
        parents: parents2,
      });
    }
  }
  out.suspects = suspects;
  out.suspectCount = suspects.length;

  // ── ③ 样式版本自检（确认跑的是收窄后的新规则）────────────────
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
