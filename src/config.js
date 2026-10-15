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
     * 「+N」截断格全量展示（§12-B18，2026-10-15 用户诉求「>9 图能否全部展示」）。
     * 数据 = 详情接口 `/ajax/statuses/show?id=<bid>`（微博自用同源接口；页面 Vue
     * 数据在生产构建上摸不到，已探针定论）。渲染 = **高度中性重渲染**：量原网格
     * 矩形，同样大的盒子里排更密的网格（17 图 → 5×4 78×67 格），容器显式锁高
     * ⇒ 卡高一个像素不变，不碰虚拟列表 translateY 缓存。取数按 bid 缓存 +
     * 在途去重 + 失败 60s 冷却；只取视口附近（±300px）的卡。
     */
    morePics: true,
    /** 头像处理变体：alpha | beta | gamma（§7.5.5，默认 α） */
    avatarVariant: 'alpha',
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
