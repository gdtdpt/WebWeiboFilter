/**
 * probe-l2.js —— L2 工单式重排（M1 侦察）真机取样
 *
 * 背景（2026-10-16 设计提案 v1 确认）：L2 = 工单式重排 + 标识文案换中性。
 * 动手前缺四份读数，本探针一次采齐：
 *
 *   ① 外壳三列布局（2026-10-16 用户新增需求：主列换到第一列、左侧分类列表移到最右）
 *      —— 找到「左栏锚 a[href="/"][aria-label] 与时间线滚动容器的公共祖先」= 布局容器，
 *      列出它的全部直接子（= 各列）：rect / display / position(sticky?) / order / flex。
 *      order 交换的前提 = 容器是 flex 且各列是直接子；左栏 sticky 会破坏移位，必须先量。
 *   ② 时间锚几何（M2「时间独立成列」材料）：a[title^="20"] 在卡内的父链、矩形、
 *      与卡左缘 / 卡顶的距离（absolute 定位的落点参数）、脱流后 header 原位留什么。
 *   ③ 主题令牌与背景（M2「行代替卡」材料）：页面底色 vs 卡底色 —— 透明化后还剩多少层次。
 *   ④ 视频卡几何（M4 评估材料）：卡内 .video-js 各层矩形与控制条位置。
 *
 * 用法：首页正常滚动加载几屏 → Console 粘全文 → probeL2() → 整个输出回传。
 * ⚠️ 跑之前确认已卸 firstframe-probe（它藏 footer 会污染读数）。
 */
function probeL2() {
  var clip = function (s, n) {
    s = (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
    n = n || 60;
    return s.length > n ? s.slice(0, n) + '…' : s;
  };
  var desc = function (el) {
    if (!el || !el.tagName) return String(el);
    return el.tagName.toLowerCase() +
      '.' + clip((el.getAttribute('class') || '').replace(/\s+/g, '.'), 80) +
      (el.id ? '#' + el.id : '');
  };

  var styleEl = document.getElementById('spb-style');
  var styleCheck = { present: Boolean(styleEl),
    hasL1Rules: styleEl ? /font-size:14px !important/.test(styleEl.textContent) : false };
  if (!styleCheck.present) return { verdict: '⛔ 没有 #spb-style —— 脚本没在跑（重装后刷新）', styleCheck: styleCheck };

  function stylesOf(el, keys) {
    var cs;
    try { cs = getComputedStyle(el); } catch (_e) { return null; }
    if (!cs) return null;
    var out = {};
    for (var i = 0; i < keys.length; i++) out[keys[i]] = cs[keys[i]];
    return out;
  }
  function rectOf(el) {
    var b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  }
  var LAYOUT_KEYS = ['display', 'position', 'order', 'flex', 'flexDirection', 'width', 'marginLeft', 'marginRight', 'zIndex'];

  /* ── ① 外壳三列布局（v3：枚举沿途全部 flex row）────────────────
   * v2 实测：信息流在 main._wrap_1l406_3（932px = _full_ 642 主列 + _side_ 282 右栏）；
   * 左栏候选 0 个 ⇒ 分类列表在更外层（v1 的 _content_1ubn9_18，1122px）。
   * ⚠️ v2 意外发现：L1 ⑧ 隐藏 .wbpro-side-main 后 **_side_ 列壳仍占 282px+8px**
   * （display:none 只藏内容不塌壳）—— 主列没变宽，右栏位置现成空着。
   * v3 从滚动容器向上把**所有** flex row 祖先连同直接子一次采齐。 */
  function shellLayout() {
    var scroller = document.querySelector('.vue-recycle-scroller');
    if (!scroller) return { verdict: '⛔ 找不到时间线容器', scrollerFound: false };

    var rows = [];
    var el = scroller.parentElement;
    while (el && el !== document.documentElement && rows.length < 4) {
      var st0 = getComputedStyle(el);
      if (st0.display === 'flex' && st0.flexDirection === 'row') {
        var rowInfo = { el: desc(el), rect: rectOf(el), styles: stylesOf(el, LAYOUT_KEYS), columns: [] };
        var cols = el.children || [];
        for (var c = 0; c < cols.length; c++) {
          var col = cols[c];
          var st = stylesOf(col, LAYOUT_KEYS);
          st.containsScroller = col.contains(scroller);
          st.containsSideMain = Boolean(col.querySelector('.wbpro-side-main'));
          st.role = st.containsScroller ? 'main(信息流)' : st.containsSideMain ? 'right(右栏)' : 'OTHER（左栏候选）';
          st.rect = rectOf(col);
          st.textSnippet = clip(col.textContent, 40);
          rowInfo.columns.push({ el: desc(col), styles: st });
        }
        rows.push(rowInfo);
      }
      el = el.parentElement;
    }

    var otherCols = 0, sideShell = null;
    for (var r = 0; r < rows.length; r++) {
      for (var k = 0; k < rows[r].columns.length; k++) {
        var colSt = rows[r].columns[k].styles;
        if (colSt.role.indexOf('OTHER') === 0) otherCols++;
        if (colSt.containsSideMain && !sideShell) {
          sideShell = { w: colSt.rect.w, note: '右栏列壳实测宽度 —— display:none 只藏了内容，壳还在占位' };
        }
      }
    }
    return {
      rows: rows,
      otherColumnCount: otherCols,
      sideShell: sideShell,
      verdict: otherCols >= 1
        ? '✅ 采到 ' + rows.length + ' 层 flex row、' + otherCols + ' 个左栏候选 —— 回传；重点看左栏候选的 textSnippet（确认是分类列表）、position（sticky 风险）与所在层的 order/flex'
        : '⚠️ 沿途没采到左栏候选 —— 分类列表可能在 flex row 之外（fixed 定位？），回传读数人工判',
    };
  }

  /* ── ② 时间锚几何 ───────────────────────────────────────────── */
  var cards = document.querySelectorAll('.vue-recycle-scroller__item-wrapper > .vue-recycle-scroller__item-view');
  if (!cards.length) cards = document.querySelectorAll('.wbpro-scroller-item');

  var TIME_KEYS = ['position', 'fontSize', 'fontFamily', 'color', 'display', 'marginLeft', 'lineHeight'];
  function timeSample(card) {
    var t = card.querySelector('a[title^="20"]');
    if (!t) return null;
    var cb = card.getBoundingClientRect();
    var tb = t.getBoundingClientRect();
    if (cb.h === 0 && cb.top === 0) return { anomalous: true }; // 异常态闸
    // 父链（卡内 3 层）：absolute 落点挂在哪层、脱流后谁塌
    var parents = [];
    var p = t.parentElement;
    for (var i = 0; i < 3 && p && p !== card; i++) {
      parents.push({ el: desc(p), styles: stylesOf(p, ['display', 'position', 'flex', 'alignItems', 'gap', 'height']), rect: rectOf(p) });
      p = p.parentElement;
    }
    // header 里的兄弟（时间脱流后原位留什么）
    var siblings = [];
    var par = t.parentElement;
    if (par) {
      var kids = par.children || [];
      for (var s = 0; s < kids.length; s++) {
        siblings.push({ el: desc(kids[s]), text: clip(kids[s].textContent, 16), rect: rectOf(kids[s]) });
      }
    }
    return {
      text: clip(t.textContent, 24),
      rawTitle: clip(t.getAttribute('title'), 24),
      rewritten: t.hasAttribute('data-spb-t'), // time.js 是否已改写
      rect: rectOf(t),
      offsetFromCard: { left: Math.round(tb.x - cb.x), top: Math.round(tb.y - cb.y) },
      styles: stylesOf(t, TIME_KEYS),
      parents: parents,
      siblings: siblings,
    };
  }

  /* ── ③ 主题令牌与背景 ───────────────────────────────────────── */
  function themeInfo() {
    var rootStyle = getComputedStyle(document.documentElement);
    var TOKENS = ['--w-card-background', '--w-main', '--w-sub', '--w-dividing-line',
      '--w-bg', '--w-page-background', '--w-frame-color', '--w-frame-background-color'];
    var tokens = {};
    for (var i = 0; i < TOKENS.length; i++) {
      var v = rootStyle.getPropertyValue(TOKENS[i]).trim();
      if (v) tokens[TOKENS[i]] = v;
    }
    var body = stylesOf(document.body, ['backgroundColor', 'backgroundImage']);
    var html = stylesOf(document.documentElement, ['backgroundColor']);
    // 找一页里第一张有效卡的卡底色
    var cardBg = null, articleBg = null;
    for (var c = 0; c < cards.length && !cardBg; c++) {
      var slot = cards[c];
      var card = slot.querySelector('.wbpro-scroller-item') || slot;
      var b = card.getBoundingClientRect();
      if (b.h === 0 && b.top === 0) continue;
      cardBg = { el: desc(card), styles: stylesOf(card, ['backgroundColor', 'backgroundImage', 'borderRadius']) };
      var art = card.querySelector('article');
      if (art) articleBg = stylesOf(art, ['backgroundColor', 'borderRadius']);
    }
    return { dataTheme: document.documentElement.getAttribute('data-theme'), tokens: tokens,
      html: html, body: body, card: cardBg, article: articleBg };
  }

  /* ── ④ 视频卡几何 ───────────────────────────────────────────── */
  function videoSample() {
    var found = [];
    for (var c = 0; c < cards.length && found.length < 3; c++) {
      var slot = cards[c];
      var card = slot.querySelector('.wbpro-scroller-item') || slot;
      var b = card.getBoundingClientRect();
      if (b.h === 0 && b.top === 0) continue;
      var vj = card.querySelector('.video-js');
      if (!vj) continue;
      var poster = vj.querySelector('.vjs-poster img');
      var bar = vj.querySelector('.vjs-control-bar');
      // 播放器外层（哈希类只描述）：_videoBox_ / _feedVideo_ 所在层
      var wrap = vj.parentElement, wrapChain = [];
      for (var w = 0; w < 3 && wrap && wrap !== card; w++) {
        wrapChain.push({ el: desc(wrap), rect: rectOf(wrap), styles: stylesOf(wrap, ['display', 'position', 'height', 'width']) });
        wrap = wrap.parentElement;
      }
      found.push({
        playerRect: rectOf(vj),
        playerStyles: stylesOf(vj, ['width', 'height', 'position']),
        poster: poster ? { rect: rectOf(poster), src: clip(poster.getAttribute('src') || '', 50) } : null,
        controlBar: bar ? { rect: rectOf(bar), h: Math.round(bar.getBoundingClientRect().height) } : null,
        wrapChain: wrapChain,
        paused: vj.className.indexOf('vjs-paused') !== -1,
      });
    }
    return { count: found.length, samples: found,
      note: 'M4 评估材料：看播放器高度占卡高的比例、控制条位置（缩高度时它是否随动）、poster 与播放器是否同几何' };
  }

  var layout = shellLayout();
  var time = [];
  var scanned = 0;
  for (var i = 0; i < cards.length && time.length < 5; i++) {
    var slot2 = cards[i];
    var card2 = slot2.querySelector('.wbpro-scroller-item') || slot2;
    var bb = card2.getBoundingClientRect();
    if (bb.h === 0 && bb.top === 0) continue;
    scanned++;
    var ts = timeSample(card2);
    if (ts && !ts.anomalous) time.push(ts);
  }

  /* ── ⑤ L2 规则命中审计（v4 新增，2026-10-16 真机三症状定位）────────────
   * 症状：分组页（mygroups）+ 窄窗口（~1080px）下 ① 信息流没加宽 ② 左栏没移最右
   * ③ 头像没渐隐。M1 结构事实是在**首页 ~1297px 窗口**采的 —— 页面/宽度两个变量都变了。
   * 本段把 l2.js 的每条选择器放到活页面里数命中数：命中 0 = 该规则没生效的直接证据，
   * 不用再猜。外加 computed 实测（article padding / 头像 mask / 时间锚 position）。 */
  function ruleAudit() {
    var sels = [
      ['①左栏order', 'div:has(> div:has(> main.woo-box-flex)) > .grayTheme'],
      ['②a收壳', 'main.woo-box-flex > div:has(.wbpro-side-main)'],
      ['②b包裹层放开', 'div:has(> main.woo-box-flex)'],
      ['②cmain放开', 'main.woo-box-flex'],
      ['②d主列放开', 'main.woo-box-flex > div:has(.vue-recycle-scroller)'],
      ['③行化+腾列', '.wbpro-scroller-item article'],
      ['④时间成列', '.wbpro-scroller-item article > div > header a[title^="20"]'],
      ['⑤L2排版', '.wbpro-scroller-item .wbpro-feed-ogText'],
      ['⑥β头像mask', '.wbpro-scroller-item img.woo-avatar-img'],
      ['锚.grayTheme全页', '.grayTheme'],
      ['锚main.woo-box-flex全页', 'main.woo-box-flex'],
      ['锚side-main全页', '.wbpro-side-main'],
      ['锚scroller全页', '.vue-recycle-scroller'],
    ];
    var out = {};
    for (var i = 0; i < sels.length; i++) {
      var n = 0;
      try { n = document.querySelectorAll(sels[i][1]).length; } catch (_e) { n = -1; }
      out[sels[i][0]] = n;
    }
    return out;
  }
  function l2Computed() {
    var card = document.querySelector('.wbpro-scroller-item');
    if (!card) return { verdict: '⛔ 当前页没有 .wbpro-scroller-item 卡' };
    var article = card.querySelector('article');
    var avatar = card.querySelector('img.woo-avatar-img');
    var time = card.querySelector('article > div > header a[title^="20"]');
    var anyAvatar = document.querySelector('img.woo-avatar-img');
    var out = { page: location.href, innerWidth: window.innerWidth };
    if (article) {
      var as = getComputedStyle(article);
      out.article = { paddingLeft: as.paddingLeft, background: as.backgroundColor,
        position: as.position, rect: rectOf(article) };
    }
    var av = avatar || anyAvatar;
    if (av) {
      var vs = getComputedStyle(av);
      out.avatar = { found: desc(av), inCard: Boolean(avatar),
        webkitMaskImage: vs.webkitMaskImage, maskImage: vs.maskImage,
        parent: desc(av.parentElement), rect: rectOf(av) };
    } else {
      out.avatar = { found: null, note: '全页找不到 img.woo-avatar-img —— 头像可能是别的元素（desc 见 avatarAlt）' };
      var alt = card.querySelector('[class*="avatar"]');
      if (alt) out.avatar.avatarAlt = desc(alt);
    }
    if (time) {
      var ts2 = getComputedStyle(time);
      out.time = { position: ts2.position, left: ts2.left, top: ts2.top, width: ts2.width,
        fontFamily: clip(ts2.fontFamily, 40) };
    } else {
      out.time = { found: null, note: '「article > div > header 内」没有时间锚 —— 结构与首页不同' };
      var t2 = card.querySelector('a[title^="20"]');
      if (t2) {
        out.time.foundElsewhere = desc(t2);
        var chain = [], p = t2.parentElement;
        for (var k = 0; k < 6 && p; k++) { chain.push(desc(p)); p = p.parentElement; }
        out.time.parentChain = chain;
      }
    }
    return out;
  }

  var theme = themeInfo();
  var video = videoSample();

  var verdict;
  if (!scanned) verdict = '⛔ 没扫到有效卡 —— 刷新后重跑';
  else if (!time.length) verdict = '⚠️ 当前页没有带时间锚的卡 —— 滚到信息流再跑';
  else verdict = '✅ 采到 ' + time.length + ' 个时间锚 / ' + scanned + ' 张卡 —— 整个输出回传。'
    + '重点：ruleAudit 命中 0 的条目（哪条规则没生效）+ l2Computed（头像 mask / article padding / 时间 position）';

  return {
    verdict: verdict,
    styleCheck: styleCheck,
    ruleAudit: ruleAudit(),
    l2Computed: l2Computed(),
    layout: layout,
    timeAnchors: time,
    scanned: scanned,
    theme: theme,
    video: video,
    note: 'v4：新增 ruleAudit（L2 每条选择器的活页命中数）与 l2Computed（article/头像/时间锚的 computed）。'
      + '请分别在「出问题的页面」（如 mygroups）和「首页」各跑一次 probeL2()，两份输出都回传',
  };
}

try { window.probeL2 = probeL2; } catch (_e) { /* 控制台总有 window */ }
