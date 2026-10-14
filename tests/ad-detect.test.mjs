import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AD_TAG_TEXTS,
  AD_URL_MARKERS,
  AD_IMG_HOSTS,
  AD_CLOSE_ICON,
  AD_THRESHOLD,
  matchAdUrl,
  adMarkerLabel,
  adMarkerWeight,
  matchAdHost,
  matchAdTag,
  isAdCloseIcon,
  classifyFeedItem,
  classifyPageAdSlot,
} from '../src/core/ad-detect.js';

// 下面每条断言的「期望值」都来自 M0 侦察的实测快照（见 src/core/ad-detect.js 顶部注释）。

// ────────────────────────────────────────────── URL 埋点

test('广告 URL 埋点：实测的两条广告外链都能命中', () => {
  // 1505(1) 推广卡「叫我老伯 / 京东双11」—— shop.sc.weibo.com 的 sclick 跳转
  const jd = 'https://shop.sc.weibo.com/h5/sclick/index?mark=3_reallog_mark_ad%3A8%7C3_1791875133631432656708000038139964' +
             '&mark_id=3_reallog_mark_ad%3A8%7C3_1791875133631432656708000038139964' +
             '&url=https%3A%2F%2Fu.jd.com%2FFD0Djmj&spm_mark=dgActivity%407835241424&sign=b9d8d16f';
  assert.equal(matchAdUrl(jd), 'campaign');

  // 1449 推广卡「OiiOii」—— shorturl 短链 + _weiboad= 令牌
  const oii = 'https://shorturl.biz.weibo.cn/AXoDbLRC?mark=3_reallog_mark_ad%3A8%7C3_1791874100632131280608000036116497' +
              '&mark_id=3_reallog_mark_ad%3A8%7C3_1791874100632131280608000036116497&2b7937c5be5b4dee32e0b0c80ce4a538_weiboad=';
  assert.equal(matchAdUrl(oii), 'campaign');
});

test('广告 URL 埋点：第三个变体 WeiboADNatural（原生/视频广告）也能命中', () => {
  // 1449「饼干姐」卡里的视频播放地址 —— 实测
  const vid = 'https://video.weibo.com/show?fid=1034:5352459179065379' +
              '&mark_id=999_reallog_mark_ad%3A999%7CWeiboADNatural';
  assert.equal(matchAdUrl(vid), 'natural');
  assert.equal(adMarkerLabel('natural'), '原生/视频广告');
  // 兜底分支：只写 reallog_mark_ad、不带已知前缀的情况
  assert.equal(matchAdUrl('https://x.example/a?mark_id=7_reallog_mark_ad%3A1'), 'reallog_mark_ad');
});

test('埋点权重分级：`natural` 只有 1 分（存疑级），商业投放 3 分', () => {
  // 2026-10-13 用户人工核对「饼干姐」卡后定：WeiboADNatural 不足以证明是商业广告 ⇒ 降级
  assert.equal(adMarkerWeight('campaign'), 3);
  assert.equal(adMarkerWeight('natural'), AD_THRESHOLD - 2, 'natural 必须低于阈值，单靠它判不出广告');
  assert.ok(adMarkerWeight('natural') < AD_THRESHOLD);
  assert.equal(adMarkerWeight('weiboad'), 2);
  assert.equal(adMarkerWeight('sclick'), 2);
  assert.equal(adMarkerWeight('spm_mark'), 2);
  assert.equal(adMarkerWeight('不存在的 id'), 0);
  // 表里每一条都必须带权重，否则会静默按 0 分处理
  for (const m of AD_URL_MARKERS) {
    assert.equal(typeof m.weight, 'number', `${m.id} 缺 weight`);
  }
});

test('埋点优先级：`natural` 必须排在兜底的 reallog_mark_ad 之前', () => {
  // 否则 999_reallog_mark_ad 会被兜底规则按 2 分算进去，降级就失效了
  assert.ok(AD_URL_MARKERS.findIndex((m) => m.id === 'natural') <
            AD_URL_MARKERS.findIndex((m) => m.id === 'reallog_mark_ad'));
});

test('广告 URL 埋点：**自然卡**的 video.weibo.com 播放地址不得误判', () => {
  // 实测：干净快照 1505 有 3 条 video.weibo.com/show 链接，全部不带任何 reallog 埋点
  const plain = 'https://video.weibo.com/show?fid=1034:5352459179065379';
  assert.equal(matchAdUrl(plain), null);
});

test('广告 URL 埋点：自然卡的电商商品链接**不得**误判', () => {
  // 实测：1505 自然卡「俄罗斯什么值得买」的京东商品卡走 h5/goods，不带任何广告埋点
  const natural = 'https://shop.sc.weibo.com/h5/goods/index?iid=110016521844900003972961' +
                  '&mid=5353573526536892&suid=1652184490&vs=weibo_feed';
  assert.equal(matchAdUrl(natural), null);

  // 站内话题搜索链接
  assert.equal(matchAdUrl('https://s.weibo.com/weibo?q=%23%E6%98%9F%E7%8E%89%E8%AE%A1%E5%88%92%23'), null);
  assert.equal(matchAdUrl('//weibo.com/u/1527347404'), null);
  assert.equal(matchAdUrl(''), null);
  assert.equal(matchAdUrl(undefined), null);
});

test('广告 URL 埋点：spm_mark 单独也能命中', () => {
  assert.equal(matchAdUrl('https://x.example/a?spm_mark=dgActivity%407835241424'), 'spm_mark');
});

// ────────────────────────────────────────────── 广告 CDN

test('广告 CDN：A 类 banner 的实测图片地址命中', () => {
  const src = 'https://kadmimage.biz.weibo.com/812f26ae950a53d4fe8ee919bd572fb85786325630_54cf08a7dfc1fb95/812f26ae950a53d4fe8ee919bd572fb8.jpg';
  assert.equal(matchAdHost(src), 'kadmimage.biz.weibo.com');
});

test('广告 CDN：常见自然图床不得误判', () => {
  for (const s of [
    'https://tvax4.sinaimg.cn/crop.0.0.1080.1080.1024/5b0978ccly8gpug3vi4c3j20u00u041s.jpg',
    'https://wx4.sinaimg.cn/orj360/69537340gy1ihzm89kr32j20cc0nltgv.jpg',
    'https://h5.sinaimg.cn/upload/108/1866/2022/11/02/vip_7.png',
    'https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/9b/2018new_aini_org.png',
  ]) {
    assert.equal(matchAdHost(s), null, s);
  }
});

// ────────────────────────────────────────────── 标签文案

test('推广标签：整串精确比对，「荐读」命中', () => {
  assert.equal(matchAdTag('荐读'), '荐读');
  assert.equal(matchAdTag(' 推广 '), '推广');
  assert.equal(matchAdTag('广告'), '广告');
});

test('推广标签：不做子串匹配 —— 含「广告」字样的自然文案不得误判', () => {
  // 否则「广告位招租」「拒绝广告」之类会被误杀
  assert.equal(matchAdTag('广告位招租'), null);
  assert.equal(matchAdTag('这里是广告吗'), null);
  assert.equal(matchAdTag('叫我老伯'), null);
  assert.equal(matchAdTag(''), null);
});

test('标签常量表与埋点表非空（防止误删成空表导致判据静默失效）', () => {
  assert.ok(AD_TAG_TEXTS.length >= 4);
  assert.ok(AD_URL_MARKERS.length >= 3);
  assert.ok(AD_IMG_HOSTS.length >= 1);
});

// ────────────────────────────────────────────── 关闭图标

test('广告位关闭图标：实测的 close.png 命中', () => {
  assert.equal(isAdCloseIcon('https://h5.sinaimg.cn/upload/1005/948/2022/09/21/close.png'), true);
  assert.equal(isAdCloseIcon('https://h5.sinaimg.cn/upload/100/no/close.png'), false);
});

// ────────────────────────────────────────────── 信息流卡判定

test('B 类推广卡 · 实测样本 1505(1)「叫我老伯 / 京东双11」应判为广告', () => {
  const v = classifyFeedItem({
    urls: ['https://shop.sc.weibo.com/h5/sclick/index?mark=3_reallog_mark_ad%3A8%7C3_179187'],
    tagTexts: ['荐读'],
    imgSrcs: ['https://wx4.sinaimg.cn/orj360/69537340gy1ihzm89kr32j.jpg'],
    hasFollowButton: true,
  });
  assert.equal(v.isAd, true);
  assert.ok(v.score >= AD_THRESHOLD);
  // §9 可解释性：必须说得出理由
  assert.ok(v.reasons.some((r) => r.includes('埋点')));
  assert.ok(v.reasons.some((r) => r.includes('荐读')));
  assert.ok(v.reasons.some((r) => r.includes('关注')));
});

test('B 类推广卡 · 实测样本 1449「OiiOii」应判为广告（无文字标签也成立）', () => {
  const v = classifyFeedItem({
    urls: ['https://shorturl.biz.weibo.cn/AXoDbLRC?mark=3_reallog_mark_ad%3A8&63c2534ddd8ca220ee63f24b4c9bee38_weiboad='],
    tagTexts: [],
    imgSrcs: ['https://tvax2.sinaimg.cn/crop.0.0.996.996.1024/6268fc76ly8gbdf0ls21ij20ro0rogn7.jpg'],
    hasFollowButton: true,
  });
  assert.equal(v.isAd, true);
  // 标签槽为空也要能判出来 —— 这是「不能把标签当唯一判据」的回归保护
  assert.ok(!v.reasons.some((r) => r.includes('标签')));
});

test('B 类推广卡 · 实测样本 1449「饼干姐」只判存疑、**不判广告**（2026-10-13 定）', () => {
  // 该卡全部链接：除转发原文那条视频外，其余都是用户主页 / 站内话题，不该命中
  const v = classifyFeedItem({
    urls: [
      'https://weibo.com/u/1651047542',
      'https://weibo.com/1651047542/Rmd6xreW1',
      'https://weibo.com/n/%E4%BA%92%E8%81%94%E7%BD%91%E6%AC%A2%E4%B9%90%E6%8C%87%E5%8D%97',
      'https://s.weibo.com/weibo?q=%23%E7%94%9F%E6%B4%BB%E8%B6%A3%E4%BA%8B%E7%8B%82%E6%83%B3%E6%9B%B2%23',
      'https://video.weibo.com/show?fid=1034:5352459179065379' +
        '&mark_id=999_reallog_mark_ad%3A999%7CWeiboADNatural',
      'https://weibo.com/6850370174/Rm0HPAPjm',
    ],
    tagTexts: [],
    imgSrcs: ['https://tvax2.sinaimg.cn/crop.0.0.996.996.1024/6268fc76ly8gbdf0ls21ij20ro0rogn7.jpg'],
    hasFollowButton: false,
  });
  assert.equal(v.isAd, false, '该卡内容经人工核对不像广告，不应被判为广告');
  assert.equal(v.suspect, true, '但埋点仍在，应留作存疑线索');
  assert.equal(v.score, 1);
  assert.ok(v.reasons.some((r) => r.includes('仅记为线索')), '理由要说明为什么只算线索');
});

test('埋点组合：`natural` 叠加其它弱证据仍不该独自构成广告', () => {
  // 只有 weak 埋点 + 无其它信号 ⇒ 仍为存疑
  const v = classifyFeedItem({
    urls: ['https://video.weibo.com/show?fid=1&mark_id=999_reallog_mark_ad%3A999%7CWeiboADNatural'],
    tagTexts: [],
    imgSrcs: [],
    hasFollowButton: false,
  });
  assert.equal(v.isAd, false);
  assert.equal(v.suspect, true);

  // 但 `natural` + 头部推广标签 ⇒ 够阈值，应判广告（弱线索可被强证据带起来）
  const v2 = classifyFeedItem({
    urls: ['https://video.weibo.com/show?fid=1&mark_id=999_reallog_mark_ad%3A999%7CWeiboADNatural'],
    tagTexts: ['荐读'],
    imgSrcs: [],
    hasFollowButton: false,
  });
  assert.equal(v2.isAd, true);
});

test('B 类推广卡 · 实测样本 1505 的自然卡不得误判（12 张卡的代表）', () => {
  const v = classifyFeedItem({
    urls: [
      '//weibo.com/u/1527347404',
      'https://weibo.com/1527347404/RmtHLma0X',
    ],
    tagTexts: [],
    imgSrcs: ['https://tvax4.sinaimg.cn/crop.0.0.1080.1080.1024/5b0978ccly8gpug3vi4c3j20u00u041s.jpg'],
    hasFollowButton: false,
  });
  assert.equal(v.isAd, false);
  assert.equal(v.score, 0);
  assert.equal(v.suspect, false);
  assert.deepEqual(v.reasons, []);
});

test('B 类推广卡 · 自然卡的电商商品卡（俄罗斯什么值得买）不得误判', () => {
  const v = classifyFeedItem({
    urls: [
      '//weibo.com/u/xxxx',
      'https://shop.sc.weibo.com/h5/goods/index?iid=110016521844900003972961&vs=weibo_feed',
    ],
    tagTexts: [],
    imgSrcs: ['https://h5.sinaimg.cn/upload/100/1111/goods.png'],
    hasFollowButton: false,
  });
  assert.equal(v.isAd, false);
});

test('B 类推广卡 · 只有「关注」按钮时判为可疑、不判广告（避免误杀社交推荐卡）', () => {
  const v = classifyFeedItem({ urls: [], tagTexts: [], imgSrcs: [], hasFollowButton: true });
  assert.equal(v.isAd, false);
  assert.equal(v.suspect, true);
  assert.equal(v.score, 2);
});

test('B 类推广卡 · 图片型标签（wbpro-tag-img）就是「广告」徽章：图片标签 + 关注按钮 ⇒ 判广告', () => {
  // 🔴 2026-10-14 定案（§12-B13 ⑨）：旧断言「wbpro-tag-img 是认证图标、不是广告信号」**前提错误** ——
  // 该型唯一已知资源 icon_auth_black.png（56×30）下载验看，**像素就是「广告」二字**（文件名有误导性）。
  // 真机实证：长江证券投教卡（图片标签 + 关注按钮、无 URL 埋点）在旧逻辑下只得 followButton
  // 2 分 ⇒ 漏判（用户截图：信息流里原样出现）。适配层现把图片型标签折算成 tagTexts「广告」。
  const v = classifyFeedItem({ urls: ['//weibo.com/u/1'], tagTexts: ['广告'], imgSrcs: [], hasFollowButton: true });
  assert.equal(v.isAd, true, `score=${v.score}`);
  assert.ok(v.reasons.some((r) => r.includes('广告')), '理由里应出现图片标签');
  // 没有图片标签时，「只有关注按钮」仍是存疑不判广告（上方的既有断言继续看住这条路）
});

test('B 类推广卡 · 空信号与 undefined 都安全返回', () => {
  for (const bad of [undefined, {}, { urls: [] }]) {
    const v = classifyFeedItem(bad);
    assert.equal(v.isAd, false);
    assert.equal(v.suspect, false);
  }
});

// ────────────────────────────────────────────── 页面级广告位

test('A 类页面广告位 · 实测 banner（kadmimage + 自带关闭按钮）应判为广告', () => {
  const v = classifyPageAdSlot({
    imgSrcs: ['https://kadmimage.biz.weibo.com/812f26ae950a53d4fe8ee919bd572fb85786325630_54cf08a7dfc1fb95/812f26ae950a53d4fe8ee919bd572fb8.jpg'],
    hasCloseIcon: true,
    inFeed: false,
  });
  assert.equal(v.isAd, true);
  assert.equal(v.inFeed, false);
  assert.ok(v.reasons.length >= 2);
});

test('A 类页面广告位 · 没有广告 CDN 就是普通容器', () => {
  const v = classifyPageAdSlot({
    imgSrcs: ['https://h5.sinaimg.cn/upload/100/1111/timer.png'],
    hasCloseIcon: false,
    inFeed: false,
  });
  assert.equal(v.isAd, false);
});

test('A 类页面广告位 · 若落在信息流卡内，报告 inFeed 让调用方改走卡片判定', () => {
  const v = classifyPageAdSlot({
    imgSrcs: ['https://kadmimage.biz.weibo.com/x.jpg'],
    hasCloseIcon: false,
    inFeed: true,
  });
  assert.equal(v.inFeed, true);
});
