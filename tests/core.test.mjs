import test from 'node:test';
import assert from 'node:assert/strict';

import { decide, ACTION } from '../src/core/decision.js';
import { loadConfig, DEFAULT_CONFIG, hasGM } from '../src/config.js';

test('判定核心不碰 DOM：只吃数据包、只吐动作（M1 已接线）', () => {
  const d = decide({ id: '1', text: '任何内容' }, {});
  assert.equal(d.action, ACTION.KEEP);
  assert.deepEqual(d.reasons, []);
  assert.equal(d.suspect, false);
  assert.equal(d.adScore, 0);
});

test('非 GM 环境（Node）下 loadConfig 回落到默认值', () => {
  assert.equal(hasGM(), false);
  const c = loadConfig();
  assert.equal(c.appearance.l0, true);
  assert.equal(c.appearance.avatarVariant, 'beta'); // 2026-10-16 用户拍板：默认 β 渐隐
  assert.equal(c.appearance.textFontSize, null); // null = 跟随档位（L1 14 / L2 13）
  assert.equal(c.appearance.thumbHeight, 60);
  assert.deepEqual(c.filter.keywords, []);
  assert.deepEqual(c.filter.detect, DEFAULT_CONFIG.filter.detect);
  // 过滤总开关（§7.4 约束 3「可逆」的落点）
  assert.equal(c.filter.enabled, true);
});
