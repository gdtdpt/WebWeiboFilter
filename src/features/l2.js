/**
 * L2「工单式重排」外观档（PROJECT.md §7.5.2 / §7.5.4 —— L2 蕴含 L1，本文件只放**增量**）
 *
 * ── M1 探针定案的结构事实（2026-10-16 probeL2 v1~v3，§12-M1）──────────────
 *   _content_ (1122, flex row, 左右 margin 87.5 居中)
 *   ├─ 左栏分类列表  182px+8   class 含 grayTheme，**static 无 sticky**（order 交换零风险）
 *   ├─ 匿名 div (932) ── main.woo-box-flex (932, flex row)
 *   │   ├─ _full_  642  主列（信息流，relative z100）
 *   │   └─ _side_  282+8 右栏壳 —— L1 ⑧ 只藏了 .wbpro-side-main 内容，**壳还占位**
 *   └─ fixed 40×40 浮钮（z99，不参与 flex 布局，无需处理）
 *   时间锚：a[title^="20"] 74×16，卡左偏移恒 81 / 卡顶恒 48（5/5 卡一致）；
 *   父链 _info_ → _content_wrap_ → _main_ 全 static ⇒ absolute 的定位上下文 = article
 *   （L1 ⑥ 已置 relative）。⚠️ _info_ 行里还有 _tagList_（标签）排在时间前 ⇒
 *   挂点选 article 以卡为坐标系，不选 _info_。
 *
 * ── 红线（§7.5.4）────────────────────────────────────────────────
 * 只许 CSS 改摆位（flex order / absolute / padding），**禁止移动 / 克隆 / 删除节点**：
 * DOM 所有权在 Vue 手里，虚拟列表的槽位回收会让一切结构改动「过期」（§12-B2）。
 * 本文件全部规则都是纯 CSS；改高度的项（article 内边距、γ 头像脱流、L2 字号）
 * 走首帧注入机制兜底（§12-B12 闸门已开），`tests/l2.test.mjs` 的 SIZE_EXEMPT 逐条登记。
 *
 * ── 锚点纪律 ────────────────────────────────────────────────────────
 * 外壳（顶栏 / 左栏 / 分栏层）没有语义锚点，可用锚只有：
 *   · `main` 标签（语义）+ `woo-box-flex`（库类）—— 分栏层 main 的唯一定位方式；
 *   · `.grayTheme`（左栏列上的主题类，probeL2 v3 实测；⚠️ 全页唯一性待真机复验，
 *     因此规则用 `:has(> .grayTheme):has(main.woo-box-flex)` 的双条件**收窄作用域**，不裸锚）；
 *   · `.vue-recycle-scroller` / `.wbpro-side-main`（库类）；
 *   · `:has()` 已在 L1 归因条（③b）用过，linkedom 语义已验一致。
 * ⛔ 禁构建哈希（_wrap_1l406_3 / _full_1l406_7 / _side_1ubn9_37 一律不锚）。
 *
 * ── 2026-10-16 真机三症状的根因（probeL2 v4 ruleAudit 定位，§12-M1 追记）─────
 * ① 🔴 **`:has()` 禁止嵌套**（CSS Selectors 4 规范，Chrome 强制）：v1 写的
 *    `div:has(> div:has(> main...))` 是非法选择器 ⇒ **整条规则被浏览器丢弃**，
 *    order 从未生效（ruleAudit 实测 querySelectorAll 抛异常 = -1）。修法 = 两个**并列**的
 *    `:has()`（合法）：`div.woo-box-flex:has(> .grayTheme):has(main.woo-box-flex)`。
 * ② `_content_` 分栏层是 **fit-content 收缩盒**（实测 753 = 左栏 190 + 信息流 563，
 *    margin 272×2 自动居中，总量恒 = 可视宽）：内层全放开 `width:auto` 后链条失去
 *    宽度基准 ⇒ 整体收缩到内容固有宽（信息流反而变窄）。修法 = 给 _content_ 本身
 *    `width:100%`，让 flex 链有自由空间可分配。
 * ③ 时间锚的**定位上下文不是 article**，是衬距边缘的 header/feed_body（微博自身
 *    relative，实测 left:14 落在卡左缘 +105 = 90 衬距 + 15）：absolute 的 left 以
 *    **衬距边缘**为原点 ⇒ 实际写 `left = 目标 - TIME_COL_PAD`（负值补偿）。
 *    top 不受影响（该上下文的顶 = article 顶，article 无 padding-top）。
 */

import {
  SEL_CARD, SEL_AVATAR, SEL_OG_TEXT, SEL_RE_TEXT, SEL_TIME_ANCHOR,
} from '../adapters/weibo-home.js';
import { normalizeFontSize, normalizeLineHeight } from './l1.js';

function rule(selector, body) {
  return selector + '{' + body + '}';
}

/** L2 排版默认值（§7.5-C：字号 13px / 行距 1.5 —— 比 L1 的 14/1.6 再紧一档） */
export const L2_TEXT_FONT_SIZE = 13;
export const L2_TEXT_LINE_HEIGHT = 1.5;

/** 头像变体（§7.5.5）：原位灰度（α）/ 左上角向右下渐隐（β，默认）/ 时间列下方小灰头像（γ） */
export const AVATAR_VARIANTS = ['alpha', 'beta', 'gamma'];

/**
 * 时间列的几何参数。左 14 / 顶 14 / 宽 48：
 * 宽 48px 下 12px 等宽字体的「10-16」（5 字符 ≈36px）装得下、整体（10 字符 ≈72px）装不下
 * ⇒ 在时间文本自带的空格处**自然折行**成「10-16 / 08:50」上下两行 —— 纯 CSS，免 JS 改写。
 * γ 头像落在两行时间之下（14 + 2×17 + 8 ≈ 56）。
 */
const TIME_COL_LEFT = 14;
const TIME_COL_TOP = 14;
const TIME_COL_W = 48;
const GAMMA_AVATAR_TOP = 56;
/** article 内边距：给时间列腾出的宽度（时间列 48 + 左右呼吸 ≈ 90） */
const TIME_COL_PAD = 90;
/**
 * 时间列 / γ 头像的 absolute left **实际写入值** = 目标偏移 - 衬距。
 * 定位上下文是衬距边缘的 header/feed_body（微博自身 relative，见文件头根因 ③），
 * 不是 article 的边框盒 ⇒ 要落到「卡左缘 +14」必须写 14 - 90 = -76px。
 */
const TIME_COL_CSS_LEFT = TIME_COL_LEFT - TIME_COL_PAD;

/**
 * 生成 L2 增量的 CSS 文本（在 L1 之后拼接，同特异性靠后胜出）。
 *
 * @param {Object} [cfg] 完整配置；消费的把手：
 *   - `cfg.appearance.textFontSize` / `textLineHeight`：**缺省（null）时用 L2 规范值
 *     13px / 1.5**（§7.5-C）；显式设置则两档共用用户值。
 *   - `cfg.appearance.avatarVariant`：'alpha' | 'beta' | 'gamma'（非法值回退 'beta'，
 *     2026-10-16 用户拍板默认 β「左上角向右下渐隐」）。
 * @returns {string}
 */
export function l2Css(cfg) {
  const a = cfg && cfg.appearance ? cfg.appearance : {};
  const fontSize = a.textFontSize == null
    ? L2_TEXT_FONT_SIZE
    : normalizeFontSize(a.textFontSize);
  const lineHeight = a.textLineHeight == null
    ? L2_TEXT_LINE_HEIGHT
    : normalizeLineHeight(a.textLineHeight);
  const variant = AVATAR_VARIANTS.indexOf(a.avatarVariant) !== -1 ? a.avatarVariant : 'beta';

  // ① 页面三列重排：左栏分类列表移到最右（用户 2026-10-16 拍板「主列为第一列」）。
  //    父层 _content_ 本来就是 flex row ⇒ 一条 order 就够，列宽一像素不变（零高度影响）。
  //    ⚠️ 选择器**禁止嵌套 :has()**（规范禁令，Chrome 丢弃整条规则 —— 见文件头根因 ①），
  //    收窄作用域用两个**并列** :has()：直接子有 .grayTheme（排除只包含 main 的外层列容器）
  //    + 后代有 main.woo-box-flex（全页唯一，audit 实测 =1；排除弹层里其它的 .grayTheme）。
  //    fixed 浮钮不参与 flex 布局，order 对它无效，无需排除。
  const layout = [
    rule('div.woo-box-flex:has(> .grayTheme):has(main.woo-box-flex) > .grayTheme',
      'order:2 !important'),

    // ①b 信息流加宽的**宽度基准**（2026-10-16 真机修复，根因 ②）：_content_ 分栏层是
  //    fit-content 收缩盒（实测 753 = 190 + 563，margin 自动居中）——内层放开 width:auto
  //    只会让整条链收缩到内容固有宽。给它 width:100% 吃满外层行，flex 链才有自由空间
  //    可分配（包裹层 flex:1 ⇒ main ⇒ _full_ 逐层传导）；max-width:none 是防微博自身
  //    上限的保险。🔴 列宽变化 ⇒ 卡宽变化 ⇒ 换行数变化 ⇒ **改卡高** —— 首帧注入兜底。
    rule('div.woo-box-flex:has(> .grayTheme):has(main.woo-box-flex)',
      'width:100% !important;max-width:none !important'),

    // ② 信息流加宽吃掉右栏空档（用户 2026-10-16 拍板；「正文行长没问题」）：
    //    先收掉 _side_ 空壳 —— L1 ⑧ 的 display:none 只藏了 .wbpro-side-main 内容，
    //    probeL2 v2 实测壳仍占 282px+8px。这里收的是**壳**（main 的直接子、含 side-main 者）。
    //    ⚠️ 不能裸写 div:has(.wbpro-side-main) —— 外层匿名包裹层同样「包含」side-main，
    //    会把整条时间线一起收掉（B10 事故同款陷阱）；用 main 的直接子关系精确到壳。
    //    右栏在虚拟列表之外（A 类逻辑，§7.5.0），display:none 安全。
    rule('main.woo-box-flex > div:has(.wbpro-side-main)', 'display:none !important'),
    //    再让三层宽度放开、逐层吃满：匿名包裹层在 _content_ 里 flex:1 吃掉自由空间，
    //    main 与主列 _full_ 放开定宽跟随。窗口缩窄时 flex-shrink 默认 1 ⇒ 信息流跟随变窄
    //    （用户要求；_content_ 若是定宽 1122 则收窄到微博自身 simple 断点前不变，真机复验）。
    //    🔴 列宽变化 ⇒ 卡宽变化 ⇒ 换行数变化 ⇒ **改卡高** —— 首帧注入兜底，SIZE_EXEMPT 登记。
    rule('div:has(> main.woo-box-flex)',
      'flex:1 1 auto !important;width:auto !important;max-width:none !important'),
    rule('main.woo-box-flex', 'width:auto !important'),
    rule('main.woo-box-flex > div:has(.vue-recycle-scroller)',
      'flex:1 1 auto !important;width:auto !important;max-width:none !important'),

    // ③ 行代替卡 + 腾出时间列（同一条规则，同锚）：
    //    · background 透明 —— 卡底 #191919 在 article 上（probeTheme 实测），透明化后
    //      卡片融进页面底色 #111，「块」变成「行」；1px 分割线 L1 ④ 已有（box-shadow）。
    //    · padding-left —— 给时间列腾位（改高度项：正文换行数变化，首帧兜底）。
    //      摘要条（⑥）是 absolute、相对 padding 盒定位，left:0/right:0 不受内边距影响。
    rule(`${SEL_CARD[0]} article`,
      `padding-left:${TIME_COL_PAD}px !important;background:transparent !important`),

    // ④ 时间独立成列：时间锚 absolute 挂 article 坐标系。⚠️ 实测定位上下文是**衬距边缘**
    //    的 header/feed_body（微博自身 relative，根因 ③）——left 必须写补偿负值
    //    （TIME_COL_CSS_LEFT = 14 - 90），top 不受影响（上下文顶 = article 顶）。
    //    等宽字体 + 宽 48px 靠空格自然折成上下两行（§7.5-A）。
    //    选择器限定 `article > div > header`（卡 header 是 feed_body 的直接子）——
    //    转发块内部的时间锚在 .retweet 更深层，不会被这条捞走、原地不动。
    //    absolute 脱流后 header 原位只剩「来自 xx」来源条（probeL2 实测，无塌陷）；
    //    时间自身盒子的 font-size/width 只影响自己（脱流），不改卡高。
    rule(`${SEL_CARD[0]} article > div > header ${SEL_TIME_ANCHOR[0]}`,
      `position:absolute !important;left:${TIME_COL_CSS_LEFT}px !important;top:${TIME_COL_TOP}px !important`
      + `;width:${TIME_COL_W}px !important;white-space:normal !important`
      + ';font-family:ui-monospace,Consolas,monospace !important'
      + ';font-size:12px !important;line-height:1.4 !important'
      + ';color:var(--w-sub) !important;text-decoration:none !important'),

    // ⑤ L2 排版：13px / 1.5（§7.5-C 规范值；config 缺省时生效，显式设置则尊重用户值）。
    //    选择器与 L1 ⑧ 完全同构 —— 本文件拼在 L1 之后，同特异性靠后胜出。
    //    🔴 改高度项（字号行距 = 卡高变化），首帧兜底 + SIZE_EXEMPT 登记。
    rule(`${SEL_CARD[0]} ${SEL_OG_TEXT[0]},${SEL_CARD[0]} ${SEL_RE_TEXT[0]}`,
      `font-size:${fontSize}px !important;line-height:${lineHeight} !important`),
  ];

  // ⑥ 头像变体（§7.5.5；默认 β —— 2026-10-16 用户拍板「左上角向右下渐隐」）。
  //    只在 L2 生效（L1 保持 α 形态 = 原位降饱和，即 ① 的现状）。
  //    · α：无额外规则（L1 ① 的降饱和 + 降透明就是 α 形态）。
  //    · β：**不脱流** —— header 高度、卡高都不变；mask 渐隐是纯绘制效果。
  //      mask 色写 black 关键字：遮罩只取 alpha 通道、与主题色无关（l2 守卫放行 black 于 mask）。
    //    · γ：整盒（.woo-avatar-main，内联 52×52 那层）absolute 挪进时间列下方、缩到 22px；
    //      left 同时间锚走衬距补偿负值（根因 ③）；选择器限定卡 header 内 ⇒ 转发块的小头像
    //      原地不动。🔴 脱流后 header 高度塌缩（原 52px 由头像撑着）⇒ **改高度项**，
    //      首帧兜底 + SIZE_EXEMPT 登记；top 以该上下文顶（= article 顶）为基准。
    let avatar = '';
    if (variant === 'beta') {
      const mask = 'linear-gradient(135deg, black 20%, transparent 85%)';
      avatar = rule(`${SEL_CARD[0]} ${SEL_AVATAR[0]}`,
        `-webkit-mask-image:${mask} !important;mask-image:${mask} !important`);
    } else if (variant === 'gamma') {
      avatar = rule(`${SEL_CARD[0]} article > div > header .woo-avatar-main`,
        `position:absolute !important;left:${TIME_COL_CSS_LEFT}px !important;top:${GAMMA_AVATAR_TOP}px !important`
          + ';width:22px !important;height:22px !important');
    }

  return layout.concat(avatar ? [avatar] : []).join('\n') + '\n';
}
