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

test('B 类推广卡 · 实测样本 1449「饼干姐 / OiiOii」应判为广告（无文字标签也成立）', () => {
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

test('B 类推广卡 · 认证图标 wbpro-tag-img 不是广告信号（适配层会跳过它）', () => {
  // 实测：`div.wbpro-tag-img > img(icon_auth_black.png)` 出现在 **自然卡** 上。
  // 适配层不把 img 型标签塞进 tagTexts ⇒ 这里传空数组即可复现。
  const v = classifyFeedItem({ urls: ['//weibo.com/u/1'], tagTexts: [], imgSrcs: [], hasFollowButton: false });
  assert.equal(v.isAd, false);
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
