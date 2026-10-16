/**
 * probe-typo.js —— 正文排版（C 组「字号行距」项）真机取样
 *
 * 背景（2026-10-16）：字号行距是改高度批次最后一项（§7.5-C：L1 目标 = 字号 14px /
 * 行距 1.6 / 段间距收紧 / 文字色用主题令牌）。规范目标值是 2026-10-13 拍的，
 * **微博原生正文排版的读数一份都没有** —— 改多少、改了卡高变多少，都得先量。
 *
 * 采样对象（锚库类，不锚哈希）：
 *   · `.wbpro-feed-ogText`（原创正文）/ `.wbpro-feed-reText`（转发原文）容器与其内层文本元素
 *   · computed：font-size / line-height / font-family / color / margin / padding（段间距的材料）
 *   · 卡级：article 的字体基线（正文是否继承自卡根）
 * 用法：首页滚到有正文的位置 → Console 粘全文 → probeTypo() → 整个输出回传。
 */
function probeTypo() {
  var clip = function (s, n) {
    s = (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
    n = n || 60;
    return s.length > n ? s.slice(0, n) + '…' : s;
  };

  var styleEl = document.getElementById('spb-style');
  var styleCheck = { present: Boolean(styleEl),
    hasMediaRule: styleEl ? /max-height:\d+px !important/.test(styleEl.textContent) : false };
  if (!styleCheck.present) return { verdict: '⛔ 没有 #spb-style —— 脚本没在跑（重装后刷新）', styleCheck: styleCheck };

  var cards = document.querySelectorAll('.vue-recycle-scroller__item-wrapper > .vue-recycle-scroller__item-view');
  if (!cards.length) cards = document.querySelectorAll('.wbpro-scroller-item');

  var KEYS = ['fontSize', 'lineHeight', 'fontFamily', 'color', 'marginTop', 'marginBottom',
    'paddingTop', 'paddingBottom', 'letterSpacing'];

  function stylesOf(el) {
    var cs;
    try { cs = getComputedStyle(el); } catch (_e) { return null; }
    if (!cs) return null;
    var out = {};
    for (var i = 0; i < KEYS.length; i++) out[KEYS[i]] = cs[KEYS[i]];
    // fontFamily 太长，只留首个族名
    if (out.fontFamily) out.fontFamily = clip(out.fontFamily, 40);
    return out;
  }

  function rectOf(el) {
    var b = el.getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height) };
  }

  function sampleText(el) {
    // 内层文本元素：取第一个带实质文本的子 div（_wbtext_ 是哈希类，只描述不锚）
    var kids = el.children || [];
    for (var i = 0; i < kids.length; i++) {
      var t = (kids[i].textContent || '').trim();
      if (t) return { innerDesc: clip(kids[i].tagName.toLowerCase() + '.' + (kids[i].getAttribute('class') || '').replace(/\s+/g, '.'), 70),
        text: clip(t, 30), styles: stylesOf(kids[i]), rect: rectOf(kids[i]) };
    }
    return null;
  }

  function sampleScope(el) {
    if (!el) return null;
    var s = { container: { styles: stylesOf(el), rect: rectOf(el) }, inner: sampleText(el) };
    // 段间距材料：容器与内层的 margin/padding 已含；再看有没有多个文本块（分段渲染？）
    s.blockCount = el.querySelectorAll(':scope > div').length;
    return s;
  }

  var found = [];
  var scanned = 0;
  for (var i = 0; i < cards.length; i++) {
    var slot = cards[i];
    var card = slot.querySelector('.wbpro-scroller-item') || slot;
    var b = card.getBoundingClientRect();
    if (b.h === 0 && b.top === 0) continue;   // 异常态闸（§12-B10）
    scanned++;

    var postId = null, m, as = card.querySelectorAll('a[href]');
    for (var k = 0; k < as.length && !postId; k++) {
      m = /weibo\.com\/\d+\/([A-Za-z0-9]+)/.exec(as[k].getAttribute('href') || '');
      if (m) postId = m[1];
    }

    var og = sampleScope(card.querySelector('.wbpro-feed-ogText'));
    var re = sampleScope(card.querySelector('.wbpro-feed-reText'));
    if (!og && !re) continue;
    found.push({ postId: postId, article: stylesOf(card.querySelector('article') || card), og: og, re: re });
  }

  var verdict;
  if (!scanned) verdict = '⛔ 没扫到有效卡 —— 刷新后重跑';
  else if (!found.length) verdict = '⚠️ 当前页没有带正文的卡 —— 滚到有文字微博的位置再跑';
  else verdict = '✅ 采到 ' + found.length + ' 张卡 —— 回传输出；重点看 og/re 的 fontSize 与 lineHeight '
    + '（L1 目标 14px / 1.6）、margin/padding（段间距收紧的落点）、color 是否已是主题令牌';

  return { verdict: verdict, styleCheck: styleCheck, scanned: scanned, cards: found,
    note: 'container = wbpro-feed-ogText/reText 库类层；inner = 内层文本元素（哈希类，仅描述）。'
      + '若 container 与 inner 的 fontSize 不同，规则要打在能压过内联的那一层' };
}

try { window.probeTypo = probeTypo; } catch (_e) { /* 控制台总有 window */ }
