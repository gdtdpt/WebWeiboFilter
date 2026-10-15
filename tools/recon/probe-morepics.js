/**
 * probe-morepics.js —— 「+N」截断格与超量图片数据可用性取样
 *
 * 背景（2026-10-15）：用户问「多于 9 张图的微博能否全部展示」。夹具里没有 >9 图的卡，
 * 「+N」格的 DOM 标记与剩余图片 URL 的存放位置（Vue props？$render_data？都没有？）
 * 均未采样 —— 本探针只侦察，不做任何修改。
 *
 * 用法：首页滚到一张「+N」卡可见的位置 → F12 Console 粘贴本文件全文 → probeMorePics()
 * → 整个输出回传。判定读数自检：没找到 +N 卡时明说，不给结论。
 */
function probeMorePics() {
  var clip = function (s, n) {
    s = (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
    n = n || 80;
    return s.length > n ? s.slice(0, n) + '…' : s;
  };

  // ── ① 样式体检（沿用 probeMedia3 的假故障防线）─────────────────────
  var styleEl = document.getElementById('spb-style');
  var styleCheck = {
    present: Boolean(styleEl),
    hasMediaRule: styleEl ? /max-height:\d+px !important/.test(styleEl.textContent) : false,
    hasCoverRule: styleEl ? styleEl.textContent.indexOf('object-fit:cover') !== -1 : false,
  };

  // ── ② 找卡 + 找「+N」格 ─────────────────────────────────────────
  // 「+N」格的类名未知（夹具没有 >9 图卡），只能靠**文案**判定：格子里出现 /+\d+/
  var cards = document.querySelectorAll('.vue-recycle-scroller__item-wrapper > .vue-recycle-scroller__item-view');
  if (!cards.length) cards = document.querySelectorAll('.wbpro-scroller-item');

  var found = []; // 每张 >9 图卡一份档案
  var scanned = 0;

  for (var i = 0; i < cards.length; i++) {
    var slot = cards[i];
    var card = slot.querySelector('.wbpro-scroller-item') || slot;
    // 异常态闸（§12-B10：矩形全零 = 某祖先 display:none，读数无效）
    var b = card.getBoundingClientRect();
    if (b.h === 0 && b.top === 0) continue;
    scanned++;

    var postId = null, m, as = card.querySelectorAll('a[href]');
    for (var k = 0; k < as.length && !postId; k++) {
      m = /weibo\.com\/\d+\/([A-Za-z0-9]+)/.exec(as[k].getAttribute('href') || '');
      if (m) postId = m[1];
    }

    var scopes = card.querySelectorAll('.wbpro-feed-content, .retweet');
    for (var s2 = 0; s2 < scopes.length; s2++) {
      var rows = scopes[s2].querySelectorAll('[class*="u-col-"]');
      for (var r2 = 0; r2 < rows.length; r2++) {
        var row = rows[r2];
        var cells = row.children;
        var plusCell = null, plusText = null, imgCount = 0, cellDescs = [];
        for (var c2 = 0; c2 < cells.length; c2++) {
          var cell = cells[c2];
          var txt = clip(cell.textContent, 20);
          var imgs = cell.querySelectorAll('img').length;
          imgCount += imgs;
          cellDescs.push({ txt: txt, imgs: imgs });
          if (!plusCell && /^\+\d+$/.test(txt)) { plusCell = cell; plusText = txt; }
        }
        if (!plusCell) continue;

        // ── ③ Vue 状态挖掘：剩余图片 URL 在不在组件数据里 ─────────────
        // 路径 A：Vue3 的 __vueParentComponent（props / setupState）
        // 路径 B：Vue2 的 __vue__（$props）
        // 一律只摘「像图片列表」的键（/pic|image|media|photo/i），URL 截断防刷屏。
        var PIC_KEY = /pic|image|media|photo/i;
        var dig = function (root) {
          var out = [];
          var seen = 0;
          var visit = function (el) {
            if (!el || seen > 40) return;
            seen++;
            var v3 = el.__vueParentComponent;
            var v2 = el.__vue__;
            if (v3) {
              var buckets = [['props', v3.props], ['setupState', v3.setupState], ['ctx', v3.ctx]];
              for (var bi = 0; bi < buckets.length; bi++) {
                var obj = buckets[bi][1];
                if (!obj || typeof obj !== 'object') continue;
                var keys;
                try { keys = Object.keys(obj); } catch (_e) { continue; }
                for (var ki = 0; ki < keys.length; ki++) {
                  var key = keys[ki];
                  if (!PIC_KEY.test(key)) continue;
                  var val;
                  try { val = obj[key]; } catch (_e2) { continue; }
                  if (Array.isArray(val) && val.length) {
                    var sample = null;
                    try {
                      var first = val[0];
                      sample = typeof first === 'string' ? clip(first, 100)
                        : first && typeof first === 'object'
                          ? clip(JSON.stringify(pickUrls(first)), 200) : clip(String(first), 60);
                    } catch (_e3) { /* 序列化失败就跳过 */ }
                    out.push({ via: 'v3.' + buckets[bi][0], key: key, len: val.length, sample: sample });
                  } else if (val && typeof val === 'object') {
                    var inner = pickUrls(val);
                    if (inner) out.push({ via: 'v3.' + buckets[bi][0], key: key, len: null, sample: clip(JSON.stringify(inner), 200) });
                  }
                }
              }
            }
            if (v2 && v2.$props) {
              var keys2;
              try { keys2 = Object.keys(v2.$props); } catch (_e4) { keys2 = []; }
              for (var k2 = 0; k2 < keys2.length; k2++) {
                if (!PIC_KEY.test(keys2[k2])) continue;
                var v;
                try { v = v2.$props[keys2[k2]]; } catch (_e5) { continue; }
                out.push({
                  via: 'v2.$props', key: keys2[k2],
                  len: Array.isArray(v) ? v.length : null,
                  sample: v ? clip(typeof v === 'string' ? v : JSON.stringify(pickUrls(Array.isArray(v) ? v[0] : v)), 200) : null,
                });
              }
            }
            visit(el.parentElement);
          };
          visit(root);
          return out;
        };
        // 从「+N」格往上挖到卡顶为止
        var vueHits = dig(plusCell);

        // 路径 C：window.$render_data（微博服务端渲染数据，可能含完整 pics）
        var renderDataHit = null;
        try {
          if (window.$render_data) renderDataHit = clip(JSON.stringify(Object.keys(window.$render_data)), 120);
        } catch (_e6) { /* 循环引用防御 */ }

        found.push({
          postId: postId,
          scope: scopes[s2].getAttribute('class').indexOf('retweet') !== -1 ? 'retweet' : 'feed-content',
          rowDesc: clip(row.getAttribute('class'), 80),
          rowInline: clip(row.getAttribute('style'), 100),
          rowRectW: +row.getBoundingClientRect().width.toFixed(1),
          cellCount: cells.length,
          imgCount: imgCount,
          plusText: plusText,
          cells: cellDescs,
          plusCellDesc: clip(plusCell.getAttribute('class'), 120),
          plusCellHtml: clip(plusCell.innerHTML, 300),
          vueHits: vueHits,
          renderDataKeys: renderDataHit,
        });
      }
    }
  }

  // ── ④ 判词 ────────────────────────────────────────────────────
  var verdict;
  if (!styleCheck.present) {
    verdict = '⛔ 页面上没有 #spb-style —— 脚本没在跑（重装后要刷新）';
  } else if (!scanned) {
    verdict = '⛔ 没扫到有效卡（全零矩形被跳过）—— 刷新后重跑';
  } else if (!found.length) {
    verdict = '⚠️ 当前页没有「+N」卡 —— 滚到超 9 图的微博再跑（判据 = 格子文案 /+\\d+/）';
  } else if (found.every(function (f) { return !f.vueHits.length; })) {
    verdict = '🔴 找到 +N 卡但 Vue 数据里没挖到图片列表 —— 剩余图片可能只在详情/查看器侧，'
      + '回传输出看 plusCellHtml 与 cells，再定「全部展示」是否可行';
  } else {
    verdict = '✅ 找到 +N 卡且 Vue 数据里有疑似图片列表 —— 「全部展示」有数据基础；'
      + '回传输出，重点看 vueHits 的 len（应 ≈ +N 数字 + 已展示数）与 sample URL 形态';
  }

  return {
    verdict: verdict,
    styleCheck: styleCheck,
    scanned: scanned,
    found: found,
    note: 'vueHits.len 若等于 9+8=17 ⇒ 完整列表就在组件 props 里，可考虑注入补格；'
      + '若只有 9 ⇒ 剩余图仅在查看器侧，feed 内全部展示需另取数据（成本陡增）。'
      + 'plusCellDesc/plusCellHtml 是「+N」格的 DOM 指纹（夹具缺失，靠这个补采样）',
  };
}

/** 从对象里挑出像 URL 的字段（探针内部工具，防 JSON 爆炸） */
function pickUrls(obj) {
  if (!obj || typeof obj !== 'object') return null;
  var out = {};
  var n = 0;
  for (var k in obj) {
    if (n > 6) break;
    var v = obj[k];
    if (typeof v === 'string' && /https?:\/\//.test(v)) { out[k] = v.slice(0, 100); n++; }
    else if (v && typeof v === 'object' && n <= 6) {
      var inner = pickUrls(v);
      if (inner) { out[k] = inner; n++; }
    }
  }
  return n ? out : null;
}

try { window.probeMorePics = probeMorePics; } catch (_e) { /* 控制台总有 window */ }

/**
 * v2：内容级深搜（v1 键名过滤扑空后的修正路线，2026-10-15）
 *
 * v1 只摘键名匹配 /pic|image|media|photo/i 的字段 —— 若图片列表藏在名为
 * `mblog` / `item` 之类 prop 的**深一层**（如 item.pic_infos），会被整体漏掉。
 * v2 改按**内容**找：从「+N」格向上遍历所有 Vue 实例（v3 __vueParentComponent /
 * v2 __vue__），在 props / setupState / ctx 里递归（≤4 层、环防御、节点上限），
 * 收集「元素含 sinaimg.cn URL 的数组」，报告**完整路径** + 长度 + 首个 URL。
 * 另对每个实例附一份顶层键清单（名:类型），键名对不上时人眼也能看出该去哪挖。
 *
 * 用法同 v1：粘全文 → probeMorePics2() → 整个输出回传。
 */
function probeMorePics2() {
  var styleEl = document.getElementById('spb-style');
  var styleCheck = { present: Boolean(styleEl),
    hasMediaRule: styleEl ? /max-height:\d+px !important/.test(styleEl.textContent) : false,
    hasCoverRule: styleEl ? styleEl.textContent.indexOf('object-fit:cover') !== -1 : false };
  if (!styleCheck.present) return { verdict: '⛔ 没有 #spb-style —— 脚本没在跑', styleCheck: styleCheck };

  var cards = document.querySelectorAll('.vue-recycle-scroller__item-wrapper > .vue-recycle-scroller__item-view');
  if (!cards.length) cards = document.querySelectorAll('.wbpro-scroller-item');

  var SINA = /sinaimg\.cn/;
  var found = [];
  var scanned = 0;

  // 内容级深搜：找「含 sinaimg URL 的数组」，返回 [{path, len, firstUrl}]
  function findSinaimgArrays(root, label) {
    var hits = [];
    var nodeBudget = 3000;
    var seen = [];
    function isSeen(o) { for (var i = 0; i < seen.length; i++) if (seen[i] === o) return true; return false; }
    function walk(o, path, depth) {
      if (!o || typeof o !== 'object' || depth > 4 || nodeBudget-- < 0) return;
      if (isSeen(o)) return;
      seen.push(o);
      if (Array.isArray(o)) {
        // 数组本身像图片列表？抽查首元素
        if (o.length && (typeof o[0] === 'string' && SINA.test(o[0]))) {
          hits.push({ path: path + ' (字符串数组)', len: o.length, firstUrl: o[0].slice(0, 110) });
        } else if (o.length && o[0] && typeof o[0] === 'object' && JSON.stringify(o[0]).search(SINA) >= 0) {
          hits.push({ path: path, len: o.length, firstUrl: firstUrlIn(o[0]) });
        }
        for (var i = 0; i < Math.min(o.length, 3); i++) walk(o[i], path + '[' + i + ']', depth + 1);
        return;
      }
      var keys;
      try { keys = Object.keys(o); } catch (_e) { return; }
      for (var k2 = 0; k2 < keys.length; k2++) {
        var v;
        try { v = o[keys[k2]]; } catch (_e2) { continue; }
        walk(v, path + '.' + keys[k2], depth + 1);
      }
    }
    function firstUrlIn(o) {
      var s;
      try { s = JSON.stringify(o); } catch (_e) { return null; }
      var m = /https?:[^"]*sinaimg\.cn[^"]*/.exec(s);
      return m ? m[0].slice(0, 110) : null;
    }
    walk(root, label, 0);
    return hits;
  }

  // 顶层键清单（名:类型/长度），防再扑空
  function keyInventory(obj) {
    var out = [];
    var keys;
    try { keys = Object.keys(obj); } catch (_e) { return out; }
    for (var i = 0; i < keys.length && i < 40; i++) {
      var v = null;
      try { v = obj[keys[i]]; } catch (_e2) { continue; }
      var t = v === null ? 'null' : Array.isArray(v) ? 'array(' + v.length + ')'
        : typeof v === 'object' ? 'obj' : typeof v;
      out.push(keys[i] + ':' + t);
    }
    return out;
  }

  function visitVue(el, cardOut) {
    if (!el) return;
    var v3 = el.__vueParentComponent;
    var v2 = el.__vue__;
    if (v3) {
      var buckets = [['props', v3.props], ['setupState', v3.setupState], ['ctx', v3.ctx]];
      for (var bi = 0; bi < buckets.length; bi++) {
        var name = buckets[bi][0], obj = buckets[bi][1];
        if (!obj || typeof obj !== 'object') continue;
        var hits = findSinaimgArrays(obj, name);
        if (hits.length) cardOut.vueHits.push.apply(cardOut.vueHits,
          hits.map(function (h) { return { bucket: name, path: h.path, len: h.len, firstUrl: h.firstUrl }; }));
        if (name !== 'ctx') cardOut.keys.push(name + '={' + keyInventory(obj).join(', ') + '}');
      }
    }
    if (v2 && v2.$props) {
      var hits2 = findSinaimgArrays(v2.$props, 'v2.$props');
      if (hits2.length) cardOut.vueHits.push.apply(cardOut.vueHits,
        hits2.map(function (h) { return { bucket: 'v2.$props', path: h.path, len: h.len, firstUrl: h.firstUrl }; }));
    }
    visitVue(el.parentElement, cardOut);
  }

  for (var i = 0; i < cards.length; i++) {
    var card = cards[i].querySelector('.wbpro-scroller-item') || cards[i];
    var b = card.getBoundingClientRect();
    if (b.h === 0 && b.top === 0) continue;
    scanned++;
    var scopes = card.querySelectorAll('.wbpro-feed-content, .retweet');
    for (var s2 = 0; s2 < scopes.length; s2++) {
      var rows = scopes[s2].querySelectorAll('[class*="u-col-"]');
      for (var r2 = 0; r2 < rows.length; r2++) {
        var cells = rows[r2].children;
        var plusCell = null, plusText = null;
        for (var c2 = 0; c2 < cells.length; c2++) {
          var t = (cells[c2].textContent || '').trim();
          if (!plusCell && /^\+\d+$/.test(t)) { plusCell = cells[c2]; plusText = t; }
        }
        if (!plusCell) continue;
        var postId = null, mm, as = card.querySelectorAll('a[href]');
        for (var k = 0; k < as.length && !postId; k++) {
          mm = /weibo\.com\/\d+\/([A-Za-z0-9]+)/.exec(as[k].getAttribute('href') || '');
          if (mm) postId = mm[1];
        }
        var cardOut = { postId: postId, plusText: plusText, vueHits: [], keys: [] };
        visitVue(plusCell, cardOut);
        found.push(cardOut);
      }
    }
  }

  var verdict;
  if (!found.length) verdict = '⚠️ 当前页没有「+N」卡 —— 滚到超 9 图的微博再跑';
  else if (found.every(function (f) { return !f.vueHits.length; }))
    verdict = '🔴 内容级深搜仍无 sinaimg 数组 —— 看 keys 清单确认实例上到底有什么；'
      + '若 props 里只有 id/文本类字段，剩余图大概率要靠详情 API（接着跑 probeDetailApi）';
  else verdict = '✅ 挖到含 sinaimg 的数组 —— 看 bucket/path/len：len ≥ 9+加号数 ⇒ 完整列表在页面数据里，注入补格有数据基础';

  return { verdict: verdict, styleCheck: styleCheck, scanned: scanned, found: found };
}

/**
 * probeDetailApi(bid) —— 详情 API 实验（**显式调用**，一次一张卡，只读 GET）
 *
 * 若页面数据里真没有完整列表，兜底路线 = 拉详情接口。微博网页版自己就用
 * `/ajax/statuses/show?id=<bid>` 取整条微博（含全部图片），同源 + 带凭证。
 * bid = 时间链接里的那串（probeMorePics2 输出的 postId，如 'Rmzv6gdtJ'）。
 * 用法：probeDetailApi('Rmzv6gdtJ').then(r => console.log(r)) → 输出回传。
 * ⚠️ 只做一次性的手动采样，不要循环调用（频控风险）。
 */
function probeDetailApi(bid) {
  return fetch('/ajax/statuses/show?id=' + encodeURIComponent(bid), { credentials: 'include' })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var hits = [];
      var nodeBudget = 5000;
      var seen = [];
      function isSeen(o) { for (var i = 0; i < seen.length; i++) if (seen[i] === o) return true; return false; }
      function firstUrlIn(o) {
        var s; try { s = JSON.stringify(o); } catch (_e) { return null; }
        var m = /https?:[^"]*sinaimg\.cn[^"]*/.exec(s);
        return m ? m[0].slice(0, 110) : null;
      }
      function walk(o, path, depth) {
        if (!o || typeof o !== 'object' || depth > 3 || nodeBudget-- < 0) return;
        if (isSeen(o)) return;
        seen.push(o);
        if (Array.isArray(o)) {
          if (o.length > 3 && o[0] && typeof o[0] === 'object' && JSON.stringify(o[0]).search(/sinaimg\.cn/) >= 0)
            hits.push({ path: path, len: o.length, firstUrl: firstUrlIn(o[0]) });
          for (var i = 0; i < Math.min(o.length, 2); i++) walk(o[i], path + '[' + i + ']', depth + 1);
          return;
        }
        var keys;
        try { keys = Object.keys(o); } catch (_e) { return; }
        for (var k2 = 0; k2 < keys.length; k2++) {
          var v; try { v = o[keys[k2]]; } catch (_e2) { continue; }
          walk(v, path + '.' + keys[k2], depth + 1);
        }
      }
      walk(j, '$', 0);
      return {
        bid: bid,
        ok: Boolean(j && j.id_str || j && j.pic_num != null),
        topKeys: j && typeof j === 'object' ? Object.keys(j).slice(0, 50) : null,
        picNum: j ? j.pic_num : null,
        sinaimgArrays: hits,
      };
    })
    .catch(function (e) { return { bid: bid, error: String(e) }; });
}

try { window.probeMorePics2 = probeMorePics2; window.probeDetailApi = probeDetailApi; } catch (_e) { /* 控制台总有 window */ }
