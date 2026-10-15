// ============================================================================
// probe-black.js —— 黑图现场取证 + 现场 A/B（B16 黑图专项，2026-10-15 夜）
//
// 用法（F12 Console，全文粘贴一次即可，重复粘贴自动跳过）：
//   ① 黑图出现在屏幕上时：copy(JSON.stringify(await probeBlack(), null, 2))
//      —— 只采样「视口内」的图片（前两轮 suspects 全在视口外 = 白采）。
//      核心字段 decode：把 img 画到 canvas 读像素 ——
//        · decode.ok + lum 高   ⇒ 源图内容正常 ⇒ 黑在「绘制层」（我们的滤镜/布局）
//        · decode.ok + lum < 24 ⇒ 源图本身就是黑的（截图黑边 / 长图中段）
//        · decode.err           ⇒ 跨域污染读不了（http 图），看 isPlaceholder 判断
//      isPlaceholder=true（src 是 data: SVG 占位）⇒ 微博加载器拒绝换真图 =
//      深色主题下的「黑块」物证（此前 RmLtSBMVS 已见一例）。
//   ② 现场 A/B（不刷新！当前内容不变，对着同一张黑图逐项摘我们的样式）：
//        spbAB('filterOff')  摘 filter+opacity   ⇒ 黑图消失 = 我们的滤镜是凶手
//        spbAB('capOff')     摘 140px 压高       ⇒ 黑图消失 = 缩略化是凶手
//        spbAB('filterOn')   恢复（交给样式表接管）
//
// 依据（2026-10-15 三份物证）：
//   · __spb.recent()：7 张被过滤卡全部是广告（标签/埋点/关注按钮）⇒ 占位块正常工作；
//   · __spb.inspect()：黑图卡 Rm3Sbv3H1 判 keep、adScore 0 ⇒ 黑图 ≠ 过滤占位；
//   · probeComments v2：14 张可疑图全部加载成功且几何健康，但全在视口外。
//   · 头号嫌疑：L1 给信息流图片上的 filter:saturate(.4)+opacity:.85（与用户
//     A/B「l1:true 才有黑图」吻合；filter+合成层在 Chromium 有渲染成黑块的先例）。
// ============================================================================
(function () {
  'use strict';
  var W = window, D = document;
  if (W.__spbBlackInstalled) { console.log('[spb-black] already installed'); return; }
  W.__spbBlackInstalled = true;

  function $all(sel, root) { return Array.prototype.slice.call((root || D).querySelectorAll(sel)); }
  function vh() { return W.innerHeight; }

  // 把 img 解码位图画到 16x16 canvas 读平均亮度 —— 读的是「源图内容」，
  // 与页面怎么绘制无关 ⇒ 能分辨「源图黑」vs「绘制黑」。
  function decodeSample(img) {
    try {
      var c = D.createElement('canvas');
      c.width = 16; c.height = 16;
      var ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 16, 16);
      var d = ctx.getImageData(0, 0, 16, 16).data;
      var r = 0, g = 0, b = 0, n = d.length / 4;
      for (var i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
      return { ok: true, avg: [r, g, b], lum: Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b) };
    } catch (e) {
      return { ok: false, err: String(e).slice(0, 60) }; // 跨域污染（http 图无 CORS 头）
    }
  }

  W.probeBlack = async function () {
    var out = { script: 'specbase-black-probe-v1', ts: Date.now(), innerWidth: W.innerWidth, pics: [] };
    $all('.wbpro-scroller-item').forEach(function (card) {
      var view = card.closest('.vue-recycle-scroller__item-view');
      var recycled = !!view && /translateY\(-9999px/.test(view.getAttribute('style') || '');
      var marked = card.getAttribute('data-spb');
      var postId = null;
      var ta = card.querySelector('a[title^="20"]');
      if (ta) {
        var href = ta.getAttribute('href') || '';
        postId = href.split('?')[0].split('/').pop() || null; // /<uid>/<bid> 取最后段
      }
      $all('.woo-picture-img', card).forEach(function (img) {
        var r = img.getBoundingClientRect();
        if (!(r.top < vh() && r.bottom > 0 && r.width > 0)) return; // ⚠️ 只采视口内的
        var cs = W.getComputedStyle(img);
        var parent = img.parentElement; // woo-picture-main
        var pcs = parent ? W.getComputedStyle(parent) : null;
        var rec = {
          postId: postId, cardMarked: marked, recycled: recycled,
          src: String(img.currentSrc || img.src || '').slice(0, 90),
          isPlaceholder: /^data:/.test(img.currentSrc || img.src || ''),
          dataSrc: img.getAttribute('data-src'),
          natural: img.naturalWidth + 'x' + img.naturalHeight,
          rect: { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) },
          imgComputed: { filter: cs.filter, opacity: cs.opacity, disp: cs.display, vis: cs.visibility },
          containerBg: pcs ? pcs.backgroundColor : null,
          decode: decodeSample(img),
        };
        out.pics.push(rec);
      });
    });
    out.picCount = out.pics.length;
    out.blackCandidates = out.pics.filter(function (p) {
      return p.isPlaceholder || (p.decode && p.decode.ok && p.decode.lum < 24);
    });
    out.blackCount = out.blackCandidates.length;
    return out;
  };

  // 现场 A/B：inline !important 压过我们样式表的 !important（inline+important 优先级最高）
  W.spbAB = function (which) {
    var imgs = $all('.wbpro-feed-content .woo-picture-img, .retweet .woo-picture-img');
    if (which === 'filterOff') {
      imgs.forEach(function (i) {
        i.style.setProperty('filter', 'none', 'important');
        i.style.setProperty('opacity', '1', 'important');
      });
      return '已摘 filter+opacity（' + imgs.length + ' 张图）。盯着刚才那张黑图看：恢复彩色 = 我们的滤镜是凶手；依旧黑 = 不是。';
    }
    if (which === 'filterOn') {
      imgs.forEach(function (i) { i.style.removeProperty('filter'); i.style.removeProperty('opacity'); });
      return '已恢复（样式表接管）。';
    }
    if (which === 'capOff') {
      var mains = $all('.wbpro-feed-content .woo-picture-main, .retweet .woo-picture-main');
      mains.forEach(function (m) { m.style.setProperty('max-height', 'none', 'important'); });
      $all('.wbpro-feed-content .u-col-1, .retweet .u-col-1').forEach(function (u) {
        // 恢复微博自己的内联 height（我们样式表用 height:auto !important 压它）
        u.style.setProperty('height', u.style.height || 'auto', 'important');
      });
      return '已摘 140px 压高（' + mains.length + ' 容器）。黑图恢复原状 = 缩略化相关；依旧黑 = 与压高无关。';
    }
    return "用法：spbAB('filterOff') / spbAB('capOff') / spbAB('filterOn')";
  };

  // ── v2 追加：fetch-blob 解码 ──────────────────────────────────────────────
  // canvas 直读被 sinaimg 的无 CORS 头污染（SecurityError）；
  // 改为重新 fetch 源图 → blob: URL → 本地 img 不污染 → 解码读亮度。
  // 回答「源图文件本身解码出来是不是黑的」（与页面怎么绘制完全无关）。
  function lumOf(img) {
    var c = D.createElement('canvas');
    c.width = 16; c.height = 16;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 16, 16);
    var d = ctx.getImageData(0, 0, 16, 16).data;
    var r = 0, g = 0, b = 0, n = d.length / 4;
    for (var i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
    return { avg: [r, g, b], lum: Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b) };
  }

  async function fetchDecode(url) {
    try {
      var resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) return { http: resp.status, err: 'HTTP ' + resp.status };
      var blob = await resp.blob();
      var objURL = URL.createObjectURL(blob);
      var img = new Image();
      img.src = objURL;
      try { await img.decode(); } finally { /* revoke 延后 */ }
      var l = lumOf(img);
      var out = {
        bytes: blob.size, type: blob.type,
        natural: img.naturalWidth + 'x' + img.naturalHeight,
        avg: l.avg, lum: l.lum,
        verdict: l.lum < 24 ? '源图本身黑' : l.lum < 60 ? '源图偏暗' : '源图正常',
      };
      URL.revokeObjectURL(objURL);
      return out;
    } catch (e) {
      return { err: String(e).slice(0, 120) };
    }
  }

  // 单张：spbDecode("图片地址")；全量：spbDecodeAll() 重下并解码当前视口内所有信息流图
  W.spbDecode = function (url) {
    if (!url) return '用法：右键黑图 → 复制图片地址 → spbDecode("粘贴")';
    return fetchDecode(url);
  };

  W.spbDecodeAll = async function () {
    var out = { script: 'specbase-black-decode-v2', ts: Date.now(), items: [] };
    $all('.wbpro-feed-content .woo-picture-img, .retweet .woo-picture-img').forEach(function (img) {
      var r = img.getBoundingClientRect();
      if (!(r.top < vh() && r.bottom > 0 && r.width > 0)) return;
      var src = img.currentSrc || img.src || '';
      if (/^data:/.test(src)) { out.items.push({ isPlaceholder: true, rect: { w: Math.round(r.width), h: Math.round(r.height) } }); return; }
      var card = img.closest('.wbpro-scroller-item');
      var ta = card && card.querySelector('a[title^="20"]');
      out.items.push({
        postId: ta ? (ta.getAttribute('href') || '').split('?')[0].split('/').pop() : null,
        src: src.slice(0, 90),
        rect: { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) },
      });
    });
    for (var i = 0; i < out.items.length; i++) {
      var it = out.items[i];
      if (it.src) it.decode = await fetchDecode(it.src);
    }
    out.count = out.items.length;
    return out;
  };

  console.log('[spb-black] 就绪。黑图在屏上时：① spbAB("filterOff") 看 A/B；② copy(JSON.stringify(await probeBlack(), null, 2))');
  console.log('[spb-black] v2：copy(JSON.stringify(await spbDecodeAll(), null, 2)) 重下视口内全部图并解码读亮度（分辨「源图黑」vs「绘制黑」）；单张用 spbDecode("图片地址")');
})();
