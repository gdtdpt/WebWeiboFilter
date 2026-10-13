import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BRAND,
  DEFAULT_PAGE_NAME,
  PAGE_NAMES,
  makeTitle,
  faviconSvg,
  faviconDataUri,
  pickPageName,
  hashString,
} from '../src/features/l0.js';

test('makeTitle 格式为 "SpecBase - <页面名>"', () => {
  assert.equal(BRAND, 'SpecBase');
  assert.equal(makeTitle('Specs'), 'SpecBase - Specs');
  assert.equal(makeTitle(), `SpecBase - ${DEFAULT_PAGE_NAME}`);
  assert.equal(makeTitle('   '), `SpecBase - ${DEFAULT_PAGE_NAME}`);
});

test('favicon 是「深色圆角方块 + 白色方框」的 SVG（§7.5-G）', () => {
  const svg = faviconSvg(32);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /rx="\d+"/); // 圆角
  assert.match(svg, /fill="#2f3e34"/); // 深色底
  assert.match(svg, /stroke="#ffffff"/); // 白框
});

test('faviconDataUri 可无损解码回原 SVG', () => {
  const uri = faviconDataUri(16);
  assert.ok(uri.startsWith('data:image/svg+xml,'));
  const decoded = decodeURIComponent(uri.slice('data:image/svg+xml,'.length));
  assert.equal(decoded, faviconSvg(16));
});

test('pickPageName 对已知路径给出固定页名', () => {
  assert.equal(pickPageName('/'), 'Reference Overview');
  assert.equal(pickPageName('/home'), 'Reference Overview');
  assert.equal(pickPageName('/detail/Cxyz123'), 'Specs');
  assert.equal(pickPageName('/status/5000000000'), 'Specs');
  assert.equal(pickPageName('/u/1234567890'), 'API Reference');
  assert.equal(pickPageName('/messages'), 'Changelog');
  assert.equal(pickPageName('/setting'), 'Drafts');
  assert.equal(pickPageName('/profile'), 'Drafts');
});

test('pickPageName 对未知路径确定性且落在轮换池内', () => {
  const a = pickPageName('/some/unknown/path');
  const b = pickPageName('/some/unknown/path');
  assert.equal(a, b, '同一路径两次调用结果必须一致');
  assert.ok(PAGE_NAMES.includes(a));
});

test('hashString 稳定且非负', () => {
  assert.equal(hashString('abc'), hashString('abc'));
  assert.ok(hashString('abc') >= 0);
  assert.equal(hashString(null), hashString(''));
});
