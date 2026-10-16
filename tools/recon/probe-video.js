/**
 * probe-video.js —— 视频缩略化（M4）真机取证
 *
 * 背景（2026-10-16 M4 启动）：图片侧缩略化已落地（mediaMaxH=90 + cover 全接管），
 * 视频当时刻意不动（「vjs 内部布局，二期单独评估」）。L2 重排已验收，现在评估视频。
 *
 * probeL2 已采到的：播放器 542×305（旧 563px 列宽时）、poster 同几何、
 * _placeholder_（哈希类）定高。**还没采到、本探针补齐的**：
 *
 *   ① 定高层的手法 —— _placeholder_ 的 305 是**内联 height**、样式表 height、
 *      还是 aspect-ratio / padding-bottom hack？手法不同，压法不同
 *      （图片侧验证过 max-height 压过显式 height；aspect-ratio 得另想）。
 *      ⛔ 哈希类不能锚 ⇒ 收高度要用 :has() 反推祖先，层数必须实测钉死。
 *   ② 🔴 B17 配对内联判定 —— poster img 是否也被微博 JS 写了「尺寸+负偏移」配对内联？
 *      有 ⇒ 必须 cover 全接管（图片侧黑图教训）；没有 ⇒ 风险降一级。
 *   ③ 播放态还原路径 —— 未播放时 .video-js 是否就带 vjs-paused？（决定规则怎么
 *      限定「只在缩略态生效」：vjs-playing 时全部还原还是保持小框。）
 *   ④ 控制条 / 大播放按钮的几何 —— 90px 小框里它们占多少，决定藏不藏。
 *   ⑤ 作用域 —— 视频卡里 .video-js 在不在 .wbpro-feed-content / .retweet 内
 *      （图片侧的评论面板豁免收窄要不要照搬）。
 *
 * 用法：首页滚到有视频卡的feed → Console 粘全文 → probeVideo() → 整个输出回传。
 * ⚠️ **跑两遍**：① 刷新后不动视频直接跑（未播放态）；② 点一下播放、放几秒、暂停，
 *    再跑一遍（播放过态）。两份都回传 —— 对比 vjs 类名翻转与几何还原。
 * ⚠️ 跑之前确认已卸 firstframe-probe（它藏 footer 会污染读数）。
 */
function probeVideo() {
  var clip = function (s, n) {
    s = (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
    n = n || 60;
    return s.length > n ? s.slice(0, n) + '…' : s;
  };
  var desc = function (el) {
    if (!el || !el.tagName) return String(el);
    return el.tagName.toLowerCase() +
      '.' + clip((el.getAttribute('class') || '').replace(/\s+/g, '.'), 80) +
      (el.id ? '#' + el.id : '');
  };
  var rectOf = function (el) {
    var b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  };
  var stylesOf = function (el, keys) {
    var cs;
    try { cs = getComputedStyle(el); } catch (_e) { return null; }
    if (!cs) return null;
    var out = {};
    for (var i = 0; i < keys.length; i++) out[keys[i]] = cs[keys[i]];
    return out;
  };

  var styleEl = document.getElementById('spb-style');
  var styleCheck = { present: Boolean(styleEl),
    hasL1Rules: styleEl ? /font-size:14px !important/.test(styleEl.textContent) : false };
  if (!styleCheck.present) {
    return { verdict: '⛔ 没有 #spb-style —— 脚本没在跑（重装后刷新）', styleCheck: styleCheck };
  }

  /* 找卡内有 .video-js 的卡（跳过回收位与异常态） */
  var slots = document.querySelectorAll('.vue-recycle-scroller__item-view');
  var samples = [];
  var scanned = 0;
  for (var s = 0; s < slots.length && samples.length < 3; s++) {
    var card = slots[s].querySelector('.wbpro-scroller-item') || slots[s];
    var cb = card.getBoundingClientRect();
    // 读数自检：矩形全零 ⇒ 某祖先 display:none（回收位 / 异常态），拒收
    if (cb.h === 0 && cb.top === 0) continue;
    var vj = card.querySelector('.video-js');
    if (!vj) continue;
    scanned++;

    /* ① 播放器到卡的全部祖先层：内联 style 原文 + 定高相关 computed
     *    内联 style 是 B17 判定的关键证据 —— 「尺寸+负偏移」配对内联只能在这里看。 */
    var chain = [];
    var el = vj;
    while (el && el !== card) {
      var cs = stylesOf(el, ['height', 'width', 'aspectRatio', 'paddingBottom',
        'position', 'overflow', 'maxHeight']);
      chain.push({
        el: desc(el),
        rect: rectOf(el),
        inlineStyle: clip(el.getAttribute('style') || '', 220),
        computed: cs,
      });
      el = el.parentElement;
    }

    /* ② poster：内联 style 原文 + cover 相关 computed */
    var posterImg = vj.querySelector('.vjs-poster img');
    var poster = posterImg ? {
      el: desc(posterImg),
      rect: rectOf(posterImg),
      inlineStyle: clip(posterImg.getAttribute('style') || '', 220),
      attrs: {
        width: posterImg.getAttribute('width'),
        height: posterImg.getAttribute('height'),
        src: clip(posterImg.currentSrc || posterImg.getAttribute('src') || '', 70),
      },
      computed: stylesOf(posterImg, ['width', 'height', 'top', 'left', 'objectFit', 'position']),
      posterLayerDisplay: (function () {
        var layer = posterImg.closest('.vjs-poster');
        return layer ? getComputedStyle(layer).display : null;
      })(),
    } : null;

    /* ③ video 本体：尺寸来自属性还是 CSS */
    var tech = vj.querySelector('video.vjs-tech');
    var techInfo = tech ? {
      el: desc(tech),
      rect: rectOf(tech),
      attrs: { width: tech.getAttribute('width'), height: tech.getAttribute('height') },
      inlineStyle: clip(tech.getAttribute('style') || '', 220),
      computed: stylesOf(tech, ['width', 'height', 'objectFit', 'position']),
    } : null;

    /* ④ 控制条 / 大播放按钮（缩略后占框比例） */
    var bar = vj.querySelector('.vjs-control-bar');
    var bigBtn = vj.querySelector('.vjs-big-play-button');

    /* ⑤ 作用域：在 feed-content / retweet 内吗 + 距卡顶 */
    var vjb = vj.getBoundingClientRect();
    samples.push({
      cardRect: { w: Math.round(cb.width), h: Math.round(cb.height) },
      playerRect: rectOf(vj),
      topOffsetInCard: Math.round(vjb.top - cb.top),
      playerClassTokens: (vj.getAttribute('class') || '').split(/\s+/),
      pausedNow: (vj.getAttribute('class') || '').indexOf('vjs-paused') !== -1,
      playingNow: (vj.getAttribute('class') || '').indexOf('vjs-playing') !== -1,
      inFeedContent: Boolean(vj.closest('.wbpro-feed-content')),
      inRetweet: Boolean(vj.closest('.retweet')),
      ancestorChain: chain,
      poster: poster,
      tech: techInfo,
      controlBar: bar ? { rect: rectOf(bar), display: getComputedStyle(bar).display } : null,
      bigPlayButton: bigBtn ? { rect: rectOf(bigBtn), display: getComputedStyle(bigBtn).display } : null,
    });
  }

  /* 卡外小窗播放器（mini-player）—— 只确认它还在卡外，规则不该碰它 */
  var mini = document.querySelector('.mini-player');
  var miniInfo = mini ? { el: desc(mini), rect: rectOf(mini) } : null;

  var verdict;
  if (!scanned) {
    verdict = '⛔ 当前页没有视频卡 —— 滚到带视频的 feed 再跑（或视频在回收位，刷新重试）';
  } else if (samples.length && samples[0].playerRect.h === 0) {
    verdict = '⚠️ 播放器矩形全零（某祖先 display:none）—— 读数无效，刷新重跑';
  } else {
    verdict = '✅ 采到 ' + samples.length + ' 张视频卡 —— 整个输出回传。'
      + '重点：ancestorChain 各层的 inlineStyle（定高手法 + B17 配对内联）、'
      + 'poster.inlineStyle、pausedNow、controlBar/bigPlayButton 几何';
  }

  return {
    verdict: verdict,
    styleCheck: styleCheck,
    innerWidth: window.innerWidth,
    videoCards: { scanned: scanned, samples: samples },
    miniPlayer: miniInfo,
    note: '请跑两遍：① 刷新后未播放直接跑；② 点播放几秒→暂停后再跑。两份都回传'
      + ' —— 对比 pausedNow/playingNow 翻转与各层几何是否还原。',
  };
}

try { window.probeVideo = probeVideo; } catch (_e) { /* 控制台总有 window */ }
