/**
 * 关键词过滤单测（PROJECT.md §12-A3 / §8.3）
 *
 * 这一组断言的核心是**字段白名单**：§12-A3 明确禁止「裸 `innerText` 全串匹配」，
 * 因为新版微博把整卡文字混在同一节点里，全串匹配会把转发链里别人的话也算进去 → 误杀。
 * 所以下面有一条**反向断言**：只在 `innerText` 里出现的关键词必须**不命中**。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KEYWORD_FIELDS,
  extractTopics,
  normalizeRule,
  compileRules,
  matchKeywords,
} from '../src/core/keyword.js';

/** 造一份只带 filter 的配置 */
function cfg(keywords, regexMode = false) {
  return { filter: { keywords, regexMode } };
}

// ── extractTopics ────────────────────────────────────────────────────────

test('话题解析：从正文里取出 #…#，去重、忽略半截 #', () => {
  assert.deepEqual(extractTopics('今天#抽奖#好开心'), ['抽奖']);
  assert.deepEqual(extractTopics('#A# 和 #B# 和 #A#'), ['A', 'B']);
  assert.deepEqual(extractTopics('没有话题'), []);
  assert.deepEqual(extractTopics('半截 #没有收尾'), []);
  assert.deepEqual(extractTopics(''), []);
  assert.deepEqual(extractTopics(null), []);
});

// ── normalizeRule ────────────────────────────────────────────────────────

test('规则归一化：空内容丢弃、动作/字段收窄到白名单', () => {
  assert.equal(normalizeRule({ content: '   ' }), null);
  assert.equal(normalizeRule(null), null);

  const r = normalizeRule({ content: ' 抽奖 ' });
  assert.equal(r.content, '抽奖');
  assert.equal(r.action, 'hide', '默认动作应为 hide');
  assert.deepEqual(r.fields, KEYWORD_FIELDS, '不写 fields 时默认全字段');

  const r2 = normalizeRule({ content: 'x', action: 'nonsense', fields: ['text', 'bogus'] });
  assert.equal(r2.action, 'hide', '非法动作退回默认');
  assert.deepEqual(r2.fields, ['text'], '非法字段被剔除');
});

// ── compileRules ─────────────────────────────────────────────────────────

test('正则模式：非法正则不抛异常，只记进 errors 并跳过', () => {
  const { compiled, errors } = compileRules(
    [{ content: '[unclosed' }, { content: '有效' }],
    true
  );
  assert.equal(compiled.length, 1, '只有合法那条被编译');
  assert.equal(compiled[0].content, '有效');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].content, '[unclosed');
});

// ── matchKeywords ────────────────────────────────────────────────────────

test('关键词：只在白名单字段里匹配 —— innerText 里的命中必须被忽略（§12-A3）', () => {
  const item = {
    text: '今天天气不错',
    repostText: '',
    author: '小明',
    // 适配层**不会**提供这个字段，这里塞进去是为了证明「整卡文本」进不来
    innerText: '明天有抽奖活动',
  };
  const r = matchKeywords(item, cfg([{ content: '抽奖' }]));
  assert.equal(r.action, null, '只在 innerText 里出现 → 不得命中（否则就是 §12-A3 说的误杀）');
});

test('关键词：正文 / 转发原文 / 昵称 三个字段都能命中', () => {
  const rules = cfg([{ content: '抽奖' }]);

  const byText = matchKeywords({ text: '正文里有抽奖', repostText: '', author: '' }, rules);
  assert.equal(byText.action, 'hide');
  assert.equal(byText.hits[0].field, 'text');

  const byRepost = matchKeywords({ text: '', repostText: '原文说抽奖', author: '' }, rules);
  assert.equal(byRepost.hits[0].field, 'repostText');

  const byAuthor = matchKeywords({ text: '', repostText: '', author: '抽奖博主' }, rules);
  assert.equal(byAuthor.hits[0].field, 'author');
});

test('关键词：字段限定生效 —— 只勾「话题」时，正文里裸出现不算命中', () => {
  const rules = [{ content: '抽奖', fields: ['topics'] }];

  const bare = matchKeywords({ text: '我们搞个抽奖吧' }, cfg(rules));
  assert.equal(bare.action, null, '正文里提到但没写成 #抽奖# → 不命中');

  const topic = matchKeywords({ text: '我们搞个#抽奖#活动' }, cfg(rules));
  assert.equal(topic.action, 'hide');
  assert.equal(topic.hits[0].field, 'topics');
});

test('关键词：动作优先级 hide > highlight（同卡两者都命中时以隐藏为准）', () => {
  const rules = [
    { content: '抽奖', action: 'highlight' },
    { content: '广告', action: 'hide' },
  ];
  const r = matchKeywords({ text: '抽奖广告' }, cfg(rules));
  assert.equal(r.action, 'hide');
  assert.equal(r.hits.length, 2, '两条都要给出理由（§9 可解释性）');
  assert.equal(r.reasons.length, 2);
});

test('关键词：大小写不敏感 + 理由文案带字段名', () => {
  const r = matchKeywords({ text: 'Buy Now' }, cfg([{ content: 'buy now' }]));
  assert.equal(r.action, 'hide');
  assert.equal(r.reasons[0], '关键词「buy now」命中正文');
});

test('关键词：正则模式生效，且不因 g 标志产生 lastIndex 状态', () => {
  const rules = [{ content: '第\\d+期', action: 'hide' }];
  const r1 = matchKeywords({ text: '第12期抽奖' }, cfg(rules, true));
  const r2 = matchKeywords({ text: '第12期抽奖' }, cfg(rules, true));
  assert.equal(r1.action, 'hide');
  assert.equal(r2.action, 'hide', '重复匹配必须一致（无 lastIndex 残留）');
});

test('关键词：空规则 / 空数据包安全退化', () => {
  assert.equal(matchKeywords({ text: 'x' }, cfg([])).action, null);
  assert.equal(matchKeywords(null, cfg([{ content: 'x' }])).action, null);
  assert.equal(matchKeywords({ text: 'x' }, undefined).action, null);
});
