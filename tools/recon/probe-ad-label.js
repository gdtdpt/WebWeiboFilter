/**
 * 现场探针：定位广告卡上的「广告」标签（2026-10-14 新变体，Console 用）
 *
 * 背景：用户回传的一张 B 类推广卡（券商投教）在截图里**明明有「广告」二字**，
 * 但 `__spb.inspect($0)` 抽出 `tagTexts: []`、`adScore: 2`（只有「关注」按钮）⇒ 判 keep。
 * 四份旧快照里 `>广告<` **0 命中**、`wbpro-tag` 只有「荐读」一处 ⇒ 这是新变体，槽位未知。
 * 按纪律「先补样本、再改 ad-detect」—— 本探针只**取样**，不改任何东西。
 *
 * ── 用法 ──────────────────────────────────────────────────────────
 *   ① 右键点那张广告卡 → 检查（Elements）
 *   ② 在 Elements 里选中卡内**任意**元素（或直接点那张卡里的一行文字）
 *   ③ F12 切到 Console，把本文件全部内容粘进去（会挂上 window.probeAdLabel）
 *   ④ 跑：`probeAdLabel($0)`
 *   ⑤ 把输出整个复制回来
 *
 * ── 输出字段 ──────────────────────────────────────────────────────
 *   articleChildren : article 的直接子块（标签槽在哪一层、多高）
 *   labelHits       : 文本含「广告」的**叶子**元素 + 祖先链（带 class）—— 最想要的
 *   attrHits        : title / alt 含「广告」的元素
 *   tokens          : 卡内 class 令牌里命中 ad|tag|promo|sponsor|label|mark 的（含出现次数）
 *   cands           : 头部附近所有「短文本 + 有 class」的元素（labelHits 为空时的兜底）
 */

function probeAdLabel(target) {
  var el = target && target.closest ? target : null;
  if (!el) {
    return {
      error: '用法：Elements 面板选中广告卡内任意元素后跑 probeAdLabel($0)',
    };
  }
  var card = el.closest('.wbpro-scroller-item');
  if (!card) {
    return { error: '选中的元素不在任何 .wbpro-scroller-item 卡内' };
  }

  var clip = function (s, n) {
    s = (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
    return s.length > (n || 40) ? s.slice(0, n || 40) + '…' : s;
  };
  var clsOf = function (e) {
    var c = e.getAttribute && e.getAttribute('class');
    return c ? clip(c, 90) : '';
  };
  /** 祖先链（不含 card 自身之外）：从自身往上，最多 6 层 */
  var chainOf = function (node) {
    var out = [], p = node;
    while (p && p !== card && out.length < 8) {
      out.push(p.tagName.toLowerCase() + (clsOf(p) ? '.' + clsOf(p).replace(/\s+/g, '.') : ''));
      p = p.parentElement;
    }
    return out;
  };

  var all = card.querySelectorAll('*');
  var labelHits = [];
  var attrHits = [];
  var tokens = {};
  var cands = [];

  for (var i = 0; i < all.length; i++) {
    var e = all[i];

    // ① 文本含「广告」的**叶子**元素（祖先的 textContent 必然包含它 ⇒ 只看叶子才有定位价值）
    var t = clip(e.textContent, 60);
    if (t && t.length <= 8 && t.indexOf('广告') !== -1 && !e.children.length) {
      labelHits.push({ tag: e.tagName.toLowerCase(), cls: clsOf(e), text: t, chain: chainOf(e) });
    }

    // ② title / alt 里的「广告」（有的是烤进图标 title 的）
    var ti = e.getAttribute('title') || '';
    var al = e.getAttribute('alt') || '';
    if (ti.indexOf('广告') !== -1 || al.indexOf('广告') !== -1) {
      attrHits.push({ tag: e.tagName.toLowerCase(), cls: clsOf(e), title: clip(ti, 40), alt: clip(al, 40), chain: chainOf(e) });
    }

    // ③ class 令牌：命中广告/标签语义的（labelHits 为空时靠它找锚点）
    var c = e.getAttribute('class') || '';
    var toks = c.split(/\s+/);
    for (var k = 0; k < toks.length; k++) {
      var tk = toks[k];
      if (!tk) continue;
      if (/ad|tag|promo|sponsor|label|mark/i.test(tk)) tokens[tk] = (tokens[tk] || 0) + 1;
    }
  }

  // ④ 兜底候选：卡片**头部区域**所有「短文本（≤12 字）+ 有 class」的元素
  var art = card.querySelector('article') || card;
  var kids = [];
  for (var c2 = 0; c2 < art.children.length; c2++) {
    var ch = art.children[c2];
    kids.push({
      tag: ch.tagName.toLowerCase(),
      cls: clsOf(ch),
      h: +ch.getBoundingClientRect().height.toFixed(1),
      kids: ch.children.length,
      text: clip(ch.textContent, 50),
    });
  }
  // 头部 = article 的第二个子块里那些兄弟（与真实结构无关，纯「短文本有 class」筛）
  for (var j = 0; j < all.length; j++) {
    var s = clip(all[j].textContent, 20);
    if (s && s.length <= 12 && clsOf(all[j]) && all[j].children.length <= 1) {
      cands.push({ tag: all[j].tagName.toLowerCase(), cls: clsOf(all[j]), text: s });
      if (cands.length >= 25) break;
    }
  }

  return {
    cardId: (function () {
      var a = card.querySelector('a[href*="/weibo.com/"]');
      var m = a && /weibo\.com\/[^/]+\/([A-Za-z0-9]+)/.exec(a.getAttribute('href') || '');
      return m ? m[1] : null;
    })(),
    articleChildren: kids,
    labelHits: labelHits,
    attrHits: attrHits,
    tokens: tokens,
    cands: cands,
    verdict: labelHits.length
      ? '✅ 找到「广告」标签元素：看 labelHits[].chain 定锚点'
      : '⚠️ 没找到含「广告」文本的叶子 —— 可能是 ::before/::after 生成的、或它是图片 alt/title',
  };
}

try {
  window.probeAdLabel = probeAdLabel;
} catch (_e) {
  /* 控制台环境总是有 window */
}
