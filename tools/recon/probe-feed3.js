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
      var rec = {
        postId: postId,
        natural: g.naturalWidth + 'x' + g.naturalHeight,
        complete: g.complete,
        rect: { w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
        inline: clip(g.getAttribute('style') || '', 100),
        cls: clip(clsOf(g), 60),
        src: clip((g.getAttribute('src') || '').split('/').pop(), 70),
      };
      rec.suspect = (!g.complete || g.naturalWidth === 0) && r.width > 0;
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

  // ── ③ 评论 toggle 测试（对第一张可见卡）────────────────────────
  // 面板出现判据：卡内出现「发布你的评论 / 按热度 / 按时间」等评论区特征文本。
  var toggle = { clicked: 0, errors: [] };
  function panelOpen(c) {
    try { return /发布你的评论|按热度|按时间/.test(c.textContent || ''); } catch (_e) { return false; }
  }
  try {
    var target = null;
    for (var ti = 0; ti < cards.length; ti++) {
      var b = cards[ti].getBoundingClientRect();
      if (b.h > 0 && b.top > 0 && b.top < window.innerHeight) { target = cards[ti]; break; }
    }
    if (!target) {
      toggle.errors.push('视口内没有可见卡 —— 滚回信息流顶部再跑');
    } else {
      var before = panelOpen(target);
      var btn = target.querySelector('article > footer .woo-font--comment');
      if (!btn) {
        toggle.errors.push('没找到评论按钮（article > footer .woo-font--comment）');
      } else {
        toggle.before = before;
        btn.click(); toggle.clicked++;
        await sleep(400);
        toggle.afterFirstClick = panelOpen(target);
        // 展开面板 class 链（摘要条避让规则要用）：找「发布你的评论」输入区向上 5 层
        if (toggle.afterFirstClick && !toggle.before) {
          var panel = null, divs = target.querySelectorAll('div, textarea');
          for (var pi = 0; pi < divs.length; pi++) {
            if (/发布你的评论/.test(divs[pi].getAttribute && (divs[pi].getAttribute('placeholder') || divs[pi].getAttribute('title') || ''))) { panel = divs[pi]; break; }
          }
          if (panel) {
            var pc = [], p = panel, pd = 0;
            while (p && p !== target && pd < 6) { pc.push(p.tagName.toLowerCase() + '|' + clsOf(p)); p = p.parentElement; pd++; }
            toggle.panelChain = pc;
          }
        }
        btn.click(); toggle.clicked++;
        await sleep(400);
        toggle.afterSecondClick = panelOpen(target);
        // 第二次后若还开着 → 再等一下（面板动画）并记录最终态
        await sleep(300);
        toggle.finalState = panelOpen(target);
      }
    }
  } catch (e) {
    toggle.errors.push(String(e && e.message || e));
  }
  out.toggle = toggle;

  // ── 判词 ─────────────────────────────────────────────────────
  var parts = [];
  parts.push('黑图可疑 ' + out.imgScan.suspect + '/' + out.imgScan.total);
  parts.push('右栏样本 ' + out.rail.length);
  if (toggle.errors.length) parts.push('toggle 未完成：' + toggle.errors[0]);
  else if (toggle.afterFirstClick && !toggle.afterSecondClick) parts.push('toggle=✅ 原生是开关（二click收起）');
  else if (toggle.afterFirstClick && toggle.afterSecondClick) parts.push('toggle=❌ 原生单向展开（二click无效）');
  else if (!toggle.afterFirstClick) parts.push('toggle=⚠️ 第一次点击没展开（看 toggle.errors）');
  out.verdict = parts.join('；') + ' —— copy(await probeFeed3()) 已进剪贴板，整个回传';
  return JSON.stringify(out, null, 1);
}

try { window.probeFeed3 = probeFeed3; } catch (_e) { /* 控制台总有 window */ }
