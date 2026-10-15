/**
 * SpecBase Helper · 入口
 *
 * 交付形态（PROJECT.md §4）：源码分模块 → esbuild 打包 → 单个 specbase-helper.user.js。
 * 本入口在 `@run-at document-start` 下执行，因此**任何 DOM 操作都必须容忍 head/body 尚未解析**。
 *
 * 启动顺序（§5.2「首帧」与 §7.4 约束 1）：
 *   ① **首帧**：注入压制样式（`apply/style.js`）—— 必须最早，否则先闪微博原皮/先露广告
 *   ② **首帧**：外观档 L0（`features/l0.js`）—— 零适配成本，不依赖任何选择器
 *   ③ **DOM 就绪后**：过滤管线（`scheduler.js`）—— 要等信息流渲染出来才有意义
 *
 * 里程碑进度（§13）：
 *   M0 侦察  — ✅ 全部闭环（B1~B7，工具在 tools/recon/）
 *   M1 管线  — ✅ 判定核心（广告 + 关键词）+ 调度层 + 应用层已接线
 *   M2 低调  — L0 已落地；L1/L2 待做
 *   M3 面板  — 入口热区 / 面板 / 配置导入导出 / 诊断页（探针注册表已在适配层就位）
 */

import { loadConfig, saveConfig } from './config.js';
import { applyL0 } from './features/l0.js';
import { appearanceCss } from './features/appearance.js';
import { ensureStyle, composeCss, FILTER_CSS, removeStyle } from './apply/style.js';
import { createScheduler } from './scheduler.js';
import { readCardSignals } from './adapters/weibo-home.js';
import { decide, ACTION } from './core/decision.js';

const PREFIX = '[SpecBase]';
const VERSION = '0.1.0';

function log(...args) {
  try {
    console.log(PREFIX, ...args);
  } catch (_e) {
    /* 控制台不可用时静默 */
  }
}

let config = null;
let scheduler = null;
let appearanceApplied = false;
let filterStarted = false;

/** 本次要注入的完整样式（过滤规则永远在，档位规则按配置，见 `features/appearance.js`） */
function fullCss(cfg) {
  return composeCss(FILTER_CSS, appearanceCss(cfg));
}

/** 读一次配置并缓存（GM_* 不可用时退回默认值） */
function readConfig() {
  if (config) return config;
  try {
    config = loadConfig();
  } catch (e) {
    log('配置读取失败，使用默认值', e);
    config = null;
  }
  return config;
}

/** ② 外观：L0（+ M2 的 L1/L2 将挂在这里） */
function applyAppearance() {
  if (appearanceApplied) return;
  const cfg = readConfig();
  if (!cfg) return;
  appearanceApplied = true;

  if (cfg.appearance && cfg.appearance.l0) {
    try {
      const title = applyL0(document);
      log('L0 标签页伪装已启用 →', title);
    } catch (e) {
      log('L0 应用失败', e);
    }
  }
}

/** ③ 过滤管线 */
function startFilter() {
  if (filterStarted) return;
  const cfg = readConfig();
  if (!cfg) return;

  if (!(cfg.filter && cfg.filter.enabled)) {
    log('过滤已关闭（config.filter.enabled = false）');
    return;
  }
  filterStarted = true;

  try {
    scheduler = createScheduler(document, cfg, { log });
    scheduler.start();
  } catch (e) {
    filterStarted = false;
    log('过滤管线启动失败（页面不受影响）', e);
  }
}

/**
 * 首帧：样式注入 + L0。
 * `document-start` 时 `documentElement` 可能还不存在 ⇒ 样式注入推后到 DOMContentLoaded 再补一次。
 */
function bootFirstFrame() {
  const cfg = readConfig();
  if (ensureStyle(document, fullCss(cfg))) log('样式已注入（首帧：过滤规则 + 外观档）');
  applyAppearance();
}

bootFirstFrame();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    ensureStyle(document, fullCss(readConfig()));   // 首帧没插进去时补一次
    startFilter();
  }, { once: true });
} else {
  ensureStyle(document, fullCss(readConfig()));
  startFilter();
}

/**
 * 取**页面 window**（而不是脚本沙箱的 window）。
 *
 * ⚠️ 为什么必须走 `unsafeWindow`（2026-10-13 真机踩到）：
 *   脚本声明了 `@grant GM_getValue/GM_setValue`（配置落在 TM 存储里，§9）
 *   ⇒ Tampermonkey 会启用**沙箱**，脚本里的 `window` 是**沙箱对象**。
 *   于是 `window.__spb = {...}` 只写进了沙箱，页面控制台访问的是页面 window
 *   ⇒ `Uncaught ReferenceError: __spb is not defined`。
 *   要命之处在于：过滤**本身完全正常**（它只用 document），所以这个错只在
 *   「想用把手调试/验收」的那一刻才暴露 —— 属于最容易蒙混过关的一类问题。
 *
 * 非 TM 环境（离线单测、`@grant none`）下没有 `unsafeWindow` ⇒ 退回 `window`。
 */
function pageWindow() {
  try {
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow;
  } catch (_e) {
    /* 某些沙箱里读 unsafeWindow 会抛 —— 忽略，退回下面的 window */
  }
  return typeof window !== 'undefined' ? window : null;
}

/**
 * 真机验收 / 调试用的最小把手（无界面、低调 —— §8.2「入口隐形」只约束**可见**入口）。
 * 完整面板属 M3；这里只是让「关掉开关后页面是否完全恢复」能在控制台一句话验证（§7.4 约束 3）。
 *
 * ⚠️ 挂在**页面 window** 上（见 `pageWindow()`）；名字刻意取短且不自述。
 */
const page = pageWindow();
if (page) {
  try {
    page.__spb = {
      version: VERSION,
      config: () => readConfig(),
      rescan: () => (scheduler ? scheduler.rescan() : null),
      stats: () => (scheduler ? scheduler.stats() : null),
      recent: () => (scheduler ? scheduler.recent() : []),
      /** 关掉过滤：清掉全部标记、停止观测、**撤掉注入的样式表** —— 用来肉眼确认「可逆」 */
      off: () => {
        // ⚠️ 2026-10-15 真机反馈修正：L1 落地改高度项（媒体缩略化）后，只清标记不够 ——
        //    媒体缩小 / footer 隐藏全是**纯 CSS**，样式表不走 `removeStyle` 就永远不恢复
        //    （用户实测 `__spb.off()` 后图片仍是缩小的）。过滤 CSS 一并撤没有副作用：
        //    stop() 已清完全部标记，过滤规则此时无东西可表达。
        const stopped = scheduler ? scheduler.stop() : false;
        if (scheduler) filterStarted = false;
        const styleGone = removeStyle(document);
        if (stopped) log('过滤管线与注入样式已全部撤除（虚拟列表高度缓存按首帧建的，建议刷新一次）');
        return Boolean(stopped || styleGone);
      },
      /** 重新打开过滤：先重建样式表（off 撤掉了），再起管线 */
      on: () => {
        ensureStyle(document, fullCss(readConfig()));
        startFilter();
        return Boolean(scheduler && scheduler.isRunning());
      },
      /**
       * 开关外观档位（写进 TM 存储）。
       * ⚠️ **改完必须刷新页面**（§7.4 约束：切换 L0/L1/L2 后自动刷新）——
       * 样式虽在首帧注入，但当前页面里微博已按旧样式测量过虚拟列表高度。
       * 例：`__spb.appearance({ l1: true })` 然后刷新。
       */
      appearance: (patch) => {
        const cfg = readConfig();
        if (!cfg || !patch || typeof patch !== 'object') return null;
        const next = Object.assign({}, cfg, { appearance: Object.assign({}, cfg.appearance, patch) });
        const saved = saveConfig(next);
        config = next;               // 本轮会话的把手立刻读到新值（页面样式需刷新才对）
        return { saved, appearance: next.appearance, needReload: true };
      },
      /** 当前实际注入的完整样式（排查"规则到底有没有生效"用） */
      css: () => fullCss(readConfig()),
      /**
       * 现场判定一张卡：`__spb.inspect($0)`（先在 Elements 面板选中卡内任意元素）。
       *
       * 与扫描管线**同一套** `readCardSignals` + `decide`（不是复制品）——
       * 专门回答「这张卡为什么**没**被处理」：`recent()` 只记「动作非 KEEP」的卡，
       * 被判 KEEP 的（如漏网的广告卡）正好不留痕，只能靠这个现场问。
       * 输出 `signals`（抽取到的原始信号）+ `decision`（action / adScore / reasons / suspect）。
       */
      inspect: (target) => {
        try {
          const el = target && target.closest ? target : null;
          if (!el) {
            return { error: '用法：Elements 面板选中卡内任意元素后，跑 __spb.inspect($0)' };
          }
          const card = el.closest('.wbpro-scroller-item');
          if (!card) {
            return { error: '选中的元素不在任何 .wbpro-scroller-item 卡内（选中广告卡内部再试）' };
          }
          const signals = readCardSignals(card);
          const decision = decide(signals, readConfig());
          return {
            cardId: signals.id,
            signals: signals,
            decision: decision,
            actionText: decision.action === ACTION.HIDE ? 'hide（隐藏）'
              : decision.action === ACTION.HIGHLIGHT ? 'highlight（高亮）' : 'keep（保留）',
            note: 'adScore ≥ 3 才判广告；只有 suspect=true 说明信号不够 —— 把这份 JSON 整个发回去',
          };
        } catch (e) {
          return { error: String(e && e.message || e) };
        }
      },
    };
  } catch (e) {
    log('调试把手挂载失败（不影响过滤）', e);
  }
}
