/**
 * 广告识别（PROJECT.md §12-B1）—— 判定核心的一部分
 *
 * 纪律（§6）：**纯函数，绝不碰 DOM。** 输入是适配层抽出的「信号包」，输出是判定结果。
 * 这里的每一条判据都来自 M0 侦察的**实测证据**（2026-10-13，四份 DOM 快照），
 * 证据原文见每条常量上方的注释。**不要凭猜测加规则 —— 先补样本、再改这里。**
 *
 * ─── 实测样本（tests/fixtures/，私有不入库）──────────────────────────
 *   1440（8 卡）   无广告
 *   1449（13 卡）  A 类 banner ✔    B 类推广卡 ✔「OiiOii」＋**存疑卡**「饼干姐」（见 AD_URL_MARKERS 中 natural 的降级说明）
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
 * 广告跳转埋点。每个标记自带 `weight`（证据权重），判定时取「权重最高的那一条」。
 *
 * ⚠️ **每个 URL 只取第一个命中的标记**（下表顺序 = 优先级），所以 `natural` 必须排在
 * 兜底的 `reallog_mark_ad` **前面**，否则 `999_reallog_mark_ad` 会被兜底规则按 2 分算进去。
 *
 * 实测共发现**三个变体**：
 *
 *  ① `campaign` —— 商业投放（**最硬，可单独判广告**，weight 3）
 *     `shop.sc.weibo.com/h5/sclick/index?mark=3_reallog_mark_ad%3A8%7C3_<19位活动ID>`
 *     解码后：`mark=3_reallog_mark_ad:8|3_1791875133631432656708000038139964`
 *     命中计数：1440=0 / 1449=12 / 1505=0 / 1505(1)=6
 *
 *  ② `natural` —— 原生 / 视频广告（**存疑级，weight 1 —— 只记线索，不单独判广告**）
 *     `video.weibo.com/show?fid=1034:…&mark_id=999_reallog_mark_ad%3A999%7CWeiboADNatural`
 *     解码后：`mark_id=999_reallog_mark_ad:999|WeiboADNatural`
 *     命中计数：1440=0 / 1449=2 / 1505=0 / 1505(1)=0
 *
 *     🔴 **降级理由（2026-10-13，用户人工核对后定）**：唯一一条样本是 1449「饼干姐」转发卡 ——
 *     用户看了原帖，**正文是玩笑话、视频内容也不是推广**，整条内容完全不像广告。
 *     该卡在页面上也没有任何广告标识（无标签 / 无「关注」按钮 / 无播放器）。
 *     ⇒ 结论：`WeiboADNatural` **不足以证明这是一条商业广告**（更可能是微博对视频内容的投放/扶持标记）。
 *     ⇒ 处理：**降为存疑线索**，单独出现时只报 `suspect`，不判 `isAd`。待攒够样本再重新评估权重。
 *
 *  ③ `weiboad` —— 广告短链令牌 `…_weiboad=`（实测：`shorturl.biz.weibo.cn/…&63c25…_weiboad=`，weight 2）
 *
 * 兜底与辅助（weight 2，均需旁证）：`reallog_mark_ad`（兜底其它 reallog 形态）、
 * `sclick`（电商广告跳转）、`spm_mark`（投放位标记）。
 *
 * 对照：**自然卡**的电商链接是 `shop.sc.weibo.com/h5/goods/index?…&vs=weibo_feed`（不带任何埋点）。
 */
export const AD_URL_MARKERS = [
  {
    id: 'campaign',
    label: '商业投放',
    weight: 3,
    re: /3_reallog_mark_ad/i,
    desc: '微博信息流商业广告埋点（实测，带 19 位活动 ID）',
  },
  {
    id: 'natural',
    label: '原生/视频广告',
    weight: 1,
    re: /999_reallog_mark_ad|WeiboADNatural/i,
    desc: '微博原生 / 视频广告埋点（实测 WeiboADNatural）。⚠️ 证据不足，只记为存疑线索',
  },
  {
    id: 'reallog_mark_ad',
    label: '其它 reallog 广告',
    weight: 2,
    re: /reallog_mark_ad/i,
    desc: '兜底：其它形态的 reallog 广告埋点',
  },
  { id: 'weiboad', label: '广告短链', weight: 2, re: /_weiboad=/i, desc: '微博广告短链令牌（实测）' },
  { id: 'sclick', label: '电商广告跳转', weight: 2, re: /\/h5\/sclick\//i, desc: '微博电商广告跳转服务（实测）' },
  { id: 'spm_mark', label: '投放位标记', weight: 2, re: /[?&]spm_mark=/i, desc: '投放位标记（实测）' },
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

/**
 * 计分权重。
 *   - 广告埋点的权重**不在这里**，而是逐条挂在 `AD_URL_MARKERS[].weight` 上
 *     （因为不同埋点的可信度差很多 —— 商业投放 3、原生/视频广告仅 1）。
 *   - 下面的三项是「非埋点」判据的权重。**≥ AD_THRESHOLD 即单独足以判定为广告**。
 */
export const WEIGHT = {
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
 * marker id → 该埋点的证据权重。
 * 未登记的 id 返回 0（安全退化：不贡献分数，但理由里仍会出现）。
 * @param {string} id
 * @returns {number}
 */
export function adMarkerWeight(id) {
  const m = AD_URL_MARKERS.find((x) => x.id === id);
  return m ? m.weight : 0;
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
 * @property {boolean}  suspect   证据不足但可疑（只命中「关注按钮」、或只命中 `natural` 埋点等弱线索）
 */

/**
 * 判定一张**信息流卡**是否为推广卡（B 类）。
 *
 * 实测支持：
 *   - 1505(1) 推广卡「叫我老伯/京东」：埋点(campaign) ✔ + followButton ✔ + tagText(荐读) ✔ ⇒ 广告
 *   - 1449   推广卡「OiiOii」     ：埋点(campaign) ✔ + followButton ✔（无文字标签）   ⇒ 广告
 *   - 1449   **存疑卡**「饼干姐」  ：仅埋点(natural, weight 1) ⇒ **可疑、不判广告**（用户人工核对：内容不像广告）
 *   - 1505   无广告快照：四路全灭（12 张卡）
 *   - 1440   无广告快照：四路全灭（8 张卡）
 *
 * @param {FeedItemSignals} sig
 * @returns {AdVerdict}
 */
export function classifyFeedItem(sig) {
  const s = sig || {};
  const reasons = [];
  let score = 0;

  // 埋点：每个 URL 只取第一个命中的标记（表序=优先级），再跨 URL 取**权重最高**的一条
  const urlHits = [];
  for (const u of (s.urls || [])) {
    const id = matchAdUrl(u);
    if (id && urlHits.indexOf(id) === -1) urlHits.push(id);
  }
  if (urlHits.length) {
    let best = urlHits[0];
    for (const id of urlHits) {
      if (adMarkerWeight(id) > adMarkerWeight(best)) best = id;
    }
    const w = adMarkerWeight(best);
    score += w;
    // §9 可解释性：证据不足时必须说清「为什么只算线索」，否则用户看不懂为什么没被过滤
    reasons.push(w < AD_THRESHOLD
      ? `正文外链带广告埋点(${adMarkerLabel(best)}，证据不足仅记为线索)`
      : `正文外链带广告埋点(${adMarkerLabel(best)})`);
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
    // 有证据但没过阈值 ⇒ 存疑（如只命中「原生/视频广告」埋点、或只有「关注」按钮）；一条信号都没有 ⇒ 不可疑
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
