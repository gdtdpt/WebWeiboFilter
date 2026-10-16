/**
 * 应用层：>9 图微博的「+N」截断格 → 全量展示（2026-10-15 用户诉求，§12-B18）
 *
 * ── 需求从哪来 ──────────────────────────────────────────────────────
 * 微博对 >9 图的信息流卡只渲染 9 格，第 9 格叠暗罩 + 「+N」文案（probeMorePics 实测：
 * 第 9 格**本身就是真图**，`_focusImg_` img + 暗罩；「+8」= 总 17 张已展示 9 张）。
 * 用户要求 feed 内全部展示。
 *
 * ── 数据从哪来（两路取证定论）──────────────────────────────────────
 *   · 页面 Vue 数据：❌ 堵死 —— `__vueParentComponent` / `__vue__` 在生产构建上
 *     全部为空（probeMorePics2 全页 keys=[]，连实例都摸不到）。
 *   · 详情 API：✅ `/ajax/statuses/show?id=<bid>`（微博网页版自用的同源接口，带凭证）
 *     返回 `pic_num` / `pic_ids`(顺序数组) / `pic_infos`(pic_id → 尺寸对象映射)。
 *     缩略格用 `thumbnail`（wap180，64~78px 格足够），点开用 `large`（orj960）。
 *
 * ── 🔴 高度中性：本功能的生死线 ────────────────────────────────────
 * 注入补格会让卡变高，而下一张卡的位置来自虚拟列表**预计算 translateY 缓存**（§12-B2）
 * ⇒ 变高 = 与下一张卡重叠。所以反着做：**量出当前网格矩形的宽高，在同样大的盒子里
 * 排更密的网格**（17 张 → 5 列 × 4 行 78×67 小格），容器显式锁高 = 原网格高、
 * overflow:hidden ⇒ 卡高**一个像素都不变**，从根上绕开缓存冲突。
 *
 * ── 幂等与可逆 ──────────────────────────────────────────────────────
 *   · 注入容器带自有标记 `data-spb="moregrid"`；已注入 ⇒ 一轮一个字节不写；
 *   · Vue 滚动回收重渲染会清掉注入 ⇒ 下一轮扫描重贴（图片走 fetch 缓存，不重发请求）；
 *   · 关档（L1/L2 关或 appearance.morePics=false）逐卡还原（原格 display:none 摘除）；
 *   · 停管线 removeMoreGrids() 整页摘除。
 *
 * ⚠️ v1 范围：只处理**卡自身**（.wbpro-feed-content）的纯图片网格（恰 9 格 + 末格
 * 「+N」文案 + woo-picture）；转发块里的 +N 网格**刻意不做** —— 转发原文的 bid 与
 * 卡 id 不同，取数 id 没核实过，宁可不动。
 */

import { readCardId } from '../adapters/weibo-home.js';

/** 注入容器的 `data-spb` 取值（与 hidden / ad / stats 并列，互不干扰） */
export const MOREGRID_MARK = 'moregrid';

/** 注入容器 / 格子的选择器（诊断与测试共用） */
export const MOREGRID_SEL = [`[data-spb="${MOREGRID_MARK}"]`];

/** 详情接口（同源相对路径 —— 脚本只在 weibo.com 域上跑） */
export const DETAIL_URL = '/ajax/statuses/show?id=';

/** 成功结果缓存上限（条）；超出丢最早的一条。只放内存、刷新即清（§9 纪律） */
const CACHE_MAX = 60;

/** 取数失败后的冷却时间（ms）—— 防频控：失败不重试到冷却结束 */
export const FAIL_COOLDOWN_MS = 60_000;

/** 格子间距（px）—— 与微博原生格子 padding 的视觉间距一致 */
const GAP = 4;

// ============================================================ 纯函数（Node 可测）

/**
 * 网格布局求解（**纯函数**，高度中性的核心）。
 *
 * 在 `rowW × rowH` 的盒子里放 `total` 个格子：枚举列数 2..12，
 * 每列数行数 = ceil(total/cols)，格子尺寸 = 盒子均分减去间距；
 * 打分 = |log(宽/高)|（越方越好），取最优。
 *
 * @param {number} total 总图片数（≥ 10 才值得调）
 * @param {number} rowW 原网格宽（px，来自 getBoundingClientRect）
 * @param {number} rowH 原网格高（px）
 * @param {number} [gap=4] 格间距
 * @returns {?{cols:number, rows:number, cellW:number, cellH:number}}
 *   `null` = 放不下（盒子太小 / 格子会小于 24px）⇒ 调用方放弃注入
 */
export function morePicsLayout(total, rowW, rowH, gap) {
  const g = gap == null ? GAP : gap;
  if (!(total > 0 && rowW > 0 && rowH > 0)) return null;
  let best = null;
  for (let cols = 2; cols <= 12; cols++) {
    const rows = Math.ceil(total / cols);
    // 格子占位 = 尺寸 + 间距（首格/首行的间距被容器余量吃掉，故 +g 再均分）
    const cellW = Math.floor((rowW + g) / cols) - g;
    const cellH = Math.floor((rowH + g) / rows) - g;
    if (cellW < 24 || cellH < 24) continue;
    const score = Math.abs(Math.log(cellW / cellH));
    if (!best || score < best._score) best = { cols, rows, cellW, cellH, _score: score };
  }
  if (!best) return null;
  return { cols: best.cols, rows: best.rows, cellW: best.cellW, cellH: best.cellH };
}

/**
 * 从详情接口响应里抽出**按展示顺序**的图片列表（**纯函数**）。
 *
 * `pic_ids` 是顺序数组（字符串 id，不带域名）；`pic_infos` 是 id → 尺寸对象映射
 * （thumbnail/bmiddle/large/original/largest/mw2000…，各含 url/width/height）。
 * 两者对不齐（缺条目 / 无 URL）⇒ 丢那条；整体不可用 ⇒ null。
 *
 * @param {Object} json `/ajax/statuses/show` 的响应
 * @returns {?Array<{id:string, thumb:string, view:string}>}
 */
export function parsePicInfos(json) {
  if (!json || !Array.isArray(json.pic_ids) || !json.pic_infos || typeof json.pic_infos !== 'object') return null;
  const out = [];
  for (let i = 0; i < json.pic_ids.length; i++) {
    const pid = json.pic_ids[i];
    const e = json.pic_infos[pid];
    if (!e || typeof e !== 'object') continue;
    const thumb = e.thumbnail && e.thumbnail.url;
    if (!thumb) continue;
    const big = e.largest || e.original || e.large || e.bmiddle;
    out.push({ id: pid, thumb, view: (big && big.url) || thumb });
  }
  return out.length ? out : null;
}

// ============================================================ 取数（缓存 / 在途去重 / 失败冷却）

const cache = new Map();     // bid → pics[]
const inflight = new Map();  // bid → Promise
const failedAt = new Map();  // bid → 时间戳

function defaultFetcher(url) {
  if (typeof fetch !== 'function') return Promise.reject(new Error('fetch unavailable'));
  return fetch(url, { credentials: 'include' });
}

/** 首个 key（缓存淘汰用；Map 保持插入序） */
function firstKey(m) { return m.keys().next().value; }

/** 清空取数缓存（测试用；生产不调 —— 会话内缓存正是设计行为） */
export function resetMorePicsCache() {
  cache.clear(); inflight.clear(); failedAt.clear();
}

/** 取数管道的当前状态（诊断把手 `__spb.morePicsDebug()` 用；只读） */
export function morePicsDebug() {
  const now = Date.now();
  return {
    cached: [...cache.keys()],
    inflight: [...inflight.keys()],
    cooling: [...failedAt.entries()]
      .filter(([, t]) => now - t < FAIL_COOLDOWN_MS)
      .map(([bid, t]) => ({ bid, retryInMs: FAIL_COOLDOWN_MS - (now - t) })),
    cacheMax: CACHE_MAX,
    fetchAvailable: typeof fetch === 'function',
  };
}

/**
 * 取一张微博的全量图片列表（带缓存 / 在途去重 / 失败冷却）。
 * 永不 reject（失败返回 null）⇒ 调用方不需要 catch。
 *
 * @param {string} bid 帖子 id（时间链接里的那串）
 * @param {Function} [fetcher] 可注入的取数函数（测试用），默认全局 fetch
 * @returns {Promise<Array<{id,thumb,view}>|null>}
 */
export function getMorePics(bid, fetcher) {
  if (!bid) return Promise.resolve(null);
  const hit = cache.get(bid);
  if (hit) return Promise.resolve(hit);
  const inf = inflight.get(bid);
  if (inf) return inf;
  const fail = failedAt.get(bid);
  if (fail && Date.now() - fail < FAIL_COOLDOWN_MS) return Promise.resolve(null);

  const p = (fetcher || defaultFetcher)(DETAIL_URL + encodeURIComponent(bid))
    .then((r) => {
      // 取数失败的可见出口：无声失败会让「功能没生效」变成悬案（2026-10-16 真机教训）
      if (!r || !r.ok) console.warn('[spb] morePics: 详情接口响应异常', bid, r && r.status);
      return r && typeof r.json === 'function' ? r.json() : null;
    })
    .then((j) => {
      const pics = parsePicInfos(j);
      if (pics) {
        cache.set(bid, pics);
        if (cache.size > CACHE_MAX) cache.delete(firstKey(cache));
      } else {
        failedAt.set(bid, Date.now());
        console.warn('[spb] morePics: 详情响应解析不出图片列表', bid,
          j && typeof j === 'object' ? Object.keys(j).slice(0, 12) : j);
      }
      return pics || null;
    })
    .catch((e) => {
      failedAt.set(bid, Date.now());
      console.warn('[spb] morePics: 取数失败（60s 冷却后重试）', bid, String(e));
      return null;
    });
  inflight.set(bid, p);
  const done = () => inflight.delete(bid);
  p.then(done, done);
  return p;
}

// ============================================================ DOM（探查 / 注入 / 摘除）

/**
 * 找卡内的「+N」截断网格（v1 只看卡自身 `.wbpro-feed-content`，见文件头范围说明）。
 *
 * 判据（probeMorePics v1 真机指纹）：
 *   · 行容器 `[class*="u-col-"]`（`u-col-*` 是库类名前缀，抗改版）；
 *   · 恰好 9 格；末格文案 = `+数字`；末格内有 `woo-picture`（防把别的「+N」文本误当截断格）。
 *
 * @param {Element} card `.wbpro-scroller-item`
 * @returns {Array<{row:Element, cells:Array<Element>, extra:number}>}
 */
export function findMoreGrids(card) {
  const out = [];
  if (!card || !card.querySelector) return out;
  const scope = card.querySelector('.wbpro-feed-content');
  if (!scope || !scope.querySelectorAll) return out;
  const rows = scope.querySelectorAll('[class*="u-col-"]');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // 统计原格时**排除我方注入容器**（关档路径也要能找到网格：注入后行里是 9 格 + 1 容器）
    const cells = [];
    for (let c = 0; c < row.children.length; c++) {
      const ch = row.children[c];
      const attr = ch.getAttribute && ch.getAttribute('data-spb');
      if (attr === MOREGRID_MARK) continue;
      cells.push(ch);
    }
    if (cells.length !== 9) continue;
    const last = cells[cells.length - 1];
    const t = (typeof last.textContent === 'string' ? last.textContent : '').trim();
    const m = /^\+(\d+)$/.exec(t);
    if (!m) continue;
    if (!last.querySelector('[class*="woo-picture"]')) continue;
    out.push({ row, cells, extra: parseInt(m[1], 10) });
  }
  return out;
}

/** 行内是否已有我方注入容器 */
function injected(row) {
  return !!(row && row.querySelector && row.querySelector(MOREGRID_SEL[0]));
}

/** 给元素的内联 style 追加 / 摘除 `display:none`（保留原有内联声明） */
function hideEl(el) {
  const s = (el.getAttribute && el.getAttribute('style')) || '';
  if (/display\s*:\s*none/i.test(s)) return;
  el.setAttribute('style', s ? s.replace(/;\s*$/, '') + ';display:none' : 'display:none');
}

function unhideEl(el) {
  const s = (el.getAttribute && el.getAttribute('style')) || '';
  if (!/display\s*:\s*none/i.test(s)) return;
  el.setAttribute('style', s.replace(/(?:^|;)\s*display\s*:\s*none\s*;?/i, ';').replace(/^;+|;+$/g, ''));
}

/**
 * 把全量图片渲染进一个已确认的「+N」行（异步回调里的落点）。
 * 全程**重新校验**：行还在文档里、没人抢先注入过、盒子还量得出 —— 任何一条不满足就放弃
 * （槽位回收 / Vue 重渲染随时可能发生，宁可这轮不做，下一轮扫描会再来）。
 *
 * @returns {boolean} 是否真的注入了
 */
function renderInto(row, pics, measure) {
  // isConnected 只在「明确为 false」（浏览器里已摘出文档）时拦；undefined（部分 DOM
  // 实现 —— 如测试的 linkedom —— 不提供该属性）不拦，否则永远注不进去。
  if (!row || row.isConnected === false || !row.appendChild) return false;
  if (injected(row)) return false;
  if (!pics || pics.length <= 9) return false; // ≤9 张微博本来就展示得下

  const r = measure(row);
  if (!(r && r.width > 100 && r.height > 40)) return false; // 矩形异常（§12-B10 纪律：异常态拒绝动作）
  const layout = morePicsLayout(pics.length, r.width, r.height);
  if (!layout) return false;

  const doc = row.ownerDocument;
  if (!doc || !doc.createElement) return false;

  const box = doc.createElement('div');
  box.setAttribute('data-spb', MOREGRID_MARK);
  // 🔴 高度中性：显式锁高 = 原网格高。格子的数学再怎么取整，卡高都不会变。
  box.setAttribute('style', 'height:' + Math.round(r.height) + 'px;overflow:hidden;'
    + 'font-size:0;line-height:0;');

  for (let i = 0; i < pics.length; i++) {
    const p = pics[i];
    const a = doc.createElement('a');
    a.setAttribute('href', p.view);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
    a.setAttribute('style', 'display:inline-block;vertical-align:top;width:' + layout.cellW
      + 'px;height:' + layout.cellH + 'px;margin:' + GAP + 'px 0 0 ' + GAP + 'px;overflow:hidden;');
    const img = doc.createElement('img');
    img.setAttribute('src', p.thumb);
    img.setAttribute('loading', 'lazy');
    img.setAttribute('alt', '');
    img.setAttribute('style', 'display:block;width:100%;height:100%;object-fit:cover;border:0;');
    a.appendChild(img);
    box.appendChild(a);
  }

  for (let i = 0; i < row.children.length; i++) hideEl(row.children[i]);
  row.appendChild(box);
  return true;
}

/**
 * 对一张卡做「+N 全展示」的幂等建立 / 摘除（每轮扫描调用，模式同 summary.js）。
 *
 * 异步说明：取数是 Promise ⇒ 注入发生在取数回调里（本轮扫描只负责「发起 + 摘除」）。
 * 回调里所有校验会重做；注入完成后 MutationObserver 会看到我们自己的插入并触发下一轮
 * 扫描 ⇒ 下一轮发现标记已存在，一个字节不写（不会成环）。
 *
 * @param {Element} card `.wbpro-scroller-item`
 * @param {boolean} on 档位（L1/L2 且 appearance.morePics）
 * @param {Object} [deps] 测试注入：{ fetcher, measure, visible }
 * @returns {{requested:number, injected:number, removed:number}}
 */
export function applyMorePics(card, on, deps) {
  const d = deps || {};
  const measure = d.measure || function (el) { return el.getBoundingClientRect(); };
  const visible = d.visible || function (el) {
    const r = el.getBoundingClientRect();
    const vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
    return r.height > 0 && r.bottom > -300 && r.top < vh + 300; // 视口 ±300px 外不取数（回收位槽位防误发请求）
  };
  const out = { requested: 0, injected: 0, removed: 0 };
  if (!card || !card.querySelector) return out;

  const grids = findMoreGrids(card);
  if (!grids.length) return out;

  for (let i = 0; i < grids.length; i++) {
    const g = grids[i];
    if (!on) {
      // 关档 ⇒ 还原：原格摘掉 display:none、容器移除
      if (injected(g.row)) {
        const box = g.row.querySelector(MOREGRID_SEL[0]);
        for (let c = 0; c < g.row.children.length; c++) {
          if (g.row.children[c] !== box) unhideEl(g.row.children[c]);
        }
        if (box && box.parentNode) box.parentNode.removeChild(box);
        out.removed++;
      }
      continue;
    }
    if (injected(g.row)) continue; // 幂等：已注入（本轮零写入）

    // 视口外的卡不取数（虚拟列表回收位上的槽位带完整卡，不拦会把缓存打爆）
    if (!visible(card)) continue;

    const bid = readCardId(card);
    if (!bid) continue;
    const extra = g.extra;
    if (!(extra > 0)) continue;
    out.requested++;
    getMorePics(bid, d.fetcher).then((pics) => {
      if (renderInto(g.row, pics, measure)) out.injected++;
    }).catch(() => { /* getMorePics 永不 reject，这里只是双保险 */ });
  }
  return out;
}

/** 整页摘除注入（停管线用）：原格还原 + 容器移除。返回摘除数。 */
export function removeMoreGrids(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || !d.querySelectorAll) return 0;
  let n = 0;
  const boxes = d.querySelectorAll(MOREGRID_SEL[0]);
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    const row = box.parentNode;
    if (row) {
      for (let c = 0; c < row.children.length; c++) {
        if (row.children[c] !== box) unhideEl(row.children[c]);
      }
      row.removeChild(box);
    }
    n++;
  }
  return n;
}

/** 当前页面的注入数（诊断用） */
export function countMoreGrids(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || !d.querySelectorAll) return 0;
  return d.querySelectorAll(MOREGRID_SEL[0]).length;
}
