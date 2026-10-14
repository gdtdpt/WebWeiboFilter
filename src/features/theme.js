/**
 * 「全局去橙红」（PROJECT.md §7.5 F 组 · 去色）
 *
 * ── 为什么是「覆盖 CSS 变量」而不是「写一堆选择器」────────────────────
 * 真机取样（`probeTheme()`，2026-10-13 17:35）拿到了微博主题系统的实底：
 *   · 微博的配色走**自定义属性**：`:root` 上生效 485 个，由 110 组规则定义；
 *   · 主题中继层就 5 个根变量，其余全部级联：
 *       `--w-color-orange-1` → `--w-brand`   → 主按钮底 / 顶栏 2px 橙线 / 登录按钮 /
 *                                              单选框 / 复选框 / 开关 / 投票选中 …
 *       `--w-color-orange-2` → `--w-brand-hover`
 *       `--w-color-orange-3` → `--w-alink`   → 热搜条目色
 *       `--w-color-red`      → `--w-special` → `--w-liked-color`（点赞色）
 *       `--w-color-red-2`    → `--w-error`
 *   · 变量名是**设计系统的契约**（`--w-*` / `--weibo-*`），不是构建哈希 ⇒ 微博改版不会失效。
 *
 * ⇒ 改 5 个根变量 + 20 来个中继/字面量，橙红就全局退了，**一条选择器都不用写**。
 *   好处：零高度影响（不碰任何盒子）、不依赖 DOM 结构、改版抗性远高于选择器。
 *
 * ── ⚠️ 为什么必须带 `!important` ─────────────────────────────────
 * 深色主题在 **`[data-theme="dark"]:root`** 里用**字面量**重新定义了这一批变量
 * （实测 `varRules` #66 / #68 / #82，例如 `--w-brand: #ea8011`）——
 * 它同时压过我们的 `:root`（优先级 0,1,1 > 0,1,0）**且**打断 `--w-color-orange-*` 的级联链。
 * 所以两件事都要做：① 覆盖中继层本身 ② 一律 `!important`。
 *
 * ── 取值纪律：哑色（低饱和同色相），不是灰（2026-10-14 用户定调）──────────
 * 最初这版把橙红映射到 `var(--w-main)` / `var(--w-sub)`（中性灰）—— 用户真机看后否决：
 * 「全局变灰效果不好，某些情况确实需要颜色，希望别那么鲜艳但**保留色相区分**」。
 * ⇒ 现在这张表把每个暖色映射到**同色相、低饱和（≤35%）**的哑色：
 *   · 橙系 → `hsl(28,…)` 暖灰   · 红系 → `hsl(13,…)` 砖红   · 金系 → `hsl(40,…)` 哑金；
 *   · 用 `hsl()` 而非十六进制，就是为了能让守卫测试**直接校验色相与饱和度**；
 *   · 明度取中段（48~58%），深浅两套主题上都可读（我们覆盖的是中继层，两套主题共用同一值）；
 *   · `var(--w-main)` / `var(--w-sub)` 只留给**本来就是中性**的变量（正文类），不作为"去色"手段。
 *
 * ── 有意**不**覆盖的两类 ─────────────────────────────────────────
 *   ① **语义色**：`--w-error` / `--w-color-red-2`（错误提示）、`--w-tip-fill-*`（提示图标）、
 *      ~~~~`--fgColor-danger` / `--borderColor-danger-emphasis` 等 markdown 语法高亮色。
 *      依据 §7.5.0「降显著度不是删除」——错误提示是**功能反馈**，把它变灰 = 功能退化，不是低调。
 *      （`--w-color-red-2` 一旦被覆盖，`--w-error` 会跟着变色 ⇒ 这两个必须一起放过。）
 *   ② **明暗底色**：`--w-card-background` / `--frame-background` / 各 `*-background` ——
 *      微博的深色主题是用户自己的选择，**跟随它**才是低调；强行刷成白底反而在深色环境里最扎眼。
 *      ⇒ 本节只去「暖色强调」，不动「明暗」。
 */

/**
 * 变量覆盖表：变量名 → 替换值（哑色，不是灰）。
 *
 * ⚠️ 这张表**只允许**出现三类值（`tests/theme.test.mjs` 逐条校验）：
 *   ① `hsl()/hsla()` —— **哑色**：色相只许橙 28° / 红 13° / 金 40°，饱和度 ≤ 35%；
 *   ② `var(--w-main)` / `var(--w-sub)` —— 只用于**本来就是中性**的变量（正文类）；
 *   ③ 播放器深色片 `rgba(0,0,0,.55)`（视频角标，与主题无关，不是"去色"）。
 * 色相基准（probeTheme 实测）：橙 `#ea8011` ≈ 28° · 红 `#f33705` ≈ 13° · 金 V ≈ 40°。
 */
export const NEUTRALIZE_VARS = {
  // ── ① 级联链根（浅色主题的路径：`--w-brand: var(--w-color-orange-1)`）────────
  '--w-color-orange-1': 'hsl(28,28%,55%)',   // → --w-brand（主强调）暖灰
  '--w-color-orange-2': 'hsl(28,26%,48%)',   // → --w-brand-hover（悬停略深一档）
  '--w-color-orange-3': 'hsl(28,24%,58%)',   // → --w-alink（热搜条目色）
  '--w-color-red': 'hsl(13,30%,55%)',        // → --w-special → --w-liked-color 砖红

  // ── ② 中继层（深色主题用字面量重定义这些 ⇒ 必须显式覆盖）──────────────────
  '--w-brand': 'hsl(28,28%,55%)',
  '--w-brand-hover': 'hsl(28,26%,48%)',
  '--w-alink': 'hsl(28,24%,58%)',
  '--w-special': 'hsl(13,30%,55%)',

  // ── ③ 带透明度的暖色底（悬停 / 高亮），换成同色相哑色的同透明度 ─────────────
  '--w-hover': 'hsla(28,28%,55%,.12)',
  '--w-b-line-primary-bg-hover': 'hsla(28,28%,55%,.12)',
  '--w-history-tag-hover-background': 'hsla(28,28%,55%,.12)',

  // ── ④ 角标 / 标签 / 气泡 ────────────────────────────────────────────
  // `--w-badge-background` 同时是中继：`--weibo-top-nav-icon-badge-color` 引用它
  // ⇒ 顶栏「新消息」红角标变砖红（仍是红系角标，可辨；属"降显著度"不属"删除"）
  '--w-badge-background': 'hsl(13,30%,55%)',
  '--bubble-bg': 'hsla(13,26%,55%,.95)',
  '--w-bubble-bg': 'hsla(13,26%,55%,.95)',
  '--feed-picture-tag-bg': 'rgba(0,0,0,.55)',   // 图片/视频角上的时长标签：播放器通用深色片，保持
  '--w-icon-skin-spe': 'hsl(40,22%,55%)',       // 金 V 皮肤的底色：哑金（图形本身由 L1 隐藏）

  // ── ⑤ 杂项暖色 ──────────────────────────────────────────────────────
  '--head-info-source-hover-color': 'hsl(28,24%,58%)',  // "来自 xxx" 悬停变橙
  '--w-option-color': 'var(--w-main)',          // 本来就是正文类中性色
  '--icon-bg-spe-1': 'hsl(40,22%,55%)',
  '--icon-bg-spe-2': 'hsl(40,22%,55%)',
  '--icon-bg-spe-3': 'hsl(40,22%,55%)',
  '--icon-bg-spe-5': 'hsl(40,22%,55%)',
  '--icon-bg-spe-6': 'hsl(40,22%,55%)',
  '--chaohua-filter-item-active-color': 'hsl(28,24%,58%)',
  '--chaohua-filter-item-active-border': 'hsl(28,24%,58%)',
  '--vs-dropdown-option--deselect-bg': 'var(--w-sub)',
};

/** 覆盖只写一次、写在一处：`:root`（两套主题下都命中） */
export const THEME_SELECTOR = ':root';

/**
 * 生成「去橙红」的 CSS。**零选择器** —— 只有一条 `:root{...}` 变量覆盖规则。
 *
 * @returns {string}
 */
export function themeCss() {
  const decls = Object.keys(NEUTRALIZE_VARS).map(
    (k) => `${k}:${NEUTRALIZE_VARS[k]} !important`,
  );
  return `${THEME_SELECTOR}{${decls.join(';')}}\n`;
}

/** 覆盖的变量条数（诊断页 / 测试断言用；改 `NEUTRALIZE_VARS` 时无需改这里） */
export const THEME_VAR_COUNT = Object.keys(NEUTRALIZE_VARS).length;
