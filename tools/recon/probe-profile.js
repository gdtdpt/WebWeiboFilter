/**
 * 个人主页取样探针（Console 粘贴即用）—— 个人页低调适配前置取证（2026-10-16）
 *
 * 背景（用户真机反馈）：个人页（博主主页）还是「原来的样式」——统计数 / 数据胶囊
 *   （昨日阅读数 / 互动数 / 视频累计播放量）/ 置顶角标仍是鲜橙。脚本在这页确实在跑
 *   （logo / 顶栏 / 卡片来源行都生效了），但：
 *   · 去橙红走 :root 变量覆盖（theme.js 26 个变量）——理论上全站生效；
 *   · 个人页组件还橙 ⇒ 要么用了**表外变量**，要么**写死颜色**（同发布按钮 svg 一族）。
 *
 * 本探针采：
 *   A. 页面身份：URL / pathname（确认个人页路由形态）+ 我方 style 注入是否在；
 *   B. 主题变量核验：:root 上我们覆盖的那批 --w-* 当前实际值（哑色是否生效）；
 *   C. 全页 vivid 扫描：**排除顶栏 bar 子树**（已处理），按「签名」分组去重输出——
 *      每组采颜色三通道 + background-image（二轮教训：涂料三族，颜色通道必漏）；
 *   D. 结构普查：个人页信息流是否还是 wbpro-scroller-item / article（决定卡片规则
 *      能否直接复用）；封面大图 / 头像 / 统计行 / 数据胶囊 / 页签条的落点链。
 *
 * 用法：个人主页 F12 → Console 粘贴全文 → probeProfile() → 整个输出回传。
 */
(function () {
  if (window.probeProfile) return;

  function rect(el) {
    try {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    } catch (_e) { return null; }
  }

  function visible(el) {
    try { return !!el.getClientRects().length; } catch (_e) { return false; }
  }

  function tagOf(el) {
    let s = (el.tagName || '').toLowerCase();
    if (el.id) s += '#' + el.id;
    s += '.' + (el.getAttribute('class') || '').trim().split(/\s+/).slice(0, 3).join('.');
    return s;
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
    for (let i = 0; i < n && cur && cur !== document.body; i++) {
      out.push({ el: tagOf(cur), stable: clsSig(cur), id: cur.id || undefined, rect: rect(cur) });
      cur = cur.parentElement;
    }
    return out;
  }

  /** HSL 饱和度 + 峰谷差判 vivid */
  function satOf(v) {
    const m = /rgba?\(([^)]+)\)/.exec(v || '');
    if (!m) return { raw: v || '', s: 0, vivid: false };
    const parts = m[1].split(',').map((x) => parseFloat(x));
    const r = parts[0], g = parts[1], b = parts[2];
    if ([r, g, b].some((x) => typeof x !== 'number' || isNaN(x))) return { raw: v, s: 0, vivid: false };
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 510;
    const s = mx === mn ? 0 : (mx - mn) / (255 * (1 - Math.abs(2 * l - 1)) || 1);
    return { raw: v, s: Math.round(s * 100), vivid: s > 0.25 && (mx - mn) > 30 };
  }

  function colorInfo(el) {
    let cs;
    try { cs = getComputedStyle(el); } catch (_e) { return null; }
    return {
      color: satOf(cs.color),
      bg: satOf(cs.backgroundColor),
      border: satOf(cs.borderTopColor),
      bgImage: cs.backgroundImage && cs.backgroundImage !== 'none'
        ? String(cs.backgroundImage).slice(0, 60) : undefined,
    };
  }

  function probeProfile() {
    const doc = document;
    const out = {
      href: location.href,
      pathname: location.pathname,
      innerWidth: window.innerWidth,
    };

    /* ── A. 我方注入核验 ── */
    out.injection = {
      styles: Array.prototype.map.call(
        doc.querySelectorAll('style[id^="spb"],style[data-spb]'),
        (s) => s.id || 'data-spb'
      ),
      marks: {
        topbar: doc.querySelectorAll('[data-spb-tb]').length,
        brand: doc.querySelectorAll('[data-spb="time"],[data-spb="avatarbg"]').length,
      },
    };

    /* ── B. 主题变量核验（我们覆盖的那批在 :root 的当前值）── */
    const VARS = ['--w-brand', '--w-brand-hover', '--w-alink', '--w-special',
      '--w-color-orange-1', '--w-badge-background', '--w-main', '--w-sub'];
    let rootCs;
    try { rootCs = getComputedStyle(doc.documentElement); } catch (_e) { rootCs = null; }
    out.themeVars = {};
    if (rootCs) {
      for (const v of VARS) out.themeVars[v] = rootCs.getPropertyValue(v).trim() || '(未定义)';
    }

    /* ── C. 全页 vivid 扫描（排除顶栏 bar 子树）── */
    // bar = logo 祖先里第一个 h∈[40,80] 且 w>600 的元素（probe-topbar 同判据）
    let bar = null;
    const logo = doc.querySelector('a[href="/"][aria-label]');
    if (logo) {
      let cur = logo;
      while (cur && cur !== doc.body) {
        const r = rect(cur);
        if (r && r.height >= 40 && r.height <= 80 && r.width >= 600) { bar = cur; break; }
        cur = cur.parentElement;
      }
    }
    const inBar = (el) => bar && bar.contains(el);

    const groups = Object.create(null);
    try {
      const all = doc.body.querySelectorAll('*');
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        if (inBar(el)) continue;
        const r = rect(el);
        if (!r || r.w === 0 || r.h === 0 || !visible(el)) continue;
        const c = colorInfo(el);
        if (!c) continue;
        const vivid = c.color.vivid || c.bg.vivid || c.border.vivid || !!c.bgImage;
        if (!vivid) continue;
        // 只采「叶子倾向」：子元素数 ≤3 的才收，避免每个容器都来一份
        if (el.children && el.children.length > 3) continue;
        // 签名 = tag + 第一个稳定类（没有稳定类就用哈希类首段）
        const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
        const stableCls = cls.find((x) => !/^(_|__)/.test(x) && !/[-_][0-9a-z]{4,6}[_][0-9a-z]/i.test(x));
        const sig = tagOf(el).split('.').slice(0, 2).join('.') + (stableCls ? '|' + stableCls : '|(哈希)');
        if (!groups[sig]) groups[sig] = { sig, count: 0, sample: null };
        groups[sig].count++;
        if (!groups[sig].sample) {
          groups[sig].sample = {
            el: tagOf(el), stable: clsSig(el), text: (el.textContent || '').trim().slice(0, 16),
            rect: r, colors: c, chain: chainOf(el, 5),
          };
        }
      }
    } catch (_e) { out.vividError = String(_e); }
    out.vividGroups = Object.keys(groups).map((k) => groups[k])
      .sort((a, b) => b.count - a.count).slice(0, 30);

    /* ── D. 结构普查：卡片体系 / 头部组件 ── */
    out.structure = {
      scrollerItems: doc.querySelectorAll('.wbpro-scroller-item').length,
      articles: doc.querySelectorAll('article').length,
      vueScroller: !!doc.querySelector('.vue-recycle-scroller'),
      feedContents: doc.querySelectorAll('.wbpro-feed-content').length,
    };
    // 头部组件：按文本反推落点链
    const probes = [
      ['statsRow', '转评赞'], ['pillBadge', '昨日阅读数'], ['pillBadge2', '视频累计播放量'],
      ['pinBadge', '置顶'], ['tabBar', '精选'], ['followBtn', '已关注'],
    ];
    out.headerParts = {};
    for (const [key, word] of probes) {
      let found = null;
      const w = doc.createTreeWalker(doc.body, 4);
      while (w.nextNode()) {
        const v = (w.currentNode.nodeValue || '').trim();
        if (v.indexOf(word) !== -1 && v.length <= 20) {
          const el = w.currentNode.parentElement;
          if (el && visible(el)) { found = el; break; }
        }
      }
      out.headerParts[key] = found
        ? { sample: tagOf(found), stable: clsSig(found), rect: rect(found), chain: chainOf(found, 6) }
        : '(未找到)';
    }
    // 封面大图：头部区域最大的 img / 背景图元素
    let cover = null;
    try {
      doc.querySelectorAll('img').forEach((img) => {
        const r = rect(img);
        if (r && r.w > 500 && r.h > 150 && (!cover || r.h > cover.rect.h)) {
          cover = { el: tagOf(img), stable: clsSig(img), rect: r, src: (img.getAttribute('src') || '').slice(0, 60) };
        }
      });
    } catch (_e) {}
    out.cover = cover || '(未找到 >500x150 的 img)';

    out.note = '判读：① themeVars 若已是 hsl(28,…) 哑色而 vividGroups 里还有橙 ⇒ 那些元素是写死色'
      + '或表外变量；② vividGroups 按签名去重，看 stable 里有没有库类可锚；'
      + '③ structure 决定卡片规则能否直接复用；④ headerParts = 头部各组件落点链。整个输出回传。';
    return out;
  }

  window.probeProfile = probeProfile;
})();
