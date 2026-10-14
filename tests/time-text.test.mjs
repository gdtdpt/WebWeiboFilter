/**
 * 「相对时间 → 绝对短格式」的纯规则测试（PROJECT.md §7.5 D 组）
 *
 * 判别依据全部来自实测（四份夹具一致）：时间锚点的 `title` 恒为 `YYYY-MM-DD HH:MM`，
 * 而卡内其它带 `title` 的链接（作者昵称等）长得完全不一样 ⇒ 正则判别零误伤。
 * 输出格式对齐微博自身的短格式（`10-8   22:51`：月日不补零、时分补零）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TIME_TITLE_RE, parseTimeTitle, isTimeTitle, absoluteShortText,
} from '../src/core/time-text.js';

const NOW = new Date('2026-10-14T08:30:00+08:00');

test('time-text：只有微博生成的时间 title 才算时间锚点', () => {
  // ✅ 实测样本（四份夹具一致）
  for (const t of ['2026-10-11 15:49', '2026-10-13 08:13', '2026-10-08 22:51']) {
    assert.equal(isTimeTitle(t), true, `${t} 应判为时间锚点`);
  }

  // ⛔ 卡内其它带 title 的链接（实测「作者昵称链接」）与脏数据
  for (const t of [
    '一年只改这一次昵称',
    '首页',
    '2026 计划',
    '',
    '2026-10-11',            // 缺时分
    '2026-13-01 10:00',      // 月份非法
    '2026-10-32 10:00',      // 日期非法
    '2026-10-11 25:00',      // 小时非法
    '2026-10-11 10:61',      // 分钟非法
    '2026/10/11 15:49',      // 分隔符不同
  ]) {
    assert.equal(isTimeTitle(t), false, `${t} 不该判为时间锚点`);
  }
});

test('time-text：解析结果字段完整（时分保留前导零）', () => {
  assert.deepEqual(parseTimeTitle('2026-10-08 09:04'), {
    year: 2026, month: 10, day: 8, hour: 9, minute: 4, hourText: '09', minuteText: '04',
  });
  assert.equal(TIME_TITLE_RE.test('2026-10-08 09:04'), true);
});

test('time-text：同年改写成微博自己的短格式（月日不补零、时分补零）', () => {
  assert.equal(absoluteShortText('2026-10-08 22:51', NOW), '10-8 22:51');
  assert.equal(absoluteShortText('2026-10-13 08:13', NOW), '10-13 08:13');
  assert.equal(absoluteShortText('2026-01-05 09:04', NOW), '1-5 09:04');
  assert.equal(absoluteShortText('2026-12-31 23:59', NOW), '12-31 23:59');
});

test('time-text：跨年与非法输入一律不动（返回 null）', () => {
  assert.equal(absoluteShortText('2024-05-01 12:00', NOW), null, '跨年应保持原样（旧帖本就是绝对日期）');
  assert.equal(absoluteShortText('2025-12-31 23:59', NOW), null);
  assert.equal(absoluteShortText('一年只改这一次昵称', NOW), null);
  assert.equal(absoluteShortText('', NOW), null);
  assert.equal(absoluteShortText(null, NOW), null);
  assert.equal(absoluteShortText('2026-10-08 22:51', new Date('invalid')), null, 'now 非法时应放弃改写');
});

test('time-text：改写宽度不超过微博原生渲染（不会被挤换行）', () => {
  // 微博自己把「6小时前」渲染成「10-8   22:51」（带多个空格）⇒ 我们的「10-8 22:51」更短
  const own = '10-8   22:51';
  const ours = absoluteShortText('2026-10-08 22:51', NOW);
  assert.ok(ours.length <= own.length, `我方输出「${ours}」不应长于微博原生「${own}」`);
});
