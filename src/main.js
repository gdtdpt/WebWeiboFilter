/**
 * SpecBase Helper · 入口
 *
 * 交付形态（PROJECT.md §4）：源码分模块 → esbuild 打包 → 单个 specbase-helper.user.js。
 * 本入口在 `@run-at document-start` 下执行，因此**任何 DOM 操作都必须容忍 head/body 尚未解析**。
 *
 * 里程碑进度（§13）：
 *   M0 侦察  — 工具在 tools/recon/recon.js（尚未拿到真实页面数据）
 *   M1 管线  — src/core + 调度层 + 应用层（待 M0 结论）
 *   M2 低调  — L0 已落地本切片；L1/L2 待 M0 结论
 *   M3 面板  — 入口热区 / 面板 / 配置导入导出 / 探针注册表
 */

import { loadConfig } from './config.js';
import { applyL0 } from './features/l0.js';

const PREFIX = '[SpecBase]';

function log(...args) {
  try {
    console.log(PREFIX, ...args);
  } catch (_e) {
    /* 控制台不可用时静默 */
  }
}

function boot() {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    log('配置读取失败，使用默认值', e);
    return;
  }

  // L0：零适配成本、不依赖任何选择器，是当前唯一可独立成立的档（§7.3）
  if (config.appearance && config.appearance.l0) {
    try {
      const title = applyL0(document);
      log('L0 标签页伪装已启用 →', title);
    } catch (e) {
      log('L0 应用失败', e);
    }
  }
}

// document-start 时 head 可能还不存在；两个时机都尝试，applyL0 内部幂等且带防御性 observer。
boot();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
}
