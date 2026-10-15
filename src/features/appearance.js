/**
 * 外观档位 → CSS（PROJECT.md §7.5 / §7.4）
 *
 * 单独成文件是为了**可测**：`appearanceCss()` 是纯函数（配置 → 字符串），
 * 可以在 Node 里直接断言「L2 是否真的蕴含 L1」「关掉档位时是否一条规则都不注入」。
 *
 * ⚠️ 注入时机是**首帧**（§7.6 风险 1）：微博的虚拟列表位置来自预计算的 `translateY` 缓存
 * （B2 实测），所以改高度只有在"微博测量时看到的就是新样式"时才安全。
 * 运行中切档 ⇒ **刷新页面**（§7.4 约束），本模块不负责热切换。
 */

import { l1Css } from './l1.js';
import { themeCss } from './theme.js';
import { composeCss } from '../apply/style.js';

/**
 * @param {Object} cfg 完整配置（`config.js` 的形状）
 * @returns {string} 要注入的外观 CSS（无任何档位开启时为空串）
 */
export function appearanceCss(cfg) {
  const a = (cfg && cfg.appearance) || {};
  const parts = [];

  // §7.5.2：L2 蕴含 L1 —— 开 L2 时 L1 的规则必须一并生效，否则会出现"皮换了、噪没去"的怪状态
  if (a.l2 || a.l1) {
    // ⚠️ 顺序有意义：`themeCss()` 的 `:root` 覆盖放**后面**。
    // 两者都是 `!important`，靠后的同优先级声明在冲突时胜出 —— 变量覆盖是地基，先让位给具体规则。
    parts.push(themeCss());
    // cfg 透传：l1 内的媒体尺寸规则组受 `appearance.mediaCaps` 门控（B17 黑图归因开关）
    parts.push(l1Css(cfg));
  }
  // L2 的重排规则、以及第二批「改高度」的规则以后接在这里（同样首帧注入）

  return composeCss(...parts);
}
