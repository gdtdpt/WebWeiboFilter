/**
 * 调度层（PROJECT.md §6 第 ① 层）
 *
 * 职责：**观测变更、决定扫哪、何时扫。**
 * 纪律：**本模块是整个工程里唯一接触 `MutationObserver` 的地方。**
 *
 * ── 扫什么 ────────────────────────────────────────────────────────
 *   ① 信息流槽位（`.vue-recycle-scroller__item-wrapper` 的**直接子槽位**）→ 逐卡判定 → 打标记
 *   ② 页面级 banner（A 类，流外）→ 收掉
 *
 * ── 为什么每轮都要重新判定（不是只判一次）────────────────────────
 *   槽位会被回收复用（§5.2 第 ④ 条）⇒ DOM 属性不能当状态用。
 *   每轮扫描 = 对**当前**渲染出来的每个槽位重新判定 + **幂等**设置/清除标记。
 *   实测渲染中的槽位只有 6 个（`slotCount: 6`），所以每轮成本是常数级、不必按视口裁剪。
 *
 * ── 观测范围为什么不含 attributes ────────────────────────────────
 *   虚拟列表滚动时会疯狂写槽位的内联 `style.transform`。若 observe attributes：
 *     ① 会与微博互相触发；② 我们自己改属性也会自触发成死循环。
 *   ⇒ 只 observe `childList + subtree + characterData`，再加 scroll（capture）兜底。
 *
 * ── 去抖 ──────────────────────────────────────────────────────────
 *   trailing 120ms：连续事件只触发一次扫描；上限约 8 次/秒，对过滤而言完全无感。
 */

import {
  readCardSignals, findPageAdSlots, SEL_HOME_WRAP,
} from './adapters/weibo-home.js';
import { decide, ACTION } from './core/decision.js';
import { markSlot, markPageAd, clearAll, countMarks } from './apply/mark.js';
import { applyAbsoluteTimes, restoreTimes, countTimes } from './apply/time.js';

/** 一次扫描的间隔上限（trailing 去抖），毫秒 */
export const SCAN_DEBOUNCE_MS = 120;

/** 「最近命中」保留条数（§9：只放内存、刷新即清、不落盘） */
export const RECENT_MAX = 200;

/** 内容摘要长度（内存态展示用，不落盘） */
const PREVIEW_LEN = 60;

function isScrollerSlot(el) {
  if (!el || typeof el.getAttribute !== 'function') return false;
  const cls = el.getAttribute('class') || '';
  return cls.split(/\s+/).indexOf('vue-recycle-scroller__item-view') !== -1;
}

/** 取槽位里的卡片根 */
function cardOf(slot) {
  return slot.querySelector('.wbpro-scroller-item') || slot;
}

/**
 * A 类广告位要收掉的**容器** = 向上走到 `#homeWrap` 的直接子节点。
 * 只收图片那一层会留下外层 padding 造成的空白，收整块才干净。
 *
 * ⚠️ 安全网：若往上走会走到**发布器**（含 textarea / contenteditable），立刻退回，
 *    绝不为了收广告把发布器干掉。
 */
function pageAdContainer(doc, el) {
  const wrap = doc.querySelector(SEL_HOME_WRAP[0]);
  if (!wrap || !el || !el.parentElement) return el;

  let cur = el;
  while (cur && cur.parentElement && cur.parentElement !== wrap) cur = cur.parentElement;
  if (!cur || cur.parentElement !== wrap) return el;

  if (cur.querySelector && cur.querySelector('textarea, [contenteditable="true"]')) return el;
  return cur;
}

function preview(text) {
  const t = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  return t.length > PREVIEW_LEN ? t.slice(0, PREVIEW_LEN) + '…' : t;
}

/**
 * 建一个调度器。
 *
 * @param {Document} doc
 * @param {Object} config  完整配置（读 config.filter）
 * @param {Object} [options]
 *   @param {Function} [options.onScan]   每轮扫描后回调（诊断用）
 *   @param {Function} [options.log]
 * @returns {{start:Function, stop:Function, rescan:Function, isRunning:Function, stats:Function, recent:Function}}
 */
export function createScheduler(doc, config, options) {
  const opts = options || {};
  const log = typeof opts.log === 'function' ? opts.log : function () {};

  const recent = [];
  const stats = {
    scans: 0, slots: 0, hidden: 0, pageAds: 0, records: 0, times: 0, lastScanAt: 0,
  };

  let observer = null;
  let timer = null;
  let running = false;
  let markedPageAds = [];

  function record(sig, decision) {
    stats.records++;
    recent.push({
      at: Date.now(),
      id: sig && sig.id ? sig.id : null,
      author: (sig && sig.author) || '',
      action: decision.action,
      reasons: decision.reasons.slice(),
      preview: preview((sig && sig.text) || (sig && sig.repostText) || ''),
    });
    if (recent.length > RECENT_MAX) recent.splice(0, recent.length - RECENT_MAX);
  }

  /** ② A 类：页面级 banner —— 流式布局，收掉不留洞（与 B 类机制不同，见 §7.5.0） */
  function applyPageAds() {
    let found = [];
    try {
      found = findPageAdSlots(doc).filter((s) => !s.inFeed && s.el);
    } catch (e) {
      log('页面广告位扫描失败', e);
      found = [];
    }

    const next = [];
    for (const item of found) {
      const el = pageAdContainer(doc, item.el);
      if (!el || next.indexOf(el) !== -1) continue;
      next.push(el);
      markPageAd(el, true);
    }
    // 已经不存在的（如广告轮播换位 / 关闭按钮被点）→ 撤回标记
    for (const el of markedPageAds) {
      if (next.indexOf(el) === -1) markPageAd(el, false);
    }
    markedPageAds = next;
    stats.pageAds = next.length;
  }

  /**
   * 每个槽位**上一轮的动作** —— 只为了让「最近命中」不重复刷屏。
   * ⚠️ 它是**日志去重**用的，不是判定状态：判定每轮都重算，所以槽位被复用后
   *    动作一变就会重新记一条，绝不会因为「上一轮已经判过了」而漏判。
   */
  const prevAction = new WeakMap();

  /** 一轮完整扫描。**幂等** —— 重复调用结果一致。 */
  function scan() {
    stats.scans++;
    stats.lastScanAt = Date.now();

    // 外观档是否开启（§7.5.2：L2 蕴含 L1）—— 时间改绝对格式属 L1 的一条，
    // 档位关着时这一趟顺带把已改写的文本**还原**（切档需刷新，见 §7.4；这里是兜底）。
    const appearanceOn = !!(config && config.appearance && (config.appearance.l1 || config.appearance.l2));
    const now = new Date();
    let times = 0;

    const wrapper = doc.querySelector('.vue-recycle-scroller__item-wrapper');
    let slots = 0;
    let hidden = 0;

    if (wrapper && wrapper.children) {
      const kids = wrapper.children;
      for (let i = 0; i < kids.length; i++) {
        const slot = kids[i];
        // ⚠️ 不过滤「回收位」槽位（`translateY(-9999px); opacity: 0`）：
        //    实测夹具里回收位上的槽位**仍带着完整卡片**（1440：8 槽 / 8 卡，2 个在回收位），
        //    而侦察（§12-B1）的期望值正是按 `.wbpro-scroller-item` 的**总数**定的
        //    ⇒ 管线必须用同一套视野。多判一个不可见槽位无害（它进视口时会因内容变更 +
        //    scroll 被重新判定并纠正），漏判才致命。
        if (!isScrollerSlot(slot)) continue;

        const card = cardOf(slot);
        if (!card || !card.querySelector) continue;

        slots++;
        const sig = readCardSignals(card);
        const decision = decide(sig, config);

        // ① 幂等落标记（每一轮都重新判定，见文件头）
        markSlot(slot, decision.action === ACTION.HIDE);

        // ② 只在动作**发生变化**时记一条「最近命中」，避免每轮重复刷屏
        if (decision.action !== prevAction.get(slot)) {
          prevAction.set(slot, decision.action);
          if (decision.action !== ACTION.KEEP) record(sig, decision);
        }

        // ③ L1 的时间改写（与过滤无关；档位关着时还原）
        const t = applyAbsoluteTimes(card, now, appearanceOn);
        times += appearanceOn ? t.total : 0;

        if (decision.action === ACTION.HIDE) hidden++;
      }
    }

    stats.slots = slots;
    stats.hidden = hidden;
    stats.times = times;
    applyPageAds();

    if (typeof opts.onScan === 'function') {
      try { opts.onScan({ slots, hidden, pageAds: stats.pageAds, stats }); } catch (_e) { /* 回调不影响管线 */ }
    }
  }

  function schedule() {
    if (!running || timer) return;
    timer = setTimeout(function () {
      timer = null;
      try { scan(); } catch (e) { log('扫描异常（已吞掉，不影响页面）', e); }
    }, SCAN_DEBOUNCE_MS);
  }

  /** 立即扫一次（不等去抖）—— 测试与面板手动刷新都用它 */
  function rescan() {
    if (timer) { clearTimeout(timer); timer = null; }
    scan();
    return stats;
  }

  function start() {
    if (running) return false;
    running = true;

    // ① 结构 / 文本变更
    const target = doc.documentElement || doc.body;
    if (target && typeof MutationObserver === 'function') {
      observer = new MutationObserver(schedule);
      // 不 observe attributes —— 见文件头说明
      observer.observe(target, { childList: true, subtree: true, characterData: true });
    }

    // ② 滚动兜底：滚动事件不冒泡，但**能被捕获** ⇒ 挂在 document 上取 capture
    if (doc.addEventListener) {
      doc.addEventListener('scroll', schedule, { passive: true, capture: true });
    }

    rescan();
    log('过滤管线已启动');
    return true;
  }

  function stop() {
    if (!running) return false;
    running = false;

    if (observer) { observer.disconnect(); observer = null; }
    if (doc.removeEventListener) {
      doc.removeEventListener('scroll', schedule, { capture: true });
    }
    if (timer) { clearTimeout(timer); timer = null; }

    markedPageAds = [];
    const n = clearAll(doc);
    // 时间文本是**唯一被改写的 DOM 内容** —— 停管线时一并还原（§7.4 约束 3「可逆」）。
    // （外观 CSS 是 `<style>` 注入，撤销靠刷新或 `appearance()` 重建，见 dev-guide §6.5。）
    const t = restoreTimes(doc);
    stats.times = 0;
    log('过滤管线已停止，清掉 ' + n + ' 处标记' + (t ? '、还原 ' + t + ' 处时间' : ''));
    return true;
  }

  return {
    start,
    stop,
    rescan,
    isRunning: () => running,
    stats: () => Object.assign({}, stats, countMarks(doc), { times: countTimes(doc) }),
    recent: () => recent.slice(),
  };
}
