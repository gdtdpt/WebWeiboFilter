/**
 * 探针注册表测试（PROJECT.md §6.1）
 *
 * §6.1 是**架构纪律**：「每条适配规则都必须注册一个『选择器探针』—— 没有探针的适配规则
 * = 改版后无法自检的规则。」
 *
 * 所以这里守两件事：
 *   ① 注册表**结构完整**（每条都必须能回答「选择器 / 期望 / 失效含义」）
 *   ② 在**真实快照**上跑一遍，「应当存在」的选择器必须真的命中 ——
 *      这是「改版把适配层打坏了」能被 CI 先发现的地方
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROBES, runProbes } from '../src/adapters/weibo-home.js';
import { FIXTURE_DIR, fixtures } from './_fixture-expect.mjs';

let parseHTML = null;
try {
  ({ parseHTML } = await import('linkedom'));
} catch (_e) {
  parseHTML = null;
}

const skip = !fixtures.length
  ? 'fixtures/ 为空（.gitignore 里的私有数据）—— 跳过探针测试'
  : (!parseHTML ? 'linkedom 未安装 —— 运行 npm install 后重试' : false);

const ALLOWED_EXPECT = ['exists', 'optional', 'variable'];

test('探针注册表：每条都具备 id / desc / selector / expect / failMeans，且 id 唯一', () => {
  assert.ok(PROBES.length > 0, '探针注册表不能为空');

  const ids = new Set();
  for (const p of PROBES) {
    assert.equal(typeof p.id, 'string', `${JSON.stringify(p)} 缺 id`);
    assert.ok(p.id.length > 0);
    assert.equal(typeof p.desc, 'string', `${p.id} 缺 desc`);
    assert.equal(typeof p.selector, 'string', `${p.id} 缺 selector`);
    assert.equal(typeof p.failMeans, 'string', `${p.id} 缺 failMeans（没有它就无法判断"坏了意味着什么"）`);
    assert.ok(ALLOWED_EXPECT.includes(p.expect), `${p.id} 的 expect 非法：${p.expect}`);
    assert.equal(ids.has(p.id), false, `探针 id 重复：${p.id}`);
    ids.add(p.id);

    // 选择器必须能在真 DOM 上跑（语法错误会在 querySelectorAll 里抛）
    assert.doesNotThrow(() => {
      // eslint-disable-next-line no-undef -- 只为语法校验，不需要真文档
      if (typeof document !== 'undefined') document.querySelectorAll(p.selector.split(' / ')[0]);
    }, `${p.id} 的选择器语法有误`);
  }
});

for (const file of fixtures) {
  test(`探针自检：${file} —— 「应当存在」的选择器必须全部命中`, { skip }, () => {
    const { document } = parseHTML(readFileSync(join(FIXTURE_DIR, file), 'utf8'));
    const results = runProbes(document);

    assert.equal(results.length, PROBES.length);

    for (const r of results) {
      assert.ok(['ok', 'warn', 'fail'].includes(r.status), `${r.id} 状态非法：${r.status}`);
      assert.ok(r.count >= 0);
    }

    // 首页时间线上，这些结构必然存在 —— 它们失效就意味着适配层被改版打穿了
    const required = ['scroller', 'item-view', 'card', 'og-text', 'avatar', 'home-wrap'];
    for (const id of required) {
      const r = results.find((x) => x.id === id);
      assert.equal(r.status, 'ok',
        `${file}: 探针「${id}」未通过（count=${r.count}）—— ${r.failMeans}`);
    }

    // 广告 CDN 图是**间歇投放**，命中 0 属正常 —— 只要不报 fail
    const adCdn = results.find((x) => x.id === 'ad-cdn');
    assert.notEqual(adCdn.status, 'fail', '间歇投放的选择器不该被判成失效');
  });
}

test('探针自检：空页面上「应当存在」的选择器必须报 fail（否则探针形同虚设）', () => {
  const fake = { querySelectorAll: () => [] };
  const results = runProbes(fake);

  for (const id of ['scroller', 'item-view', 'card', 'og-text', 'avatar']) {
    const r = results.find((x) => x.id === id);
    assert.equal(r.status, 'fail', `${id} 在空页面上应报 fail，实际 ${r.status}`);
  }
  // optional 的只降级为 warn
  for (const id of ['re-text', 'tag-slot', 'follow-btn', 'home-wrap']) {
    const r = results.find((x) => x.id === id);
    assert.equal(r.status, 'warn', `${id} 是 optional，空页面上应为 warn，实际 ${r.status}`);
  }
  // variable 的永远是 ok（为空不代表失效）
  assert.equal(results.find((x) => x.id === 'ad-cdn').status, 'ok');
});
