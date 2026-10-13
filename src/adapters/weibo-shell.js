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
 *
 * ── ⚠️ 两条来自 `probeTheme()` 的修正（2026-10-13 17:35）─────────────────
 * ① **`woo-panel-*` 不是"布局方位"，别拿它找左/右栏。**
 *    实测左栏那个元素同时带 `woo-panel-main woo-panel-left woo-panel-top woo-panel-right
 *    woo-panel-bottom`（四个方位全齐）⇒ 它是**圆角修饰符**（哪几个角要圆），
 *    不是"这一列在左边"。`woo-panel-left` 出现 13 次也是同一个原因。
 *    能用的只有：顶栏是 `woo-panel-main.woo-panel-bottom`（在 `position:fixed; z-index:9999`
 *    的外层里，高 58），左栏是 `div.grayTheme` → `woo-panel-main.…wbpro-scrollbar`（sticky，高 795）。
 * ② **主题是稳定锚点**：`<html data-theme="dark|light" data-layout="index">`。
 *    深色主题会把同一批变量在 `[data-theme="dark"]:root` 里用**字面量**重定义（见 `features/theme.js`）
 *    ⇒ 任何"写死颜色"的规则都会在其中一套主题上翻车。
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
 * 头像上的**身份徽标**（`woo-icon-*` 族）。纯装饰，§7.5 A 组「认证徽标 / 身份图标 → 隐藏」。
 *
 * 实测结构（夹具 + 真机取样都是同一套，与主题无关）：
 * ```html
 * <span class="woo-icon-wrap woo-avatar-icon">
 *   <span class="woo-icon-main" style="width:16px;height:16px">   ← 保留（占位 16×16）
 *     <svg class="woo-icon-in woo-icon-skinSpe"> …金底 + 红圈 + 黄 V…  ← 目标
 *     <svg class="woo-icon-in woo-icon--vblue woo-icon-skin"> …蓝底 + 白 V…  ← 目标
 *   </span>
 *   <span class="woo-icon-frames" style="width:16px;height:16px"></span>  ← 空元素，不动
 * </span>
 * ```
 * ⚠️ **只隐藏叶子图形**（`svg.woo-icon-in.xxx`），父级 `woo-icon-main` 的 16×16 占位留着
 * ⇒ 行高、行内宽度**都不变**，是严格的零布局变化。
 * 反过来，隐藏父级 / `woo-icon-frames` 会让那一行少 16px 宽 —— 没必要冒这个险。
 *
 * ⚠️ 不写 `svg.woo-icon-in`（不带修饰符）：那是图标组件的**通用内层**，
 * 任何功能性图标都可能用它 ⇒ 会误伤。这里只枚举**身份类型**修饰符。
 */
export const SEL_BADGE = [
  'img.woo-icon-vipimg',                  // 会员图标（实测是 <img>，src 形如 vip_7.png / vvip_2.png）
  'i.woo-icon-vipimg',
  'svg.woo-icon-in.woo-icon-skinSpe',     // 金 / 橙 V 皮肤
  'svg.woo-icon-in.woo-icon--vblue',      // 蓝 V 认证
];

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
    desc: '身份徽标（会员 / 金 V / 蓝 V）—— 只含叶子图形，父级 16×16 占位保留',
    selector: SEL_BADGE.join(' / '),
    expect: 'optional',   // 只有认证 / 会员账号才有 ⇒ 为空不算失效
    failMeans: '徽标锚点失效 ⇒ 认证徽标不会被隐藏（缺 V 账号时为空属正常）',
  },
];
