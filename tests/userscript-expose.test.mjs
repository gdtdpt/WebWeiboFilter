/**
 * 调试把手暴露位置的回归测试（真机踩坑 2026-10-13）
 *
 * 背景：脚本声明了 `@grant GM_getValue/GM_setValue` ⇒ Tampermonkey 启用**沙箱**，
 * 脚本里的 `window` 是沙箱对象 ⇒ `window.__spb = {...}` 页面上看不到
 * （`Uncaught ReferenceError: __spb is not defined`），而过滤本身**一切正常** ——
 * 所以这个错只在「想用把手调试」时暴露，最容易蒙混过关。
 *
 * 做法：把 `dist/specbase-helper.user.js`（真产物，不是源码）放进 `node:vm`，
 * 给出**两个不同的 window**：`window`（沙箱）与 `unsafeWindow`（页面），
 * 断言把手只挂在后者。谁要是把实现改回 `window.__spb = ...`，本测试立刻变红。
 *
 * 产物不存在时（未构建）整个文件自动跳过。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(HERE, '..', 'dist', 'specbase-helper.user.js');

let parseHTML = null;
try {
  ({ parseHTML } = await import('linkedom'));
} catch (_e) {
  parseHTML = null;
}

const skip = !existsSync(BUNDLE)
  ? 'dist/specbase-helper.user.js 不存在 —— 先跑 tools/build.mjs'
  : (!parseHTML ? 'linkedom 未安装 —— 运行 npm install 后重试' : false);

const PAGE_HTML = '<!doctype html><html><head></head><body><div id="app"></div></body></html>';

/** 极简环境：够 bundle 顶层跑完（真实 DOM 行为由 pipeline.test.mjs 负责） */
function makeContext({ withUnsafeWindow }) {
  const { document, window: pageLike } = parseHTML(PAGE_HTML);
  const sandboxWindow = {};          // 模拟 Tampermonkey 沙箱 window
  const pageObject = {};             // 模拟页面 window（unsafeWindow 指向它）
  void pageLike;

  const noopObserver = class {
    observe() {}
    disconnect() {}
    takeRecords() { return []; }
  };

  const sandbox = {
    document,
    window: sandboxWindow,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
    cancelAnimationFrame: () => {},
    performance: { now: () => Date.now() },
    MutationObserver: noopObserver,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
  };
  if (withUnsafeWindow) sandbox.unsafeWindow = pageObject;
  // 沙箱里 `unsafeWindow` 缺失时必须真的"不存在"，否则测不出退回逻辑

  return { context: vm.createContext(sandbox), sandboxWindow, pageObject };
}

test('调试把手挂在页面 window（unsafeWindow）而不是沙箱 window 上', { skip }, () => {
  const code = readFileSync(BUNDLE, 'utf8');
  const { context, sandboxWindow, pageObject } = makeContext({ withUnsafeWindow: true });

  vm.runInContext(code, context, { filename: 'specbase-helper.user.js' });

  // ① 页面 window 上必须有把手
  assert.equal(typeof pageObject.__spb, 'object', '__spb 没挂到页面 window —— 控制台会报 not defined');
  assert.equal(typeof pageObject.__spb.stats, 'function');
  assert.equal(typeof pageObject.__spb.recent, 'function');
  assert.equal(typeof pageObject.__spb.rescan, 'function');
  assert.equal(typeof pageObject.__spb.off, 'function');
  assert.equal(typeof pageObject.__spb.on, 'function');
  assert.equal(typeof pageObject.__spb.version, 'string');

  // ② 沙箱 window 上**不该**有 —— 这条把 bug 焊死
  assert.equal(sandboxWindow.__spb, undefined,
    '把手写进了沙箱 window：页面控制台访问不到（真机症状 = Uncaught ReferenceError: __spb is not defined）');
});

test('没有 unsafeWindow 时（非 TM 环境）退回 window —— 把手仍可用', { skip }, () => {
  const code = readFileSync(BUNDLE, 'utf8');
  const { context, sandboxWindow } = makeContext({ withUnsafeWindow: false });

  vm.runInContext(code, context, { filename: 'specbase-helper.user.js' });

  assert.equal(typeof sandboxWindow.__spb, 'object');
});

test('产物元数据声明了 unsafeWindow grant（否则沙箱里取不到页面 window）', { skip }, () => {
  const head = readFileSync(BUNDLE, 'utf8').split('\n').slice(0, 30).join('\n');
  assert.match(head, /^\/\/\s*@grant\s+unsafeWindow\s*$/m,
    'build.mjs 的元数据块少了 @grant unsafeWindow —— 沙箱下 unsafeWindow 不可用，把手会静默挂不上页面');
});
