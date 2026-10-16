/**
 * probe-brand.js —— M3「标识文案换中性」真机取证
 *
 * 背景（§7.5-G 伪装纪律）：L0 已把标签页伪装成 SpecBase，但**页面内**的品牌字样
 * 还是「微博」。目标 = 把界面 chrome 上的「微博」换成中性身份；**正文内容里的
 * 「微博」二字绝对不动**（那是用户写的，改了就是篡改内容）。
 *
 * ⚠️ 已知难点（MEMORY.md 沉淀）：外壳（顶栏 / 侧栏 / logo）**没有语义锚点**，
 * 唯一属性锚 = `a[href="/"][aria-label]`。所以动手前必须把「微博」字样的落点
 * 全部采齐、逐个判可锚性 —— 本探针就是干这个的。
 *
 * 采五样：
 *   ① 文本节点 —— 全页含「微博」的 text node：祖先链 + 可锚性 + 可见性 +
 *      inCard 判定（article 内 = 用户内容，禁改；卡外 = chrome 候选）；
 *   ② 属性文本 —— title / aria-label / placeholder / alt / contenteditable
 *      初值里含「微博」的元素；
 *   ③ logo 结构 —— `a[href="/"][aria-label]`（顶栏唯一属性锚）内部长什么样
 *      （SVG？图片？文字？）—— 决定 logo 上的「微博」怎么处理；
 *   ④ 搜索框 —— placeholder 现状；
 *   ⑤ 动态区粗查 —— 「微博」出现在 fixed/弹层里的嫌疑（position 采样）。
 *
 * 用法：首页滚两屏（让弹层/懒加载都出来）→ Console 粘全文 → probeBrand() → 整个输出回传。
 * ⚠️ 跑之前确认已卸 firstframe-probe。
 */
function probeBrand() {
  var clip = function (s, n) {
    s = (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
    n = n || 60;
    return s.length > n ? s.slice(0, n) + '…' : s;
  };
  var desc = function (el) {
    if (!el || !el.tagName) return String(el);
    return el.tagName.toLowerCase() +
      '.' + clip((el.getAttribute('class') || '').replace(/\s+/g, '.'), 70) +
      (el.id ? '#' + el.id : '');
  };
  var rectOf = function (el) {
    var b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  };

  /* 可锚性判读：祖先链里有没有稳定锚（id / 库类 / 语义标签 / 自有属性），
   * 还是只有构建哈希（锚不了，得另想办法）。 */
  function anchorability(el) {
    var chain = [];
    var cur = el;
    for (var i = 0; i < 8 && cur && cur !== document.documentElement; i++) {
      var id = cur.id || '';
      var cls = (cur.getAttribute && cur.getAttribute('class')) || '';
      var stable = [];
      if (id) stable.push('#' + id);
      var tokens = cls.split(/\s+/);
      for (var t = 0; t < tokens.length; t++) {
        var c = tokens[t];
        if (!c) continue;
        if (/^(wbpro|woo|vue|vjs)-/.test(c)) stable.push('.' + c);
        else if (/^_/.test(c)) stable.push('⛔' + c.slice(0, 14));   // 构建哈希
      }
      if (cur.tagName === 'ARTICLE' || cur.tagName === 'HEADER' || cur.tagName === 'MAIN') {
        stable.push(cur.tagName.toLowerCase());
      }
      chain.push({ el: desc(cur), stable: stable });
      cur = cur.parentElement;
    }
    return chain;
  }

  function visible(el) {
    var b = el.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  /* ── ① 文本节点：含「微博」的全采，按 inCard 分流 ─────────────────── */
  var textHits = { chrome: [], inCard: [], hidden: [] };
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  var node;
  while ((node = walker.nextNode())) {
    var txt = node.nodeValue || '';
    if (txt.indexOf('微博') === -1) continue;
    var el = node.parentElement;
    if (!el || !el.getBoundingClientRect) continue;
    var card = el.closest ? el.closest('.wbpro-scroller-item') : null;
    var inArticle = el.closest ? Boolean(el.closest('article')) : false;
    var rec = {
      text: clip(txt, 50),
      el: desc(el),
      rect: rectOf(el),
      inArticle: inArticle,
      inCard: Boolean(card),
      chain: anchorability(el),
    };
    if (!visible(el)) textHits.hidden.push(rec);
    else if (card) textHits.inCard.push(rec);
    else textHits.chrome.push(rec);
  }

  /* ── ② 属性文本：title / aria-label / placeholder / alt ──────────── */
  var attrHits = [];
  var all = document.querySelectorAll('*');
  for (var i = 0; i < all.length; i++) {
    var e = all[i];
    var found = null;
    for (var a = 0; a < 4; a++) {
      var name = ['title', 'aria-label', 'placeholder', 'alt'][a];
      var v = e.getAttribute && e.getAttribute(name);
      if (v && v.indexOf('微博') !== -1) { found = { attr: name, value: clip(v, 50) }; break; }
    }
    if (!found) continue;
    var card2 = e.closest ? e.closest('.wbpro-scroller-item') : null;
    attrHits.push({
      attr: found.attr, value: found.value, el: desc(e), rect: rectOf(e),
      inCard: Boolean(card2), visible: visible(e),
      chain: anchorability(e),
    });
  }

  /* ── ③ logo 结构：顶栏唯一属性锚的内部 ────────────────────────────── */
  var logo = document.querySelector('a[href="/"][aria-label]');
  var logoInfo = null;
  if (logo) {
    var inner = [];
    var kids = logo.querySelectorAll('*');
    for (var k = 0; k < Math.min(kids.length, 12); k++) {
      var kd = kids[k];
      inner.push({
        el: desc(kd),
        rect: rectOf(kd),
        text: clip(kd.textContent || '', 30),
        svgText: kd.tagName === 'svg' ? clip((kd.textContent || ''), 30) : undefined,
      });
    }
    logoInfo = {
      el: desc(logo),
      ariaLabel: logo.getAttribute('aria-label'),
      rect: rectOf(logo),
      inner: inner,
      note: '看「微博」是 SVG 矢量字、位图、还是真文本 —— 决定 logo 的处理手法',
    };
  }

  /* ── ④ 搜索框 placeholder ─────────────────────────────────────────── */
  var search = document.querySelector('input[placeholder]');
  var searchInfo = search ? { el: desc(search), placeholder: search.getAttribute('placeholder') } : null;

  var verdict = '✅ 文本 chrome ' + textHits.chrome.length + ' 处 / 卡内 ' + textHits.inCard.length
    + ' 处 / 隐藏 ' + textHits.hidden.length + ' 处；属性 ' + attrHits.length + ' 处 —— 整个输出回传。'
    + '重点：chrome 清单的 chain.stable（可锚性）与 logo.inner（logo 的「微博」长在哪）';

  return {
    verdict: verdict,
    innerWidth: window.innerWidth,
    textChrome: textHits.chrome,
    textInCardCount: textHits.inCard.length,
    textInCardSample: textHits.inCard.slice(0, 6),
    textHiddenCount: textHits.hidden.length,
    attrHits: attrHits,
    logo: logoInfo,
    search: searchInfo,
    note: 'inCard=true 的是用户内容（禁改）；chrome 才是本任务的候选。chain.stable 里'
      + '带 ⛔ 的层级是构建哈希，不可锚 —— 候选落点必须挑有稳定锚的路径。',
  };
}

try { window.probeBrand = probeBrand; } catch (_e) { /* 控制台总有 window */ }
