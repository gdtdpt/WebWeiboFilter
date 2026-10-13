/**
 * 判定核心合成测试（PROJECT.md §6 第 ② 层）
 *
 * 验证两条判定线（广告 / 关键词）合成一个动作时的边界：
 *   - 并集语义：任一条线说 hide，结果就是 hide
 *   - 优先级：广告（hide）压过关键词的 highlight —— 不能出现自相矛盾的结论
 *   - 存疑不动手：广告证据不足（`suspect`）时**不得**产生动作（§12-B1「饼干姐」卡的纪律）
 *   - 三项开关（§8.3「推广 / 荐读 / 嵌入广告」）真的能关掉对应的判据
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { decide, ACTION } from '../src/core/decision.js';
import { DETECT_GATE_DEFAULT } from '../src/core/ad-detect.js';

function cfg(patch = {}) {
  return {
    filter: {
      enabled: true,
      keywords: [],
      regexMode: false,
      detect: { ...DETECT_GATE_DEFAULT },
      ...patch,
    },
  };
}

/** 实测原文：商业投放埋点（1449 OiiOii 卡） */
const CAMPAIGN_URL =
  'https://shop.sc.weibo.com/h5/sclick/index?mark=3_reallog_mark_ad%3A8%7C3_1791875133631432656708000038139964';
/** 实测原文：原生/视频广告埋点（1449 饼干姐卡，已降级为存疑） */
const NATURAL_URL =
  'https://video.weibo.com/show?fid=1034:5352459179065379&mark_id=999_reallog_mark_ad%3A999%7CWeiboADNatural';

test('判定：干净卡 → keep，无理由', () => {
  const d = decide({ id: 'A', urls: ['https://weibo.com/1/abc'], text: '今天天气不错', imgSrcs: [], tagTexts: [] }, cfg());
  assert.equal(d.action, ACTION.KEEP);
  assert.deepEqual(d.reasons, []);
  assert.equal(d.suspect, false);
});

test('判定：广告 → hide，且理由以「广告 · 」开头（§9）', () => {
  const d = decide({ id: 'A', urls: [CAMPAIGN_URL], imgSrcs: [], tagTexts: [], text: '' }, cfg());
  assert.equal(d.action, ACTION.HIDE);
  assert.ok(d.reasons.length > 0);
  assert.ok(d.reasons[0].startsWith('广告 · '), `理由前缀不对：${d.reasons[0]}`);
});

test('判定：存疑卡 → keep（证据不足不得动手）但保留 suspect', () => {
  const d = decide({ id: 'B', urls: [NATURAL_URL], imgSrcs: [], tagTexts: [], text: '' }, cfg());
  assert.equal(d.action, ACTION.KEEP, 'natural 埋点单独出现不足以动手');
  assert.equal(d.suspect, true, '但要保留为存疑线索');
  assert.equal(d.adScore, 1);
});

test('判定：关键词 hide → hide；关键词 highlight → highlight', () => {
  const hide = decide({ text: '一起来抽奖' }, cfg({ keywords: [{ content: '抽奖', action: 'hide' }] }));
  assert.equal(hide.action, ACTION.HIDE);

  const hi = decide({ text: '一起来抽奖' }, cfg({ keywords: [{ content: '抽奖', action: 'highlight' }] }));
  assert.equal(hi.action, ACTION.HIGHLIGHT);
});

test('判定：广告 hide 压过关键词 highlight（并集以更硬的动作为准）', () => {
  const d = decide(
    { urls: [CAMPAIGN_URL], text: '一起来抽奖' },
    cfg({ keywords: [{ content: '抽奖', action: 'highlight' }] })
  );
  assert.equal(d.action, ACTION.HIDE);
  // 两条线的理由都要留下，便于解释
  assert.ok(d.reasons.some((r) => r.startsWith('广告 · ')));
  assert.ok(d.reasons.some((r) => r.includes('关键词')));
});

test('判定：三项开关关掉「推广」后，商业投放埋点不再判广告', () => {
  const item = { urls: [CAMPAIGN_URL], imgSrcs: [], tagTexts: [], text: '' };
  assert.equal(decide(item, cfg()).action, ACTION.HIDE, '开关全开时应判广告');

  const off = decide(item, cfg({ detect: { promo: false, recommend: true, embedded: true } }));
  assert.equal(off.action, ACTION.KEEP, '关掉「推广」后不判广告');
  assert.equal(off.adScore, 0, '该路判据不得计分');
});

test('判定：关掉「荐读」后，头部推广标签不再判广告', () => {
  const item = { urls: [], imgSrcs: [], tagTexts: ['荐读'], text: '' };
  assert.equal(decide(item, cfg()).action, ACTION.HIDE, '标签「荐读」独立 3 分，应判广告');

  const off = decide(item, cfg({ detect: { promo: true, recommend: false, embedded: true } }));
  assert.equal(off.action, ACTION.KEEP);
});

test('判定：关掉「嵌入广告」后，广告 CDN 图不再判广告', () => {
  const item = { urls: [], imgSrcs: ['https://kadmimage.biz.weibo.com/x.png'], tagTexts: [], text: '' };
  assert.equal(decide(item, cfg()).action, ACTION.HIDE);

  const off = decide(item, cfg({ detect: { promo: true, recommend: true, embedded: false } }));
  assert.equal(off.action, ACTION.KEEP);
});

test('判定：正则编译错误会透传到 decision.keywordErrors（诊断页要显示）', () => {
  const d = decide({ text: 'x' }, cfg({ keywords: [{ content: '[bad' }], regexMode: true }));
  assert.equal(d.action, ACTION.KEEP);
  assert.equal(d.keywordErrors.length, 1);
});

test('判定：null / 空输入安全退化', () => {
  assert.equal(decide(null, cfg()).action, ACTION.KEEP);
  assert.equal(decide({}, null).action, ACTION.KEEP);
});
