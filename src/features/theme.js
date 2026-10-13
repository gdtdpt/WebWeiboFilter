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
 * ── 取值纪律：只用微博自己的中性色令牌 ───────────────────────────
 * 取 `var(--w-main)` / `var(--w-sub)`（= 当前主题的正文色 / 次级灰度），**绝不写死明暗色**：
 *   · 浅色主题下 `--w-main` ≈ 深灰，深色主题下 ≈ `#bfbfbf` ⇒ 同一份 CSS 两套主题都成立；
 *   · 写死 `#333` 在深色主题上就是「深灰字压深灰底」，等于把正文抹掉（L1 第一批真踩过，见 §12-B9）。
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
 * 变量覆盖表：变量名 → 替换值。
 *
 * ⚠️ 这张表**只允许**出现三类值：
 *   ① `var(--w-main)` / `var(--w-sub)` —— 微博当前主题的中性令牌；
 *   ② 中性半透明灰 `rgba(128,128,128,α)`（用于「橙色 10% 悬停底」这类带透明度的暖色）；
 *   ③ 视频播放器用的 `rgba(0,0,0,.55)`（播放器底色恒为深色，与主题无关）。
 * 测试 `tests/theme.test.mjs` 会逐条校验 —— 任何人往里塞十六进制色都会立刻变红。
 */
export const NEUTRALIZE_VARS = {
  // ── ① 级联链根（浅色主题的路径：`--w-brand: var(--w-color-orange-1)`）────────
  '--w-color-orange-1': 'var(--w-main)',   // → --w-brand（主强调）
  '--w-color-orange-2': 'var(--w-main)',   // → --w-brand-hover
  '--w-color-orange-3': 'var(--w-sub)',    // → --w-alink（热搜条目色）
  '--w-color-red': 'var(--w-sub)',         // → --w-special → --w-liked-color（点赞色）

  // ── ② 中继层（深色主题用字面量重定义这些 ⇒ 必须显式覆盖）──────────────────
  '--w-brand': 'var(--w-main)',
  '--w-brand-hover': 'var(--w-main)',
  '--w-alink': 'var(--w-sub)',
  '--w-special': 'var(--w-sub)',

  // ── ③ 带透明度的暖色底（悬停 / 高亮），换成中性灰的同透明度 ──────────────
  '--w-hover': 'rgba(128,128,128,.12)',
  '--w-b-line-primary-bg-hover': 'rgba(128,128,128,.12)',
  '--w-history-tag-hover-background': 'rgba(128,128,128,.12)',

  // ── ④ 角标 / 标签 / 气泡 ────────────────────────────────────────────
  // `--w-badge-background` 同时是中继：`--weibo-top-nav-icon-badge-color` 引用它
  // ⇒ 顶栏「新消息」红角标会跟着变灰（仍是角标，可辨；属"降显著度"不属"删除"）
  '--w-badge-background': 'var(--w-sub)',
  '--bubble-bg': 'rgba(128,128,128,.95)',
  '--w-bubble-bg': 'rgba(128,128,128,.95)',
  '--feed-picture-tag-bg': 'rgba(0,0,0,.55)',   // 图片/视频角上的时长标签：换成播放器通用深色片
  '--w-icon-skin-spe': 'var(--w-sub)',          // 金 V 皮肤的底色（图形本身由 L1 隐藏）

  // ── ⑤ 杂项暖色 ──────────────────────────────────────────────────────
  '--head-info-source-hover-color': 'var(--w-main)',   // "来自 xxx" 悬停变橙
  '--w-option-color': 'var(--w-main)',
  '--icon-bg-spe-1': 'var(--w-sub)',
  '--icon-bg-spe-2': 'var(--w-sub)',
  '--icon-bg-spe-3': 'var(--w-sub)',
  '--icon-bg-spe-5': 'var(--w-sub)',
  '--icon-bg-spe-6': 'var(--w-sub)',
  '--chaohua-filter-item-active-color': 'var(--w-main)',
  '--chaohua-filter-item-active-border': 'var(--w-main)',
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
