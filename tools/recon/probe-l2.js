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

  /* ── ① 外壳三列布局 ─────────────────────────────────────────── */
  function shellLayout() {
    var nav = document.querySelector('a[href="/"][aria-label]');
    var scroller = document.querySelector('.vue-recycle-scroller');
    if (!nav || !scroller) return { verdict: '⛔ 找不到左栏锚或时间线容器', navFound: Boolean(nav), scrollerFound: Boolean(scroller) };

    // 公共祖先 = 布局容器（含左栏与主列的那一层）
    function chain(el) {
      var out = [];
      while (el && el !== document.documentElement) { out.push(el); el = el.parentElement; }
      return out;
    }
    var navChain = chain(nav), scChain = chain(scroller);
    var common = null;
    for (var i = 0; i < navChain.length; i++) {
      if (scChain.indexOf(navChain[i]) !== -1) { common = navChain[i]; break; }
    }
    if (!common) return { verdict: '⛔ 左栏与主列无公共祖先（理论不可能）' };

    // 从公共祖先往下走 0~2 层，找到「直接子含两者」且 display 是 flex 的那一层
    var layoutEl = null, layoutLv = 0, cur = common;
    for (var lv = 0; lv < 3 && cur; lv++) {
      var kids = cur.children || [];
      var hasNav = false, hasSc = false;
      for (var k = 0; k < kids.length; k++) {
        if (kids[k].contains(nav)) hasNav = true;
        if (kids[k].contains(scroller)) hasSc = true;
      }
      if (hasNav && hasSc) { layoutEl = cur; layoutLv = lv; }
      cur = (cur.children && cur.children.length === 1) ? cur.children[0] : null;
      if (!layoutEl) continue;
      var d = getComputedStyle(layoutEl).display;
      if (d === 'flex' || d === 'grid') break; // 找到 flex 布局层就停
      if (lv < 2) { // 不是 flex 就再往下一层找（重置，继续找「同时含两者」的更深层）
        var deeper = layoutEl;
        layoutEl = null;
        cur = deeper;
      }
    }
    var out = {
      commonAncestor: desc(common),
      layoutLevel: layoutLv,
      layoutEl: layoutEl ? desc(layoutEl) : null,
      layoutStyles: layoutEl ? stylesOf(layoutEl, LAYOUT_KEYS) : null,
      columns: [],
      leftNavStickyUnknown: false,
    };
    if (!layoutEl) {
      out.verdict = '⚠️ 未找到「同时含左栏与主列」的 flex 布局层 —— order 交换可能不可用，回传读数人工判';
      out.leftNavStickyUnknown = true;
      return out;
    }
    var cols = layoutEl.children || [];
    for (var c = 0; c < cols.length; c++) {
      var col = cols[c];
      var st = stylesOf(col, LAYOUT_KEYS);
      st.containsNav = col.contains(nav);
      st.containsScroller = col.contains(scroller);
      st.containsSideMain = Boolean(col.querySelector('.wbpro-side-main'));
      st.rect = rectOf(col);
      out.columns.push({ el: desc(col), styles: st });
    }
    var hasNavCol = out.columns.some(function (x) { return x.styles.containsNav; });
    var hasScCol = out.columns.some(function (x) { return x.styles.containsScroller; });
    out.verdict = (hasNavCol && hasScCol)
      ? '✅ 布局层与列构成已采到 —— 回传；重点看左栏列的 position（sticky 会坏事）与各列 order/flex'
      : '⚠️ 布局层直接子里没有同时覆盖左栏与主列 —— 中间还有包裹层，回传读数人工判';
    return out;
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

  var theme = themeInfo();
  var video = videoSample();

  var verdict;
  if (!scanned) verdict = '⛔ 没扫到有效卡 —— 刷新后重跑';
  else if (!time.length) verdict = '⚠️ 当前页没有带时间锚的卡 —— 滚到信息流再跑';
  else verdict = '✅ 采到 ' + time.length + ' 个时间锚 / ' + scanned + ' 张卡 —— 整个输出回传。'
    + '重点：① 布局层 columns 的 position/flex/order；② offsetFromCard（时间列落点）与 header 兄弟（脱流后原位）；'
    + '③ 页面底色 vs 卡底色的差值；④ 视频播放器占卡高的比例';

  return {
    verdict: verdict,
    styleCheck: styleCheck,
    layout: layout,
    timeAnchors: time,
    scanned: scanned,
    theme: theme,
    video: video,
    note: 'layout.commonAncestor 是用「左栏锚 × 滚动容器公共祖先」定位的（外壳无语义锚点的替代法）。'
      + 'timeAnchors.parents 首层就是 absolute 的挂点候选；siblings 是时间脱流后 header 原位的残留物',
  };
}

try { window.probeL2 = probeL2; } catch (_e) { /* 控制台总有 window */ }
