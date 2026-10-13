/* eslint-disable no-console */
/**
 * SpecBase Helper · M0 结构侦察脚本（PROJECT.md §12-B / §13 M0）
 * ================================================================
 * 一次性的「结构 + 值」采集器：在**真实登录态的微博页面**上跑，回答 §12-B1~B8。
 * 跑完即弃、不留痕 —— 不改动页面（高度测试会临时改一下并立刻还原）。
 *
 * 用法（§12-B 采集方式）
 * ---------------------
 * 1. 打开 https://weibo.com/home（或目标页面），等**信息流滚动到有内容**。
 * 2. F12 → Console → 粘贴本文件全部内容 → 回车。
 * 3. 控制台会打印一份报告；点 `SpecBaseRecon.downloadReport()` 存 JSON。
 * 4. 点 `SpecBaseRecon.saveSnapshot()` 存 DOM 快照 HTML，放进 tests/fixtures/。
 * 5. 找广告：`SpecBaseRecon.huntAds(12)`（自动滚动；报告卡片类型分布 + 结构异常卡；**一旦发现带广告文案的卡会自动存快照**）。
 * 6. 其余手动：`SpecBaseRecon.testHeight()`（量高度行为）/ `SpecBaseRecon.watchTitle(20)`（看 title/favicon 是否被改写）。
 *
 * ⚠️ 夹具与报告含真实微博内容，属私有数据 —— 仓库已把 tests/fixtures 排除在 git 之外。
 */

(function () {
  'use strict';

  var VERSION = '0.1.0-m0';

  // 指示「这条可能是广告 / 推广」的文案标记（§12-B1 的核心线索）
  var MARKERS = [
    '推广', '广告', '荐读', '推荐', '热门', '赞助', 'Sponsored', 'Promoted',
    '企鹅号', '头条文章', '置顶', '赞过', '好友', '微博广告'
  ];

  // ---- 基础工具 -----------------------------------------------------------------------------

  function cs(el, prop) {
    try { return getComputedStyle(el).getPropertyValue(prop); } catch (e) { return null; }
  }
  function classOf(el) {
    if (!el) return '';
    var c = el.className;
    if (typeof c === 'string') return c;
    if (c && typeof c.baseVal === 'string') return c.baseVal;
    return '';
  }
  function classes(el) {
    return classOf(el).split(/\s+/).filter(Boolean);
  }
  function txt(el) {
    var t = el && el.innerText ? el.innerText : (el && el.textContent) || '';
    return String(t).replace(/\s+/g, ' ').trim();
  }
  function pickAttrs(el) {
    var o = {};
    if (!el || !el.attributes) return o;
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (/^data-/.test(a.name) || a.name === 'role' || /^aria-/.test(a.name) || a.name === 'id') {
        o[a.name] = a.value;
      }
    }
    return o;
  }
  function rect(el) {
    var r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left) };
  }
  function tag(el) {
    return el && el.nodeName ? el.nodeName.toLowerCase() : '';
  }
  function uniq(arr) {
    var seen = {}, out = [];
    for (var i = 0; i < arr.length; i++) { if (!seen[arr[i]]) { seen[arr[i]] = 1; out.push(arr[i]); } }
    return out;
  }

  // ---- 微博新版信息流的结构事实（由 2026-10-13 首轮侦察确认）--------------------------------
  //
  //   容器: div.vue-recycle-scroller__item-wrapper
  //   项  : div.vue-recycle-scroller__item-view        ← 虚拟列表槽位
  //   卡  : div.wbpro-scroller-item > article.__yawf_feed_wrap.__yawf_feed_normal
  //
  // class 命名有两套 —— 这是最关键的结论：
  //   稳定（可作选择器）: __yawf_*（语义别名）、wbpro-*、woo-*、vue-*、vjs-*
  //   构建哈希（禁止写进选择器）: _name_hash_lineno 形如 _num_198pe_46
  var HASHED_CLASS = /^_[A-Za-z0-9-]+_[a-z0-9]{4,}_\d+$/;

  function isHashedClass(t) { return HASHED_CLASS.test(t); }

  function cardOf(itemEl) {
    return itemEl.querySelector('.wbpro-scroller-item') || itemEl.firstElementChild || itemEl;
  }

  /** 帖子稳定 ID = 时间链接 `<uid>/<bid>` 里的 bid（§12-B3「标记跟着数据走」的锚点） */
  function itemId(card) {
    var links = card.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var h = links[i].getAttribute('href') || '';
      var m = h.match(/^https?:\/\/weibo\.com\/(\d+)\/([A-Za-z0-9]{5,})/);
      if (m) return { uid: m[1], bid: m[2], href: h };
    }
    for (var j = 0; j < links.length; j++) {
      var h2 = links[j].getAttribute('href') || '';
      var m2 = h2.match(/\/detail\/([A-Za-z0-9]{5,})/);
      if (m2) return { uid: null, bid: m2[1], href: h2 };
    }
    return null;
  }

  /**
   * 卡片类型令牌 = `<article>` 上的**构建哈希类名**（如 `_normal_ecgcn_34`）。
   * ⚠️ 千万别用 `__yawf_*`：实测同一次构建下时有时无（外部脚本运行时注入），不可依赖。
   */
  function cardTypeTokens(card) {
    var art = card.querySelector('article') || card;
    return classes(art).filter(isHashedClass);
  }

  /** 卡片指纹：类型令牌 + wbpro 语义类 + 内容块 —— 用来在滚动中挑出「少数派」卡 */
  function cardSignature(card) {
    var wbpro = {};
    var nodes = card.querySelectorAll('[class]');
    for (var i = 0; i < nodes.length; i++) {
      classes(nodes[i]).forEach(function (c) { if (/^wbpro-/.test(c)) wbpro[c] = 1; });
    }
    return {
      types: cardTypeTokens(card).join(' '),
      wbpro: Object.keys(wbpro).sort().join(' '),
      ogText: !!card.querySelector('.wbpro-feed-ogText'),
      reText: !!card.querySelector('.wbpro-feed-reText'),
      video: card.querySelectorAll('video').length,
      img: card.querySelectorAll('img').length,
      markers: markersIn(card)
    };
  }

  function markersIn(card) {
    var t = txt(card);
    return MARKERS.filter(function (m) { return t.indexOf(m) !== -1; });
  }

  // ---- ① 找信息流容器与项节点（B3）----------------------------------------------------------

  var KNOWN_CONTAINER_SELECTORS = [
    '[class*="wbpro-scroller"]', '[class*="scroller"]', '[class*="vue-recycle"]',
    '[class*="virtual"]', '[class*="Virtual"]', '[class*="timeline"]', '[class*="Timeline"]',
    '[class*="feed"]', '[class*="Feed"]', '[class*="list"]', '[class*="List"]'
  ];

  /** 按「相同 class 签名的子节点组」打分 */
  function scoreContainer(el, why) {
    var kids = [];
    for (var i = 0; i < el.children.length; i++) kids.push(el.children[i]);
    if (kids.length < 3) return null;

    var groups = {};
    kids.forEach(function (k) {
      var sig = classOf(k) || tag(k);
      (groups[sig] = groups[sig] || []).push(k);
    });

    var best = null;
    Object.keys(groups).forEach(function (sig) {
      var g = groups[sig];
      if (g.length < 3) return;
      var heights = g.map(function (n) { return Math.round(n.getBoundingClientRect().height); });
      var avg = heights.reduce(function (a, b) { return a + b; }, 0) / heights.length;
      if (avg < 30) return;
      var maxDev = Math.max.apply(null, heights.map(function (h) { return Math.abs(h - avg); }));
      var score = g.length - (maxDev > avg * 0.6 ? 2 : 0);
      if (!best || score > best.score) {
        best = { sig: sig, count: g.length, avgHeight: Math.round(avg), maxDev: Math.round(maxDev), score: score, nodes: g };
      }
    });
    if (!best) return null;
    return { why: why, sig: best.sig, count: best.count, avgHeight: best.avgHeight, score: best.score };
  }

  function findContainers() {
    var args = arguments;
    var found = [];
    var seen = new Set();

    function consider(el, why) {
      if (!el || seen.has(el)) return;
      seen.add(el);
      var s = scoreContainer(el, why);
      if (s) { s.el = el; s.tag = tag(el); s.className = classOf(el); s.attrs = pickAttrs(el); found.push(s); }
    }

    // 1) 已知选择器
    try {
      KNOWN_CONTAINER_SELECTORS.forEach(function (sel) {
        document.querySelectorAll(sel).forEach(function (el) { consider(el, 'known-selector:' + sel); });
      });
    } catch (e) { /* 选择器兼容性 */ }

    // 2) 泛化扫描（限制节点数，避免卡顿）
    var all = document.querySelectorAll('div, ul, section, main');
    var limit = Math.min(all.length, 6000);
    for (var i = 0; i < limit; i++) consider(all[i], 'generic-scan');

    found.sort(function (a, b) { return b.score - a.score; });
    return { candidates: found.slice(0, 8).map(function (c) {
      return { why: c.why, tag: c.tag, className: c.className, attrs: c.attrs, sig: c.sig, count: c.count, avgHeight: c.avgHeight, score: c.score };
    }), _els: found };
  }

  // ---- ② 描述单条项（B1 广告特征 / B3 项↔ID / B6 核对）--------------------------------------

  function adSignals(el) {
    var signals = { classTokens: [], dataAttrs: {} };
    var nodes = el.querySelectorAll('*');
    var cap = Math.min(nodes.length, 500);
    for (var i = 0; i < cap; i++) {
      var n = nodes[i];
      classes(n).forEach(function (c) {
        if (/(^|[-_])(ad|ads|promo|sponsor|recommend|tuiguang|hot)([-_]|$)/i.test(c) ||
            /advert|sponsor|promot/i.test(c)) {
          if (signals.classTokens.indexOf(c) === -1) signals.classTokens.push(c);
        }
      });
      var at = n.attributes;
      for (var j = 0; at && j < at.length; j++) {
        if (/^data-/.test(at[j].name) && /ad|promo|sponsor|recommend/i.test(at[j].name + '=' + at[j].value)) {
          signals.dataAttrs[at[j].name] = at[j].value;
        }
      }
    }
    return signals;
  }

  function describeItem(itemEl) {
    var card = cardOf(itemEl);
    var t = txt(card);
    var d = {
      itemClass: classOf(itemEl),
      cardClass: classOf(card),
      id: itemId(card),
      markers: markersIn(card),
      cardTypes: cardTypeTokens(card),
      adSignals: adSignals(card),
      rect: rect(card),
      textSample: t.slice(0, 160),
      textLength: t.length,
      media: { img: card.querySelectorAll('img').length, video: card.querySelectorAll('video').length },
      // 正文分块 —— §12-A3 关键词字段（正文 / 转发原文）挂载点的前提
      textBlocks: {
        og: !!card.querySelector('.wbpro-feed-ogText'),
        re: !!card.querySelector('.wbpro-feed-reText'),
        retweet: !!card.querySelector('.__yawf_feed_retweet')
      },
      avatarCandidates: [],
      childCount: card.children.length
    };

    // 头像：<img> 形态 与 background-image 形态（§7.5.5 前提）
    var imgs = card.querySelectorAll('img');
    for (var i = 0; i < Math.min(imgs.length, 6); i++) {
      var im = imgs[i];
      var r = im.getBoundingClientRect();
      if (r.width && r.width <= 80 && Math.abs(r.width - r.height) <= 6) {
        d.avatarCandidates.push({ kind: 'img', className: classOf(im), size: Math.round(r.width), src: (im.currentSrc || im.src || '').slice(0, 120) });
      }
    }
    var all = card.querySelectorAll('*');
    for (var k = 0; k < Math.min(all.length, 500); k++) {
      var bg = cs(all[k], 'background-image');
      if (bg && bg.indexOf('url(') !== -1) {
        var r2 = all[k].getBoundingClientRect();
        if (r2.width && r2.width <= 80 && Math.abs(r2.width - r2.height) <= 6) {
          d.avatarCandidates.push({ kind: 'background', className: classOf(all[k]), size: Math.round(r2.width), bg: bg.slice(0, 120) });
        }
      }
    }
    return d;
  }

  // ---- ③ class 稳定性（B4：哪些 class 稳定、哪些是构建时随机生成）---------------------------

  /** class 稳定性（B4）：必须扫**整张卡片子树** —— 项节点自身只有虚拟列表的类 */
  function classStability(items) {
    var presence = {};
    var n = items.length || 1;
    items.forEach(function (it) {
      var card = cardOf(it);
      var tokens = {};
      var nodes = card.querySelectorAll('[class]');
      var list = [card];
      for (var i = 0; i < nodes.length; i++) list.push(nodes[i]);
      list.forEach(function (node) {
        classes(node).forEach(function (c) { tokens[c] = 1; });
      });
      Object.keys(tokens).forEach(function (c) { presence[c] = (presence[c] || 0) + 1; });
    });
    var rows = Object.keys(presence).map(function (c) {
      return { token: c, presence: Math.round((presence[c] / n) * 100) / 100, hashed: isHashedClass(c) };
    });
    rows.sort(function (a, b) { return b.presence - a.presence; });
    return {
      itemCount: items.length,
      usable: rows.filter(function (r) { return r.presence >= 0.9 && !r.hashed; }).slice(0, 60),
      forbidden: rows.filter(function (r) { return r.hashed; }).slice(0, 30),
      // 部分卡片才有 → 很可能是「某类卡专属」的块，广告判据常藏在这里
      partial: rows.filter(function (r) { return r.presence > 0 && r.presence < 0.9 && !r.hashed; }).slice(0, 40)
    };
  }

  // ---- ④ 高度行为实测（B2：display:none 残留 vs 1px 容器）-----------------------------------

  function testHeight(items) {
    var list = items || (window.SpecBaseRecon && window.SpecBaseRecon._items) || [];
    if (list.length < 2) return { skipped: true, reason: '需要至少 2 个项节点' };
    var target = list[0], next = list[1];
    var res = { targetClass: classOf(target) };

    var beforeNext = next.offsetTop;
    var h = target.offsetHeight;
    res.before = { targetHeight: h, nextTop: beforeNext };

    var prevDisplay = target.style.display;
    target.style.display = 'none';
    var afterHide = next.offsetTop;
    target.style.display = prevDisplay;
    res.displayNone = { nextTop: afterHide, delta: beforeNext - afterHide, residual: h - (beforeNext - afterHide) };

    var prevH = target.style.height, prevOverflow = target.style.overflow;
    target.style.height = '1px';
    target.style.overflow = 'hidden';
    var after1px = next.offsetTop;
    target.style.height = prevH;
    target.style.overflow = prevOverflow;
    res.onePixel = { nextTop: after1px, delta: beforeNext - after1px, residual: h - (beforeNext - after1px) };

    res.verdict = res.onePixel.residual <= 3
      ? '1px 容器有效（残留高度≈1px）'
      : '1px 容器残留 ' + res.onePixel.residual + 'px，需换策略';
    return res;
  }

  // ---- ⑤ 右下角悬浮占用（B5）----------------------------------------------------------------

  function findFloating() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var hotspot = { x: vw - 24, y: vh - 24, w: 24, h: 24 };
    var hits = [];
    var nodes = document.querySelectorAll('body *');
    var cap = Math.min(nodes.length, 8000);
    for (var i = 0; i < cap; i++) {
      var el = nodes[i];
      var pos = cs(el, 'position');
      if (pos !== 'fixed' && pos !== 'sticky' && pos !== 'absolute') continue;
      var r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      // 与右下角 24x24 是否相交
      var overlap = !(r.right < hotspot.x || r.left > hotspot.x + hotspot.w || r.bottom < hotspot.y || r.top > hotspot.y + hotspot.h);
      if (!overlap) continue;
      hits.push({
        tag: tag(el), className: classOf(el), id: el.id || null,
        position: pos, zIndex: cs(el, 'z-index'),
        rect: { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
      });
    }
    return { viewport: { w: vw, h: vh }, hotspotBottomRight: hotspot, blocking: hits.slice(0, 10), clean: hits.length === 0 };
  }

  // ---- ⑥ title / favicon 现状（B7）----------------------------------------------------------

  function titleFavicon() {
    var icons = [];
    document.querySelectorAll('link[rel]').forEach(function (l) {
      var rel = (l.getAttribute('rel') || '').toLowerCase();
      if (rel.indexOf('icon') !== -1) icons.push({ rel: rel, href: (l.getAttribute('href') || '').slice(0, 200) });
    });
    return { title: document.title, icons: icons };
  }

  /** 观察 N 秒，看微博是否自己改写 title / favicon（新消息计数、红角标） */
  function watchTitle(seconds) {
    var secs = seconds || 15;
    var start = titleFavicon();
    var changes = [];
    var mo = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        if (m.target && m.target.nodeName === 'TITLE') {
          changes.push({ at: Date.now(), kind: 'title', value: document.title });
        }
        for (var i = 0; i < m.addedNodes.length; i++) {
          var n = m.addedNodes[i];
          if (n.nodeType === 1 && (n.nodeName === 'LINK' || n.nodeName === 'TITLE')) {
            changes.push({ at: Date.now(), kind: n.nodeName.toLowerCase(), value: (n.getAttribute && (n.getAttribute('href') || n.getAttribute('rel'))) || '' });
          }
        }
      });
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    console.log('[SpecBase Recon] 开始观察 title / favicon ' + secs + 's …（期间可切到别的标签页再切回来，看是否变化）');
    return new Promise(function (resolve) {
      setTimeout(function () {
        mo.disconnect();
        var res = { start: start, end: titleFavicon(), changeCount: changes.length, changes: changes.slice(0, 30) };
        console.log('[SpecBase Recon] title/favicon 观察结果：', res);
        resolve(res);
      }, secs * 1000);
    });
  }

  // ---- ⑦ 广告猎取（B1：自动滚动，找广告卡与普通卡的结构差异）--------------------------------

  function scrollHost() {
    var cands = document.querySelectorAll('.vue-recycle-scroller, [class*="scroller"]');
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      if (el.scrollHeight > el.clientHeight + 50) return el;
    }
    return null; // null → 用 window
  }

  function doScroll(px) {
    var host = scrollHost();
    if (host) host.scrollTop = host.scrollTop + px;
    else window.scrollBy(0, px);
  }

  /**
   * 自动滚动 N 步，收集每张卡的指纹：marker 文案 / `__yawf_feed_*` 修饰符集合 / 帖子 bid。
   * 广告卡一旦滚进视野，它的修饰符或 marker 就会与「多数派」区分开 —— 这就是 B1 的答案。
   */
  function huntAds(screens, opts) {
    var n = screens || 12;
    var o = opts || {};
    var autoSnap = o.autoSnapshot !== false; // 默认：一发现带广告文案的卡就立刻存快照
    var seen = {};
    var typeHist = {};
    var markerHits = [];
    var unusual = [];
    var snapped = false;
    var i = 0;
    console.log('[SpecBase Recon] huntAds：滚动 ' + n + ' 步（每步 ~0.9 屏 / 1.2s）' +
      (autoSnap ? '，发现广告卡自动存快照' : '') + ' …');

    function scan() {
      var wrapper = document.querySelector('.vue-recycle-scroller__item-wrapper');
      var items = wrapper ? Array.prototype.slice.call(wrapper.querySelectorAll('.vue-recycle-scroller__item-view')) : [];
      items.forEach(function (it) {
        var card = cardOf(it);
        var id = itemId(card);
        var bid = id ? id.bid : null;
        if (!bid || seen[bid]) return;
        var sig = cardSignature(card);
        seen[bid] = { bid: bid, types: sig.types, wbpro: sig.wbpro, markers: sig.markers, text: txt(card).slice(0, 90) };
        typeHist[sig.types] = (typeHist[sig.types] || 0) + 1;
        if (sig.markers.length) markerHits.push(seen[bid]);
      });
    }

    function finish() {
      // 「类型令牌属少数派」的卡 = 嫌疑广告卡（多数派 = 普通卡）
      var counts = Object.keys(typeHist).map(function (k) { return typeHist[k]; });
      var maxCount = counts.length ? Math.max.apply(null, counts) : 0;
      Object.keys(seen).forEach(function (bid) {
        var rec = seen[bid];
        if ((typeHist[rec.types] || 0) < maxCount || rec.markers.length) unusual.push(rec);
      });

      var res = {
        cardsSeen: Object.keys(seen).length,
        typeHistogram: typeHist,
        markerHits: markerHits,
        unusualCards: unusual,
        autoSnapshotSaved: snapped,
        verdict: markerHits.length
          ? '发现 ' + markerHits.length + ' 条带广告文案的卡（已自动存快照）；对比 typeHistogram 定位判据'
          : (unusual.length
            ? '无广告文案，但有 ' + unusual.length + ' 条「类型令牌属少数派」的卡 —— 可能是广告，请人工核对'
            : '未发现带广告文案或结构异常的卡 —— 加大步数，或换页面（详情页推荐流 / 热搜页）再试')
      };
      console.log('%c[SpecBase Recon] huntAds 结果', 'background:#2f3e34;color:#fff;padding:1px 4px', res);
      window.SpecBaseRecon._hunt = res;
      window.SpecBaseRecon._seen = seen;
      return res;
    }

    function step() {
      scan();
      if (markerHits.length && autoSnap && !snapped) {
        snapped = true;
        console.warn('[SpecBase Recon] ⚡ 发现带广告文案的卡（bid=' + markerHits[0].bid + '），立刻存快照。');
        saveSnapshot();
      }
      doScroll(Math.round(window.innerHeight * 0.9));
      i++;
      if (i < n) { setTimeout(step, 1200); return; }
      finish();
    }

    step();
  }

  // ---- 汇总报告 -----------------------------------------------------------------------------

  function collectItems(containerEl) {
    if (!containerEl) return [];
    var views = containerEl.querySelectorAll('.vue-recycle-scroller__item-view');
    if (views.length) return Array.prototype.slice.call(views);
    var kids = Array.prototype.slice.call(containerEl.children).filter(function (k) { return k.getBoundingClientRect().height > 30; });
    return kids.length ? kids : Array.prototype.slice.call(containerEl.children);
  }

  function report() {
    var result = {
      script: 'specbase-recon', version: VERSION, generatedAt: new Date().toISOString(),
      page: { url: location.href, title: document.title, readyState: document.readyState }
    };

    var c = findContainers();
    result.B3_containers = c.candidates;

    var primary = c._els[0];
    if (primary && primary.el) {
      var items = collectItems(primary.el);
      result.B3_primary = { className: primary.className, sig: primary.sig, itemCount: items.length };
      result.B1_items = items.slice(0, 6).map(describeItem);
      result.B4_classStability = classStability(items);
      window.SpecBaseRecon._container = primary.el;
      window.SpecBaseRecon._items = items;
    } else {
      result.B3_primary = null;
      result.B1_items = [];
      result.note = '未找到候选容器 —— 请确认信息流已加载并滚动出内容，或把控制台输出反馈给开发者。';
    }

    result.B5_floating = findFloating();
    result.B7_titleFavicon = titleFavicon();

    console.log('%c[SpecBase Recon] 报告 %c ' + VERSION, 'background:#2f3e34;color:#fff;padding:1px 4px;border-radius:3px', 'color:#888');
    console.log(result);
    console.log('[SpecBase Recon] 下一步：SpecBaseRecon.downloadReport() 存 JSON · SpecBaseRecon.saveSnapshot() 存 DOM 快照 · SpecBaseRecon.testHeight() 量高度');
    return result;
  }

  // ---- 导出 ---------------------------------------------------------------------------------

  function download(name, text, mime) {
    try {
      var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      console.log('[SpecBase Recon] 已导出：' + name + ' (' + Math.round(text.length / 1024) + ' KB)');
    } catch (e) { console.error('[SpecBase Recon] 导出失败', e); }
  }

  function stamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function saveSnapshot() {
    var html = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
    download('snapshot-' + stamp() + '.html', html, 'text/html');
    console.warn('[SpecBase Recon] 该快照含页面真实内容，属私有数据 —— 只放 tests/fixtures/，不要提交。');
    return html.length;
  }

  window.SpecBaseRecon = {
    version: VERSION,
    report: report,
    testHeight: testHeight,
    watchTitle: watchTitle,
    huntAds: huntAds,
    findContainers: findContainers,
    _container: null,
    _items: [],
    downloadReport: function () {
      var r = report();
      download('specbase-recon-' + stamp() + '.json', JSON.stringify(r, null, 2), 'application/json');
      return r;
    },
    saveSnapshot: saveSnapshot
  };

  // 自动跑一次
  try { report(); } catch (e) { console.error('[SpecBase Recon] 报告生成失败', e); }
})();
