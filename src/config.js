/**
 * 配置与存储（PROJECT.md §9）
 *
 * 配置落在 Tampermonkey 扩展存储里（GM_setValue），**不是可用记事本编辑的明文文件** ⇒
 * 必须提供导出 / 导入（M3 面板「配置」页）。本模块只负责读写与默认值合并。
 *
 * 首版面板控件上限 ≈14（§8.3 纪律 2）：用不上的项一律硬编码默认值，不进面板。
 */

export const STORAGE_KEY = 'specbase.config';

/**
 * 默认配置。字段名尽量与 PROJECT.md 的档位/条目对齐，方便面板直接绑定。
 */
export const DEFAULT_CONFIG = {
  version: 1,
  appearance: {
    /** L0 · 标签页伪装（§7.3，推荐常态开） */
    l0: true,
    /** L1 · 素净 */
    l1: false,
    /** L2 · 工作台重排（蕴含 L1） */
    l2: false,
    /**
     * L1 内的「媒体尺寸规则组」独立开关（B17 黑图归因，✅ 2026-10-15 结案）。
     * 归因背景：黑图与「媒体缩略化上线」时间相关（用户：改尺寸前无黑图、开后有）；
     * 刷新级开关三轮二分实锤 **凶手 = img 规则的 partial 形态**（height:100%+top:auto
     * 部分覆盖微博「尺寸+负偏移」配对内联 → 加载器首帧判定异常 → 单向锁存不挂 img）；
     * **修复 = cover 全接管**（width/height 100% + top/left 0 + object-fit:cover），
     * 用户真机实测无黑图。档位：
     * - `true`（默认）= cover 全接管形态（常态）
     * - `false` = 三条尺寸规则全不注入（归因对照；L1 其余一切保留）
     * - `'partial'` = 旧 partial 形态 —— 🔴 黑图凶手，仅存法证复现档，永不进默认路径
     * - 其他值按 true 处理（容错；`'all'` / `'cover'` 是合法别名）
     * 切档后必须刷新（首帧注入）。
     */
    mediaCaps: true,
    /**
     * 媒体缩略化的容器 max-height 上限（px）。**审美参数**：用户 2026-10-15 两轮下调
     * 140 → 110 → 90（「图片还是过大」；110 实测无黑图后继续压）。
     * 可在控制台 `__spb.appearance({ mediaMaxH: 80 })` + 刷新实时试值，试定后回改这里。
     * 非法值回退 90，越界夹回 [40, 400]。
     */
    mediaMaxH: 90,
    /**
     * 媒体格子的宽度上限（px）。null = **跟随 mediaMaxH**（正方格，默认）；
     * 显式数值可压得比高度更窄 ⇒ inline-block 流式自动换行、一行挤进更多列
     * （probeMedia3 实测 13/13 flow：u-col-3 容器 409.75px 在 90 宽装 4 列、72 宽装 5 列；
     * u-col-4 容器 546px 在 90 装 5 列、72 装 7 列）。
     * 控制台 `__spb.appearance({ mediaMaxW: 72 })` + 刷新试值。非法值回退跟随值，越界夹 [40, 400]。
     */
    mediaMaxW: null,
    /**
     * **多图网格专属**宽度上限（px，⑦c 二轮 2026-10-16）。背景：u-col-3 容器定宽
     * 409.75px，90 方格只能装 4 列（5×94=470 装不下）⇒ 用户真机反馈「有一些卡片
     * 还是 4 个一行」。76 ⇒ u-col-3 装 5 列（5×80=400）、u-col-4 装 6 列。
     * **只作用 u-col-3/u-col-4 行**，单图行保持 mediaMaxW 跟随高度（90 方格）——
     * 用户拍板「单图不跟着变窄」。控制台 `__spb.appearance({ mediaMaxWGrid: 72 })`
     * + 刷新可试值。非法值回退 76，越界夹 [40, 400]。
     */
    mediaMaxWGrid: 76,
    /**
     * 视频缩略化的高度上限（px，⑦d M4，2026-10-16 用户确认）。**null = 跟随 mediaMaxH**；
     * 宽恒按 16:9 换算（probeVideo 实锤播放器恒 16:9 宽度驱动）⇒ 90 ⇒ 160×90 无黑边小框。
     * 只作用**未播放态**（.vjs-paused）—— 起播自动还原全尺寸；真机复验「播放→暂停→滚动不留洞」。
     * 控制台 `__spb.appearance({ videoMaxH: 72 })` + 刷新试值。非法值回退跟随值，越界夹 [40, 400]。
     */
    videoMaxH: null,
    /**
     * 「+N」截断格全量展示（§12-B18，2026-10-15 用户诉求「>9 图能否全部展示」）。
     * 数据 = 详情接口 `/ajax/statuses/show?id=<bid>`（微博自用同源接口；页面 Vue
     * 数据在生产构建上摸不到，已探针定论）。渲染 = **高度中性重渲染**：量原网格
     * 矩形，同样大的盒子里排更密的网格（17 图 → 5×4 78×67 格），容器显式锁高
     * ⇒ 卡高一个像素不变，不碰虚拟列表 translateY 缓存。取数按 bid 缓存 +
     * 在途去重 + 失败 60s 冷却；只取视口附近（±300px）的卡。
     */
    morePics: true,
    /**
     * 正文字号（px，⑧）。**null = 跟随档位默认**（L1=14 / L2=13，§7.5-C）；
     * 显式设置则两档共用用户值。**改高度项**（走首帧注入），落地后真机复验「不留洞」。
     * 控制台 `__spb.appearance({ textFontSize: 13 })` + 刷新试值。
     * 非法值回退档位默认，越界夹回 [12, 20]。
     */
    textFontSize: null,
    /**
     * 正文行距（无单位比值，⑧）。**null = 跟随档位默认**（L1=1.6 / L2=1.5）。
     * 同属改高度项。非法值回退档位默认，越界夹回 [1.2, 2.2]。
     */
    textLineHeight: null,
    /**
     * 头像处理变体（§7.5.5，**只在 L2 生效**；L1 恒为 α 形态 = 原位降饱和）：
     * - 'alpha'：原位灰度小圆（现状，无额外规则）
     * - 'beta'：头像**图片**作为整行（自日期列起的 article）左上角背景、向右下渐隐
     *   （默认，2026-10-16 用户二次定稿，纠正「元素 mask」误实现）。原头像元素
     *   visibility:hidden 退场但保留占位 ⇒ 零高度影响；图片数据由扫描管线写成
     *   CSS 变量 --spb-avatar-bg，绘制在 article::before（尺寸见 avatarBgSize）
     * - 'gamma'：挪进时间列下方缩为 22px 小灰头像（🔴 脱流后 header 塌缩 = 改高度项）
     * 非法值回退 'beta'。
     */
    avatarVariant: 'beta',
    /**
     * β 水印边长（px，正方形 cover ⇒ 不变形）。非法值回退 120，越界夹回 [64, 320]。
     * 控制台 `__spb.appearance({ avatarBgSize: 96 })` + 刷新试值。
     */
    avatarBgSize: 120,
    /**
     * β 水印不透明度（2026-10-16 真机反馈「水印太亮压过时间文字」后补上，
     * 取规范表 §7.5.5 的 0.15~0.25 中值）。非法值回退 0.2，越界夹回 [0.05, 0.8]。
     * 控制台 `__spb.appearance({ avatarBgOpacity: 0.12 })` + 刷新试值。
     */
    avatarBgOpacity: 0.2,
    /**
     * 信息流列的左 margin（px，版面呼吸；2026-10-16 真机两轮定值 24→12）。
     * 非法值回退 12，越界夹回 [0, 64]。控制台 `__spb.appearance({ layoutMarginLeft: 16 })` + 刷新试值。
     */
    layoutMarginLeft: 12,
    /**
     * 信息流列与分类列（移到最右）之间的列间距（px；与 layoutMarginLeft 同轮定值 24→12）。
     * 非法值回退 12，越界夹回 [0, 64]。控制台 `__spb.appearance({ layoutGap: 16 })` + 刷新试值。
     */
    layoutGap: 12,
    /**
     * L2 品牌文案换中性（§7.5-F/G，§12-B20；probeBrand 真机取证后落地）。
     * JS 改写**整段命中白名单模板**的平台文案（chrome 文本 / title·aria-label·
     * placeholder·alt / logo SVG→SpecBase 文字标），用户正文绝不碰。
     * 仅在 l2 开启时生效；false 可单独关掉文案改写（L2 其余一切保留）。
     */
    brandNeutral: true,
    /**
     * L2 顶栏降显著（§7.5-F；2026-10-16 用户诉求「头像太显眼 / 橙色按钮明显」+ probeTopbar
     * 取证后落地）：顶栏头像与彩色图标/徽章灰度（内联 filter，零布局影响）+ 分类条整行
     * 收掉（CSS 侧 = l2.js ⓪ .wbpro-tab2；JS 侧收 _slot_ 行，含「高级搜索」残余）。
     * 仅在 l2 开启时生效；false 可单独关掉（L2 其余一切保留）。
     */
    topbarQuiet: true,
    /** 缩略图高度预设：40 | 60 | 80（§7.5.3，默认 60） */
    thumbHeight: 60,
    /** 悬停恢复彩色（§7.5.3，默认关） */
    hoverRestore: false,
    /** 面板热区位置：br | bl | tr | tl（§8.2，默认右下） */
    hotspotCorner: 'br',
  },
  filter: {
    /** 过滤总开关（§7.4 约束 3「可逆」）—— 关掉即清掉页面上全部标记并停止调度 */
    enabled: true,
    /** 关键词规则：[{ content, action: 'hide'|'highlight', fields: [...] }] */
    keywords: [],
    /** 正则模式（§8.3 过滤页） */
    regexMode: false,
    /** 广告识别三项开关（§8.3） */
    detect: { promo: true, recommend: true, embedded: true },
  },
  ui: {
    /** 首次安装提示是否已展示（§8.2 要点 1） */
    firstRunTipShown: false,
  },
};

/** 判断 GM_* 是否可用（离线单测 / 非 TM 环境下会缺失） */
export function hasGM() {
  return typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch === undefined ? base : patch;
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const key of Object.keys(patch)) {
    const bv = base ? base[key] : undefined;
    const pv = patch[key];
    if (bv && pv && typeof bv === 'object' && typeof pv === 'object' && !Array.isArray(bv) && !Array.isArray(pv)) {
      out[key] = deepMerge(bv, pv);
    } else {
      out[key] = pv;
    }
  }
  return out;
}

/** 读取配置（与默认值深合并，容忍旧版本缺字段） */
export function loadConfig() {
  let raw = null;
  try {
    raw = hasGM() ? GM_getValue(STORAGE_KEY, null) : null;
  } catch (_e) {
    raw = null;
  }
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch (_e) {
      raw = null;
    }
  }
  return deepMerge(DEFAULT_CONFIG, raw || {});
}

/** 写回配置 */
export function saveConfig(config) {
  if (!hasGM()) return false;
  try {
    GM_setValue(STORAGE_KEY, JSON.stringify(config));
    return true;
  } catch (_e) {
    return false;
  }
}
