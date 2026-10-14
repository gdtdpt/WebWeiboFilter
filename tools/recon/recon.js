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
 * 5b. **广告判据实测（B1 已定稿）**：`SpecBaseRecon.probeAds()` —— 一次列出页面上的
 *     A 类页面 banner 广告位、B 类信息流推广卡、以及**存疑卡**，并逐条打印**命中了哪条判据**。
 *     四路判据：外链埋点（`3_reallog_mark_ad` 商业投放 =3 分 / `999_reallog_mark_ad|WeiboADNatural`
 *     原生视频广告 =**1 分**（存疑级，单独判不出广告）/ `_weiboad=` / `/h5/sclick/` / `spm_mark=` =2 分）；
 *     广告 CDN 图 `kadmimage.biz.weibo.com` =3 分；头部标签槽文案（荐读 / 推广 / 广告）=3 分；
 *     卡内「关注」按钮 `_followbtn_` =2 分（需与其它信号同现）。**≥3 分判广告，1~2 分判存疑**。
 *     详见 PROJECT.md §12-B1。
 * 6. 其余手动：`SpecBaseRecon.testHeight()`（量高度行为）/ `SpecBaseRecon.watchTitle(20)`（看 title/favicon 是否被改写）。
 *    这两个**跑完会自动下载 JSON 文件**，不需要从 Console 复制任何东西。
 *    `testHeight()` 跑**四组**实验：display:none / 1px 容器 / 1px + 主动触发重测量 / visibility:hidden（对照组）。
 *    ⚠️ 它会打印**目标身份**（tag/class/data-index）并校验「目标必须是 `.vue-recycle-scroller__item-view` 槽位」；
 *    若 `sanity.warning` 非空 ⇒ 读数作废（2026-10-13 曾误测到卡片内九宫格图片格，见 §12-B2）。
 * 6b. **改高度可不可行（2026-10-14 新增）**：`SpecBaseRecon.probeHeightCache()` —— 回答
 *     「槽位尺寸缓存是**量 DOM 得来的**还是**预先定好的**」。这条决定 L1 剩余 4 项（媒体缩略化 /
 *     隐藏统计行 / 互动按钮行 / 字号行距）与**整个 L2 重排**能不能做（§7.5.4 押在「首帧注入」上）。
 *     **两段式**：跑一次 → 注入 -60px 并给基线读数（含「CSS 真的生效了」的自证）
 *     → **换一次路由**让列表**重新挂载**（⚠️ 不是切信息流 tab、更不是刷新）
 *     → 再跑一次 → 给结论并自动撤掉注入。中途不想继续：`probeHeightCache({clear:true})`。
 *     ⚠️ **别指望它回答「首帧注入行不行」** —— 注入天然晚于微博的首次测量，这条路走不到首帧。
 *     它只能答「列表被**重建**时会不会重测」。
 * 6c. **决定性问题（首帧是否早于微博那次唯一的高度写入）只有一个走法**：
 *     `tools/recon/firstframe-probe.user.js`（一次性油猴脚本，`@run-at document-start`，
 *     装上 → 刷新一次 → 自动出结论并下载 JSON）。Console 探针做不到这件事。
 *
 * 结果怎么拿走（不用从 Console 复制对象）
 * ------------------------------------
 *   · `testHeight()` / `watchTitle(20)` / `probeTheme()` / `probeHeightCache()` —— 跑完**自动下载** JSON
 *     （`probe-height-*.json` / `probe-title-*.json` / `probe-theme-*.json` /
 *      `probe-height-cache-baseline-*.json` / `probe-height-cache-remount-*.json`）
 *   · `SpecBaseRecon.exportResults()` —— 把跑过的**所有**探针结果汇总成一份 `probe-all-*.json` 下载
 *   · `SpecBaseRecon.copyResult()` —— 兜底：把结果 JSON 塞进剪贴板（下载被浏览器拦时用）
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
      // ⚠️ 真信息流容器（子节点 = 虚拟列表槽位）必须碾压一切嵌套网格：
      //   否则一个 9 宫格图片网格（9 个同签名图片格）会把 primary 抢走 —— 见 testHeight 的踩坑注释。
      var slotKids = 0;
      for (var q = 0; q < g.length; q++) if (isScrollerSlot(g[q])) slotKids++;
      if (slotKids >= 3) score += 1000;
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

  // ---- ④ 高度行为实测（B2：隐藏一项之后的上移量 / 残留空洞 / 延迟重排）-----------------------

  /** 虚拟列表的项容器（槽位父节点）—— **B2 唯一权威锚点** */
  function itemWrapper() {
    return document.querySelector('.vue-recycle-scroller__item-wrapper');
  }

  function isScrollerSlot(el) {
    return !!el && classes(el).indexOf('vue-recycle-scroller__item-view') !== -1;
  }

  /**
   * 槽位的**内容下标** `data-index`。
   *
   * ⚠️ 2026-10-14 实测纠正（被真机 JSON 打脸）：真实结构链是
   *    `item-view > .wbpro-scroller-item[data-index] > article` —— `data-index`
   *    **不在** `item-view` 上，在它**里面**的 `.wbpro-scroller-item` 上。
   *    上一版直接在 `item-view` 上读 ⇒ 恒为 null ⇒ 两个后果：
   *      ① 相邻配对静默退回 DOM 顺序（这次运气好，结论碰巧一样；运气不好就会配出假数据）；
   *      ② `probeHeightCache()` 的「注入是否生效」自检算出**空数组** ⇒ 打成 `cssApplied: false`
   *         + 「后面读数不可信」的**假警**（`probe-height-cache-baseline-20261014-1157.json` 就是这么错的）。
   *    ⇒ 这里先认自己、再认**直接子元素**（槽位里只有一层包装，不是深挖 `querySelector`，
   *      免得捞到卡片内部同名属性）。
   */
  function slotIndexOf(el) {
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

  /**
   * 只取**信息流槽位**：`item-wrapper` 的**直接子节点**里带 `vue-recycle-scroller__item-view` 的那些。
   * ⚠️ 为什么必须这么严格 —— 2026-10-13 真实踩坑：
   *   上一版 `testHeight()` 直接用 `report()` 选出的「最高分容器」取项，结果钻进了
   *   **卡片内的九宫格图片格**（`woo-box-item-inlineBlock _item_a3hty_47 __yawf_feed-picture_item`，
   *   高 137px）。隐藏它当然不会让后续信息流项上移，于是打出了 `delta: 0 / residual: 137`
   *   —— 读数看着像结论，其实**完全无意义**。原因：`scoreContainer()` 按「≥3 个同签名子节点」
   *   打分，一个 9 宫格（9 个一模一样的图片格）比信息流容器得分还高 ⇒ 抢到了 primary。
   *   ⇒ 修法：① 本函数只认 `item-wrapper` 的直接子槽位；② `scoreContainer()` 给真槽位组巨额加权；
   *     ③ `testHeight()` 每次打印**目标身份**并显式校验，取错对象时 verdict 直接报警。
   */
  function feedItems() {
    var w = itemWrapper();
    if (!w) return [];
    var out = [];
    for (var i = 0; i < w.children.length; i++) if (isScrollerSlot(w.children[i])) out.push(w.children[i]);
    return out;
  }

  /** 目标身份 —— 取错对象时能一眼看出来（tag / class / data-index / 是否槽位 / 内联 style） */
  function identityOf(el) {
    return {
      tag: tag(el),
      className: classOf(el),
      dataIndex: slotIndexOf(el),
      isScrollerSlot: isScrollerSlot(el),
      parentClass: el.parentElement ? classOf(el.parentElement) : null,
      inlineStyle: String((el.getAttribute && el.getAttribute('style')) || '').slice(0, 240)
    };
  }

  /**
   * 尽力找出承载虚拟列表的 Vue 组件实例 —— 只为一件事：判断「**能不能主动触发重测量**」。
   * 若实例上真的挂着 `sizes[] / handleResize / forceUpdate`，那 CSS 之外就还有一条 JS 路径
   * （把广告项尺寸从 size 缓存里改掉）；否则就只能走「降显著度」。
   * ⚠️ 返回对象里 `_vm` 是**实例引用，不能进 JSON**（循环引用），序列化前用 summarizeVm() 剥掉。
   */
  function findScrollerVm(el) {
    try {
      var node = el, depth = 0;
      while (node && depth < 40) {
        var vm = node.__vue__ || node.__vueParentComponent;
        if (vm) {
          var cur = vm, hops = 0;
          while (cur && hops < 25) {
            var opt = cur.$options || {};
            var name = String(opt.name || opt._componentTag ||
              (cur.type && (cur.type.name || cur.type.__name)) || '');
            var api = [];
            ['forceUpdate', 'updateVisibleItems', 'scrollToItem', 'handleResize', 'onResize']
              .forEach(function (m) { if (typeof cur[m] === 'function') api.push(m); });
            if (cur.sizes) api.push('sizes[]');
            if (/scroller|virtual|recycle/i.test(name)) {
              return {
                found: true, name: name, api: uniq(api),
                sizesLength: cur.sizes ? cur.sizes.length : null,
                itemSize: typeof cur.itemSize === 'number' ? cur.itemSize : null,
                componentKeys: Object.keys(cur).filter(function (k) { return !/^\$|^_/.test(k); }).slice(0, 25),
                _vm: cur
              };
            }
            cur = cur.$parent || cur.parent;
            hops++;
          }
        }
        node = node.parentElement; depth++;
      }
    } catch (e) { return { found: false, error: String(e) }; }
    return { found: false };
  }

  /** 剥掉实例引用，只留可 JSON 化的摘要 */
  function summarizeVm(vm) {
    if (!vm) return { found: false };
    return {
      found: !!vm.found, name: vm.name || null, api: vm.api || null,
      sizesLength: vm.sizesLength, itemSize: vm.itemSize,
      componentKeys: vm.componentKeys, error: vm.error
    };
  }

  /** 优先挑一对「都完全在视口内」的相邻项，避免半截卡污染读数 */
  function pickVisiblePair(list) {
    var vh = window.innerHeight;
    for (var i = 0; i < list.length - 1; i++) {
      var a = list[i].getBoundingClientRect(), b = list[i + 1].getBoundingClientRect();
      if (a.height > 40 && a.top >= 0 && a.bottom <= vh && b.height > 40) {
        return { target: list[i], next: list[i + 1], index: i };
      }
    }
    return { target: list[0], next: list[1], index: 0 };
  }

  /**
   * 回答 B2（首版头号风险）：隐藏一个**信息流槽位**之后
   *   ① 后续项会不会上移？上移多少？
   *   ② 还剩多少空洞？
   *   ③ 会不会**延迟**重排（微博用 ResizeObserver 重新测量 ⇒ 内容跳变）？
   *   ④ 能否**主动**触发重测量（Vue 实例上的 handleResize / forceUpdate）把洞填掉？
   *
   * ⚠️ 关键：item-view 是 `position:absolute` + `transform:translateY(...)` 定位的，
   * **`offsetTop` 不反映视觉位置** —— 只看 offsetTop 会得出「什么都没发生」的错误结论。
   * 所以这里同时看 `getBoundingClientRect()`（含 transform）与 `offsetTop`，
   * 并在隐藏后采样 0 / 400 / 1200ms，专门抓延迟重排。
   *
   * 四组实验（每组都跑完立刻还原）：
   *   display:none / 1px 容器 / 1px + 主动触发重测量 / visibility:hidden（对照组）
   *
   * 结果自动导出成 JSON（不用从 Console 复制），并恢复现场 —— 绝不留下改动。
   * @returns {Promise<Object>}
   */
  function testHeight(items) {
    var list = feedItems();
    var source = 'feedItems()（item-wrapper 的直接子槽位）';
    if (list.length < 2) {
      list = items || (window.SpecBaseRecon && window.SpecBaseRecon._items) || [];
      source = '⚠️ _items 兜底（feedItems 取不到 ≥2 个槽位）';
    }
    if (list.length < 2) {
      return Promise.resolve(stash('height', {
        skipped: true,
        reason: '一条信息流项都没取到 —— 先把信息流滚出内容再跑（选择器 .vue-recycle-scroller__item-view 也可能已失效）'
      }));
    }

    var pair = pickVisiblePair(list);
    var target = pair.target, next = pair.next, wrap = target.parentElement;
    var scrollerVm = findScrollerVm(target);
    var prevDisplay = target.style.display;
    var prevHeight = target.style.height;
    var prevOverflow = target.style.overflow;
    var prevVisibility = target.style.visibility;

    function styleOf(el) {
      return {
        position: cs(el, 'position'), transform: cs(el, 'transform'), top: cs(el, 'top'),
        height: cs(el, 'height'), overflow: cs(el, 'overflow'), opacity: cs(el, 'opacity')
      };
    }

    function snap(label) {
      var r0 = target.getBoundingClientRect(), r1 = next.getBoundingClientRect();
      return {
        label: label,
        targetTop: Math.round(r0.top), targetH: Math.round(r0.height),
        nextTop: Math.round(r1.top), nextH: Math.round(r1.height),
        nextOffsetTop: next.offsetTop,
        wrapScrollHeight: wrap ? wrap.scrollHeight : null,
        wrapClientHeight: wrap ? wrap.clientHeight : null
      };
    }

    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    function restore() {
      target.style.display = prevDisplay;
      target.style.height = prevHeight;
      target.style.overflow = prevOverflow;
      target.style.visibility = prevVisibility;
    }

    var res = {
      question: 'B2 — 隐藏一个项之后：后续项上移多少？还剩多少空洞？会不会延迟重排（跳变）？',
      method: 'getBoundingClientRect（含 transform）+ offsetTop 双视角；隐藏后采样 0 / 400 / 1200ms',
      source: source,
      slotCount: list.length,
      targetIndex: pair.index,
      target: identityOf(target),
      next: identityOf(next),
      scrollerVm: summarizeVm(scrollerVm),
      sanity: {
        targetIsScrollerSlot: isScrollerSlot(target),
        nextIsScrollerSlot: isScrollerSlot(next),
        warning: (isScrollerSlot(target) && isScrollerSlot(next)) ? null
          : '⚠️ 目标不是信息流槽位（.vue-recycle-scroller__item-view）—— 本次读数无意义，别据此下结论'
      },
      itemStyle: styleOf(target),
      nextStyle: styleOf(next),
      displayNone: [],
      onePixel: [],
      onePixelResize: [],
      visibilityHidden: [],
      verdict: ''
    };

    /** 跑一个实验：存基线 → 施加改动 → 采样三次 → 撤销 */
    function experiment(label, apply, undo, sink) {
      sink.push(snap(label + ' · 基线'));
      apply();
      sink.push(snap(label + ' · 立即'));
      return wait(400).then(function () {
        sink.push(snap(label + ' · +400ms'));
        return wait(800);
      }).then(function () {
        sink.push(snap(label + ' · +1200ms'));
        undo();
      });
    }

    /** 从一组采样算出「上移量 / 残留空洞 / 是否延迟重排」 */
    function evaluate(sink) {
      if (sink.length < 2) return null;
      var b = sink[0], later = sink.slice(1), last = later[later.length - 1];
      return {
        moved: b.nextTop - last.nextTop,                                  // 正数 = 后续项上移
        hole: last.nextTop - b.targetTop,                                 // 空洞 = 原卡顶 → 下一卡顶
        jump: later.some(function (s) { return s.nextTop !== later[0].nextTop; }),
        wrapScrollHeightBefore: b.wrapScrollHeight,
        wrapScrollHeightAfter: last.wrapScrollHeight
      };
    }

    function poke() {
      // 主动触发一次重测量：优先调 Vue 实例上的方法，其次派发 window resize
      try { window.dispatchEvent(new Event('resize')); } catch (e) { /* noop */ }
      var vm = scrollerVm && scrollerVm._vm;
      if (!vm) return;
      ['handleResize', 'onResize', 'forceUpdate', 'updateVisibleItems'].forEach(function (m) {
        try { if (typeof vm[m] === 'function') vm[m](); } catch (e) { /* noop */ }
      });
    }

    console.log('[SpecBase Recon] testHeight：开始实测（约 6 秒，跑四组实验）—— '
      + '**期间请不要滚动页面**，否则读数会被污染。跑完自动下载 JSON。'
      + (scrollerVm && scrollerVm.found ? '（已找到虚拟列表 Vue 实例：' + scrollerVm.name + '）' : '（未找到虚拟列表 Vue 实例）'));

    return experiment(
      'display:none',
      function () { target.style.display = 'none'; },
      function () { target.style.display = prevDisplay; },
      res.displayNone
    ).then(function () {
      return experiment(
        '1px 容器',
        function () { target.style.height = '1px'; target.style.overflow = 'hidden'; },
        function () { target.style.height = prevHeight; target.style.overflow = prevOverflow; },
        res.onePixel
      );
    }).then(function () {
      return experiment(
        '1px + 主动触发重测量',
        function () { target.style.height = '1px'; target.style.overflow = 'hidden'; poke(); },
        function () { target.style.height = prevHeight; target.style.overflow = prevOverflow; },
        res.onePixelResize
      );
    }).then(function () {
      return experiment(
        'visibility:hidden（对照组 · 保高度）',
        function () { target.style.visibility = 'hidden'; },
        function () { target.style.visibility = prevVisibility; },
        res.visibilityHidden
      );
    }).then(function () {
      restore();
      var a = evaluate(res.displayNone);
      var c = evaluate(res.onePixel);
      var d = evaluate(res.onePixelResize);
      var e = evaluate(res.visibilityHidden);
      res.displayNoneSummary = a;
      res.onePixelSummary = c;
      res.onePixelResizeSummary = d;
      res.visibilityHiddenSummary = e;

      var parts = [];
      if (res.sanity.warning) parts.push(res.sanity.warning);
      function line(name, r) {
        if (!r) return null;
        return name + ' → 后续项上移 ' + r.moved + 'px、残留空洞 ' + r.hole +
          'px' + (r.jump ? '、⚠️ 有延迟重排' : '、无延迟重排');
      }
      [['display:none', a], ['1px 容器', c], ['1px + 主动触发重测量', d], ['visibility:hidden', e]]
        .forEach(function (kv) { var s = line(kv[0], kv[1]); if (s) parts.push(s); });
      if (c) {
        parts.push('结论：' + (c.hole <= 3
          ? '1px 容器可闭合空洞 → 可以直接隐藏'
          : '1px 容器仍残留 ' + c.hole + 'px'
            + (d && d.hole <= 3 ? '，但**主动触发重测量可以闭合** ⇒ 走 JS 路径（改 size 缓存 + 触发重排）'
              : '，且主动触发重测量也无效 → **隐藏不可行**，改走「降显著度」（保高度，只缩小/去色/降对比，§7.5.0）')));
      } else {
        parts.push('结论：未能测出');
      }
      if (res.scrollerVm && !res.scrollerVm.found) {
        parts.push('（未找到虚拟列表 Vue 实例 ⇒ 无法评估 JS 路径）');
      }
      res.verdict = parts.join('；');

      console.log('%c[SpecBase Recon] testHeight 结果', 'background:#2f3e34;color:#fff;padding:1px 4px', res);
      console.log('[SpecBase Recon] ' + res.verdict);
      return exportResult('height', res);
    }, function (err) {
      restore();
      res.error = String(err);
      return exportResult('height', res);
    });
  }

  // ---- ⑤b 槽位尺寸缓存的**来源**（M2 第二批「改高度」的前置判定 · 2026-10-14）--------------------
  //
  // 为什么需要它：B2 已证「运行中改高度」会留洞、且后续项不上移（四组实验：display:none / 1px /
  // 1px + 主动重测 / visibility:hidden）。但那四组**全是在页面渲染完成之后**才改的 ⇒
  // 只否定了「渲染后改」，**没有**回答「渲染前（首帧）改是否有效」——
  // 而 §7.5.4「重排仍会改变项高度，因此必须在首帧注入（首帧就定稿则无害）」恰恰押在这上面。
  //
  // 两者的分水岭是一个**从未测过的假设**：**微博的槽位尺寸缓存是「量 DOM 得来的」还是「预先定好的」？**
  //   ① 量 DOM ⇒ 我们的 CSS 只要早于那次测量生效（脚本本来就是 `@run-at document-start`）
  //     就会被一起量进去 ⇒ 改高度**不留洞**；
  //   ② 预先定好 ⇒ 什么时候注入都无效 ⇒ L1 剩余 4 项（媒体缩略化 / 隐藏统计行 / 互动按钮行 /
  //     字号行距）与**整个 L2 重排**一起作废。
  //
  // 本探针用「纯观测 + 一次列表重挂载」回答它，**不改页面**（注入的 CSS 会自己清掉）：
  //   判据 ①（一致性）：相邻槽的内联 `translateY` 差值 d(i) 是否等于**上一槽的实际高度** h(i)。
  //     缓存若是量出来的，二者必然相等（取整误差内）；若是固定值 / 接口给的，则无关。
  //     更强的旁证是**小数位**：h 带小数（如 287.6px）而 d 是整数 ⇒ 只有「量 DOM」能得到这种值。
  //   判据 ②（会不会重测）：注入「卡片变矮 60px」的 CSS 后让列表**重挂载**（SPA 切页，**不是刷新**）
  //     再复量。若 d 仍等于（已变矮的）h、且卡片之间**没有洞** ⇒ 微博按当前实际高度重算了
  //     ⇒ **首帧注入必然有效**（确证）。若 d 与 h 脱节约 60px、并且看得到洞 ⇒ 只在初次渲染量一次。
  //
  // ⚠️ 为什么强调「切页而不是刷新」：刷新会**同时丢掉**我们注入的 CSS 与基线状态；
  //    而重新粘贴脚本注入 CSS 时页面早就渲染完了 ⇒ 又退回 B2 的情形，读数无意义。

  var HPROBE_STYLE_ID = 'spb-recon-hprobe';
  var HPROBE_DELTA = 60;
  var HPROBE_CSS = '.wbpro-scroller-item{margin-bottom:-' + HPROBE_DELTA + 'px !important}';
  var hprobeBaseline = null;

  function round1(n) { return Math.round(n * 10) / 10; }

  function medianOf(arr) {
    if (!arr || !arr.length) return null;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : round1((a[mid - 1] + a[mid]) / 2);
  }

  /** 读槽位内联 `transform: translateY(Npx)` 的 N —— 这是微博 JS 预计算的**槽位位置** */
  function parseTranslateY(el) {
    var t = String((el && el.getAttribute && el.getAttribute('style')) || '');
    var m = /translateY\(\s*(-?[\d.]+)px\s*\)/.exec(t);
    return m ? parseFloat(m[1]) : null;
  }

  /** 回收位（滚出视口后被挪走的槽）：`translateY(-9999px)` 或 `opacity:0` —— 必须排除 */
  function isRecycledSlot(el) {
    var ty = parseTranslateY(el);
    if (ty !== null && ty <= -9990) return true;
    var op = cs(el, 'opacity');
    return !!op && parseFloat(op) === 0;
  }

  /** 逐槽采样：内联 translateY / 实际高度（**保留一位小数**，小数位本身就是证据）/ 视觉位置 */
  function sampleSlots() {
    var list = feedItems();
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var el = list[i], r = el.getBoundingClientRect();
      var row = {
        order: i,
        dataIndex: slotIndexOf(el),
        ty: parseTranslateY(el),
        h: round1(r.height),
        top: round1(r.top),
        bottom: round1(r.bottom),
        recycled: isRecycledSlot(el)
      };
      // 元素引用挂在**不可枚举**的属性上：两次采样之间按「元素身份」配对要用它，
      // 但它绝不能进 JSON（DOM 节点会序列化成 `{}`，还可能带出循环引用）。
      try { Object.defineProperty(row, '_node', { value: el, enumerable: false }); }
      catch (e) { /* 个别环境不支持就放弃这条回退路径，下标配对仍然可用 */ }
      out.push(row);
    }
    return out;
  }

  function makeHeightPair(a, b) {
    var d = round1(b.ty - a.ty);
    return {
      from: a.dataIndex, to: b.dataIndex,
      d: d, h: a.h,
      err: round1(Math.abs(d - a.h)),
      gap: round1(b.top - a.bottom)
    };
  }

  /**
   * 把采样算成「d(i) vs h(i)」的比对。
   * 配对策略：**优先按 `data-index` 找相邻项**（DOM 顺序 ≠ 内容顺序 —— 槽位由回收池复用、会被打乱），
   * 取不到 `data-index` 时退回 DOM 顺序。
   * `gap` 是两卡的**视觉空隙**（下一卡 top − 本卡 bottom）：无洞 ≈ 0，留洞则 ≈ 缩小量。
   */
  function analyzeSlots(rows) {
    rows = rows || [];
    var live = [];
    for (var i = 0; i < rows.length; i++) if (!rows[i].recycled && rows[i].ty !== null) live.push(rows[i]);

    var byIdx = {}, idxKeys = [];
    for (var j = 0; j < live.length; j++) {
      if (live[j].dataIndex === null) continue;
      byIdx[live[j].dataIndex] = live[j];
      var n = Number(live[j].dataIndex);
      if (!isNaN(n) && idxKeys.indexOf(n) === -1) idxKeys.push(n);
    }
    idxKeys.sort(function (a, b) { return a - b; });

    var pairs = [], k;
    if (idxKeys.length >= 2) {
      for (k = 0; k < idxKeys.length - 1; k++) {
        if (idxKeys[k + 1] !== idxKeys[k] + 1) continue;   // 中间那项被回收掉了，跳过
        pairs.push(makeHeightPair(byIdx[String(idxKeys[k])], byIdx[String(idxKeys[k + 1])]));
      }
    }
    if (!pairs.length && live.length >= 2) {
      for (k = 0; k < live.length - 1; k++) pairs.push(makeHeightPair(live[k], live[k + 1]));
    }

    var errs = pairs.map(function (p) { return p.err; });
    var gaps = pairs.map(function (p) { return p.gap; });
    var hs = live.map(function (r) { return r.h; });
    var exact = pairs.filter(function (p) { return p.err <= 2; }).length;
    return {
      liveSlots: live.length,
      pairs: pairs.length,
      exact: exact,
      matchRate: pairs.length ? Math.round(exact / pairs.length * 100) / 100 : null,
      medianAbsErr: medianOf(errs),
      maxAbsErr: errs.length ? Math.max.apply(null, errs) : null,
      hAvg: hs.length ? round1(hs.reduce(function (a, b) { return a + b; }, 0) / hs.length) : null,
      hMin: hs.length ? Math.min.apply(null, hs) : null,
      hMax: hs.length ? Math.max.apply(null, hs) : null,
      hDistinct: uniq(hs).length,
      hHasDecimal: hs.some(function (v) { return Math.abs(v - Math.round(v)) > 0.05; }),
      gapAvg: gaps.length ? round1(gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length) : null,
      gapMax: gaps.length ? Math.max.apply(null, gaps) : null,
      gapHasHole: gaps.some(function (g) { return g > 8; }),
      samples: pairs.slice(0, 12)
    };
  }

  function hprobeStyle() {
    var s = document.getElementById(HPROBE_STYLE_ID);
    if (!s) {
      s = document.createElement('style');
      s.id = HPROBE_STYLE_ID;
      s.textContent = HPROBE_CSS;
      (document.head || document.documentElement).appendChild(s);
    }
    return s;
  }

  function hprobeRemove() {
    var s = document.getElementById(HPROBE_STYLE_ID);
    if (s && s.parentNode) s.parentNode.removeChild(s);
  }

  /**
   * 「注入的 CSS 真的把卡片改矮了」的**结构自证** —— 完全不依赖任何下标。
   *
   * `.wbpro-scroller-item` 自己挂 `margin-bottom:-60px` ⇒ 它**父槽**（`item-view`）的高度
   * 自动变成「卡片高 − 60」。于是 `卡片高 − 槽高` 直接读出注入量：**只要这个差 ≈ 60，
   * 就是 CSS 确实生效的铁证**，哪怕下标解析整个坏掉。
   *
   * 为什么需要它：规则没命中时也会「没有洞」—— 那是假阳性。必须把「CSS 生效了」
   * 和「没有洞」分成两件事分别证明。
   */
  function injectSelfProof(rows) {
    var deltas = [], i;
    for (i = 0; i < rows.length; i++) {
      var el = rows[i]._node, inner = el && el.firstElementChild;
      if (!el || rows[i].recycled || !inner || !inner.getBoundingClientRect) continue;
      deltas.push(round1(inner.getBoundingClientRect().height - rows[i].h));
    }
    var med = medianOf(deltas);
    return {
      expectation: '卡片高 − 槽高 应 ≈ ' + HPROBE_DELTA + 'px（`margin-bottom:-' + HPROBE_DELTA + 'px` 的作用）',
      n: deltas.length,
      median: med,
      samples: deltas.slice(0, 8),
      ok: deltas.length > 0 && med !== null && Math.abs(med - HPROBE_DELTA) <= 6
    };
  }

  /**
   * 两次采样之间**同一个槽**的高度变化（`rowsB.h - rowsA.h`）。
   * 优先按 `data-index` 配对；下标取不到时退回**元素身份**。
   *
   * ⚠️ 2026-10-14：上一版在 `item-view` 上读 `data-index`（那儿根本没有）⇒ 配对表恒为空
   * ⇒ 自检算出**空数组** ⇒ 报「CSS 没生效」的假警。**空数组 ≠ 高度没变化**，
   * 所以调用方要用 `length` 把「没配上」与「配上了但没变」分开说。
   */
  function heightShrink(rowsA, rowsB) {
    var out = [], i, j, byIdx = {}, idxN = 0, key;
    for (i = 0; i < rowsA.length; i++) {
      key = rowsA[i].dataIndex;
      if (key !== null && !Object.prototype.hasOwnProperty.call(byIdx, key)) { byIdx[key] = rowsA[i]; idxN++; }
    }
    if (idxN) {
      for (j = 0; j < rowsB.length; j++) {
        var a = byIdx[rowsB[j].dataIndex];
        if (a) out.push(round1(rowsB[j].h - a.h));
      }
      return out;
    }
    for (j = 0; j < rowsB.length; j++) {
      for (i = 0; i < rowsA.length; i++) {
        if (rowsA[i]._node && rowsA[i]._node === rowsB[j]._node) {
          out.push(round1(rowsB[j].h - rowsA[i].h));
          break;
        }
      }
    }
    return out;
  }

  /**
   * 回答「槽位尺寸缓存是量 DOM 得来的，还是预先定好的」—— 决定 **L1 剩余 4 项 + 整个 L2 重排**
   * 能不能做。用法（**两段式，中间不要刷新页面**）：
   *
   *   SpecBaseRecon.probeHeightCache()          // ① 基线一致性 + 注入 -60px（不撤）→ 自动下载 JSON
   *   ← 手动切换一次信息流 tab（推荐 / 关注），或来回切一次路由，让列表**重挂载**
   *   SpecBaseRecon.probeHeightCache()          // ② 复量并给结论 → 自动下载 JSON，随后自动撤掉注入
   *   SpecBaseRecon.probeHeightCache({clear:true})   // 随时中止：撤掉注入、清掉基线
   *
   * @param {{clear?: boolean}} [opts]
   * @returns {Object}
   */
  function probeHeightCache(opts) {
    opts = opts || {};

    if (opts.clear) {
      hprobeRemove();
      hprobeBaseline = null;
      var cleared = { stage: 'cleared', note: '已移除实验用的 -60px CSS，页面恢复原状。' };
      console.log('[SpecBase Recon] ' + cleared.note);
      return stash('heightCache', cleared);
    }

    var rows = sampleSlots();
    var now = analyzeSlots(rows);

    // ---------- 第二段：列表**重建**之后再量，与基线对比 ----------
    if (hprobeBaseline) {
      var cur = feedItems(), kept = 0, i;
      for (i = 0; i < cur.length; i++) if (hprobeBaseline.els.indexOf(cur[i]) !== -1) kept++;
      var remountDetected = kept < Math.min(cur.length, hprobeBaseline.els.length);
      var b = hprobeBaseline.analysis;
      var shrink2 = heightShrink(hprobeBaseline.rows, rows);
      var proof2 = injectSelfProof(rows);

      var v;
      if (!remountDetected) {
        // 没重建 ⇒ 这段读数等价于 B2（渲染后改高度），一个字都不能当结论
        v = '⛔ **读数作废**：槽位元素 ' + kept + '/' + cur.length + ' 个原样保留 ⇒ 列表**没有重建**。'
          + '这段只是把「渲染后改高度」又量了一遍（= B2 的已知情形：洞里还是 ' + now.gapAvg
          + 'px），**不构成任何新证据**。';
      } else if (now.matchRate === null) {
        v = '未能取到可比的相邻槽（活槽 ' + now.liveSlots + ' 个）—— 先把信息流滚出内容再跑一次。';
      } else if (now.matchRate >= 0.8) {
        v = '✅ 列表**重建后** d 仍等于 h（' + now.exact + '/' + now.pairs
          + ' 对在 ±2px 内，中位误差 ' + now.medianAbsErr + 'px，平均视觉空隙 ' + now.gapAvg + 'px）'
          + ' ⇒ 重建时会按**当前实际高度**重新测量（卡片已比注入前矮 ' + HPROBE_DELTA + 'px，'
          + '结构自证 ' + proof2.median + 'px）。⚠️ 但它仍**答不了首帧问题** —— 这条路要重建一次才成立。';
      } else if (now.matchRate <= 0.4) {
        v = '❌ 列表重建后 d 与 h **仍然**脱节（仅 ' + now.exact + '/' + now.pairs
          + ' 对吻合，中位误差 ' + now.medianAbsErr + 'px，平均视觉空隙 ' + now.gapAvg + 'px'
          + (now.gapHasHole ? '，洞里还在' : '') + '）⇒ **尺寸缓存与「重建」无关**：它只被写过一次，'
          + '写完之后怎么重建都不重测。'
          + '⇒ 这正是「首帧注入必须成立」的理由 —— 请用 '
          + 'tools/recon/firstframe-probe.user.js 把首帧那条路验掉，别据此判死刑。';
      } else {
        v = '⚠️ 证据不足（' + now.exact + '/' + now.pairs + ' 对吻合，中位误差 ' + now.medianAbsErr
          + 'px）—— 建议清掉后重跑，或用 firstframe-probe.user.js 直接验。';
      }

      var res2 = {
        question: '列表被**重建**（换路由）之后会不会重测槽位高度？（第二段：注入 -60px + 重建后复量）',
        stage: 'after-remount',
        method: '注入 `.wbpro-scroller-item{margin-bottom:-60px}`（卡片实际变矮 ' + HPROBE_DELTA
          + 'px）→ 换路由让列表重建 → 复量 d(i) vs h(i) 与视觉空隙',
        injectedCss: HPROBE_CSS,
        remountDetected: remountDetected,
        remountKeptSlots: kept + '/' + cur.length,
        injectMedianShrink: medianOf(shrink2),
        selfProof: proof2,
        baseline: b,
        remount: now,
        verdict: v,
        note: '⚠️ 本段**不回答首帧问题**（注入天然晚于微博的首次测量）。首帧那条路只有 '
          + 'tools/recon/firstframe-probe.user.js 能走。'
      };

      hprobeRemove();
      hprobeBaseline = null;

      console.log('%c[SpecBase Recon] probeHeightCache 结果（第二段 · 重挂载后）',
        'background:#2f3e34;color:#fff;padding:1px 4px', res2);
      console.log('[SpecBase Recon] ' + v);
      return exportResult('height-cache-remount', res2);
    }

    // ---------- 第一段：基线一致性 + 注入 + 即时复量 ----------
    hprobeStyle();
    var rows2 = sampleSlots();
    var afterInject = analyzeSlots(rows2);

    var shrink = heightShrink(rows, rows2);
    var shrinkMedian = medianOf(shrink);
    var proof = injectSelfProof(rows2);
    var cssApplied = shrinkMedian !== null && Math.abs(shrinkMedian + HPROBE_DELTA) <= 6;

    var v1;
    if (now.matchRate === null) {
      v1 = '未能取到可比的相邻槽 —— 先把信息流滚出内容再跑。';
    } else if (now.matchRate >= 0.8) {
      v1 = '倾向「量 DOM」：d 与 h 吻合 ' + now.exact + '/' + now.pairs + ' 对（中位误差 '
        + now.medianAbsErr + 'px）⇒ 槽位位置与**实际渲染高度**一致'
        + (now.hHasDecimal ? '，且高度带小数（' + now.hAvg + 'px 这种值只可能来自实测）' : '')
        + ' ⇒ 缓存**不是**固定步长 / 预算表。'
        + (cssApplied ? ' 注入 -60px 后卡片确实矮了 ~' + HPROBE_DELTA + 'px（自证通过）。'
          : ' ⚠️ 但注入自检**没通过**（配对上 ' + shrink.length + ' 个槽，中位变化 '
            + shrinkMedian + 'px，结构自证 ' + proof.median + 'px）—— 读数存疑。');
    } else if (now.matchRate <= 0.4) {
      v1 = '倾向「预先定好」：d 与 h 只吻合 ' + now.exact + '/' + now.pairs + ' 对（中位误差 '
        + now.medianAbsErr + 'px）⇒ 缓存不是当前渲染高度。';
    } else {
      v1 = '证据混杂（' + now.exact + '/' + now.pairs + ' 对吻合，中位误差 ' + now.medianAbsErr
        + 'px）—— 需人工判读。';
    }
    if (!cssApplied && proof.ok) {
      v1 += ' ℹ️ 结构自证却是通过的（卡片高 − 槽高 ≈ ' + proof.median
        + 'px）⇒ 大概率只是**两次采样之间槽位被换了**，重跑一次即可。';
    }

    var next = 'CSS 已注入且**先不撤**。请**换一次路由**让信息流**重建**'
      + '（例：首页 → 点进自己的主页 → 再点回首页；**切「推荐 / 关注」tab 不算**——'
      + '2026-10-14 实测那样做槽位元素一个都没换，列表压根没重建），然后**再跑一次** '
      + 'SpecBaseRecon.probeHeightCache() —— 那一次给结论并自动下载 JSON。'
      + '⚠️ **不要刷新页面**（刷新会同时丢掉注入的 CSS 与基线，读数作废）。'
      + '⚠️ 这一段只回答「列表**重建**时会不会重测」；**「首帧注入行不行」它答不了** —— '
      + '那必须走 tools/recon/firstframe-probe.user.js。'
      + '不想继续就跑 SpecBaseRecon.probeHeightCache({clear:true}) 撤掉注入。';

    var res1 = {
      question: '槽位尺寸缓存是「量 DOM 得来的」还是「预先定好的」？（第一段：基线 + 注入即时读数）',
      stage: 'baseline',
      method: '纯观测：相邻槽内联 translateY 差值 d(i) vs 上一槽实际高度 h(i)；再注入 -60px 立即复量',
      injectedCss: HPROBE_CSS,
      consistency: now,
      injectDelta: {
        cssApplied: cssApplied,
        medianHeightShrink: shrinkMedian,
        pairedSlots: shrink.length,
        expected: -HPROBE_DELTA,
        samples: shrink.slice(0, 12),
        selfProof: proof,
        note: cssApplied
          ? 'CSS 确认生效（卡片实际矮了 ~' + HPROBE_DELTA + 'px）'
          : (shrink.length === 0
            ? '⚠️ 两次采样之间**一个槽都没配上**（下标与元素身份都取不到）—— 重跑一次；'
              + '若仍为 0，看 selfProof（结构与下标无关，它才是兜底判据）'
            : '⚠️ CSS 没按预期生效（配上 ' + shrink.length + ' 个槽，中位变化 ' + shrinkMedian
              + 'px）—— 先检查 .wbpro-scroller-item 这个锚点还在不在')
      },
      afterInject: afterInject,
      next: next,
      verdict: v1
    };

    hprobeBaseline = {
      analysis: now, rows: rows,
      els: [].slice.call(feedItems()),
      at: new Date().toISOString()
    };

    console.log('%c[SpecBase Recon] probeHeightCache 结果（第一段 · 基线）',
      'background:#2f3e34;color:#fff;padding:1px 4px', res1);
    console.log('[SpecBase Recon] ' + v1);
    console.log('[SpecBase Recon] ' + next);
    return exportResult('height-cache-baseline', res1);
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
    console.log('[SpecBase Recon] 开始观察 title / favicon ' + secs + 's …'
      + '期间可切到别的标签页再切回来（看是否变化），**但不要刷新页面**。结束后会自动导出 JSON。');
    return new Promise(function (resolve) {
      setTimeout(function () {
        mo.disconnect();
        var res = {
          seconds: secs,
          start: start,
          end: titleFavicon(),
          changeCount: changes.length,
          changes: changes.slice(0, 30),
          // 微博改写 title 的常见时机：新消息数、红点、切标签页回来 —— 建议「有变化」时重跑一次 L0 验收
          verdict: changes.length
            ? '⚠️ 观察期内 title / favicon 被改写了 ' + changes.length + ' 次 ⇒ L0 的 MutationObserver 防御是必需的'
            : '观察期内 title / favicon 未被改写 ⇒ 但不要据此删掉 L0 的防御（改写可能只在新消息到达时发生）'
        };
        console.log('%c[SpecBase Recon] watchTitle 结果', 'background:#2f3e34;color:#fff;padding:1px 4px', res);
        console.log('[SpecBase Recon] ' + res.verdict);
        resolve(exportResult('title', res));
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
      stash('hunt', res);
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
    // ① 最可靠：item-wrapper 的**直接子槽位** —— 绝不钻进卡片内的九宫格图片格
    var w = itemWrapper() ||
      (classes(containerEl).indexOf('vue-recycle-scroller__item-wrapper') !== -1 ? containerEl : null);
    if (w) {
      var slots = [];
      for (var s = 0; s < w.children.length; s++) if (isScrollerSlot(w.children[s])) slots.push(w.children[s]);
      if (slots.length >= 2) return slots;
    }
    // ② 容器自身就在信息流里 → 取其槽位后代
    var views = containerEl.querySelectorAll('.vue-recycle-scroller__item-view');
    if (views.length) return Array.prototype.slice.call(views);
    // ③ 兜底（非虚拟列表页面）
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
    console.log('[SpecBase Recon] 下一步：SpecBaseRecon.downloadReport() 存 JSON · SpecBaseRecon.saveSnapshot() 存 DOM 快照 · SpecBaseRecon.testHeight() 量高度（会自动下载 JSON）');
    return stash('report', result);
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

  // ---- 结果收集与导出 -------------------------------------------------------------------------
  // 解决的问题：探针结果以 JS 对象打印在 Console 里，**复制不出来**（右键复制对象会变成
  // [object Object] 的浅拷贝，长对象还会被折叠/截断）。
  //   ⇒ 每个探针跑完都把结果**存进 RESULTS**；
  //   ⇒ testHeight() / watchTitle() 跑完**自动下载** JSON，用户不用做任何事；
  //   ⇒ 其余探针用 `exportResults()`（一次全导）或 `copyResult()`（塞剪贴板）取。

  var RESULTS = {};

  function stash(key, value) {
    RESULTS[key] = value;
    if (window.SpecBaseRecon) window.SpecBaseRecon._results = RESULTS;
    return value;
  }

  function buildPayload(tag, result) {
    return {
      script: 'specbase-recon', version: VERSION,
      generatedAt: new Date().toISOString(),
      page: { url: location.href, title: document.title },
      tag: tag,
      result: result
    };
  }

  /** 存进 RESULTS 并**立刻下载成 JSON 文件** —— 用户不需要从 Console 复制任何东西 */
  function exportResult(tag, result) {
    stash(tag, result);
    download('probe-' + tag + '-' + stamp() + '.json',
      JSON.stringify(buildPayload(tag, result), null, 2), 'application/json');
    return result;
  }

  /**
   * 把**所有已跑过的**探针结果汇总成一份 JSON 并下载。
   * 手动跑过 probeAds() / testHeight() / watchTitle() / report() 之后，一句就能全拿走。
   */
  function exportResults() {
    var payload = {
      script: 'specbase-recon', version: VERSION,
      generatedAt: new Date().toISOString(),
      page: { url: location.href, title: document.title },
      keys: Object.keys(RESULTS),
      results: RESULTS
    };
    download('probe-all-' + stamp() + '.json', JSON.stringify(payload, null, 2), 'application/json');
    return payload;
  }

  /** 兜底：把结果 JSON 塞进剪贴板（下载被浏览器拦时用） */
  function copyResult() {
    var keys = Object.keys(RESULTS);
    if (!keys.length) {
      console.warn('[SpecBase Recon] 还没有结果 —— 先跑 probeAds() / testHeight() / watchTitle() 之一。');
      return null;
    }
    var text = JSON.stringify(RESULTS, null, 2);
    var printFallback = function () {
      console.log('[SpecBase Recon] 自动复制失败。请**右键点下面这行字符串 → Copy string contents**，粘贴给开发者即可：');
      console.log(text);
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          console.log('[SpecBase Recon] 已复制到剪贴板（' + keys.join(', ') + '，' + text.length + ' 字符）—— 粘贴给开发者即可');
        }, printFallback);
      } else { printFallback(); }
    } catch (e) { printFallback(); }
    return text;
  }

  function saveSnapshot() {
    var html = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
    download('snapshot-' + stamp() + '.html', html, 'text/html');
    console.warn('[SpecBase Recon] 该快照含页面真实内容，属私有数据 —— 只放 tests/fixtures/，不要提交。');
    return html.length;
  }

  // ---- B1 定稿：广告判据实测（2026-10-13 第二轮）---------------------------------------------
  // 离线在四份快照上已确证；这里是在**活页面上**复跑同一套判据，随时可再验一次。

  // 广告 CDN（A 类页面 banner 实测来源）
  var AD_HOSTS = ['kadmimage.biz.weibo.com', 'kadm.biz.weibo.com', 'sinaads.cn', 'ad.sina.com.cn', 'sax.sina.com.cn'];
  // 广告跳转埋点（B 类推广卡的正文外链）—— 逐条带权重，与 src/core/ad-detect.js 保持一致。
  // ⚠️ 顺序 = 优先级：每个 URL 只取第一个命中的标记，所以 natural 必须在兜底的 reallog_mark_ad 之前。
  // ⚠️ `natural`（WeiboADNatural）**只有 1 分** —— 2026-10-13 用户人工核对「饼干姐」卡后降级为存疑线索。
  var AD_URLS = [
    { id: 'campaign', weight: 3, re: /3_reallog_mark_ad/i },
    { id: 'natural', weight: 1, re: /999_reallog_mark_ad|WeiboADNatural/i },
    { id: 'reallog_mark_ad', weight: 2, re: /reallog_mark_ad/i },
    { id: 'weiboad', weight: 2, re: /_weiboad=/i },
    { id: 'sclick', weight: 2, re: /\/h5\/sclick\//i },
    { id: 'spm_mark', weight: 2, re: /[?&]spm_mark=/i }
  ];
  // 推广标签文案（**整串精确比对**）
  var AD_TAGS = ['广告', '推广', '荐读', '热推', '品牌推广', '商业推广', '赞助', 'Sponsored', 'Promoted'];

  function adUrlOf(url) {
    for (var i = 0; i < AD_URLS.length; i++) { if (AD_URLS[i].re.test(url)) return AD_URLS[i].id; }
    return null;
  }
  function adUrlWeight(id) {
    for (var i = 0; i < AD_URLS.length; i++) { if (AD_URLS[i].id === id) return AD_URLS[i].weight; }
    return 0;
  }
  function adHostOf(src) {
    for (var i = 0; i < AD_HOSTS.length; i++) { if (src.indexOf(AD_HOSTS[i]) !== -1) return AD_HOSTS[i]; }
    return null;
  }
  function adTagOf(t) {
    t = (t || '').trim();
    for (var i = 0; i < AD_TAGS.length; i++) { if (t === AD_TAGS[i]) return t; }
    return null;
  }

  /** 逐条列出卡片的四路判据命中矩阵 */
  function cardAdSignals(card) {
    var hits = [], urls = [], tags = [], imgs = [];

    var as = card.querySelectorAll('a[href]');
    for (var i = 0; i < as.length; i++) {
      var u = as[i].getAttribute('href') || '';
      urls.push(u);
      var m = adUrlOf(u);
      if (m && hits.indexOf('url:' + m) === -1) hits.push('url:' + m);
    }

    var tNodes = card.querySelectorAll('[class*="wbpro-tag"]');
    for (var j = 0; j < tNodes.length; j++) {
      // wbpro-tag-img = 认证图标（自然卡也有），不是广告信号
      if (/(^|\s)wbpro-tag-img/.test(tNodes[j].className || '')) continue;
      var tt = txt(tNodes[j]);
      if (!tt) continue;
      tags.push(tt);
      var tg = adTagOf(tt);
      if (tg) hits.push('tag:' + tg);
    }

    var im = card.querySelectorAll('img');
    for (var k = 0; k < im.length; k++) {
      var s = im[k].currentSrc || im[k].src || '';
      imgs.push(s);
      var h = adHostOf(s);
      if (h && hits.indexOf('img:' + h) === -1) hits.push('img:' + h);
    }

    // 卡内「关注」按钮 —— 首关时间线里不该出现
    var follow = false;
    var btns = card.querySelectorAll('button');
    for (var b = 0; b < btns.length; b++) {
      if (/(^|\s)_followbtn_/.test(btns[b].className || '')) { follow = true; break; }
    }
    if (!follow) {
      var hd = card.querySelector('header');
      if (hd) {
        var hb = hd.querySelectorAll('button');
        for (var c = 0; c < hb.length; c++) {
          if (txt(hb[c]).indexOf('关注') !== -1) { follow = true; break; }
        }
      }
    }
    if (follow) hits.push('followBtn');

    // 计分：埋点按各自权重（natural 只有 1 分 ⇒ 单独判不出广告），标签/广告图各 3 分，关注按钮 2 分
    var score = 0;
    hits.forEach(function (h) {
      if (h === 'followBtn') { score += 2; return; }
      if (h.indexOf('url:') === 0) { score += adUrlWeight(h.slice(4)); return; }
      score += 3;
    });

    return {
      hits: hits, score: score,
      isAd: score >= 3,
      suspect: score > 0 && score < 3,
      tags: tags, followBtn: follow
    };
  }

  /** B1 主入口：一次回答「这一页上有哪些广告、各自命中哪条判据」 */
  function probeAds() {
    var out = { pageAds: [], feedAds: [], feedSuspects: [], cleanCards: 0, totalCards: 0 };

    // ① A 类：页面级 banner 广告位（锚「广告 CDN 图片」而不是结构 —— 结构类名是构建哈希）
    var allImgs = document.querySelectorAll('img');
    var seen = {};
    for (var i = 0; i < allImgs.length; i++) {
      var src = allImgs[i].currentSrc || allImgs[i].src || '';
      var host = adHostOf(src);
      if (!host) continue;
      var inFeed = !!allImgs[i].closest('.wbpro-scroller-item');
      // 同一广告位的多张图只报一次
      var holder = allImgs[i].closest('div');
      var key = host + '|' + (holder ? (classes(holder).join('.') || 'anon') : 'null');
      if (seen[key]) continue;
      seen[key] = 1;
      out.pageAds.push({
        host: host,
        src: src.slice(0, 120),
        inFeed: inFeed,
        hasCloseIcon: !!(holder && holder.querySelector('img[src*="948/2022/09/21/close.png"]')),
        parent: holder ? sigOf(holder) : null,
        grandparent: holder && holder.parentElement ? sigOf(holder.parentElement) : null
      });
    }

    // ② B 类：信息流推广卡
    var cards = document.querySelectorAll('.wbpro-scroller-item');
    out.totalCards = cards.length;
    for (var c = 0; c < cards.length; c++) {
      var s = cardAdSignals(cards[c]);
      var id = itemId(cards[c]);
      var row = {
        bid: id ? id.bid : null,
        author: (cards[c].querySelector('a[usercard] span[title]') || {}).textContent || null,
        hits: s.hits,
        score: s.score,
        isAd: s.isAd,
        suspect: s.suspect,
        tags: s.tags,
        preview: txt(cards[c]).slice(0, 70)
      };
      if (s.isAd) out.feedAds.push(row);
      else if (s.suspect) out.feedSuspects.push(row);
      else out.cleanCards++;
    }

    out.verdict = (out.pageAds.length || out.feedAds.length || out.feedSuspects.length)
      ? '页面广告位 ' + out.pageAds.length + ' 个 / 信息流推广卡 ' + out.feedAds.length + ' 张'
        + ' / 存疑卡 ' + out.feedSuspects.length + ' 张（共 ' + out.totalCards + ' 张卡）'
      : '本页未检出广告（共 ' + out.totalCards + ' 张卡）—— 注意 A 类 banner 是间歇投放，此刻为空属正常';

    console.log('%c[SpecBase Recon] probeAds 结果', 'background:#2f3e34;color:#fff;padding:1px 4px', out);
    console.log('[SpecBase Recon] ' + out.verdict);
    window.SpecBaseRecon._ads = out;
    // 存进 RESULTS —— 之后用 exportResults() / copyResult() 一句话取走，不用从 Console 复制对象
    return stash('ads', out);
  }

  function sigOf(el) {
    var t = el.tagName.toLowerCase();
    if (el.id) t += '#' + el.id;
    var cs2 = classes(el).filter(function (x) { return !isHashedClass(x); });
    if (cs2.length) t += '.' + cs2.join('.');
    var n = classes(el).length - cs2.length;
    if (n) t += ' [+' + n + ' hashed]';
    return t;
  }

  // ---- 主题与外壳取样（M2 用）-----------------------------------------------------------------

  /**
   * 一次性把「L1/L2 剩下的项该打到哪儿」的真机数据取回来，**跑完自动下载 JSON**。
   *
   * 为什么需要它：外壳（顶栏 / 侧栏 / 右栏 / logo）的类名**全是构建哈希**（`_side_1ubn9_37`），
   * CSS 侧没有稳定锚点；而「全局去橙红」得先知道微博把品牌色定义成哪个自定义属性、
   * 定义在哪个选择器上（`:root` 还是某个主题类）。这两类都只能**在真机上取样**，不能猜
   * （§6.1：没有探针的适配规则不许进代码）。
   *
   * 取样内容：
   *   ① 样式表里定义的自定义属性（`--w-*` / `--weibo-*`）及其定义选择器
   *   ② `:root` 上实际生效的变量值 + **疑似品牌暖色**（橙 / 红）的变量清单
   *   ③ 页面元素上的暖色分布 —— 「去橙红」的着力点清单（按出现次数排序）
   *   ④ 外壳几何：logo / 顶栏 / 左侧栏 / 右侧栏 / 底部推荐 的稳定签名与矩形
   *   ⑤ `woo-icon-*` 家族（补齐认证 / 会员角标的锚点）
   *   ⑥ 时间锚点样本（验证「相对时间 → 绝对短格式」的选择器策略）
   *   ⑦ 我方 L1 规则在当前页面上的**命中数**（确认规则真的打到了东西）
   *
   * ⚠️ 会遍历数千个元素做 getComputedStyle ⇒ 页面会卡半秒左右，属正常。
   * @returns {Object}
   */
  function probeTheme() {
    var out = {};

    // ---- ① 自定义属性：定义位置 ---------------------------------------------------
    var varRules = [];
    function walkRules(list, origin, depth) {
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        if (r.cssRules && !r.selectorText) { walkRules(r.cssRules, origin, depth + 1); continue; }
        if (!r.style || !r.selectorText) continue;
        var vars = {}, n = 0;
        for (var j = 0; j < r.style.length; j++) {
          var p = r.style[j];
          if (p.indexOf('--') === 0) { vars[p] = String(r.style.getPropertyValue(p)).trim(); n++; }
        }
        if (n) varRules.push({ origin: origin, selector: r.selectorText, vars: vars });
      }
    }
    var sheets = document.styleSheets || [];
    for (var s = 0; s < sheets.length; s++) {
      var rules = null;
      try { rules = sheets[s].cssRules; } catch (e) { rules = null; }   // 跨域样式表会抛 SecurityError
      if (rules) walkRules(rules, sheets[s].href || '(inline)', 0);
    }
    out.varRuleCount = varRules.length;
    out.varRules = varRules.slice(0, 400);

    // ---- ② 变量实际值 + 暖色识别 --------------------------------------------------
    function rgbOf(v) {
      var t = String(v || '').trim();
      var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t);
      if (m) {
        var h = m[1];
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
      }
      m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(t);
      return m ? [+m[1], +m[2], +m[3]] : null;
    }

    /** 暖色（红 / 橙 / 黄）判定：红分量最大且与最小分量拉开差距；灰阶返回 null */
    function warmth(v) {
      var c = rgbOf(v);
      if (!c) return null;
      var max = Math.max(c[0], c[1], c[2]), min = Math.min(c[0], c[1], c[2]);
      if (c[0] !== max || max - min < 40) return null;
      return { rgb: c, spread: max - min };
    }

    var names = {};
    for (var k = 0; k < varRules.length; k++) {
      for (var key in varRules[k].vars) names[key] = 1;
    }
    var rootStyle = null;
    try { rootStyle = window.getComputedStyle(document.documentElement); } catch (e) { rootStyle = null; }

    var rootVars = {}, brandVars = [];
    Object.keys(names).forEach(function (name) {
      var v = '';
      try { v = rootStyle ? String(rootStyle.getPropertyValue(name)).trim() : ''; } catch (e) { v = ''; }
      if (!v) return;
      rootVars[name] = v;
      if (warmth(v)) brandVars.push({ name: name, value: v });
    });
    out.rootVarCount = Object.keys(rootVars).length;
    out.rootVars = rootVars;
    out.brandVars = brandVars;

    // ---- ③ 页面上的暖色分布（去橙红的着力点）---------------------------------------
    var warmEls = {};
    var all = document.querySelectorAll('#app *');
    var limit = Math.min(all.length, 4000);
    var COLOR_PROPS = ['color', 'background-color', 'border-top-color', 'border-bottom-color', 'fill'];
    for (var i = 0; i < limit; i++) {
      var el = all[i], st = null;
      try { st = window.getComputedStyle(el); } catch (e) { continue; }
      for (var pi = 0; pi < COLOR_PROPS.length; pi++) {
        var val = st.getPropertyValue(COLOR_PROPS[pi]);
        if (!warmth(val)) continue;
        var key2 = sigOf(el) + ' | ' + COLOR_PROPS[pi] + ': ' + val;
        warmEls[key2] = (warmEls[key2] || 0) + 1;
      }
    }
    out.warmElementCount = Object.keys(warmEls).length;
    out.warmElements = Object.keys(warmEls)
      .sort(function (a, b) { return warmEls[b] - warmEls[a]; })
      .slice(0, 40)
      .map(function (key3) { return { signature: key3, count: warmEls[key3] }; });

    // ---- ④ 外壳几何 ---------------------------------------------------------------
    function factOf(node) {
      if (!node) return null;
      var r = node.getBoundingClientRect();
      var st2 = window.getComputedStyle(node);
      return {
        sig: sigOf(node),
        rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        // 视口外 / 被裁掉的候选也照样记下来（右栏在窄窗口下会被裁掉一半，但它的存在仍然重要）
        inViewport: r.right > 0 && r.left < window.innerWidth && r.bottom > 0 && r.top < window.innerHeight,
        position: st2.position, zIndex: st2.zIndex,
        bg: st2.backgroundColor, color: st2.color
      };
    }

    var scroller = document.querySelector('#scroller');
    var scRect = scroller ? scroller.getBoundingClientRect() : null;
    var logo = document.querySelector('a[href="/"][aria-label]');
    var logoSvg = logo ? logo.querySelector('svg') : null;

    out.shell = {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      scrollerRect: scRect ? {
        x: Math.round(scRect.left), y: Math.round(scRect.top),
        w: Math.round(scRect.width), h: Math.round(scRect.height)
      } : null,
      logo: logo ? {
        sig: sigOf(logo),
        ariaLabel: logo.getAttribute('aria-label'),
        svgFills: logoSvg
          ? Array.prototype.slice.call(logoSvg.querySelectorAll('[fill]'))
            .map(function (nd) { return nd.getAttribute('fill'); }).slice(0, 10)
          : []
      } : null,
      top: [], left: [], right: [], bottom: [],
      // 不管尺寸阈值，凡是落在信息流右缘之外/下缘之外的元素都记一笔 ——
      // 用来回答「右栏到底存不存在」（微博在窗口不够宽时会自己把它收起来）
      rightAny: [], bottomAny: []
    };

    var nodes = document.querySelectorAll('#app *');
    var nlimit = Math.min(nodes.length, 3000);
    for (var q = 0; q < nlimit; q++) {
      var nd = nodes[q];
      var rr = nd.getBoundingClientRect();
      if (rr.width < 40 || rr.height < 20) continue;
      if (scRect && rr.left > scRect.right + 4) {
        if (out.shell.rightAny.length < 8) out.shell.rightAny.push(factOf(nd));
      } else if (scRect && rr.top > scRect.bottom + 4) {
        if (out.shell.bottomAny.length < 8) out.shell.bottomAny.push(factOf(nd));
      }
      if (rr.top < 90 && rr.width > 400) {
        if (out.shell.top.length < 8) out.shell.top.push(factOf(nd));
      } else if (rr.left < 260 && rr.width >= 100 && rr.width <= 340 && rr.height > 260) {
        if (out.shell.left.length < 8) out.shell.left.push(factOf(nd));
      } else if (scRect && rr.left > scRect.right + 4 && rr.width > 60 && rr.height > 40) {
        if (out.shell.right.length < 8) out.shell.right.push(factOf(nd));
      } else if (scRect && rr.top > scRect.bottom + 4 && rr.height > 40) {
        if (out.shell.bottom.length < 8) out.shell.bottom.push(factOf(nd));
      }
    }

    // ---- ④.5 主题（明 / 暗）与布局模式 ----------------------------------------------
    // 为什么必须记下来：深色主题会用**字面量**在 `[data-theme="dark"]:root` 里重定义同一批
    // 配色变量 ⇒ 任何「写死颜色」的规则都会在其中一套主题上翻车（实测教训，见 PROJECT.md §12-B9）。
    var docEl = document.documentElement;
    var TOKEN_NAMES = [
      '--w-main', '--w-sub', '--w-contrast', '--w-dividing-line', '--w-card-border',
      '--w-brand', '--w-special', '--w-alink', '--w-error',
      '--frame-background', '--w-card-background', '--weibo-top-nav-borderTop',
      '--main-width', '--simple-width', '--left-width', '--mid-width', '--right-width',
    ];
    var tokens = {};
    TOKEN_NAMES.forEach(function (n) {
      var v = '';
      try { v = rootStyle ? String(rootStyle.getPropertyValue(n)).trim() : ''; } catch (e) { v = ''; }
      if (v) tokens[n] = v;
    });
    function px(v) { var m = /^([\d.]+)px$/.exec(String(v || '')); return m ? +m[1] : null; }

    out.theme = {
      htmlAttrs: {
        theme: docEl.getAttribute('data-theme'),
        layout: docEl.getAttribute('data-layout'),
        dpr: docEl.getAttribute('data-dpr'),
      },
      bodyClass: (document.body && document.body.getAttribute('class')) || '',
      tokens: tokens
    };

    // 微博在窗口不够宽时会自己收起右栏（内容宽 < --main-width ⇒ 走 --simple-width 那套布局）。
    // 判据是**算术**，不靠猜：`--simple-width` = 左栏 + 间隙 + 内容列，`--main-width` 再多一条右栏。
    var contentW = (document.body && document.body.clientWidth) || window.innerWidth || 0;
    out.layout = {
      contentWidth: contentW,
      mainWidth: px(tokens['--main-width']),
      simpleWidth: px(tokens['--simple-width']),
      rightWidth: px(tokens['--right-width']),
      mode: (px(tokens['--main-width']) && contentW < px(tokens['--main-width']))
        ? 'simple（微博自己收起了右栏）'
        : 'full（含右栏）'
    };

    // ---- ⑤ woo-icon 家族 + 时间锚点样本 ---------------------------------------------
    var iconClasses = {};
    Array.prototype.slice.call(document.querySelectorAll('[class*="woo-icon"]')).forEach(function (node) {
      classes(node).forEach(function (c) {
        if (c.indexOf('woo-icon') === 0) iconClasses[c] = (iconClasses[c] || 0) + 1;
      });
    });
    out.wooIconFamily = iconClasses;

    var timeAnchors = { total: 0, withTitle: 0, absoluteTitle: 0, samples: [] };
    Array.prototype.slice.call(document.querySelectorAll('a[href]')).forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (!/^https?:\/\/weibo\.com\/\d+\//.test(href)) return;   // 帖子直链；昵称链接是 /u/<uid>，不会命中
      timeAnchors.total++;
      var t = a.getAttribute('title');
      if (t) {
        timeAnchors.withTitle++;
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t)) timeAnchors.absoluteTitle++;
      }
      if (timeAnchors.samples.length < 6) {
        timeAnchors.samples.push({ text: (a.textContent || '').trim().slice(0, 20), title: t || null, href: href });
      }
    });
    out.timeAnchors = timeAnchors;

    // ---- ⑥ 我方 L1 规则的命中数 -----------------------------------------------------
    function count(sel) {
      try { return document.querySelectorAll(sel).length; } catch (e) { return -1; }
    }
    out.ourRuleHits = {
      avatar: count('img.woo-avatar-img'),
      badge: count('img.woo-icon-vipimg, i.woo-icon-vipimg, svg.woo-icon-in.woo-icon-skinSpe, svg.woo-icon-in.woo-icon--vblue'),
      media: count('[class*="woo-picture"]'),
      textContainers: count('.wbpro-feed-ogText, .wbpro-feed-reText, .wbpro-textcut'),
      textLinks: count('.wbpro-feed-ogText a, .wbpro-feed-reText a, .wbpro-textcut a'),
      cards: count('.wbpro-scroller-item'),
      logoSvg: count('a[href="/"][aria-label] svg')
    };

    out.verdict = '主题 ' + (out.theme.htmlAttrs.theme || '(未声明)')
      + '（正文令牌 ' + (out.theme.tokens['--w-main'] || '?') + ' / 卡片底 '
      + (out.theme.tokens['--w-card-background'] || '?') + '）；布局 ' + out.layout.mode
      + '（内容宽 ' + out.layout.contentWidth + ' / main ' + out.layout.mainWidth
      + ' / simple ' + out.layout.simpleWidth + '）'
      + '；自定义属性 ' + out.varRuleCount + ' 组规则 / :root 生效 ' + out.rootVarCount
      + ' 个 / 暖色变量 ' + out.brandVars.length + ' 个 / 页面暖色元素 ' + out.warmElementCount
      + ' 处；外壳候选：顶栏 ' + out.shell.top.length + ' / 左栏 ' + out.shell.left.length
      + ' / 右栏 ' + out.shell.right.length + '（信息流右侧任意元素 '
      + out.shell.rightAny.length + '）/ 底部 ' + out.shell.bottom.length
      + '；时间锚点 ' + out.timeAnchors.total + ' 个（带绝对时间 title '
      + out.timeAnchors.absoluteTitle + ' 个）';

    console.log('%c[SpecBase Recon] probeTheme 结果', 'background:#2f3e34;color:#fff;padding:1px 4px', out);
    console.log('[SpecBase Recon] ' + out.verdict);
    return exportResult('theme', out);
  }

  window.SpecBaseRecon = {
    version: VERSION,
    report: report,
    testHeight: testHeight,
    watchTitle: watchTitle,
    huntAds: huntAds,
    probeAds: probeAds,
    probeTheme: probeTheme,
    probeHeightCache: probeHeightCache,
    findContainers: findContainers,
    // 内部钩子（供测试 / 排查用，不是面向用户的 API）—— 守「项集合必须是信息流槽位」这条线
    _feedItems: feedItems,
    _collectItems: collectItems,
    _isScrollerSlot: isScrollerSlot,
    _sampleSlots: sampleSlots,
    _analyzeSlots: analyzeSlots,
    _slotIndexOf: slotIndexOf,
    _heightShrink: heightShrink,
    _injectSelfProof: injectSelfProof,
    _parseTranslateY: parseTranslateY,
    _container: null,
    _items: [],
    _results: RESULTS,
    downloadReport: function () {
      var r = report();
      download('specbase-recon-' + stamp() + '.json', JSON.stringify(r, null, 2), 'application/json');
      return r;
    },
    saveSnapshot: saveSnapshot,
    // 结果导出（解决「Console 里的对象复制不出来」）
    exportResults: exportResults,
    copyResult: copyResult,
    downloadAds: function () { exportResult('ads', probeAds()); }
  };

  // 自动跑一次
  try { report(); } catch (e) { console.error('[SpecBase Recon] 报告生成失败', e); }
})();
