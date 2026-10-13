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

import { loadConfig } from './config.js';
import { applyL0 } from './features/l0.js';
import { ensureStyle } from './apply/style.js';
import { createScheduler } from './scheduler.js';

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
  if (ensureStyle(document)) log('压制样式已注入（首帧）');
  applyAppearance();
}

bootFirstFrame();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    ensureStyle(document);   // 首帧没插进去时补一次
    startFilter();
  }, { once: true });
} else {
  ensureStyle(document);
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
      /** 关掉过滤：清掉全部标记并停止观测 —— 用来肉眼确认「可逆」 */
      off: () => {
        if (!scheduler) return 0;
        scheduler.stop();
        filterStarted = false;
        return true;
      },
      /** 重新打开过滤 */
      on: () => {
        startFilter();
        return Boolean(scheduler && scheduler.isRunning());
      },
    };
  } catch (e) {
    log('调试把手挂载失败（不影响过滤）', e);
  }
}
