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
