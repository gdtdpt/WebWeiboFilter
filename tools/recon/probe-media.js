/**
 * 现场探针：媒体尺寸取样（媒体缩略化前置 · 2026-10-15，Console 用）
 *
 * ── 为什么有这个探针 ────────────────────────────────────────────────
 * 媒体缩略化是「改高度」批次剩余项里收益最大的一项（§12-B12 前提已验：首帧注入的 CSS
 * 会被算进虚拟列表尺寸缓存）。但**缩多少、用什么属性缩**不能猜：
 *   ① 单图 / 九宫格 / 视频的实际渲染尺寸分布从未采样；
 *   ② 九宫格容器类名（_inlineNum3_*）是**构建哈希**（B2 踩过）⇒ 锚点要现场重新确认；
 *   ③ 高度由什么决定（aspect-ratio？固定高？padding-bottom 占位？）决定缩高手法。
 * 本探针一次采全页可见卡，输出聚合 + 逐卡明细，回传 JSON 后定稿设计。
 *
 * ── 用法 ──────────────────────────────────────────────────────────
 *   ① 首页信息流滚到**有图 / 有视频**的位置（多滚几屏，让不同类型都出现）
 *   ② F12 → Console，把本文件全部内容粘进去（挂上 window.probeMedia）
 *   ③ 跑：`probeMedia()`
 *   ④ 先看 verdict 与 summary 再复制全部输出（结果走下载 / 剪贴板出口，控制台打印的对象复制不出来）
 *
 * ⚠️ 读数自检（§12-B10 纪律）：探针能识别「页面异常态」并拒绝给结论 ——
 *    槽位矩形全零而 translateY 有值 ⇒ 某祖先被 display:none ⇒ boxesMissing 闸。
 */

function probeMedia() {
  var clip = function (s, n) {
    s = (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
    n = n || 60;
    return s.length > n ? s.slice(0, n) + '…' : s;
  };
  var clsOf = function (e) {
    var c = e.getAttribute && e.getAttribute('class');
    return c ? clip(c, 120) : '';
  };
  var desc = function (e) {
    return e.tagName.toLowerCase() + (clsOf(e) ? '.' + clsOf(e).replace(/\s+/g, '.') : '');
  };
  /** 向上取 n 层祖先的描述链（判断「哪层可锚」用） */
  var chainOf = function (node, n) {
    var out = [], p = node.parentElement, k = n || 4;
    while (p && k-- > 0) { out.push(desc(p)); p = p.parentElement; }
    return out;
  };
  var r = function (e) {
    var b = e.getBoundingClientRect();
    return { w: +b.width.toFixed(1), h: +b.height.toFixed(1), top: +b.top.toFixed(1) };
  };
  /** 关键 computed style（高度由什么决定，一眼可查） */
  var csOf = function (e) {
    var cs;
    try { cs = getComputedStyle(e); } catch (_e) { return null; }
    if (!cs) return null;
    return {
      aspectRatio: cs.aspectRatio,
      height: cs.height,
      paddingBottom: cs.paddingBottom,
      objectFit: cs.objectFit,
      display: cs.display,
      position: cs.position,
      overflow: cs.overflow,
    };
  };

  var cards = document.querySelectorAll('.vue-recycle-scroller__item-wrapper > .vue-recycle-scroller__item-view');
  if (!cards.length) {
    cards = document.querySelectorAll('.wbpro-scroller-item');
    if (!cards.length) return { error: '页面上找不到信息流卡（要在微博首页信息流里跑）' };
  }

  var boxesMissing = 0;
  var items = [];          // 每个媒体块一条记录
  var cardsOut = [];       // 每卡一条摘要
  var noMedia = 0;

  for (var i = 0; i < cards.length; i++) {
    var slot = cards[i];
    var card = slot.querySelector('.wbpro-scroller-item') || slot;
    var transform = slot.style && slot.style.transform || '';
    var box = r(card);
    // 🔴 异常态闸：矩形全零而 translateY 有值 ⇒ 有祖先被 display:none，读数无效
    var missing = box.h === 0 && box.top === 0 && /translateY/.test(transform) && !/translateY\(0px\)/.test(transform);
    if (missing) { boxesMissing++; continue; }

    // 帖 ID（时间链接 /weibo.com/<uid>/<bid>）
    var postId = null, m, as = card.querySelectorAll('a[href]');
    for (var k = 0; k < as.length && !postId; k++) {
      m = /weibo\.com\/\d+\/([A-Za-z0-9]+)/.exec(as[k].getAttribute('href') || '');
      if (m) postId = m[1];
    }

    var content = card.querySelector('.wbpro-feed-content') || card.querySelector('article') || card;

    // ── ① 视频（video.js）──
    var videoEls = content.querySelectorAll('.video-js');
    var video = null;
    if (videoEls.length) {
      var vj = videoEls[0];
      var poster = vj.querySelector('.vjs-poster img');
      video = {
        playerCls: clsOf(vj),
        rect: r(vj),
        poster: poster ? {
          src: clip(poster.getAttribute('src') || '', 90),
          natural: poster.naturalWidth + 'x' + poster.naturalHeight,
          cs: csOf(poster),
        } : null,
        chain: chainOf(vj, 4),
      };
      items.push(Object.assign({ kind: 'video', postId: postId }, video.rect,
        { detail: video }));
    }

    // ── ② 图片（排除头像 / 徽章小图 / 图标）──
    // 头像 = header 内；徽章 = wbpro-tag-img 内；小图标 = 渲染宽 ≤ 48px
    var mediaImgs = [];
    var imgs = content.querySelectorAll('img');
    for (var q = 0; q < imgs.length; q++) {
      var im = imgs[q];
      if (im.closest('header')) continue;
      if (im.closest('[class*="wbpro-tag-img"]')) continue;
      if (im.closest('.video-js')) continue;
      var rw = im.getBoundingClientRect().width;
      if (rw && rw <= 48) continue;
      mediaImgs.push(im);
    }

    // 九宫格 / 多图容器：某祖先包含 ≥2 张媒体图
    var gridContainers = [];
    for (var g = 0; g < mediaImgs.length; g++) {
      var p = mediaImgs[g].parentElement, found = null;
      while (p && p !== content) {
        var cnt = p.querySelectorAll('img').length;
        if (cnt >= 2) { found = p; break; }
        p = p.parentElement;
      }
      if (found && gridContainers.indexOf(found) === -1) gridContainers.push(found);
    }
    // 已归入 grid 的图片不再按单图计
    for (var gc = 0; gc < gridContainers.length; gc++) {
      var gr = gridContainers[gc];
      var gImgs = gr.querySelectorAll('img');
      var cols = 1, top0 = null;
      for (var gi = 0; gi < gImgs.length; gi++) {
        var t = gImgs[gi].getBoundingClientRect().top;
        if (top0 === null) top0 = t;
        else if (Math.abs(t - top0) > 8) cols++;
      }
      var rec = {
        kind: 'grid', postId: postId, rect: r(gr),
        containerCls: clsOf(gr),
        imgCount: gImgs.length, rows: cols,
        firstImg: {
          cls: clsOf(gImgs[0]), rect: r(gImgs[0]),
          natural: gImgs[0].naturalWidth + 'x' + gImgs[0].naturalHeight,
          src: clip(gImgs[0].getAttribute('src') || '', 90),
          cs: csOf(gImgs[0]),
        },
        containerCs: csOf(gr),
        chain: chainOf(gr, 4),
      };
      items.push(rec);
      for (var rm = 0; rm < mediaImgs.length; rm++) {
        if (gr.contains(mediaImgs[rm])) { mediaImgs.splice(rm, 1); rm--; }
      }
    }
    // 剩下的按单图计
    for (var s2 = 0; s2 < mediaImgs.length; s2++) {
      var si = mediaImgs[s2];
      items.push({
        kind: 'img', postId: postId, rect: r(si),
        imgCls: clsOf(si),
        natural: si.naturalWidth + 'x' + si.naturalHeight,
        src: clip(si.getAttribute('src') || '', 90),
        cs: csOf(si),
        parentCs: csOf(si.parentElement),
        chain: chainOf(si, 4),
      });
    }

    cardsOut.push({
      postId: postId,
      cardH: box.h,
      hasVideo: Boolean(video),
      imgCount: mediaImgs.length,
      gridCount: gridContainers.length,
    });
    if (!video && !mediaImgs.length && !gridContainers.length) noMedia++;
  }

  // ── 聚合 ──
  var byKind = { video: [], img: [], grid: [] };
  for (var it = 0; it < items.length; it++) {
    var o = items[it];
    byKind[o.kind].push({ postId: o.postId, w: o.rect ? o.rect.w : o.w, h: o.rect ? o.rect.h : o.h });
  }
  var hs = function (arr) {
    var list = arr.map(function (x) { return x.h; }).sort(function (a, b) { return a - b; });
    return list;
  };

  var verdict;
  if (boxesMissing) {
    verdict = '⛔ 页面异常态：' + boxesMissing + ' 张卡矩形全零而 translateY 有值（某祖先被 display:none）'
      + ' —— 读数无效，先刷新页面 / 排查 A 类收口再跑（§12-B10）';
  } else if (!items.length) {
    verdict = '⚠️ 当前页没有采到任何媒体 —— 滚到有图 / 有视频的位置再跑（不同类型都要出现：单图、多图、视频）';
  } else {
    verdict = '✅ 采到 ' + items.length + ' 个媒体块（视频 ' + byKind.video.length
      + ' / 单图 ' + byKind.img.length + ' / 九宫格 ' + byKind.grid.length
      + '）—— 把整个输出回传，定缩放值与手法';
  }

  return {
    verdict: verdict,
    summary: {
      cards: cards.length - boxesMissing,
      cardsNoMedia: noMedia,
      byKind: {
        video: byKind.video.length, img: byKind.img.length, grid: byKind.grid.length,
      },
      heights: {
        video: hs(byKind.video),
        img: hs(byKind.img),
        grid: hs(byKind.grid),
      },
      boxesMissing: boxesMissing,
    },
    items: items,
    cards: cardsOut,
    note: 'containerCls 里的哈希类（_xxx_123）不可锚，但要知道高度由哪层决定；'
      + 'cs.aspectRatio / cs.paddingBottom 是「缩高手法」选型的直接依据',
  };
}

try { window.probeMedia = probeMedia; } catch (_e) { /* 控制台总有 window */ }

/**
 * v2：九宫格**逐格**取样（2026-10-15 真机反馈「有的缩有的不缩」专项）
 *
 * ── 为什么要有 v2 ──────────────────────────────────────────────────
 * v1 只量到「容器级」，且把竖图 224 的显式 height 归到了 woo-picture-main 头上 ——
 * 真机验收证明显式 height 在父子两层重复声明（.u-col-1 行容器也有一份），首版只压内层留 84px 空白。
 * 现在 Nine-grid 又出现「同一套全局 CSS 有的格子缩有的不缩」⇒ 说明格子级还有我们没掌握的结构差异。
 * v2 的三件事：
 *   ① **样式体检**：`#spb-style` 在不在、里面有没有新版规则（u-col-1 / max-height:140px）
 *      —— 先排除「重装后没刷新、旧样式还在跑」这种假故障；
 *   ② **逐格**采样：每格 img 及向上 4 层祖先的 类名 / **内联 style** / rect / computed
 *      （height / max-height / aspect-ratio / display / position）——
 *      「缩没缩」与「内联高度在哪层」的相关性一眼可见；
 *   ③ **聚合判词**：shrunk（h≤141）/ natural（h>141）各几格 —— 把「有的缩有的不缩」变成数字。
 * 用法同 v1：粘进 Console → `probeMedia2()` → 整个输出回传。
 */
function probeMedia2() {
  var clip = function (s, n) {
    s = (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
    n = n || 60;
    return s.length > n ? s.slice(0, n) + '…' : s;
  };
  var clsOf = function (e) {
    var c = e.getAttribute && e.getAttribute('class');
    return c ? clip(c, 120) : '';
  };
  var inlineOf = function (e) {
    var s = e.getAttribute && e.getAttribute('style');
    return s ? clip(s, 140) : '';
  };
  var rect = function (e) {
    var b = e.getBoundingClientRect();
    return { w: +b.width.toFixed(1), h: +b.height.toFixed(1), top: +b.top.toFixed(1), left: +b.left.toFixed(1) };
  };
  var csOf = function (e, keys) {
    var cs;
    try { cs = getComputedStyle(e); } catch (_e) { return null; }
    if (!cs) return null;
    var out = {};
    for (var i = 0; i < keys.length; i++) out[keys[i]] = cs[keys[i]];
    return out;
  };
  var CS_KEYS = ['height', 'maxHeight', 'aspectRatio', 'display', 'position', 'objectFit', 'overflow'];

  /** 一层祖先的完整读数 */
  var level = function (e) {
    return {
      desc: e.tagName.toLowerCase() + (clsOf(e) ? '.' + clsOf(e).replace(/\s+/g, '.') : ''),
      inline: inlineOf(e),
      rect: rect(e),
      cs: csOf(e, CS_KEYS),
    };
  };
  /** 从 img 向上 n 层（含 img 自身 = 第 0 层） */
  var chain = function (img, n) {
    var out = [], e = img, k = (n || 4) + 1;
    while (e && k-- > 0) { out.push(level(e)); e = e.parentElement; }
    return out;
  };

  // ── ① 样式体检（先排除假故障）────────────────────────────────
  var styleEl = document.getElementById('spb-style');
  var styleCheck = {
    present: Boolean(styleEl),
    hasMediaRule: styleEl ? styleEl.textContent.indexOf('max-height:140px') !== -1 : false,
    hasUcol1Rule: styleEl ? styleEl.textContent.indexOf('u-col-1') !== -1 : false,
  };
  // ⭐ 2026-10-15 补：窗口宽度必须一起记 —— 格子尺寸随窗口宽变（同一条九宫格，
  //    窄窗口格子 132.6 天然低于阈值、宽窗口格子 340 会被压到 140），
  //    「有的缩有的不缩」这类宽度相关态，没有 innerWidth 就无法对齐复现条件。
  var innerWidth = (window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0);

  // ── ② 找卡（与 v1 同一套视野 + 异常态闸）──────────────────────
  var cards = document.querySelectorAll('.vue-recycle-scroller__item-wrapper > .vue-recycle-scroller__item-view');
  if (!cards.length) {
    cards = document.querySelectorAll('.wbpro-scroller-item');
    if (!cards.length) {
      return { error: '页面上找不到信息流卡（要在微博首页信息流里跑）', styleCheck: styleCheck };
    }
  }

  var boxesMissing = 0;
  var grids = [];
  var cellStats = { shrunk: 0, natural: 0, capped: 0, uncapped: 0 };

  for (var i = 0; i < cards.length; i++) {
    var slot = cards[i];
    var card = slot.querySelector('.wbpro-scroller-item') || slot;
    var transform = slot.style && slot.style.transform || '';
    var box = rect(card);
    var missing = box.h === 0 && box.top === 0 && /translateY/.test(transform) && !/translateY\(0px\)/.test(transform);
    if (missing) { boxesMissing++; continue; }

    var postId = null, m, as = card.querySelectorAll('a[href]');
    for (var k = 0; k < as.length && !postId; k++) {
      m = /weibo\.com\/\d+\/([A-Za-z0-9]+)/.exec(as[k].getAttribute('href') || '');
      if (m) postId = m[1];
    }

    var content = card.querySelector('.wbpro-feed-content') || card.querySelector('article') || card;
    if (!content) continue;

    // 媒体图（与 v1 同一套排除：头像 / 徽章 / 播放器 / ≤48px 小图）
    var mediaImgs = [];
    var imgs = content.querySelectorAll('img');
    for (var q = 0; q < imgs.length; q++) {
      var im = imgs[q];
      if (im.closest('header')) continue;
      if (im.closest('[class*="wbpro-tag-img"]')) continue;
      if (im.closest('.video-js')) continue;
      var rw = im.getBoundingClientRect().width;
      if (rw && rw <= 48) continue;
      mediaImgs.push(im);
    }
    if (mediaImgs.length < 2) continue;   // v2 只关心多图（九宫格）

    // 多图容器：某祖先包含 ≥2 张媒体图
    var gr = null;
    for (var g = 0; g < mediaImgs.length && !gr; g++) {
      var p = mediaImgs[g].parentElement;
      while (p && p !== content) {
        if (p.querySelectorAll('img').length >= 2) { gr = p; break; }
        p = p.parentElement;
      }
    }
    if (!gr) continue;

    // 按行分组（top 相差 ≤8px 同行）
    var cells = [];
    for (var c = 0; c < mediaImgs.length; c++) {
      if (!gr.contains(mediaImgs[c])) continue;
      cells.push(mediaImgs[c]);
    }
    cells.sort(function (a, b) {
      var d = a.getBoundingClientRect().top - b.getBoundingClientRect().top;
      return d !== 0 ? d : a.getBoundingClientRect().left - b.getBoundingClientRect().left;
    });
    var rows = [];
    for (var c2 = 0; c2 < cells.length; c2++) {
      var top = cells[c2].getBoundingClientRect().top;
      var row = null;
      for (var r2 = 0; r2 < rows.length; r2++) {
        if (Math.abs(rows[r2].top - top) <= 8) { row = rows[r2]; break; }
      }
      if (!row) { row = { top: +top.toFixed(1), cells: [] }; rows.push(row); }
      var detail = {
        img: level(cells[c2]),
        chain: chain(cells[c2], 4),   // 0=img, 1=woo-picture-main, 2=item, 3=row, 4=…
      };
      // 判「缩没缩」：看 woo-picture-main（第 1 层）的渲染高
      var mainBox = detail.chain[1] ? detail.chain[1].rect.h : detail.img.rect.h;
      detail.shrunk = mainBox > 0 && mainBox <= 141;
      // ⭐ capped = max-height **真的在压**（渲染高贴着 140），区别于「天然低于阈值」——
      //   上一轮读数里 132.6 的格子被误算成 shrunk，其实我们的规则根本没参与；
      //   「有的缩有的不缩」要看的正是 capped 与否的**格子级差异**。
      detail.capped = detail.shrunk && mainBox >= 139;
      if (detail.shrunk) cellStats.shrunk++; else cellStats.natural++;
      if (detail.capped) cellStats.capped++; else cellStats.uncapped++;
      row.cells.push(detail);
    }

    grids.push({
      postId: postId,
      container: level(gr),
      imgCount: cells.length,
      rows: rows,
      cellHeights: cells.map(function (x) { return +(x.getBoundingClientRect().height).toFixed(1); }).sort(function (a, b) { return a - b; }),
    });
  }

  // ── ③ 判词 ──────────────────────────────────────────────────
  var verdict;
  if (!styleCheck.present) {
    verdict = '⛔ 页面上没有 #spb-style —— 脚本没在跑（重装后要刷新页面）';
  } else if (!styleCheck.hasMediaRule || !styleCheck.hasUcol1Rule) {
    verdict = '⛔ #spb-style 不是新版（' + JSON.stringify(styleCheck) + '）'
      + ' —— 重装产物后**刷新页面**再跑，否则读数反映的是旧规则';
  } else if (boxesMissing) {
    verdict = '⛔ 页面异常态：' + boxesMissing + ' 张卡矩形全零（§12-B10）—— 先刷新再跑';
  } else if (!grids.length) {
    verdict = '⚠️ 当前页没有多图卡 —— 滚到有九宫格的位置再跑（样式体检已过：' + JSON.stringify(styleCheck) + '）';
  } else if (cellStats.shrunk && cellStats.natural) {
    verdict = '🔴 复现：同一页里缩了 ' + cellStats.shrunk + ' 格、没缩 ' + cellStats.natural + ' 格'
      + ' —— 把整个输出回传，重点看 natural 格的 chain 里内联 style / computed maxHeight 差在哪层';
  } else if (cellStats.capped && cellStats.uncapped && cellStats.natural) {
    verdict = '🔴 疑似复现（宽度 ' + innerWidth + '）：capped ' + cellStats.capped + ' 格（真被压到 ~140）'
      + ' / uncapped ' + cellStats.uncapped + ' 格（天然高于 140 却没被压）—— 这就是「有的缩有的不缩」，回传输出';
  } else if (cellStats.natural) {
    verdict = '⚠️ ' + cellStats.natural + ' 格全部没缩（宽度 ' + innerWidth
      + '，含天然低于阈值的格子 ' + cellStats.uncapped + ' 个）—— 规则没命中格子层或都在阈值下，回传输出';
  } else if (cellStats.capped) {
    verdict = '✅ ' + cellStats.capped + ' 格全部被 max-height 压到 ~140（宽度 ' + innerWidth
      + '）—— 均匀压高，这页没问题';
  } else {
    verdict = '✅ ' + cellStats.shrunk + ' 格全部天然低于 140 阈值（宽度 ' + innerWidth
      + '，max-height 未参与）—— 这页不需要压，若要测压高态请**拉宽窗口**让格子超过 140 再跑';
  }

  return {
    verdict: verdict,
    styleCheck: styleCheck,
    innerWidth: innerWidth,
    summary: {
      grids: grids.length, shrunk: cellStats.shrunk, natural: cellStats.natural,
      capped: cellStats.capped, uncapped: cellStats.uncapped, boxesMissing: boxesMissing,
    },
    grids: grids,
    note: '每格 chain[0]=img、[1]=woo-picture-main、[2]=item、[3]=行容器；'
      + '对比 shrunk/natural 两类格子的 inline 与 cs.maxHeight，差异层就是根因',
  };
}

try { window.probeMedia2 = probeMedia2; } catch (_e) { /* 控制台总有 window */ }

/**
 * v3：媒体**宽度**机制取样（2026-10-15 用户诉求「宽度也压小，一行容纳更多图」前置）
 *
 * ── 为什么要有 v3 ──────────────────────────────────────────────────
 * 高度侧已结案（max-height 数值法 + img cover 全接管，B16/B17），但宽度侧从未采样：
 *   ① 已知单图格子是「内联 width:168px 父子两层重复声明」（B16 首轮 84px 空白的宽度版隐患）；
 *   ② 「压窄 ⇒ 一行挤进更多格」**只在行容器是流式排版（inline-block 换行 / flex wrap）时成立**；
 *      若是 flex nowrap 或固定列数 grid，压窄只会「格子变小、右边留白」—— 机制决定可行性；
 *   ③ 行内空隙（gap）有多大 ⇒ 容器宽还能塞几列（potentialCols），是「值得压多窄」的直接依据。
 * v3 对每个 u-col-* 行容器采：容器（类名 / 内联 / rect / display·flexWrap·gridTemplate）
 * + 前 4 个子格（内联 width / rect / computed width·maxWidth）+ 行机制判词。
 * 用法同前：粘进 Console → `probeMedia3()` → 整个输出回传。
 */
function probeMedia3() {
  var clip = function (s, n) {
    s = (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
    n = n || 60;
    return s.length > n ? s.slice(0, n) + '…' : s;
  };
  var clsOf = function (e) {
    var c = e.getAttribute && e.getAttribute('class');
    return c ? clip(c, 120) : '';
  };
  var inlineOf = function (e) {
    var s = e.getAttribute && e.getAttribute('style');
    return s ? clip(s, 160) : '';
  };
  var rect = function (e) {
    var b = e.getBoundingClientRect();
    return { w: +b.width.toFixed(1), h: +b.height.toFixed(1), top: +b.top.toFixed(1), left: +b.left.toFixed(1) };
  };
  var csOf = function (e, keys) {
    var cs;
    try { cs = getComputedStyle(e); } catch (_e) { return null; }
    if (!cs) return null;
    var out = {};
    for (var i = 0; i < keys.length; i++) out[keys[i]] = cs[keys[i]];
    return out;
  };
  var level = function (e, keys) {
    return {
      desc: e.tagName.toLowerCase() + (clsOf(e) ? '.' + clsOf(e).replace(/\s+/g, '.') : ''),
      inline: inlineOf(e),
      rect: rect(e),
      cs: csOf(e, keys),
    };
  };

  // ── ① 样式体检（排除旧版假故障；宽度数值不写死 —— 用户可能 mediaMaxH 试值中）──
  var styleEl = document.getElementById('spb-style');
  var styleCheck = {
    present: Boolean(styleEl),
    hasMediaRule: styleEl ? /max-height:\d+px !important/.test(styleEl.textContent) : false,
    hasCoverRule: styleEl ? styleEl.textContent.indexOf('object-fit:cover') !== -1 : false,
  };
  var innerWidth = (window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0);

  // ── ② 找卡（同一套视野 + 异常态闸）────────────────────────────
  var cards = document.querySelectorAll('.vue-recycle-scroller__item-wrapper > .vue-recycle-scroller__item-view');
  if (!cards.length) {
    cards = document.querySelectorAll('.wbpro-scroller-item');
    if (!cards.length) {
      return { error: '页面上找不到信息流卡（要在微博首页信息流里跑）', styleCheck: styleCheck };
    }
  }

  var ROW_CS_KEYS = ['display', 'flexWrap', 'gridTemplateColumns', 'width', 'maxWidth', 'overflowX', 'justifyContent'];
  var CELL_CS_KEYS = ['display', 'position', 'width', 'maxWidth', 'height'];

  var boxesMissing = 0;
  var rows = [];
  var mechStats = { flow: 0, flexNowrap: 0, grid: 0, other: 0 };

  for (var i = 0; i < cards.length; i++) {
    var slot = cards[i];
    var card = slot.querySelector('.wbpro-scroller-item') || slot;
    var transform = slot.style && slot.style.transform || '';
    var box = rect(card);
    var missing = box.h === 0 && box.top === 0 && /translateY/.test(transform) && !/translateY\(0px\)/.test(transform);
    if (missing) { boxesMissing++; continue; }

    var postId = null, m, as = card.querySelectorAll('a[href]');
    for (var k = 0; k < as.length && !postId; k++) {
      m = /weibo\.com\/\d+\/([A-Za-z0-9]+)/.exec(as[k].getAttribute('href') || '');
      if (m) postId = m[1];
    }

    // 作用域与媒体规则同款：feed-content / retweet（评论面板豁免）
    var scopes = card.querySelectorAll('.wbpro-feed-content, .retweet');
    if (!scopes.length) continue;

    for (var s2 = 0; s2 < scopes.length; s2++) {
      var scope = scopes[s2];
      // 行容器：类名含 u-col- 的元素（u-col-1 单图 / u-col-3、u-col-4 多图，探针现场确认还有什么）
      var rowEls = scope.querySelectorAll('[class*="u-col-"]');
      for (var r2 = 0; r2 < rowEls.length; r2++) {
        var rowEl = rowEls[r2];
        var rl = level(rowEl, ROW_CS_KEYS);
        var kids = rowEl.children;
        var cells = [];
        for (var c2 = 0; c2 < kids.length && c2 < 4; c2++) {
          cells.push(level(kids[c2], CELL_CS_KEYS));
        }
        // 行机制判词：决定「压窄能否挤进更多格」
        var disp = rl.cs && rl.cs.display || '';
        var mech = 'other';
        if (disp.indexOf('grid') !== -1) mech = 'grid';
        else if (disp.indexOf('flex') !== -1 && rl.cs.flexWrap === 'nowrap') mech = 'flexNowrap';
        else if (disp.indexOf('flex') !== -1 || disp === 'block') mech = 'flow';
        mechStats[mech] = (mechStats[mech] || 0) + 1;
        // 行内空隙与潜在列数：cell[0] 与 cell[1] 的 left 差 − cell0 宽
        var potentialCols = null, gap = null;
        if (cells.length >= 2) {
          gap = +(cells[1].rect.left - (cells[0].rect.left + cells[0].rect.w)).toFixed(1);
          var unit = cells[0].rect.w + (gap > 0 ? gap : 0);
          if (unit > 0) potentialCols = Math.floor(rl.rect.w / unit);
        }
        rows.push({
          postId: postId,
          scope: scope.getAttribute('class').indexOf('retweet') !== -1 ? 'retweet' : 'feed-content',
          row: rl,
          childCount: kids.length,
          cells: cells,
          mech: mech,
          gap: gap,
          potentialCols: potentialCols,
        });
      }
    }
  }

  // ── ③ 判词 ──────────────────────────────────────────────────
  var verdict;
  if (!styleCheck.present) {
    verdict = '⛔ 页面上没有 #spb-style —— 脚本没在跑（重装后要刷新页面）';
  } else if (!styleCheck.hasMediaRule || !styleCheck.hasCoverRule) {
    verdict = '⛔ #spb-style 不是新版（' + JSON.stringify(styleCheck) + '）—— 重装产物后刷新再跑';
  } else if (boxesMissing) {
    verdict = '⛔ 页面异常态：' + boxesMissing + ' 张卡矩形全零（§12-B10）—— 先刷新再跑';
  } else if (!rows.length) {
    verdict = '⚠️ 当前页没采到 u-col-* 行 —— 滚到有图的位置再跑（单图 / 多图都要出现）';
  } else if (mechStats.grid || mechStats.flexNowrap) {
    verdict = '🔴 行机制含固定排版（grid ' + (mechStats.grid || 0) + ' / flexNowrap ' + (mechStats.flexNowrap || 0)
      + ' / 流式 ' + (mechStats.flow || 0) + '）—— 固定列数下压窄只会留白，需连行容器一起接管；回传输出看 gridTemplateColumns';
  } else {
    verdict = '✅ 行机制全是流式（flow ' + (mechStats.flow || 0) + '）—— 压窄格子后理论可自动换行挤进更多格；'
      + '回传输出，重点看 potentialCols 与 cells[0].inline.width（父子两层重复声明的宽度版 84px 隐患）';
  }

  return {
    verdict: verdict,
    styleCheck: styleCheck,
    innerWidth: innerWidth,
    summary: {
      rows: rows.length,
      mech: mechStats,
      boxesMissing: boxesMissing,
      childCounts: rows.map(function (x) { return x.childCount; }),
      potentialCols: rows.map(function (x) { return x.potentialCols; }),
    },
    rows: rows,
    note: 'row.cs.gridTemplateColumns / flexWrap / justifyContent 决定「压窄后格子去哪」；'
      + 'cells[].inline 与 row.inline 里的 width 是「宽度版重复声明」的判定材料；'
      + 'potentialCols = 容器宽还能容纳几列（含 gap 估算），是定目标宽度的直接依据',
  };
}

try { window.probeMedia3 = probeMedia3; } catch (_e) { /* 控制台总有 window */ }
