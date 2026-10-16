/**
 * 顶栏取样探针（Console 粘贴即用）—— 低调模式顶栏项前置取证（2026-10-16）
 *
 * 背景（用户真机反馈）：
 *   ① 频道分类条（全部/原创/视频/超话社区/V+微博/群微博）**整条隐藏**（用户拍板「都不需要」）；
 *   ② 顶栏个人头像「太显眼」；③ 右侧橙色按钮（发 / 无障碍…）「有点明显」。
 *
 * 外壳没有语义锚点（§7.5 纪律：不猜，真机取样）⇒ 本探针采：
 *   A. 分类条：从「超话社区」文本反推整条容器 —— 链上各层的类名可锚性 + 矩形
 *      （隐藏落点选哪一层、隐藏后会不会带走别的）；
 *   B. 顶栏容器：从 logo 锚（a[href="/"][aria-label]）向上找 bar —— 直接子清单
 *      （tag / 类 / 矩形 / aria / 文本 / 计算色）；
 *   C. 头像：bar 里的 img / 背景图元素 + 未读数徽章；
 *   D. 橙色按钮：bar 内所有「计算色带彩度」的可点元素 —— 它们的颜色是变量还是写死，
 *      决定降显著手法（覆盖变量 / 单点规则）。
 *
 * 用法：首页 F12 → Console 粘贴全文 → probeTopbar() → 整个输出回传。
 */
(function () {
  if (window.probeTopbar) return;

  function rect(el) {
    try {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    } catch (_e) { return null; }
  }

  function visible(el) {
    try { return !!el.getClientRects().length; } catch (_e) { return false; }
  }

  /** 类名可锚性：库类 ✅ / 语义 #id ✅ / 哈希 ⛔（只标记，不在探针里做选择） */
  function clsSig(el) {
    if (!el || typeof el.getAttribute !== 'function') return [];
    const cls = el.getAttribute('class') || '';
    return cls.split(/\s+/).filter(Boolean).map((c) =>
      /^(_|__)/.test(c) || /[-_][0-9a-z]{4,6}[_][0-9a-z]/i.test(c) ? ('⛔' + c) : ('.' + c)
    );
  }

  function chainOf(el, n) {
    const out = [];
    let cur = el;
    for (let i = 0; i < n && cur; i++) {
      out.push({ el: tagOf(cur), stable: clsSig(cur), id: cur.id || undefined, rect: rect(cur) });
      cur = cur.parentElement;
    }
    return out;
  }

  function tagOf(el) {
    let s = (el.tagName || '').toLowerCase();
    if (el.id) s += '#' + el.id;
    s += '.' + (el.getAttribute('class') || '').trim().split(/\s+/).slice(0, 3).join('.');
    return s;
  }

  /** 计算色 + 彩度（HSL S>25% 判「鲜艳」） */
  function colorInfo(el) {
    let cs;
    try { cs = getComputedStyle(el); } catch (_e) { return null; }
    const pick = (v) => {
      const m = /rgba?\(([^)]+)\)/.exec(v || '');
      if (!m) return { raw: v || '', vivid: false };
      const [r, g, b] = m[1].split(',').map((x) => parseFloat(x));
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const l = (mx + mn) / 510;
      const s = mx === mn ? 0 : (mx - mn) / (255 * (1 - Math.abs(2 * l - 1)) || 1);
      return { raw: v, s: Math.round(s * 100), vivid: s > 0.25 && (mx - mn) > 30 };
    };
    return {
      color: pick(cs.color),
      bg: pick(cs.backgroundColor),
      border: pick(cs.borderTopColor),
    };
  }

  function probeTopbar() {
    const doc = document;
    const out = { innerWidth: window.innerWidth };

    /* ── A. 分类条：从「超话社区 / V+微博」文本反推 ── */
    const CHWords = ['超话社区', 'V+微博', '群微博'];
    let tabEl = null, tabText = '';
    const walker = doc.createTreeWalker(doc.body, 4); // SHOW_TEXT
    while (walker.nextNode()) {
      const v = (walker.currentNode.nodeValue || '').trim();
      if (CHWords.indexOf(v) !== -1) {
        tabEl = walker.currentNode.parentElement;
        tabText = v;
        break;
      }
    }
    if (tabEl) {
      out.channelBar = { sampleText: tabText, sampleChain: chainOf(tabEl, 6) };
      // 从样本向上找「行容器」：宽度接近主列、高度 30~70 的祖先
      let bar = null;
      let cur = tabEl;
      while (cur && cur !== doc.body) {
        const r = rect(cur);
        if (r && r.h >= 30 && r.h <= 70 && r.w > 300) { bar = cur; break; }
        cur = cur.parentElement;
      }
      if (bar) {
        out.channelBar.barGuess = {
          el: tagOf(bar), stable: clsSig(bar), rect: rect(bar),
          children: Array.prototype.map.call(bar.children, (c) => ({
            el: tagOf(c), stable: clsSig(c), text: (c.textContent || '').trim().slice(0, 12),
            rect: rect(c), visible: visible(c),
          })),
        };
      }
    } else {
      out.channelBar = { note: '❌ 没找到「超话社区/V+微博」文本节点 —— 分类条可能没渲染或结构不同' };
    }

    /* ── B/C/D. 顶栏：从 logo 锚向上 ── */
    const logo = doc.querySelector('a[href="/"][aria-label]');
    if (!logo) {
      out.topbar = { note: '❌ logo 锚没找到' };
      return out;
    }
    // bar = logo 祖先里第一个 h∈[40,80] 且 w>600 的元素
    let bar = null, cur = logo;
    while (cur && cur !== doc.body) {
      const r = rect(cur);
      if (r && r.h >= 40 && r.h <= 80 && r.w > 600) { bar = cur; break; }
      cur = cur.parentElement;
    }
    out.logoChain = chainOf(logo, 5);
    if (!bar) { out.topbar = { note: '❌ 没定位到 bar 容器（logoChain 兜底看）' }; return out; }

    const kids = Array.prototype.map.call(bar.querySelectorAll('a,button,[role="button"],input'), (el) => {
      const r = rect(el);
      const img = el.querySelector ? el.querySelector('img') : null;
      const bgEl = el.querySelector ? el.querySelector('[style*="background"],[class*="avatar"]') : null;
      return {
        el: tagOf(el), stable: clsSig(el), aria: el.getAttribute('aria-label') || undefined,
        title: el.getAttribute('title') || undefined, text: (el.textContent || '').trim().slice(0, 10),
        rect: r, visible: visible(el), colors: colorInfo(el),
        innerImg: img ? { el: tagOf(img), stable: clsSig(img), src: (img.getAttribute('src') || '').slice(0, 60) } : undefined,
        innerBg: bgEl && !img ? { el: tagOf(bgEl), stable: clsSig(bgEl) } : undefined,
      };
    }).filter((x) => x.visible && x.rect && x.rect.w > 0 && x.rect.h > 0);

    out.topbar = {
      bar: { el: tagOf(bar), stable: clsSig(bar), rect: rect(bar) },
      clickables: kids,
      // 未读徽章（红点/数字）：小而鲜艳的元素
      badges: Array.prototype.map.call(bar.querySelectorAll('*'), (el) => {
        const r = rect(el);
        if (!r || r.w > 30 || r.h > 30 || r.w === 0 || !visible(el)) return null;
        const c = colorInfo(el);
        const t = (el.textContent || '').trim();
        if (!c) return null;
        if ((c.bg.vivid || c.color.vivid) && t && t.length <= 4) {
          return { el: tagOf(el), stable: clsSig(el), text: t, rect: r, colors: c };
        }
        return null;
      }).filter(Boolean).slice(0, 8),
    };

    /* 判读提示 */
    out.note = '判读：① channelBar.barGuess = 分类条隐藏落点候选（取「再上一层就开始装别的」的那层）；'
      + '② topbar.clickables 里 bg/color vivid:true = 橙色按钮清单（看 stable 里有没有库类可锚）；'
      + '③ innerImg/innerBg = 头像真身；badges = 未读数徽章。整个输出回传。';
    return out;
  }

  window.probeTopbar = probeTopbar;
})();
