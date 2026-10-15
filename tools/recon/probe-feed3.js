/**
 * 现场探针：评论区 toggle + 右栏锚点 + 黑图扫描（2026-10-15，Console 用）
 *
 * ── 为什么有这个探针 ────────────────────────────────────────────────
 * 浏览器操控协议没有 JS 执行通道（只有点击 / 截图 / 无障碍 DOM），而这三件事
 * 都需要精确数据：
 *   ① **评论 toggle 测试**：摘要条转发点击的前提 —— 原生评论按钮第二次 click()
 *      是收起还是无动作？展开面板的 class 链是什么（摘要条避让要用）？
 *      （用户实验已证：第一次 click() 能原位展开、卡片合法增高、无洞。）
 *   ② **右栏锚点采样**：宽窗口下右栏（微博热搜 / 推荐关注 / 创作者中心）要隐藏，
 *      但外壳无语义锚点（B4），夹具是窄布局快照不含右栏 ⇒ 只能活页采样 class 链。
 *   ③ **黑图扫描**：用户反馈「有些图片调整后显示为纯黑（单图也有）」——
 *      逐 img 记录 natural 尺寸（0=没加载）/ rect / 内联样式 / src，
 *      一次性扫全页，不用先滚到黑图帖子。
 *
 * ── 用法 ──────────────────────────────────────────────────────────
 *   ① 微博首页信息流（登录态），F12 → Console 粘贴本文件全部内容
 *   ② 跑：`copy(await probeFeed3())`（copy 是 DevTools 内置，结果进剪贴板，直接粘贴回传）
 *      （老控制台不支持顶层 await 时：`probeFeed3().then(copy)`）
 *   ③ ⚠️ 探针会对**第一张可见卡**的程序化点击两次（评论按钮）—— 幂等无副作用，
 *      结束后该卡评论区可能处于展开态，属预期
 */

async function probeFeed3() {
  var clip = function (s, n) {
    s = (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
    n = n || 80;
    return s.length > n ? s.slice(0, n) + '…' : s;
  };
  var clsOf = function (e) {
    var c = e.getAttribute && e.getAttribute('class');
    return c ? clip(c, 140) : '';
  };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var wait = function (ms) { return sleep(ms).then(function () {}); };
  void wait;

  var out = { script: 'specbase-feed3-probe', ts: Date.now(), innerWidth: window.innerWidth || 0 };

  // ── ① 黑图 / 懒加载扫描 ────────────────────────────────────────
  // 可疑判定：naturalWidth===0（没加载）或 complete=false；
  // 「纯黑」若非未加载，则要看 src（占位图？）与内联样式——全量记录，回传后人工比对截图。
  var imgs = [];
  var cards = document.querySelectorAll('.wbpro-scroller-item');
  for (var ci = 0; ci < cards.length; ci++) {
    var card = cards[ci];
    var postId = null, mm, as = card.querySelectorAll('a[href]');
    for (var ai = 0; ai < as.length && !postId; ai++) {
      mm = /weibo\.com\/\d+\/([A-Za-z0-9]+)/.exec(as[ai].getAttribute('href') || '');
      if (mm) postId = mm[1];
    }
    var im = card.querySelectorAll('img');
    for (var ii = 0; ii < im.length; ii++) {
      var g = im[ii];
      if (g.closest('header')) continue;
      if (g.closest('[class*="wbpro-tag-img"]')) continue;
      var r = g.getBoundingClientRect();
      if (r.width && r.width <= 48) continue;         // 小图标
      var srcFull = g.getAttribute('src') || '';
      var rec = {
        postId: postId,
        natural: g.naturalWidth + 'x' + g.naturalHeight,
        complete: g.complete,
        rect: { w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
        inline: clip(g.getAttribute('style') || '', 100),
        cls: clip(clsOf(g), 60),
        src: clip(srcFull.split('/').pop(), 70),
      };
      // 🔴 占位图判定（2026-10-15 黑图线索）：src 是 data:URI（svg 占位）⇒ 懒加载没换真图
      //    ⇒ 深色主题下就是一块黑。转储全部属性（找真图 URL 藏在哪个 data-* 里）+ 父链。
      //    ⚠️ 占位图也计入 suspect —— 它 complete=true / natural>0，旧判定会漏（黑图首恶）。
      rec.placeholder = /^data:/.test(srcFull.trim());
      if (rec.placeholder) {
        rec.attrs = clip(g.outerHTML, 400);
      }
      // 父链两层（第二种图集变体 img.woo-picture-img 的容器是谁，决定我们的规则覆盖不覆盖）
      var p1 = g.parentElement, p2 = p1 && p1.parentElement;
      rec.parents = [
        p1 ? p1.tagName.toLowerCase() + '|' + clsOf(p1) : '',
        p2 ? p2.tagName.toLowerCase() + '|' + clsOf(p2) : '',
      ];
      rec.suspect = rec.placeholder
        || ((!g.complete || g.naturalWidth === 0) && r.width > 0);
      imgs.push(rec);
    }
  }
  out.imgScan = { total: imgs.length, suspect: imgs.filter(function (x) { return x.suspect; }).length, items: imgs };

  // ── ② 右栏锚点采样 ────────────────────────────────────────────
  // 找「微博热搜 / 推荐关注(感兴趣的人) / 创作者中心」文案的最小自含容器，
  // 输出向上 6 层 class 链 + outerHTML 头部 —— 隐藏规则的锚点依据。
  var rail = [];
  var kw = ['微博热搜', '推荐关注', '感兴趣的人', '创作者中心'];
  var all = document.querySelectorAll('div');
  for (var di = 0; di < all.length; di++) {
    var el = all[di];
    var own = '';
    for (var ni = 0; ni < el.childNodes.length; ni++) {
      if (el.childNodes[ni].nodeType === 3) own += el.childNodes[ni].textContent;
    }
    if (kw.indexOf(clip(own, 12)) === -1) continue;
    var chain = [], cur = el, d = 0;
    while (cur && d < 6) { chain.push(cur.tagName.toLowerCase() + '|' + clsOf(cur)); cur = cur.parentElement; d++; }
    rail.push({ keyword: clip(own, 12), chain: chain, html: clip(el.parentElement ? el.parentElement.outerHTML : el.outerHTML, 500) });
    if (rail.length >= 4) break;
  }
  out.rail = rail;

  // ── ③ 评论 toggle 测试（对视口中央的卡）────────────────────────
  // 🔴 展开判据（2026-10-15 三跑误报修正）：不要猜面板文案 —— 用**结构判据**：
  //    卡内出现 textarea / contenteditable（评论输入框）+ 卡高增长。旧版猜
  //    「发布你的评论/按热度」文案，猜错就是假阴性。
  //    ⚠️ 竞态：scrollIntoView 会触发虚拟列表换槽 ⇒ 点前**重选**离视口中心最近的卡。
  var toggle = { clicked: 0, errors: [] };
  function panelProbe(c) {
    var inputs = [];
    try { inputs = c.querySelectorAll('textarea, [contenteditable="true"]'); } catch (_e) { /* 忽略 */ }
    return {
      open: inputs.length > 0,
      h: +(c.getBoundingClientRect().height || 0).toFixed(1),
      inputTag: inputs.length ? inputs[0].tagName.toLowerCase() + '|' + clsOf(inputs[0]) : '',
    };
  }
  function pickCenterCard() {
    var best = null, bestDist = Infinity, mid = (window.innerHeight || 800) / 2;
    for (var pi = 0; pi < cards.length; pi++) {
      var rc = cards[pi].getBoundingClientRect();
      if (!(rc.height > 0)) continue;
      if ((cards[pi].getAttribute('style') || '').includes('-9999')) continue;
      var dist = Math.abs(rc.top + rc.height / 2 - mid);
      if (dist < bestDist) { bestDist = dist; best = cards[pi]; }
    }
    return best;
  }
  try {
    var target = pickCenterCard();
    if (!target) {
      toggle.errors.push('页面上没有非回收位卡 —— 回到信息流再跑');
    } else {
      target.scrollIntoView({ block: 'center' });
      await sleep(400);
      target = pickCenterCard() || target;   // 换槽后重选
      toggle.before = panelProbe(target);
      var btn = target.querySelector('article > footer .woo-font--comment');
      if (!btn) {
        toggle.errors.push('没找到评论按钮（article > footer .woo-font--comment）');
      } else {
        btn.click(); toggle.clicked++;
        await sleep(500);
        toggle.afterFirstClick = panelProbe(target);
        // 展开面板 class 链（摘要条避让规则要用）：输入框向上 5 层
        if (toggle.afterFirstClick.open && !toggle.before.open) {
          var input = target.querySelector('textarea, [contenteditable="true"]');
          if (input) {
            var pc = [], p = input, pd = 0;
            while (p && p !== target && pd < 6) { pc.push(p.tagName.toLowerCase() + '|' + clsOf(p)); p = p.parentElement; pd++; }
            toggle.panelChain = pc;
          }
        }
        btn.click(); toggle.clicked++;
        await sleep(500);
        toggle.afterSecondClick = panelProbe(target);
        await sleep(300);
        toggle.finalState = panelProbe(target);
      }
    }
  } catch (e) {
    toggle.errors.push(String(e && e.message || e));
  }
  out.toggle = toggle;

  // ── 判词 ─────────────────────────────────────────────────────
  var parts = [];
  parts.push('黑图/占位可疑 ' + out.imgScan.suspect + '/' + out.imgScan.total);
  parts.push('右栏样本 ' + out.rail.length);
  if (toggle.errors.length) parts.push('toggle 未完成：' + toggle.errors[0]);
  else if (toggle.afterFirstClick.open && !toggle.afterSecondClick.open) parts.push('toggle=✅ 原生是开关（二click收起）');
  else if (toggle.afterFirstClick.open && toggle.afterSecondClick.open) parts.push('toggle=❌ 原生单向展开（二click无效）');
  else parts.push('toggle=⚠️ 两次点击都没展开（结构判据 textarea/contenteditable 未出现；'
    + '卡高 before=' + toggle.before.h + ' → after1=' + toggle.afterFirstClick.h
    + ' → after2=' + toggle.afterSecondClick.h + '）');
  out.verdict = parts.join('；') + ' —— copy(await probeFeed3()) 已进剪贴板，整个回传';
  return JSON.stringify(out, null, 1);
}

try { window.probeFeed3 = probeFeed3; } catch (_e) { /* 控制台总有 window */ }
