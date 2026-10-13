/**
 * 广告识别（PROJECT.md §12-B1）—— 判定核心的一部分
 *
 * 纪律（§6）：**纯函数，绝不碰 DOM。** 输入是适配层抽出的「信号包」，输出是判定结果。
 * 这里的每一条判据都来自 M0 侦察的**实测证据**（2026-10-13，四份 DOM 快照），
 * 证据原文见每条常量上方的注释。**不要凭猜测加规则 —— 先补样本、再改这里。**
 *
 * ─── 实测样本（tests/fixtures/，私有不入库）──────────────────────────
 *   1440（8 卡）   无广告
 *   1449（13 卡）  A 类 banner ✔    B 类推广卡 ✔「饼干姐 / OiiOii」
 *   1505（12 卡）  A 类 banner ✔    无 B 类
 *   1505(1)（6卡） A 类 banner ✔    B 类推广卡 ✔「叫我老伯 / 京东双11」
 *
 * ─── 结论：微博的广告是**两类**，判据完全不同 ────────────────────────
 *   A 类 = 页面级 banner 广告位（发布器下方，**不在信息流里**）
 *          → 纯图片 + 广告 CDN + 自带关闭按钮。不涉及虚拟列表高度问题。
 *   B 类 = 信息流内的推广卡（在 .wbpro-scroller-item 里）
 *          → 走 §12-B1 的四路判据。
 *
 * ─── 反面结论（同样重要，避免走弯路）──────────────────────────────
 *   ❌ 卡片修饰符区分不了广告：广告卡与自然卡同为
 *      `_wrap_ecgcn_2 _normal_ecgcn_34`（连续两次快照均如此）。
 *   ❌ class 里没有 ad / promo / sponsor 任何令牌 —— 四份快照全部为 0。
 *   ❌ 文案里搜不到「广告」二字：banner 上的「广告」标识是**烤在图片里**的。
 *   ⚠️ `div.wbpro-tag-img`（认证图标 `icon_auth_black.png`）出现在**自然卡**上，
 *      **不是**广告信号 —— 别把「标签槽存在」当成广告。
 */

// ============================================================ 判据常量

/**
 * 卡片头部标签槽的推广文案。
 * 实测：1505(1) 的推广卡头部为
 *   `<div class="wbpro-tag wbpro-tag-c2">…<div>荐读</div>`，
 * 而两张无广告快照里 `div.wbpro-tag` 计数为 0。
 * ⚠️ 样本只有「荐读」一条文字样本；其余为按微博文案习惯的预置，**待补样本确认**。
 */
export const AD_TAG_TEXTS = [
  '广告', '推广', '荐读', '热推', '品牌推广', '商业推广', '赞助',
  'Sponsored', 'Promoted', 'Advertisement',
];

/**
 * 广告跳转埋点。出现在卡内任意 `<a href>` / URL 里即为**强判据**。
 *
 * 实测共发现**三个变体**（按可信度排序，`matchAdUrl` 返回第一个命中的 id）：
 *
 *  ① `campaign` —— 商业投放（**最硬**）
 *     `shop.sc.weibo.com/h5/sclick/index?mark=3_reallog_mark_ad%3A8%7C3_<19位活动ID>`
 *     解码后：`mark=3_reallog_mark_ad:8|3_1791875133631432656708000038139964`
 *     命中计数：1440=0 / 1449=12 / 1505=0 / 1505(1)=6
 *
 *  ② `natural` —— 原生 / 视频广告
 *     `video.weibo.com/show?fid=1034:…&mark_id=999_reallog_mark_ad%3A999%7CWeiboADNatural`
 *     解码后：`mark_id=999_reallog_mark_ad:999|WeiboADNatural`
 *     命中计数：1440=0 / 1449=2 / 1505=0 / 1505(1)=0
 *     ⚠️ **待观察**：样本里它出现在一条「帖子看着自然、但内嵌广告视频」的卡上。
 *     干净快照 1505 也有 3 条 `video.weibo.com/show` 链接却**不带**该埋点 ⇒ 判别力成立（不是「凡视频都算」）。
 *     但「该不该把整张卡判为广告」建议再攒几个样本后与用户确认。
 *
 *  ③ `weiboad` —— 广告短链令牌 `…_weiboad=`（实测：`shorturl.biz.weibo.cn/…&63c25…_weiboad=`）
 *     ④ `sclick` / `spm_mark` —— 电商广告跳转与投放位标记（实测）
 *
 * 对照：**自然卡**的电商链接是 `shop.sc.weibo.com/h5/goods/index?…&vs=weibo_feed`（不带任何埋点）。
 */
export const AD_URL_MARKERS = [
  {
    id: 'campaign',
    label: '商业投放',
    re: /3_reallog_mark_ad/i,
    desc: '微博信息流商业广告埋点（实测，带 19 位活动 ID）',
  },
  {
    id: 'natural',
    label: '原生/视频广告',
    re: /999_reallog_mark_ad|WeiboADNatural/i,
    desc: '微博原生 / 视频广告埋点（实测 WeiboADNatural）',
  },
  {
    id: 'reallog_mark_ad',
    label: '其它 reallog 广告',
    re: /reallog_mark_ad/i,
    desc: '兜底：其它形态的 reallog 广告埋点',
  },
  { id: 'weiboad', label: '广告短链', re: /_weiboad=/i, desc: '微博广告短链令牌（实测）' },
  { id: 'sclick', label: '电商广告跳转', re: /\/h5\/sclick\//i, desc: '微博电商广告跳转服务（实测）' },
  { id: 'spm_mark', label: '投放位标记', re: /[?&]spm_mark=/i, desc: '投放位标记（实测）' },
];

/**
 * 微博广告投放 CDN。
 * 实测：A 类 banner 的图片固定来自 `kadmimage.biz.weibo.com`（四份快照中三份命中）。
 * 命中计数：1440=0 / 1449=1 / 1505=1 / 1505(1)=1
 */
export const AD_IMG_HOSTS = [
  'kadmimage.biz.weibo.com',
  'kadm.biz.weibo.com',
  'sinaads.cn',
  'ad.sina.com.cn',
  'sax.sina.com.cn',
];

/**
 * A 类广告位自带的「关闭」图标。
 * 实测：`https://h5.sinaimg.cn/upload/1005/948/2022/09/21/close.png`
 * 出现在 banner 的 `woo-picture-slot` 里 —— 说明它本身就是微博给的「可关广告位」。
 */
export const AD_CLOSE_ICON = '948/2022/09/21/close.png';

/** 计分权重：≥ STRONG 即单独足以判定为广告 */
export const WEIGHT = {
  urlMarker: 3,
  adHost: 3,
  tagText: 3,
  followButton: 2,   // 启发式：单独不够，需配合其他信号
};
export const AD_THRESHOLD = 3;

// ============================================================ 单点匹配

function trimStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

/**
 * URL 是否带广告埋点。
 * @param {string} url
 * @returns {string|null} 命中的 marker id（见 AD_URL_MARKERS）；未命中返回 null
 */
export function matchAdUrl(url) {
  const u = trimStr(url);
  if (!u) return null;
  for (const m of AD_URL_MARKERS) {
    if (m.re.test(u)) return m.id;
  }
  return null;
}

/** marker id → 人类可读标签（§9 可解释性：理由要给用户看得懂） */
export function adMarkerLabel(id) {
  const m = AD_URL_MARKERS.find((x) => x.id === id);
  return m ? m.label : id;
}

/**
 * 图片地址是否来自广告 CDN。
 * @param {string} src
 * @returns {string|null} 命中的主机；未命中返回 null
 */
export function matchAdHost(src) {
  const s = trimStr(src);
  if (!s) return null;
  for (const h of AD_IMG_HOSTS) {
    if (s.includes(h)) return h;
  }
  return null;
}

/**
 * 标签文案是否是推广标签。**整串精确比对**（避免「广告位招租」之类误伤）。
 * @param {string} text
 * @returns {string|null} 命中的标签文案
 */
export function matchAdTag(text) {
  const t = trimStr(text);
  if (!t) return null;
  for (const tag of AD_TAG_TEXTS) {
    if (t === tag) return tag;
  }
  return null;
}

/** 是否是广告位自带的关闭图标 */
export function isAdCloseIcon(src) {
  return trimStr(src).includes(AD_CLOSE_ICON);
}

// ============================================================ 卡片判定

/**
 * @typedef {Object} FeedItemSignals  适配层（第 ③ 层）从一张卡抽出的信号包
 * @property {string[]} [urls]            卡内所有 <a href>（正文外链尤其重要）
 * @property {string[]} [tagTexts]        卡内标签槽的文案（div.wbpro-tag 的文本）
 * @property {string[]} [imgSrcs]         卡内所有 <img src>
 * @property {boolean}  [hasFollowButton] 卡内是否有「关注」按钮 button[_followbtn_*]
 *
 * @typedef {Object} AdVerdict
 * @property {boolean}  isAd
 * @property {number}   score
 * @property {string[]} reasons   命中的理由（§9「可解释性」纪律：必须能告诉用户为什么）
 * @property {boolean}  suspect   证据不足但可疑（如只命中「关注按钮」）
 */

/**
 * 判定一张**信息流卡**是否为推广卡（B 类）。
 *
 * 实测支持：
 *   - 1505(1) 推广卡「叫我老伯/京东」：urlMarker ✔ + followButton ✔ + tagText(荐读) ✔
 *   - 1449   推广卡「饼干姐/OiiOii」：urlMarker ✔ + followButton ✔（无文字标签）
 *   - 1505   无广告快照：三者全灭（12 张卡）
 *   - 1440   无广告快照：三者全灭（8 张卡）
 *
 * @param {FeedItemSignals} sig
 * @returns {AdVerdict}
 */
export function classifyFeedItem(sig) {
  const s = sig || {};
  const reasons = [];
  let score = 0;

  const urlHit = (s.urls || []).map(matchAdUrl).find(Boolean);
  if (urlHit) {
    score += WEIGHT.urlMarker;
    reasons.push(`正文外链带广告埋点(${adMarkerLabel(urlHit)})`);
  }

  const hostHit = (s.imgSrcs || []).map(matchAdHost).find(Boolean);
  if (hostHit) {
    score += WEIGHT.adHost;
    reasons.push(`卡内图片来自广告 CDN(${hostHit})`);
  }

  const tagHit = (s.tagTexts || []).map(matchAdTag).find(Boolean);
  if (tagHit) {
    score += WEIGHT.tagText;
    reasons.push(`头部推广标签「${tagHit}」`);
  }

  if (s.hasFollowButton) {
    score += WEIGHT.followButton;
    reasons.push('卡内出现「关注」按钮（首关时间线里不该有）');
  }

  const isAd = score >= AD_THRESHOLD;
  return {
    isAd,
    score,
    reasons,
    // 有证据但没过阈值 ⇒ 可疑；一条信号都没有 ⇒ 不可疑
    suspect: !isAd && score > 0,
  };
}

/**
 * @typedef {Object} PageAdSlotSignals
 * @property {string[]} [imgSrcs]       槽内所有 <img src>
 * @property {boolean}  [hasCloseIcon]  槽内是否有广告位自带的关闭图标
 * @property {boolean}  [inFeed]        该槽是否处于 .wbpro-scroller-item 之内
 *                                      （A 类应在流外；在流内说明判据用错了对象）
 *
 * @typedef {Object} PageAdVerdict
 * @property {boolean}  isAd
 * @property {string[]} reasons
 * @property {boolean}  inFeed   true = 这不是 A 类页面广告位，应交给 classifyFeedItem
 */

/**
 * 判定一个**页面级广告位**是否为 A 类 banner。
 *
 * A 类的实测特征：纯图片、来源 `kadmimage.biz.weibo.com`、自带关闭按钮、
 * 位置在 `#homeWrap` 里发布器卡之后、**不在** `.wbpro-scroller-item` 之内。
 *
 * @param {PageAdSlotSignals} sig
 * @returns {PageAdVerdict}
 */
export function classifyPageAdSlot(sig) {
  const s = sig || {};
  const reasons = [];
  const hostHit = (s.imgSrcs || []).map(matchAdHost).find(Boolean);
  if (hostHit) reasons.push(`图片来自广告 CDN(${hostHit})`);
  if (s.hasCloseIcon) reasons.push('带广告位自带的关闭按钮');

  return {
    isAd: Boolean(hostHit) || Boolean(s.hasCloseIcon),
    reasons,
    inFeed: Boolean(s.inFeed),
  };
}
