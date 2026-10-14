/**
 * L1「素净」外观档（PROJECT.md §7.5 的第一批 —— **零高度影响子集**）
 *
 * ── 为什么只做「零高度影响」的那些项 ────────────────────────────────
 * B2 已实测（§12-B2）：虚拟列表的槽位位置来自**预计算的 `translateY` 缓存**，
 * `item-wrapper` 的 scrollHeight / clientHeight 全程恒定 ⇒ **微博从不重测槽位尺寸**。
 * ⇒ 任何**改变卡片高度**的改动（媒体缩略化、隐藏统计行 / 互动按钮行、改字号行距）
 *   都可能在时间线上留下**洞**或累积漂移 —— 与「过滤卡不能删除式隐藏」同一个根因。
 * 所以这一批**全是"改颜色 / 改装饰 / 改滤镜，不改尺寸"的规则**：
 * 先把「改样式不会引起洞或漂移」这个前提在真机上验证掉，再动改高度的项。
 *
 * ── 锚点纪律（§6 / §12-B4）────────────────────────────────────────
 * 只用稳定锚点：`woo-*` / `wbpro-*` / `vue-*` / `vjs-*` / `#scroller` / `#homeWrap` / `#app`。
 * ⛔ 禁止构建哈希（`_logo_18dhr_77`、`_side_1ubn9_37`）—— 微博一改版全部失效。
 * ⛔ 禁止 `__yawf_*` —— 那是外部脚本运行时注入的，干净页面里根本不存在。
 * 选择器常量一律从适配层 import（单一来源，避免"CSS 改了探针没改"的漂移）。
 *
 * ── 为什么到处 `!important` ─────────────────────────────────────
 * 这是一套「覆盖微博自有主题」的样式，而微博编译后的选择器优先级不低。
 * 因此**一律 `!important`**，但把选择器压得很窄（宁可少覆盖，也不误伤）。
 *
 * ── ⚠️ 颜色一律走主题变量，禁止写死明暗色（2026-10-13 真机取样后纠正）──────
 * `probeTheme()` 实测：用户的微博跑在**深色主题**下（`<html data-theme="dark">`，
 * `--w-card-background: #191919` / `--w-main: #bfbfbf`）。本文件最初的 `color:#333`
 * 与 `box-shadow:…#e6e6e6` 是**按浅色主题写的**，在深色下分别是"正文消失"与"白线"。
 * ⇒ 规则里的颜色一律取微博自己的中性令牌 `var(--w-main)` / `var(--w-sub)` /
 *   `var(--w-dividing-line)`：**同一份 CSS 在两套主题下都成立**。
 *   `tests/l1.test.mjs` 有一张守卫会扫出任何十六进制颜色。
 *
 * ⚠️ **已知未做**（都缺确定锚点或属改高度，见 §7.5 与 PROJECT.md §13-M2）：
 *    隐藏右栏（实测窄窗口下**微博自己就收起了**：内容宽 < `--main-width` 1122px ⇒ simple 布局，§12-B9 ⑥；
 *      要落地得先在更宽的窗口复采锚点）· 底部推荐（实测首页不存在）、
 *    时间改绝对格式（`title` 里确有绝对时间，但需先由适配层打标 —— 与 L2 时间列同一套机制）、
 *    媒体缩略化 / 隐藏统计行 / 隐藏互动按钮行（**改高度** ⇒ 第二批，需先验洞）。
 */

import {
  SEL_CARD, SEL_AVATAR, SEL_OG_TEXT, SEL_RE_TEXT, SEL_TEXTCUT, SEL_MEDIA,
} from '../adapters/weibo-home.js';
import { SEL_BADGE, SEL_LOGO } from '../adapters/weibo-shell.js';

/** 正文容器族（原创正文 / 转发原文 / 截断容器） */
const TEXT_SEL = [SEL_OG_TEXT[0], SEL_RE_TEXT[0], SEL_TEXTCUT[0]].join(',');

/** 正文内的链接（话题 / `@` / 外链） */
const TEXT_LINK_SEL = [SEL_OG_TEXT[0], SEL_RE_TEXT[0], SEL_TEXTCUT[0]]
  .map((s) => `${s} a`).join(',');

function rule(selector, body) {
  return selector + '{' + body + '}';
}

/**
 * 生成 L1 的 CSS 文本。逐组说明「为什么它不改高度」。
 *
 * @returns {string}
 */
export function l1Css() {
  return [
    // ① 身份信号：头像降饱和（**保持原尺寸与色相**，2026-10-14 用户定调「降彩度不灭色相」）
    //    ⚠️ 不用 grayscale(1) —— 全灰会丢掉头像的可辨识度；saturate(.4) 只是让它不扎眼。
    rule(SEL_AVATAR.join(','), 'filter:saturate(.4) !important;opacity:.8 !important'),
    // ⚠️ 只隐藏**徽标图形本身**（叶子节点）：父级 `woo-icon-main` 带内联 16×16，
    //    留着它 ⇒ 宽度也没变，是真正的零布局变化（隐藏父级会少 16px 宽）。
    rule(SEL_BADGE.join(','), 'display:none !important'),

    // ② 媒体：降饱和（**不改尺寸、不灭色相**；缩略化属第二批）
    rule(`${SEL_MEDIA[0]} img`, 'filter:saturate(.4) !important;opacity:.85 !important'),

    // ③ 正文：文字色转中性；链接 / 话题 / @ 去蓝、去下划线、去话题底色（颜色不占布局 ⇒ 零高度影响）
    //    `var(--w-main)` = 当前主题的正文色（浅色≈#333，深色≈#bfbfbf）
    rule(TEXT_SEL, 'color:var(--w-main) !important'),
    rule(TEXT_LINK_SEL,
      'color:var(--w-sub) !important;text-decoration:none !important;background:none !important'),

    // ④ 卡片：去阴影、去圆角，改用一条 1px 的**内阴影**做分割线
    //    ⚠️ 用 box-shadow 而不是 border-bottom —— border 会占 1px 布局 ⇒ 改高度。
    //    颜色取 `--w-dividing-line`（浅色≈#f2f2f2，深色=#222）—— 写死颜色会在另一套主题上变成白线。
    rule(SEL_CARD[0], 'border-radius:0 !important;box-shadow:0 1px 0 var(--w-dividing-line) !important'),
    // 卡片外壳（article 及其下一层）通常自带圆角与投影，一并压掉；
    // 只走两层，避免把视频控件等深层元素的样式一起杀掉。
    rule(`${SEL_CARD[0]} > *,${SEL_CARD[0]} > * > *`, 'border-radius:0 !important;box-shadow:none !important'),

    // ⑤ 外壳：logo 灰化（SVG 内的 fill 是硬编码的微博红，只能用滤镜压）。
    //    ⚠️ logo 是**伪装层**（§7.5-G「SpecBase」身份的一部分），不是内容配色 ——
    //    这里保持 grayscale 而不是降饱和：品牌红的识别度必须压掉，属刻意的例外。
    rule(`${SEL_LOGO[0]} svg`, 'filter:grayscale(1) !important;opacity:.5 !important'),
  ].join('\n') + '\n';
}

/** 规则条数（探针 / 诊断页断言用；改 `l1Css()` 时记得同步） */
export const L1_RULE_COUNT = 8;
