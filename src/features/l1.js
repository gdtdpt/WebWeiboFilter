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

    // ⑥ A1：互动按钮行 → 缩略为摘要条（2026-10-15 用户拍板方案 ②，§12-B15）
    //    用户诉求（原话）：「还是希望看到原微博的转发评论列表，但是又不想用 hover
    //    这种容易被误触的方式」⇒ footer 整行收掉（卡真实矮 40px），由 apply/summary.js
    //    在原位置叠一条摘要条 <a>（「52 转发 · 3 评论 · 21 赞」），**点一下**直达详情页。
    //
    //    ⚠️⚠️ 这是**登记过的改高度项**（`tests/l1.test.mjs` 的 SIZE_EXEMPT 里有名有姓）：
    //    §12-B12 已验「首帧注入的 CSS 会被算进虚拟列表尺寸缓存」⇒ 缓存按矮卡建 ⇒ 预期无洞，
    //    但**真机复验「不留洞」仍是唯一防线**（滚动 + 反复上下 + `__spb.off()` 恢复）。
    //    直接子选择器天然避开转发块内部自己的 footer（§12-B13 ①）。
    rule(`${SEL_CARD[0]} ${SEL_ACTION_BAR[0]}`, 'display:none !important'),
    //    摘要条的定位上下文：article 转 relative **不占布局、不参与高度**（relative 只挪坐标原点，
    //    盒子留在原处）⇒ 零高度影响。⚠️ 真机要顺带看一眼卡内有没有绝对定位的微博元素
    //    因定位上下文改变而错位（目前已知卡内视频控件锚在自己的 .video-js 上，不受影响）。
    rule(`${SEL_CARD[0]} article`, 'position:relative !important'),
    //    摘要条本体：绝对定位浮在 footer 腾出的空间里，**不进布局流** ⇒ 它的建立 / 更新 /
    //    摘除永远不改卡片高度。整条是 <a>（刻意点击，无 hover —— 用户明确不要 hover）。
    rule(SUMMARY_SEL[0],
      'position:absolute !important;left:0 !important;right:0 !important;bottom:0 !important'
      + ';display:flex !important;align-items:center !important;justify-content:center !important'
      + ';font-size:13px !important;color:var(--w-sub) !important;opacity:.6 !important'
      + ';text-decoration:none !important;z-index:1 !important'),

    // ⑤ 外壳：logo 灰化（SVG 内的 fill 是硬编码的微博红，只能用滤镜压）。
    //    ⚠️ logo 是**伪装层**（§7.5-G「SpecBase」身份的一部分），不是内容配色 ——
    //    这里保持 grayscale 而不是降饱和：品牌红的识别度必须压掉，属刻意的例外。
    rule(`${SEL_LOGO[0]} svg`, 'filter:grayscale(1) !important;opacity:.5 !important'),
  ].join('\n') + '\n';
}

/** 规则条数（探针 / 诊断页断言用；改 `l1Css()` 时记得同步） */
export const L1_RULE_COUNT = 16;
