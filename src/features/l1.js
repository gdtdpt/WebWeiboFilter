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
 *    媒体缩略化（视频封面同样是"降饱和已做、缩略化待做"）。
 * ⚠️ 已**不**在"待隐藏"名单里：**社交归因条**（「xx 赞过 / xx 关注了」）——
 *    2026-10-14 用户定调「**保留信息、只做中性化**」（§7.5-E），见下面 ③b。
 * ✅ 互动按钮行（A1）已落地为「缩略为摘要条」（⑥，改高度项，§12-B15）。
 */

import {
  SEL_CARD, SEL_AVATAR, SEL_OG_TEXT, SEL_RE_TEXT, SEL_TEXTCUT, SEL_MEDIA,
  SEL_VIDEO_PLAYER, SEL_VIDEO_POSTER, SEL_VIDEO_TECH,
  SEL_SOCIAL_ROW, SEL_SOCIAL_NAME, SEL_SOCIAL_MORE,
  SEL_ACTION_BAR,
} from '../adapters/weibo-home.js';
import { SEL_BADGE, SEL_LOGO } from '../adapters/weibo-shell.js';
import { SUMMARY_SEL } from '../apply/summary.js';

/** 正文容器族（原创正文 / 转发原文 / 截断容器） */
const TEXT_SEL = [SEL_OG_TEXT[0], SEL_RE_TEXT[0], SEL_TEXTCUT[0]].join(',');

/** 正文内的链接（话题 / `@` / 外链） */
const TEXT_LINK_SEL = [SEL_OG_TEXT[0], SEL_RE_TEXT[0], SEL_TEXTCUT[0]]
  .map((s) => `${s} a`).join(',');

function rule(selector, body) {
  return selector + '{' + body + '}';
}

/**
 * 媒体缩略化的默认上限（px）。**审美参数**（用户 2026-10-15「图片还是过大，再小一点」，
 * 从 140 压到 110；横图 126 / 九宫格 132.6 从此不再免疫，尺寸更统一）——
 * 可通过 `appearance.mediaMaxH` 覆盖（`__spb.appearance({ mediaMaxH: 96 })` + 刷新即可试值）。
 */
export const DEFAULT_MEDIA_MAX_H = 110;

/** 容错：非法值（非数值 / 非正数）回退默认，越界值夹回 [40, 400] */
function normalizeMaxH(v) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MEDIA_MAX_H;
  return Math.min(400, Math.max(40, Math.round(n)));
}

/**
 * 生成 L1 的 CSS 文本。逐组说明「为什么它不改高度」。
 *
 * @param {Object} [cfg] 完整配置；`cfg.appearance.mediaCaps` 门控 ⑦/⑦b 三条媒体尺寸规则
 *   （B17 黑图归因，✅ 已结案 2026-10-15，见 config.js 注释；L1 其余规则一律不受影响）：
 *   - `true` / 缺省 / `'all'` / `'cover'` / 未知值 = **cover 全接管形态**（默认，真机实锤无黑图）
 *   - `false` = 三条全摘（归因对照；已实测无黑图）
 *   - `'partial'` = 旧 partial 形态（height:100%+top:auto）—— 🔴 **B17 黑图凶手**，
 *     仅留作法证复现档，**永不进默认路径**
 *   `cfg.appearance.mediaMaxH` = 容器 max-height 上限（默认 {@link DEFAULT_MEDIA_MAX_H}）。
 * @returns {string}
 */
export function l1Css(cfg) {
  const a = cfg && cfg.appearance ? cfg.appearance : {};
  const mc = a.mediaCaps;
  const mode = mc === false ? 'off' : mc === 'partial' ? 'partial' : 'all';
  const capPx = normalizeMaxH(a.mediaMaxH);
  // img 规则的两种形态（B17 结案 2026-10-15：'partial' 形态 = 黑图凶手，'cover' = 修复）：
  // · 'partial'（height:100%+top:auto）—— 🔴 真机实锤致「空 slot 黑图」（'noRow' 档黑、
  //   'onlyCap' 档净，刷新级二分三轮）。机制：微博 JS 裁切给 img 写「尺寸+负偏移」**配对**内联
  //   （竖图 height:133%+top:-33%，横图 height:100%+width:180%+left:-34%），partial 部分覆盖
  //   这对内联 ⇒ 加载器首帧读到自相矛盾的几何 → 判定异常 → **单向锁存**不挂 img。
  //   仅存 'partial' 法证档，不进默认路径。
  // · 'cover' —— 修复（真机实锤干净）：**全几何接管**（width/height 100% + top/left 0 +
  //   object-fit:cover），把配对内联**整体**作废 —— 没有残留偏移可错，也不需要
  //   微博的 JS 裁切（CSS 原生 cover 居中裁切；微博用 JS 方案是为了智能取景，我们不在乎）。
  //   同时天然消掉 34.6px 竖图错位与 84px 单图行空白。
  const imgMode = mode; // 'all' 与 'partial' 都注入 img 规则，只是形态不同
  const keep = {
    img: imgMode !== 'off',
    row: mode !== 'off',
    cap: mode !== 'off', // 除 false 全摘外，max-height 恒保留
  };
  const IMG_RULE =
    imgMode === 'all'
      ? 'width:100% !important;height:100% !important;top:0 !important;left:0 !important'
        + ';object-fit:cover !important'
      : 'height:100% !important;top:auto !important';
  // ⑦+⑦b 媒体尺寸规则组（mediaCaps 门控；每条的完整设计说明见下方各处注释）
  const mediaSizing = [
    keep.img
      ? //    作用域与容器规则同轮收窄（评论面板豁免，见 ⑦ 注）。
        rule(`${SEL_CARD[0]} .wbpro-feed-content .woo-picture-main img,${SEL_CARD[0]} .retweet .woo-picture-main img`,
          IMG_RULE)
      : '',
    keep.row
      ? // ⑦b 单图行容器（2026-10-15 真机验收踩坑修正）：**显式 height 不止 picture-main 一处** ——
        //    外层行 `.u-col-1` 带着**同样的内联 height:224px**（夹具四份 10/10：卡内 u-col-1 全部
        //    且仅是单图行，九宫格走 u-col-3/4 且无内联高度）。只压内层 ⇒ 图缩了、行没缩，
        //    卡片下方留 84px 空白（用户截图实锤）。修法 = 行高 `height:auto` 压掉重复的内联高度，
        //    让行回归**内容高**（图已被 ⑦ 压到上限内；数值法语义不变）。
        //    ⚠️ 不能给 u-col-1 也上 max-height —— 万一微博哪天把更高的合法内容放进行里，
        //    auto 只「去掉重复声明」、不引入新的裁切面，比再压一次 140 更保守。
        //    作用域同轮收窄（评论面板豁免，见 ⑦ 注）。
        rule(`${SEL_CARD[0]} .wbpro-feed-content .u-col-1,${SEL_CARD[0]} .retweet .u-col-1`,
          'height:auto !important')
      : '',
    keep.cap
      ? //    容器压高放最后（⑦ 本体；读数依据与收窄说明见 ⑦ 注释块）。
        rule(`${SEL_CARD[0]} .wbpro-feed-content .woo-picture-main,${SEL_CARD[0]} .retweet .woo-picture-main`,
          `max-height:${capPx}px !important`)
      : '',
  ].filter(Boolean);

  return [
    // ① 身份信号：头像降饱和（**保持原尺寸与色相**，2026-10-14 用户定调「降彩度不灭色相」）
    //    ⚠️ 不用 grayscale(1) —— 全灰会丢掉头像的可辨识度；saturate(.4) 只是让它不扎眼。
    rule(SEL_AVATAR.join(','), 'filter:saturate(.4) !important;opacity:.8 !important'),
    // ⚠️ 只隐藏**徽标图形本身**（叶子节点）：父级 `woo-icon-main` 带内联 16×16，
    //    留着它 ⇒ 宽度也没变，是真正的零布局变化（隐藏父级会少 16px 宽）。
    rule(SEL_BADGE.join(','), 'display:none !important'),

    // ② 媒体：降饱和（**不改尺寸、不灭色相**；缩略化属第二批）
    rule(`${SEL_MEDIA[0]} img`, 'filter:saturate(.4) !important;opacity:.85 !important'),

    // ②b 视频：封面 / 暂停帧降饱和 —— 和图片同一套手法（用户反馈 2026-10-14：视频封面一直全彩）。
    //     根因：视频卡里**没有 `woo-picture`**（见适配层 `SEL_VIDEO_PLAYER` 的注释），
    //     上面那条媒体规则盖不到它 ⇒ 未播放的视频封面就是整页最扎眼的一块。
    //     · 只作用于**信息流卡片内**的播放器（`SEL_CARD` 前缀）。这不只是"缩小打击面"，而是**语义**：
    //       卡片外还挂着微博自己的小窗播放器（`div.mini-player` → `div#vjs_video_3`，
    //       实测每个页面恒定 1 个、静态时 `display:none`、无封面）—— 那是**用户主动弹出的**播放器，
    //       不该被我们按"躺在时间线上没人看"的待遇处理。实测三层相等：
    //       卡内 `.video-js` == 卡内 `.vjs-poster img` == 卡内 `video.vjs-tech`（四份夹具全部成立，有测试守着）。
    //     · 封面 `vjs-poster img`：注入一条 filter 就够 —— video.js 起播后会把 poster 层自己
    //       `display:none`，所以**不需要**再写「未播放」的状态判断。
    //     · 暂停帧 `video.vjs-tech`：**选择器里带上 `.vjs-paused`** —— 播放时 video.js 会把
    //       根节点的 `vjs-paused` 换成 `vjs-playing`，规则自然失效、颜色自动回来
    //       （因此不必再补一条 `filter:none` 的反向覆盖，少一条规则就少一个漂移点）。
    //       ⚠️ 全屏时（`.vjs-fullscreen`）不淡化：那时用户是**主动在看**，画面不该被我们动手。
    //     · ⛔ 绝不把 filter 打在播放器根 `.video-js` 上：那会新建层叠上下文，把播放按钮与
    //       控制条一起卷进滤镜，还会把整块播放器提成一个合成层。
    rule(`${SEL_CARD[0]} ${SEL_VIDEO_POSTER[0]} img`,
      'filter:saturate(.4) !important;opacity:.85 !important'),
    rule(`${SEL_CARD[0]} ${SEL_VIDEO_PLAYER[0]}.vjs-paused:not(.vjs-fullscreen) ${SEL_VIDEO_TECH[0]}`,
      'filter:saturate(.4) !important'),

    // ③ 正文：文字色转中性；链接 / 话题 / @ 去蓝、去下划线、去话题底色（颜色不占布局 ⇒ 零高度影响）
    //    `var(--w-main)` = 当前主题的正文色（浅色≈#333，深色≈#bfbfbf）
    rule(TEXT_SEL, 'color:var(--w-main) !important'),
    rule(TEXT_LINK_SEL,
      'color:var(--w-sub) !important;text-decoration:none !important;background:none !important'),

    // ③b 社交归因条（「xx 赞过」/「xx 关注了」）—— **刻意保留、只做中性化**（2026-10-14 用户定调，§7.5-E）
    //     它回答「**这条我没关注的人发的微博，为什么出现在这里**」⇒ 有信息价值，**不进隐藏名单**。
    //     做法与正文链接同构（去蓝、去下划线、转中性色）—— 它本质就是「几个链接 + 一句文案」。
    //     ⚠️ 昵称必须**单独覆盖**：微博给链接显式设了色（蓝），父级的 color 继承会被它盖住。
    rule(SEL_SOCIAL_NAME[0],
      'color:var(--w-sub) !important;text-decoration:none !important;background:none !important'),
    //     整行设色 ⇒ 「和」「关注了」这些**文本节点**跟着继承（它们自己没有选择器可锚）。
    rule(SEL_SOCIAL_ROW[0], 'color:var(--w-sub) !important'),
    //     行尾「更多」下拉箭头（微博原生的「不感兴趣 / 屏蔽此类」入口）：用户 2026-10-14 决定隐藏。
    //     🔴 **用 `visibility:hidden` 而不是 `display:none`** —— 真机实测（2026-10-14 16:52）：
    //        `display:none` 让归因条从 35px 变成 **34.5px**（那 0.5px 差值说明高度**不纯**是内边距撑的，
    //        图标参与了 0.5px 的行盒计算）。改动高度是本项目红线（§12-B2/B12），哪怕 0.5px 也不行
    //        —— 切档后强制刷新时首帧缓存会按 34.5 建、暂无洞，但纪律是「测出变了就退回」，
    //        本条正属此列。`visibility:hidden` 保证零布局变化，代价只是右侧留一小块空白。
    //     ⛔ 绝不裸锚 `.woo-font--angleDown` —— 它是通用字体图标，实测一页 12 个里只有 6 个属于归因条。
    rule(`${SEL_SOCIAL_ROW[0]} ${SEL_SOCIAL_MORE[0]}`, 'visibility:hidden !important'),

    // ④ 卡片：去阴影、去圆角，改用一条 1px 的**内阴影**做分割线
    //    ⚠️ 用 box-shadow 而不是 border-bottom —— border 会占 1px 布局 ⇒ 改高度。
    //    颜色取 `--w-dividing-line`（浅色≈#f2f2f2，深色=#222）—— 写死颜色会在另一套主题上变成白线。
    rule(SEL_CARD[0], 'border-radius:0 !important;box-shadow:0 1px 0 var(--w-dividing-line) !important'),
    // 卡片外壳（article 及其下一层）通常自带圆角与投影，一并压掉；
    // 只走两层，避免把视频控件等深层元素的样式一起杀掉。
    rule(`${SEL_CARD[0]} > *,${SEL_CARD[0]} > * > *`, 'border-radius:0 !important;box-shadow:none !important'),

    // ⑥ A1：互动按钮行 → 空位摘要条（§12-B15；2026-10-15 用户**四轮**定稿）
    //    用户诉求（原话）：「还是希望看到原微博的转发评论列表，但是又不想用 hover
    //    这种容易被误触的方式」⇒ 由 apply/summary.js 在 footer 原位置叠一条摘要条
    //    <a>（「52 转发 · 3 评论 · 21 赞」）。
    //    🔴 **四轮定稿（probeFeed3 实测钉死）**：摘要条点击 = **转发给被隐藏的原生
    //    评论开关**（`visibility:hidden` 挡得住真手、挡不住程序化 click）——
    //    原生按钮是**开关**：click 展开评论区（卡高 329.5→548），再 click 收起；
    //    增高走 Vue 合法路径（组件状态驱动 scroller 重测，§12-B2 只约束外部 CSS）。
    //    初稿「点一下跳详情页」太重，已废；跳详情入口仍由原生「查看全部评论」承担。
    //    🔴 **二轮修正（同日真机反馈）**：最初 footer `display:none` 收掉 40px（改高度），
    //    摘要条浮在腾出的空间里 —— 但腾出的空间高度**随卡内容不同**（视频/大图贴底），
    //    浮条落点不一致、必然遮挡媒体，用户判「不美观」。⇒ 定稿：footer **不收了**，
    //    改 `visibility:hidden`（40px 空位保留 —— 那里本来就是空的），摘要条永远落在
    //    空位上，**不遮挡任何内容、观感恒定**；代价是放弃 -40px（A1 退化为零高度影响项）。
    //    「改高度批次第一枪」由此让位给后续项；真收口重排仍属 L2。
    rule(`${SEL_CARD[0]} ${SEL_ACTION_BAR[0]}`, 'visibility:hidden !important'),
    //    摘要条的定位上下文：article 转 relative **不占布局、不参与高度**（relative 只挪坐标原点，
    //    盒子留在原处）⇒ 零高度影响。⚠️ 真机要顺带看一眼卡内有没有绝对定位的微博元素
    //    因定位上下文改变而错位（目前已知卡内视频控件锚在自己的 .video-js 上，不受影响）。
    rule(`${SEL_CARD[0]} article`, 'position:relative !important'),
    //    摘要条本体：绝对定位浮在 footer 的空位上，**不进布局流** ⇒ 它的建立 / 更新 /
    //    摘除永远不改卡片高度。整条是 <a>（刻意点击，无 hover —— 用户明确不要 hover）。
    //    ⚠️ 不透明底色 + 高 z 序是**兜底**（2026-10-15 真机：视频贴底卡上曾被播放器压住）
    //    —— 空位定稿后正常情况不与任何内容重叠，但底色保证万一重叠也不透字。
    rule(SUMMARY_SEL[0],
      'position:absolute !important;left:0 !important;right:0 !important;bottom:0 !important'
      + ';display:flex !important;align-items:center !important;justify-content:center !important'
      + ';font-size:13px !important;color:var(--w-sub) !important;opacity:.6 !important'
      + ';background:var(--w-card-background) !important;z-index:30 !important'
      + ';text-decoration:none !important'),

    // ⑥b 转发原文的交互按钮行 → 与卡自身**同一套设计语言**（2026-10-15 用户拍板，
    //     着眼点：整个界面最终要改成 L2 的日志/工单形态，现在就统一视觉语言）——
    //     原行 `visibility:hidden`（空间保留），apply/summary.js 在原位叠转发摘要条
    //     「原微博 · 7-11 17:30 · 18 转发 · 8 评论 · 156 赞」，点击**同样转发给
    //     转发块自己的原生评论开关**（作用域收窄防串台，见 apply/summary.js），
    //     原微博详情页入口仍由摘要条 href 降级兜底（代理失败时不跳）。
    //     （初稿只做 color+opacity 中性化，真机反馈「与原版区别不大」⇒ 升级为换语言。）
    //     `.retweet` 是**语义类**（四份快照 13 处全部一致、每个恰好 1 个 footer）；卡内限定防误伤。
    rule(`${SEL_CARD[0]} .retweet footer`, 'visibility:hidden !important'),
    rule(`${SEL_CARD[0]} .retweet`, 'position:relative !important'),

    // ⑦ 媒体缩略化（2026-10-15 用户拍板；上限现由 `mediaMaxH` 控制，默认 110px，§12-B16/B17）
    //    —— **改高度项，SIZE_EXEMPT 有登记**
    //    probeMedia() 真机读数（11 卡 9 媒体块）：高度全是**显式固定像素**（竖图容器 224px、
    //    横图 126px、九宫格格子 132.6px），img `position:absolute + object-fit:cover` 内建
    //    ⇒ 手法 = 容器 `max-height` 压过显式 height（标准 CSS 行为）+ img 全几何接管（cover 形态）。
    //    ⭐ 数值法的妙处：**只有高于阈值的媒体被压** —— 上限 140 时代横图 126 / 九宫格 132.6
    //    天然免疫；2026-10-15 用户「图片还是过大」压到 110 后横图 / 九宫格一并入笼（尺寸更统一）。
    //    锚 `.woo-picture-main`（**库类**，probeMedia 四快照一致）；图片源全是 orj360 缩略图 ⇒ 不损清晰度。
    //    🔴 **三轮收窄（2026-10-15 真机实锤）**：评论面板（摘要条点开的原生评论区）在**卡内**、
    //    复用同一批组件类 ⇒ 裸的「卡内 .woo-picture-main」会**误伤评论图**（错位 + 黑框，
    //    用户截图）。夹具四份 61/61：卡内 woo-picture-main **全部**在 `.wbpro-feed-content`
    //    或 `.retweet` 之内 ⇒ 收窄到这两个区域，信息流行为零变化、评论面板天然豁免
    //    （面板是 feed-content 的兄弟区域；probeComments() 首轮读数再钉死面板位置）。
    //    ⚠️ 真机复验「不留洞」是唯一防线（改高度项纪律）；**视频不动**（vjs 内部布局，二期单独评估）。
    //    ⚠️ 这三条规则**受 `mediaCaps` 门控**（见函数头）—— B17 黑图归因：用户观察
    //    「改尺寸前无黑图、媒体缩略化上线后有」是强时间相关性，三条规则里哪条（或组合）
    //    干扰了微博懒加载的首帧决策（假设：布局变化 → 加载器判定异常 → **单向锁存**不挂 img），
    //    只能靠「mediaCaps:false + 刷新」的速率对照来二分，现场摘除测不出锁存路径。
    ...mediaSizing,

    // ⑧ 右栏整体隐藏（2026-10-15 用户定调「热搜列表 / 感兴趣的人没什么意义」，§12-B16 ⑧）
    //    旧结论「无需落地」（B9：内容宽 < 1122px 时微博自己收起右栏）被推翻 —— 用户宽窗口
    //    是常态，右栏长期可见。probeFeed3() 活页采样拿到锚点：右栏容器 = `.wbpro-side-main`
    //    （库前缀 wbpro-*，链：wbpro-side-main > hotBand > .wbpro-side(面板) > .wbpro-side-tit），
    //    热搜 / 推荐关注 / 创作者中心面板全在其中。
    //    ⚠️ display:none 在这里**安全** —— 右栏在虚拟列表**之外**、正常流式布局
    //    （A 类逻辑：流外容器可收掉，§7.5.0），与 B10 事故（信息流共享匿名 div）不同源。
    //    ⛔ 不用 visibility —— 右栏收掉后主列该占满就占满，留白无意义。
    //    副作用：主列变宽 ⇒ 信息流卡变宽 ⇒ 格子图更常超 140 阈值（⑦ 已天然处理），无洞风险。
    rule('.wbpro-side-main', 'display:none !important'),

    // ⑤ 外壳：logo 灰化（SVG 内的 fill 是硬编码的微博红，只能用滤镜压）。
    //    ⚠️ logo 是**伪装层**（§7.5-G「SpecBase」身份的一部分），不是内容配色 ——
    //    这里保持 grayscale 而不是降饱和：品牌红的识别度必须压掉，属刻意的例外。
    rule(`${SEL_LOGO[0]} svg`, 'filter:grayscale(1) !important;opacity:.5 !important'),
  ].join('\n') + '\n';
}

/** 规则条数（探针 / 诊断页断言用；改 `l1Css()` 时记得同步） */
export const L1_RULE_COUNT = 22;
