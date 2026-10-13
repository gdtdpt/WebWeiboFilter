import test from 'node:test';
import assert from 'node:assert/strict';

import { decide } from '../src/core/decision.js';
import { loadConfig, DEFAULT_CONFIG, hasGM } from '../src/config.js';

test('判定核心在 M1 前是空实现：一切保留，不碰 DOM', () => {
  assert.deepEqual(decide({ id: '1', text: '任何内容' }, {}), { action: 'keep', reason: null });
});

test('非 GM 环境（Node）下 loadConfig 回落到默认值', () => {
  assert.equal(hasGM(), false);
  const c = loadConfig();
  assert.equal(c.appearance.l0, true);
  assert.equal(c.appearance.avatarVariant, 'alpha');
  assert.equal(c.appearance.thumbHeight, 60);
  assert.deepEqual(c.filter.keywords, []);
  assert.deepEqual(c.filter.detect, DEFAULT_CONFIG.filter.detect);
});
