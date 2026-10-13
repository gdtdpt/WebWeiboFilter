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
