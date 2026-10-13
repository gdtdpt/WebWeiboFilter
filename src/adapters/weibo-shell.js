/**
 * 微博**外壳层**适配（§10.0 三层模型的第 ① 层：全站外壳 —— 顶栏 / 侧栏 / logo / 页面级装饰）
 *
 * 与 `weibo-home.js`（② 页面层：首页时间线）分开，理由是**失效方式不同**：
 *   - 信息流锚点失效 ⇒ 过滤停摆（功能坏掉，必须立刻知道）
 *   - 外壳锚点失效 ⇒ 只是"看起来还是微博"（外观退化，不影响可用性）
 * 诊断页（M3）需要能分别报告这两类。
 *
 * ── ⚠️ 实测结论（2026-10-13，四份夹具）：外壳几乎没有语义锚点 ────────────
 * 外壳的类名**全是构建哈希**：`_logo_18dhr_77` / `_side_1ubn9_37` / `_wrap_18dhr_36` /
 * `_holder_18dhr_61` …（曾经的 `__yawf_weibo-top-nav-base_logoWrap` 那类"语义名"是**外部
 * yawf 脚本注入**的，用户已卸载 ⇒ 干净页面里不存在，不能当锚点）。
 * ⇒ 外壳层能用的稳定钩子只剩两类：**属性**（如 `a[href="/"][aria-label]`）与**结构/几何**。
 *
 * ⇒ 纪律：凡是只能靠**几何**判定位置的项（右栏、底部推荐、顶栏容器本体），
 *   **一律先由 `SpecBaseRecon.probeTheme()` 在真机上取样，不猜、不预先写规则**（§6.1）。
 *   这一批 L1 只落「有确定锚点」的那几条。
 */

/**
 * 顶栏 logo。实测结构（1440 夹具）：
 *   `<a href="/" aria-label="Weibo" class="_logoWrap_18dhr_77">` 内嵌一个 inline SVG
 *   （SVG 内的 fill 是硬编码的 `#d52c2b` 微博红 ⇒ L1 只能靠 CSS 覆盖 fill 或压 opacity）。
 *
 * ⚠️ 为什么带 `[aria-label]`：侧栏「首页」也是一个 `a[href="/"]`，
 * 不带这个限定会把侧栏首页链接一起选中（它里面是文字，不是 logo）。
 */
export const SEL_LOGO = ['a[href="/"][aria-label]'];

/**
 * 行内认证 / 会员角标（`woo-icon-*` 族）。
 * 纯装饰、且是**行内小图标** ⇒ 隐藏它只减少行内宽度，**不改变行高**（零高度影响，§7.5 A 组）。
 * ⚠️ 只列已实测存在的 `woo-icon-vipimg`。其余身份图标（会员 / 达人 / 旅行 / 红包 / 问答…）
 * 的锚点未确认 —— `probeTheme()` 会 dump 出 `woo-icon-*` 全家族，补齐后再加进这张表。
 */
export const SEL_BADGE = ['img.woo-icon-vipimg', 'i.woo-icon-vipimg'];

/**
 * 外壳层探针（§6.1）。用法与 `weibo-home.js` 的 `PROBES` 相同：
 * `runProbes(doc, [...PROBES, ...PROBES_SHELL])`。
 */
export const PROBES_SHELL = [
  {
    id: 'logo',
    desc: '顶栏 logo（L1 灰化锚点）',
    selector: SEL_LOGO.join(' / '),
    expect: 'exists',
    failMeans: 'logo 锚点失效 ⇒ L1 的 logo 灰化不生效（其余档位不受影响）',
  },
  {
    id: 'icon-badge',
    desc: '行内认证 / 会员角标 woo-icon-*',
    selector: SEL_BADGE.join(' / '),
    expect: 'optional',   // 只有认证 / 会员账号才有 ⇒ 为空不算失效
    failMeans: '角标锚点失效 ⇒ 认证徽标不会被隐藏（缺 V 账号时为空属正常）',
  },
];
