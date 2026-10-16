/**
 * β 头像水印（apply/avatarbg.js）的守卫（§7.5.5，2026-10-16 用户二次定稿）
 *
 * 测四件事：
 *   ① `avatarBgUrl` 纯函数的转义契约（url("…") 里的引号不许截断内联样式）；
 *   ② `applyAvatarBackground` 的幂等 / 可逆生命周期（建 → 不重写 → 换 src 更新 → 摘除）；
 *   ③ 🔴 槽位复用防串号：新卡没有 header 头像 ⇒ 上一张卡的水印必须清掉；
 *   ④ 作用域：转发块里的小头像不参与；removeAvatarBackgrounds 全页清干净。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyAvatarBackground, removeAvatarBackgrounds, countAvatarBackgrounds,
  avatarBgUrl, AVATAR_BG_ATTR, AVATAR_BG_MARK, AVATAR_BG_SEL, AVATAR_BG_VAR,
} from '../src/apply/avatarbg.js';

let parseHTML = null;
try {
  ({ parseHTML } = await import('linkedom'));
} catch (_e) {
  parseHTML = null;
}

/** 合成一张带 header 主头像的卡（结构对齐真机：card > article > div > header > img） */
function makeCard(doc, { src, retweetAvatar } = {}) {
  const card = doc.createElement('div');
  card.setAttribute('class', 'wbpro-scroller-item');
  const article = doc.createElement('article');
  const body = doc.createElement('div');
  const header = doc.createElement('header');

  if (src) {
    const img = doc.createElement('img');
    img.setAttribute('class', 'woo-avatar-img');
    img.setAttribute('src', src);
    header.appendChild(img);
  }

  body.appendChild(header);
  article.appendChild(body);

  if (retweetAvatar) {
    const rt = doc.createElement('div');
    rt.setAttribute('class', 'retweet');
    const rtImg = doc.createElement('img');
    rtImg.setAttribute('class', 'woo-avatar-img');
    rtImg.setAttribute('src', retweetAvatar);
    rt.appendChild(rtImg);
    article.appendChild(rt);
  }

  card.appendChild(article);
  return card;
}

test('avatarBgUrl：转义契约', () => {
  assert.equal(avatarBgUrl(''), '');
  assert.equal(avatarBgUrl(null), '');
  assert.equal(
    avatarBgUrl('https://tvax1.sinaimg.cn/crop.0.0.50.50.180/abc.jpg'),
    'url("https://tvax1.sinaimg.cn/crop.0.0.50.50.180/abc.jpg")',
  );
  // 引号必须转成 %22，否则整条内联样式被截断
  assert.equal(avatarBgUrl('https://x/a"b.jpg'), 'url("https://x/a%22b.jpg")');
  assert.doesNotMatch(avatarBgUrl('https://x/a\\b.jpg'), /[^\\]\\\\"/);
});

test('applyAvatarBackground：建 → 幂等 → 更新 → 摘除', () => {
  const { document } = parseHTML('<html><body></body></html>');
  const card = makeCard(document, { src: 'https://tvax1.sinaimg.cn/a.jpg' });
  const article = card.querySelector('article');

  // 建
  const first = applyAvatarBackground(card, true);
  assert.equal(first.set, 1);
  assert.equal(article.getAttribute(AVATAR_BG_ATTR), AVATAR_BG_MARK, '应有自有标记');
  assert.match(article.getAttribute('style') || '', new RegExp(AVATAR_BG_VAR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    '内联样式里应写入 CSS 变量');
  assert.match(article.getAttribute('style'), /a\.jpg/);

  // 幂等：同 src 第二遍 ⇒ 一个字节都不写
  const again = applyAvatarBackground(card, true);
  assert.equal(again.set, 0, '同 src 不应重写');
  assert.equal(again.cleared, 0);

  // 槽位复用换头像 ⇒ 跟着新 src 更新
  card.querySelector('header img').setAttribute('src', 'https://tvax1.sinaimg.cn/b.jpg');
  const upd = applyAvatarBackground(card, true);
  assert.equal(upd.set, 1, 'src 变了应更新');
  assert.match(article.getAttribute('style'), /b\.jpg/);

  // 关 ⇒ 摘除（标记 + 变量一起清）
  const off = applyAvatarBackground(card, false);
  assert.equal(off.cleared, 1);
  assert.equal(article.getAttribute(AVATAR_BG_ATTR), null);
  assert.doesNotMatch(article.getAttribute('style') || '', new RegExp('spb-avatar-bg'));
});

test('🔴 槽位复用防串号：新卡没有 header 头像 ⇒ 旧水印必须清掉', () => {
  const { document } = parseHTML('<html><body></body></html>');
  const card = makeCard(document, { src: 'https://tvax1.sinaimg.cn/a.jpg' });
  const article = card.querySelector('article');
  applyAvatarBackground(card, true);
  assert.equal(article.getAttribute(AVATAR_BG_ATTR), AVATAR_BG_MARK);

  // 模拟虚拟列表复用：同一 article 换成无头像卡（推荐关注 / 话题大卡）
  const img = card.querySelector('header img');
  img.parentNode.removeChild(img);
  const out = applyAvatarBackground(card, true);
  assert.equal(out.cleared, 1, '取不到 header 头像必须清旧水印');
  assert.equal(article.getAttribute(AVATAR_BG_ATTR), null, '不许留下 A 作者的水印在 B 卡上');
});

test('作用域：转发块小头像不参与；全页清理与计数', () => {
  const { document } = parseHTML('<html><body></body></html>');

  // 只有转发块里有头像 ⇒ 不该建水印
  const rtOnly = makeCard(document, { retweetAvatar: 'https://tvax1.sinaimg.cn/rt.jpg' });
  const out = applyAvatarBackground(rtOnly, true);
  assert.equal(out.set, 0, '转发块小头像不是水印来源');
  assert.equal(rtOnly.querySelector('article').getAttribute(AVATAR_BG_ATTR), null);

  // 全页清理
  const c1 = makeCard(document, { src: 'https://tvax1.sinaimg.cn/a.jpg' });
  const c2 = makeCard(document, { src: 'https://tvax1.sinaimg.cn/b.jpg' });
  document.body.appendChild(c1);
  document.body.appendChild(c2);
  applyAvatarBackground(c1, true);
  applyAvatarBackground(c2, true);
  assert.equal(countAvatarBackgrounds(document), 2);
  assert.equal(removeAvatarBackgrounds(document), 2);
  assert.equal(countAvatarBackgrounds(document), 0);
  // 标记选择器与标记常量自洽（CSS/查询共用一个来源）
  assert.equal(AVATAR_BG_SEL[0], `[${AVATAR_BG_ATTR}="${AVATAR_BG_MARK}"]`);
});
