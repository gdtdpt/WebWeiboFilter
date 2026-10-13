/**
 * 夹具期望值表 —— `fixture-ad.test.mjs`（适配层+判定核心）与 `recon-smoke.test.mjs`
 * （recon.js 无浏览器冒烟）**共用同一张表**，避免两处各写一份而漂移。
 *
 * 每个条目的数字都来自 M0 侦察的**逐卡人工核对**（见 PROJECT.md §12-B1）。
 * 新增夹具时在这里补一行即可。
 */

import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const FIXTURE_DIR = join(HERE, 'fixtures');

/** 目录里已有的快照夹具（私有不入库；不存在时返回空数组） */
export const fixtures = existsSync(FIXTURE_DIR)
  ? readdirSync(FIXTURE_DIR).filter((f) => /^snapshot-.*\.html$/.test(f)).sort()
  : [];

/**
 * 期望结果。key = 文件名子串（匹配时按 key 长度从长到短，避免 '1505' 抢走 '1505 (1)'）。
 *   feedAds      信息流推广卡数（isAd）
 *   feedSuspects 存疑卡数（score 1~2）
 *   bannerAds    页面级 banner 广告位数
 */
export const EXPECT = [
  { key: '1440', desc: '首页时间线（首轮，无广告）', feedAds: 0, feedSuspects: 0, bannerAds: 0 },
  {
    // 1449 有 1 张广告卡 + 1 张存疑卡：
    //   ① OiiOii_AI  —— 商业投放埋点(campaign) + 「关注」按钮  ⇒ 广告（5 分）
    //   ② 饼干姐     —— 埋点只在**转发原文**视频链接上，且是 `natural`（1 分）
    //      2026-10-13 用户人工核对原帖后判定「内容完全不像广告」⇒ **降级为存疑，不判广告**
    key: '1449', desc: '首页时间线（OiiOii 广告卡 + 饼干姐 存疑卡）',
    feedAds: 1, feedSuspects: 1, bannerAds: 1,
  },
  { key: '1505 (1)', desc: '首页时间线（叫我老伯/京东 荐读卡）', feedAds: 1, feedSuspects: 0, bannerAds: 1 },
  { key: '1505', desc: '首页时间线（干净）', feedAds: 0, feedSuspects: 0, bannerAds: 1 },
];

/** 按 key 从长到短匹配，避免 '1505' 抢走 '1505 (1)' */
export function expectFor(file) {
  const sorted = [...EXPECT].sort((a, b) => b.key.length - a.key.length);
  return sorted.find((e) => file.includes(e.key)) || null;
}
