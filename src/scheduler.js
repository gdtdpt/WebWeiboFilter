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
  readCardSignals, findPageAdSlots, resolvePageAdContainer,
} from './adapters/weibo-home.js';
import { decide, ACTION } from './core/decision.js';
import { markSlot, markPageAd, clearAll, countMarks } from './apply/mark.js';
import { applyAbsoluteTimes, restoreTimes, countTimes } from './apply/time.js';
import {
  applyActionBarSummary, removeSummaries, countSummaries,
} from './apply/summary.js';
import {
  applyMorePics, removeMoreGrids, countMoreGrids,
} from './apply/morepics.js';
import {
  applyAvatarBackground, removeAvatarBackgrounds, countAvatarBackgrounds,
} from './apply/avatarbg.js';
import {
  applyBrandText, restoreBrandText, countBrandText,
} from './apply/brandtext.js';
import {
  applyTopbarQuiet, restoreTopbarQuiet, countTopbarQuiet,
} from './apply/topbar.js';
import {
  applyVividQuiet, restoreVividQuiet, countVividQuiet,
} from './apply/vivid.js';
import { AVATAR_VARIANTS } from './features/l2.js';

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
    scans: 0, slots: 0, hidden: 0, pageAds: 0, pageAdsRefused: 0, records: 0, times: 0, lastScanAt: 0,
  };

  let observer = null;
  let timer = null;
  let running = false;
  let markedPageAds = [];
  /** 上一轮的「放弃收掉」计数 —— 只用于日志去重（不是判定状态） */
  let prevRefused = 0;

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
    let refused = 0;
    for (const item of found) {
      // ⚠️ 落点由适配层算，红线是**绝不含信息流 / 发布器**（见 resolvePageAdContainer）。
      //    返回 null = 找不到安全落点 ⇒ **放弃收掉**（宁可露出广告，也不许吞掉时间线）。
      //    2026-10-14 真机事故：旧实现把落点取成"#homeWrap 的直接子块"，
      //    而真机里广告与时间线同住一个匿名 div ⇒ 整条信息流被 display:none（整页空白）。
      const el = resolvePageAdContainer(doc, item.el);
      if (!el) { refused++; continue; }
      if (next.indexOf(el) !== -1) continue;
      next.push(el);
      markPageAd(el, true);
    }
    // 已经被收掉、但这一轮不再命中的 → 撤回标记
    for (const el of markedPageAds) {
      if (next.indexOf(el) === -1) markPageAd(el, false);
    }
    markedPageAds = next;
    stats.pageAds = next.length;
    stats.pageAdsRefused = refused;
    // 只在数量变化时吭声（每轮 8 次日志会把控制台刷爆）
    if (refused !== prevRefused) {
      prevRefused = refused;
      if (refused) {
        log('⚠️ A 类广告位有 ' + refused + ' 处找不到安全落点（收下去会连带吞掉信息流）'
          + '—— 已放弃收掉，广告保持可见。请把这条记下来反馈。');
      }
    }
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
    // β 头像水印只在「L2 开 + avatarVariant=beta」时建立（与 l2Css 的变体回退同一张表，
    // 判定不复刻）；其余情形逐卡清干净 —— 槽位复用防串号。
    const appCfg = (config && config.appearance) || {};
    const avatarVariant = AVATAR_VARIANTS.indexOf(appCfg.avatarVariant) !== -1
      ? appCfg.avatarVariant : 'beta';
    const avatarBgOn = appearanceOn && !!appCfg.l2 && avatarVariant === 'beta';
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

        // ④ A1 摘要条（§12-B15，与时间改写同一套「幂等 + 可逆」模式；档位关着时逐卡摘除）。
        //    摘要条绝对定位、不占布局 ⇒ 建/更/摘都不改卡片高度（l1.js 的 CSS 保证）。
        applyActionBarSummary(card, appearanceOn);

        // ⑤ 「+N」截断格全量展示（§12-B18，取数异步、注入幂等；
        //    🔴 高度中性 —— 容器显式锁高 = 原网格高，卡高一个像素不变）。
        applyMorePics(card, appearanceOn && !!(config.appearance && config.appearance.morePics));

        // ⑥ β 头像水印（§7.5.5）：header 头像的 src → article 的 --spb-avatar-bg，
        //    绘制在 article::before（l2.js CSS 侧）；absolute + pointer-events:none
        //    ⇒ 建/更/摘都不改卡片高度。
        applyAvatarBackground(card, avatarBgOn);

        if (decision.action === ACTION.HIDE) hidden++;
      }
    }

    stats.slots = slots;
    stats.hidden = hidden;
    stats.times = times;
    applyPageAds();

    // ⑦ L2 品牌文案换中性（§7.5-F/G，§12-B20）：chrome 文本 + 属性 + logo 文字标。
    //    chrome 在卡片外 ⇒ 全文档扫（不逐卡）；pattern 驱动幂等 ⇒ 每轮重复调用无害；
    //    档位关着时还原（L2 独有，L1 不含）。只写文本/属性，不 observe attributes ⇒ 无自触发。
    const brandOn = appearanceOn && !!appCfg.l2 && appCfg.brandNeutral !== false;
    try {
      applyBrandText(doc, brandOn);
    } catch (e) {
      log('品牌文案改写异常（已吞掉，不影响页面）', e);
    }

    // ⑧ L2 顶栏降显著（§7.5-F，probeTopbar 取证后落地）：头像/彩色图标灰度 + 分类条整行收掉。
    //    分类条的 display:none 不落在 CSS 是因为行落点（_slot_ 祖先）是哈希类，只能 JS 按
    //    tab2 反推；CSS 侧（l2.js ⓪ .wbpro-tab2）负责首帧防闪烁。内联 filter 零布局影响。
    const topbarOn = appearanceOn && !!appCfg.l2 && appCfg.topbarQuiet !== false;
    try {
      applyTopbarQuiet(doc, topbarOn);
    } catch (e) {
      log('顶栏降显著异常（已吞掉，不影响页面）', e);
    }

    // ⑨ 主区 vivid 收尾（§12-B22，probeProfile 取证后落地）：写死鲜色（非变量）的运行时
    //    灰度网 —— 数据胶囊 / 侧栏未读数 / SVG fill / 渐变。阈值 0.5 只抓写死色、放过哑色；
    //    跳过 article 子树（用户内容）与顶栏（⑧ 已管）。与 themeCss 去橙红同层（L1/L2 任一开）。
    const vividOn = appearanceOn && appCfg.vividQuiet !== false;
    try {
      applyVividQuiet(doc, vividOn);
    } catch (e) {
      log('主区 vivid 收尾异常（已吞掉，不影响页面）', e);
    }

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
    // 摘要条是我方**元素**（clearAll 只摘属性不够）—— 停管线时整页摘除。
    const sm = removeSummaries(doc);
    // 「+N」全展示注入同样是**元素** —— 停管线时整页还原（原格 display:none 摘掉）。
    const mg = removeMoreGrids(doc);
    // β 头像水印是我方写入的内联 CSS 变量 + 标记 —— 停管线时整页清掉。
    const ab = removeAvatarBackgrounds(doc);
    // L2 品牌文案 / logo 文字标是**被改写的 DOM 内容** —— 停管线时按台账逐条还原（§7.4「可逆」）。
    const br = restoreBrandText(doc);
    // 顶栏降显著的内联 filter / display 同理 —— 停管线时逐条还原。
    const tq = restoreTopbarQuiet(doc);
    // 主区 vivid 收尾的内联 filter 同理。
    const vq = restoreVividQuiet(doc);
    stats.times = 0;
    log('过滤管线已停止，清掉 ' + n + ' 处标记' + (t ? '、还原 ' + t + ' 处时间' : '')
      + (sm ? '、摘除 ' + sm + ' 条摘要' : '') + (mg ? '、还原 ' + mg + ' 处全图网格' : '')
      + (ab ? '、清掉 ' + ab + ' 处头像水印' : '')
      + (br ? '、还原 ' + br + ' 处品牌文案' : '')
      + (tq ? '、还原 ' + tq + ' 处顶栏降显著' : '')
      + (vq ? '、还原 ' + vq + ' 处 vivid 收尾' : ''));
    return true;
  }

  return {
    start,
    stop,
    rescan,
    isRunning: () => running,
    stats: () => Object.assign({}, stats, countMarks(doc),
      { times: countTimes(doc), summaries: countSummaries(doc), moreGrids: countMoreGrids(doc),
        avatarBgs: countAvatarBackgrounds(doc), brandText: countBrandText(),
        topbarQuiet: countTopbarQuiet(doc), vividQuiet: countVividQuiet(doc) }),
    recent: () => recent.slice(),
  };
}
