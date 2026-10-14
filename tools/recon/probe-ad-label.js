/**
 * 现场探针 v2：定位广告卡上的「广告」标签（2026-10-14 新变体，Console 用）
 *
 * ── 为什么有 v2 ────────────────────────────────────────────────────
 * v1 在「长江证券」卡上返回了 `labelHits: []` —— 但那张卡的正文/来源里**压根没有「广告」二字**，
 * 更像一张**普通帖**（我们采错卡了）。v2 加了三重防线，避免再来一轮空跑：
 *   ① `cardText` —— 开头就打印卡片文本，**当场确认采到的是不是那张广告卡**；
 *   ② `pseudoHits` —— 检查 `::before` / `::after` 生成的内容（「广告」有可能是 CSS 造的）；
 *   ③ `headerHtml` —— 头部原样 HTML（截断），**兜底铁证**：真是 DOM 里就有的文本，一眼可见。
 * 同时放宽 v1 过严的过滤（原来要求「无子元素」，像 `<span><i/>广告</span>` 会被漏掉）。
 *
 * ── 用法 ──────────────────────────────────────────────────────────
 *   ① 右键点**那张广告卡** → 检查（Elements）；⚠️ 先看准卡片内容（如「天猫双11」），别点错
 *   ② 在 Elements 里选中卡内**任意**元素
 *   ③ F12 → Console，把本文件全部内容粘进去（挂上 window.probeAdLabel）
 *   ④ 跑：`probeAdLabel($0)`
 *   ⑤ 先看 `cardText` 对不对得上那张广告卡，再复制全部输出
 *
 * v3（2026-10-14 晚）：用户确认「长江证券」卡**就是**广告卡（截图为证）⇒ v1 落空的真正原因不是
 * 采错卡，而是**徽章不是文本节点**（全卡 textContent 无「广告」）—— 只剩 CSS 伪元素 / 图片两种可能。
 * v3 加 `imgs`（卡内全部 <img>：src / class / 父类 / 宽度；主脚本 imgSrcs 只收 woo-picture，
 * 徽章小图会漏）+ verdict 增加「有 tag/ad 类图片」分支；headerHtml 截断放宽到 2200。
 */

function probeAdLabel(target) {
  var el = target && target.closest ? target : null;
  if (!el) return { error: '用法：Elements 面板选中广告卡内任意元素后跑 probeAdLabel($0)' };
  var card = el.closest('.wbpro-scroller-item');
  if (!card) return { error: '选中的元素不在任何 .wbpro-scroller-item 卡内' };

  var clip = function (s, n) {
    s = (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
    n = n || 40;
    return s.length > n ? s.slice(0, n) + '…' : s;
  };
  var clsOf = function (e) {
    var c = e.getAttribute && e.getAttribute('class');
    return c ? clip(c, 120) : '';
  };
  var desc = function (e) {
    return e.tagName.toLowerCase() + (clsOf(e) ? '.' + clsOf(e).replace(/\s+/g, '.') : '');
  };
  var chainOf = function (node) {
    var out = [], p = node;
    while (p && p !== card && out.length < 8) { out.push(desc(p)); p = p.parentElement; }
    out.push('card');
    return out;
  };
  var psContent = function (e, which) {
    try {
      var cs = getComputedStyle(e, which);
      return cs ? (cs.content || '') : '';
    } catch (_e) { return ''; }
  };

  var all = card.querySelectorAll('*');
  var anyHits = [];      // ① 任何（含非叶子）元素，其 textContent 含「广告」
  var leafHits = [];     // ② 文本**本身**含「广告」的元素（用直接子文本节点判，避免父元素 textContent 连坐）
  var pseudoHits = [];   // ③ ::before / ::after 生成「广告」
  var attrHits = [];     // ④ title / alt
  var tagSlots = [];     // ⑤ 我方抽取器读的那个槽位（[class*=wbpro-tag]）—— 解释 tagTexts 为何为空

  for (var i = 0; i < all.length; i++) {
    var e = all[i];
    var full = clip(e.textContent, 80);

    if (full.indexOf('广告') !== -1) {
      anyHits.push({ tag: e.tagName.toLowerCase(), cls: clsOf(e), text: clip(full, 50), chain: chainOf(e) });
    }
    // 直接子文本节点里含「广告」—— 这才是「这个元素自己显示的字」
    var own = '';
    for (var n = 0; n < e.childNodes.length; n++) {
      var cn = e.childNodes[n];
      if (cn.nodeType === 3) own += cn.nodeValue || '';
    }
    if (own.indexOf('广告') !== -1 && clip(own, 20).length <= 20) {
      leafHits.push({ tag: e.tagName.toLowerCase(), cls: clsOf(e), ownText: clip(own, 30), chain: chainOf(e) });
    }
    var b = psContent(e, '::before'), a2 = psContent(e, '::after');
    if ((b && b.indexOf('广告') !== -1) || (a2 && a2.indexOf('广告') !== -1)) {
      pseudoHits.push({ tag: e.tagName.toLowerCase(), cls: clsOf(e), before: clip(b, 30), after: clip(a2, 30), chain: chainOf(e) });
    }
    var ti = e.getAttribute('title') || '', al = e.getAttribute('alt') || '';
    if (ti.indexOf('广告') !== -1 || al.indexOf('广告') !== -1) {
      attrHits.push({ tag: e.tagName.toLowerCase(), cls: clsOf(e), title: clip(ti, 30), alt: clip(al, 30), chain: chainOf(e) });
    }
    if (/wbpro-tag/.test(clsOf(e))) {
      tagSlots.push({ tag: e.tagName.toLowerCase(), cls: clsOf(e), text: clip(full, 30), kids: e.children.length });
    }
  }

  var art = card.querySelector('article') || card;
  var kids = [];
  for (var c2 = 0; c2 < art.children.length; c2++) {
    var ch = art.children[c2];
    kids.push({
      tag: ch.tagName.toLowerCase(), cls: clsOf(ch),
      h: +ch.getBoundingClientRect().height.toFixed(1), kids: ch.children.length,
      text: clip(ch.textContent, 60),
    });
  }
  var hdr = card.querySelector('header');
  // 帖 ID：只认 /weibo.com/<数字 uid>/<bid> 形态（v1 错抓成了 uid）
  var m = null;
  for (var k = 0; k < all.length && !m; k++) {
    if (all[k].tagName !== 'A') continue;
    m = /weibo\.com\/\d+\/([A-Za-z0-9]+)/.exec(all[k].getAttribute('href') || '');
  }
  // ⑥ 卡内**全部** <img>（主脚本 imgSrcs 只收 woo-picture —— 徽章小图会漏；
  //    「广告」若是烤进图片像素里的，只能靠 src / class 认出来）
  var imgs = [];
  var im = card.querySelectorAll('img');
  for (var q = 0; q < im.length; q++) {
    imgs.push({
      src: clip(im[q].getAttribute('src') || '', 110),
      cls: clsOf(im[q]),
      parent: desc(im[q].parentElement),
      w: im[q].getBoundingClientRect().width.toFixed(0),
    });
  }

  return {
    cardText: clip(card.textContent, 150),   // ⚠️ 先核对这个！对不上就是采错卡了
    postId: m ? m[1] : null,
    articleChildren: kids,
    ownHits: leafHits,                       // ⭐ 最想要的：元素自己显示的文字里有「广告」
    anyHits: anyHits,
    pseudoHits: pseudoHits,
    attrHits: attrHits,
    tagSlots: tagSlots,
    imgs: imgs,                              // ⭐ 徽章若是图片，答案就在这（src / class / 宽度）
    headerHtml: hdr ? clip(hdr.outerHTML.replace(/<!---->/g, ''), 2200) : null,
    verdict: (leafHits.length || pseudoHits.length || anyHits.length)
      ? '✅ 找到「广告」来源：看 ownHits / pseudoHits / anyHits 里的 chain'
      : (imgs.some(function (x) { return /tag|ad|label|promo/i.test(x.cls + ' ' + x.parent); })
        ? '⚠️ 卡内没有「广告」文本，但有 tag/ad 类图片 —— 看 imgs（徽章多半烤在图里）'
        : '⚠️ 卡内没有「广告」文本 —— ① 先看 cardText 确认是不是那张广告卡；'
          + '② 若确实是广告却没文本 ⇒ 看 imgs 和 headerHtml（图片 / 背景 / 颜色块）'),
  };
}

try { window.probeAdLabel = probeAdLabel; } catch (_e) { /* 控制台总有 window */ }
