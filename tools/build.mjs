/**
 * 构建脚本：把 src/ 分模块源码打成单个 userscript（PROJECT.md §4 / §12-A8）。
 *
 *   node tools/build.mjs
 *
 * 产物：dist/specbase-helper.user.js（纯文本，用户手动导入 Tampermonkey）
 * 工具链：esbuild（开发机专用；用户侧无需 Node）
 */

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const outFile = resolve(root, 'dist', 'specbase-helper.user.js');

/**
 * userscript 元数据块。
 * §7.5-G「成套要求延伸」：@name 用中性英文（不出现"微博"），避免 TM 菜单自曝。
 * @description 同样保持中性；@match 无法隐藏（可接受，§7.2）。
 */
const metadata = `// ==UserScript==
// @name         SpecBase Helper
// @namespace    specbase-helper
// @version      ${pkg.version}
// @description  Internal reference toolkit.
// @author       Heinrich
// @match        https://weibo.com/*
// @match        https://www.weibo.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @license      MIT
// ==/UserScript==
`;

const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  // 目标环境为本机最新 Chromium（Chrome 154 / Edge 154，§3），可放心用较新语法
  target: ['chrome120'],
  charset: 'utf8', // 保留中文原文，不转义成 \uXXXX
  legalComments: 'none',
  banner: { js: metadata },
  write: false,
});

const code = result.outputFiles[0].text;
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, code, 'utf8');

const size = statSync(outFile).size;
console.log(`[build] ${pkg.name} v${pkg.version}`);
console.log(`[build] 产物  ${outFile}`);
console.log(`[build] 大小  ${(size / 1024).toFixed(1)} KB`);
