/**
 * 「+N」截断格全量展示（§12-B18）—— apply/morepics.js 的测试
 *
 * 覆盖三层：
 *   · 纯函数：布局求解（高度中性的数学保证）+ 详情响应解析（真机采样形状焊死）
 *   · 取数：缓存 / 在途去重 / 失败冷却（防频控纪律）
 *   · DOM（linkedom）：注入幂等 / 原格隐藏与还原 / 锁高不变形 / 视口外不取数
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  morePicsLayout, parsePicInfos, getMorePics, resetMorePicsCache,
  applyMorePics, removeMoreGrids, countMoreGrids, MOREGRID_SEL,
} from '../src/apply/morepics.js';

let parseHTML = null;
try {
  ({ parseHTML } = await import('linkedom'));
} catch (_e) {
  parseHTML = null;
}

// ─────────────────────────────────────────────── 纯函数：布局求解

test('morePicsLayout：17 图塞 409.75×282 = 5列×4行 78×67（probeMorePics 真机矩形）', () => {
  const L = morePicsLayout(17, 409.75, 282);
  assert.ok(L, '必须解得出来');
  assert.equal(L.cols, 5);
  assert.equal(L.rows, 4);
  assert.equal(L.cellW, 78);
  assert.equal(L.cellH, 67);

  // 高度中性的硬不变量：格子总占位不得超出原盒子（超了 = 卡变高 = 虚拟列表重叠）
  const G = 4;
  assert.ok(L.cols * (L.cellW + G) - G <= 409.75, '宽度占位不得超原盒宽');
  assert.ok(L.rows * (L.cellH + G) - G <= 282, '高度占位不得超原盒高 —— 生死线');
  // 「越方越好」：5×4 的 |log(宽/高)| 应该是该约束下的最优（64×91 等被比下去）
  const score = Math.abs(Math.log(L.cellW / L.cellH));
  assert.ok(score <= Math.abs(Math.log(64 / 91)) + 1e-9, '5×4(78×67) 应比 6×3(64×91) 更方');
});

test('morePicsLayout：任意 total 都满足「放得下」不变量（2..40 全扫）', () => {
  for (let total = 10; total <= 40; total++) {
    const L = morePicsLayout(total, 409.75, 282);
    assert.ok(L, `total=${total} 必须有解（9+N 的现实范围）`);
    assert.equal(L.cols * L.rows >= total, true, `total=${total}: 格位必须 ≥ 图数`);
    assert.ok(L.cellW >= 24 && L.cellH >= 24, `total=${total}: 格子不许小于 24px（看不清）`);
  }
});

test('morePicsLayout：退化输入返回 null（异常态拒绝动作的纪律）', () => {
  assert.equal(morePicsLayout(0, 409.75, 282), null);
  assert.equal(morePicsLayout(17, 0, 282), null);
  assert.equal(morePicsLayout(17, 409.75, 0), null);
  assert.equal(morePicsLayout(17, -1, 282), null);
  // 盒子小到格子 <24px ⇒ 放弃（宁可维持 9 格，也不注入看不清的格子）
  assert.equal(morePicsLayout(17, 100, 60), null);
});

// ─────────────────────────────────────────────── 纯函数：响应解析

/** probeDetailApi 真机采样焊死的响应形状（17 图那条，截两条） */
const SAMPLE_JSON = {
  pic_num: 17,
  pic_ids: ['5396ee05ly8ii1g1q6s0kj20j20eqq6d', '5396ee05ly8ii1g1qmz5kj20mx0bjgn3'],
  pic_infos: {
    '5396ee05ly8ii1g1q6s0kj20j20eqq6d': {
      thumbnail: { url: 'https://wx2.sinaimg.cn/wap180/5396ee05ly8ii1g1q6s0kj20j20eqq6d.jpg', width: 180, height: 139 },
      bmiddle: { url: 'https://wx2.sinaimg.cn/wap360/5396ee05ly8ii1g1q6s0kj20j20eqq6d.jpg', width: 360, height: 278 },
      large: { url: 'https://wx2.sinaimg.cn/orj960/5396ee05ly8ii1g1q6s0kj20j20eqq6d.jpg', width: 686, height: 530 },
      largest: { url: 'https://wx2.sinaimg.cn/large/5396ee05ly8ii1g1q6s0kj20j20eqq6d.jpg', width: 686, height: 530 },
    },
    '5396ee05ly8ii1g1qmz5kj20mx0bjgn3': {
      thumbnail: { url: 'https://wx4.sinaimg.cn/wap180/5396ee05ly8ii1g1qmz5kj20mx0bjgn3.jpg', width: 180, height: 90 },
      large: { url: 'https://wx4.sinaimg.cn/orj960/5396ee05ly8ii1g1qmz5kj20mx0bjgn3.jpg', width: 825, height: 415 },
      // 无 largest/original ⇒ view 应回退到 large
    },
  },
};

test('parsePicInfos：按 pic_ids 顺序出列表；thumb=thumbnail、view 走 largest→original→large 回退', () => {
  const pics = parsePicInfos(SAMPLE_JSON);
  assert.ok(Array.isArray(pics) && pics.length === 2);
  assert.equal(pics[0].id, '5396ee05ly8ii1g1q6s0kj20j20eqq6d');
  assert.equal(pics[0].thumb, 'https://wx2.sinaimg.cn/wap180/5396ee05ly8ii1g1q6s0kj20j20eqq6d.jpg');
  assert.equal(pics[0].view, 'https://wx2.sinaimg.cn/large/5396ee05ly8ii1g1q6s0kj20j20eqq6d.jpg');
  // 第二条没有 largest ⇒ 回退 large
  assert.equal(pics[1].view, 'https://wx4.sinaimg.cn/orj960/5396ee05ly8ii1g1qmz5kj20mx0bjgn3.jpg');
});

test('parsePicInfos：畸形输入一律 null（pic_ids/pic_infos 缺失、无 thumbnail 的条目被丢弃）', () => {
  assert.equal(parsePicInfos(null), null);
  assert.equal(parsePicInfos({}), null);
  assert.equal(parsePicInfos({ pic_ids: [], pic_infos: {} }), null);
  // 条目缺 thumbnail ⇒ 丢条目；全丢 ⇒ null
  assert.equal(parsePicInfos({ pic_ids: ['a'], pic_infos: { a: { large: { url: 'x' } } } }), null);
  // pic_ids 与 pic_infos 键对不齐 ⇒ 只出对得上的
  const partial = parsePicInfos({ pic_ids: ['a', 'b'], pic_infos: { a: { thumbnail: { url: 'ta' } } } });
  assert.ok(partial && partial.length === 1 && partial[0].id === 'a');
});

// ─────────────────────────────────────────────── 取数：缓存 / 冷却

/** 测试用 fetcher：模仿 fetch 的 Response 形状（模块按 r.json() 取数据） */
function jsonFetcher(json) {
  return () => Promise.resolve({ json: () => Promise.resolve(json) });
}

/** 17 张图的详情响应（形状按 probeDetailApi 真机采样；SAMPLE_JSON 供解析单测用） */
function detailJson17() {
  const pic_ids = [];
  const pic_infos = {};
  for (let i = 0; i < 17; i++) {
    const id = 'pic' + i;
    pic_ids.push(id);
    pic_infos[id] = {
      thumbnail: { url: 'https://wx2.sinaimg.cn/wap180/' + id + '.jpg', width: 180, height: 120 },
      large: { url: 'https://wx2.sinaimg.cn/orj960/' + id + '.jpg', width: 690, height: 460 },
      largest: { url: 'https://wx2.sinaimg.cn/large/' + id + '.jpg', width: 690, height: 460 },
    };
  }
  return { pic_num: 17, pic_ids, pic_infos };
}

test('getMorePics：缓存命中不发第二个请求；在途去重共用同一个 Promise', async () => {
  resetMorePicsCache();
  let calls = 0;
  const fetcher = () => { calls++; return Promise.resolve({ json: () => Promise.resolve(SAMPLE_JSON) }); };

  const [a, b] = await Promise.all([getMorePics('BID1', fetcher), getMorePics('BID1', fetcher)]);
  assert.ok(a && a.length === 2, '首次取数应成功');
  assert.ok(b, '并发第二发应共用在途 Promise');
  assert.equal(calls, 1, '两个并发 + 一个缓存命中 ⇒ 只发 1 个请求');

  const c = await getMorePics('BID1', fetcher);
  assert.ok(c, '缓存命中仍有结果');
  assert.equal(calls, 1, '缓存命中不再发请求');
});

test('getMorePics：失败进入冷却（60s 内不重发）；解析失败视同失败', async () => {
  resetMorePicsCache();
  let calls = 0;
  const badFetcher = () => { calls++; return Promise.reject(new Error('network')); };
  assert.equal(await getMorePics('BID2', badFetcher), null, '失败返回 null（永不 reject）');
  assert.equal(await getMorePics('BID2', badFetcher), null, '冷却期内直接返回 null');
  assert.equal(calls, 1, '冷却期内不得重发请求（防频控纪律）');

  // 解析不出图片（如非图片微博的详情响应）也进冷却
  resetMorePicsCache();
  let calls2 = 0;
  const emptyFetcher = () => { calls2++; return Promise.resolve({ id_str: 'x', text: 'no pics' }); };
  assert.equal(await getMorePics('BID3', emptyFetcher), null);
  assert.equal(await getMorePics('BID3', emptyFetcher), null);
  assert.equal(calls2, 1, '解析失败同样冷却，不重发');
});

// ─────────────────────────────────────────────── DOM（linkedom）

/** 搭一张 9 格 +8 的最小卡（结构按 probeMorePics 真机指纹） */
function buildCard(doc) {
  const card = doc.createElement('div');
  card.setAttribute('class', 'wbpro-scroller-item');
  const a = doc.createElement('a');
  a.setAttribute('href', 'https://weibo.com/12345/Rmzv6gdtJ');
  card.appendChild(a);

  const content = doc.createElement('div');
  content.setAttribute('class', 'wbpro-feed-content');
  card.appendChild(content);

  const row = doc.createElement('div');
  row.setAttribute('class', 'u-col-3 woo-box-wrap');
  content.appendChild(row);

  for (let i = 0; i < 9; i++) {
    const cell = doc.createElement('div');
    cell.setAttribute('class', 'woo-box-item-inlineBlock');
    cell.setAttribute('style', 'padding-left: 0.25rem; padding-top: 0.25rem;');
    const pic = doc.createElement('div');
    pic.setAttribute('class', 'woo-picture-main');
    const img = doc.createElement('img');
    img.setAttribute('src', 'https://wx2.sinaimg.cn/orj360/orig' + i + '.jpg');
    pic.appendChild(img);
    cell.appendChild(pic);
    if (i === 8) {
      // 末格：真图 + 「+8」暗罩文案（probeMorePics 实测的第 9 格真身）
      const overlay = doc.createElement('div');
      overlay.textContent = '+8';
      cell.appendChild(overlay);
    }
    row.appendChild(cell);
  }
  doc.body.appendChild(card);   // 卡必须真的在文档里（isConnected 校验会拦离文档的行）
  return { card, row };
}

test('DOM：+8 卡注入 17 格；原格隐藏；容器锁高 = 原网格高（高度中性）', { skip: !parseHTML && 'linkedom 未安装' }, async () => {
  resetMorePicsCache();
  const { document } = parseHTML('<html><body></body></html>');
  const { card, row } = buildCard(document);

  let calls = 0;
  const deps = {
    fetcher: (u) => { calls++; return jsonFetcher(detailJson17())(u); },
    measure: () => ({ width: 409.75, height: 282 }),
    visible: () => true,
  };

  const res = applyMorePics(card, true, deps);
  assert.equal(res.requested, 1, '发现 1 个 +N 网格并发起取数');
  await new Promise((r) => setTimeout(r, 0));   // 放行取数回调

  assert.equal(calls, 1, '只发 1 个详情请求');
  assert.equal(countMoreGrids(document), 1, '注入容器恰好 1 个');
  const box = row.querySelector(MOREGRID_SEL[0]);
  assert.ok(box, '容器在行内');
  assert.ok(/height:\s*282px/.test(box.getAttribute('style') || ''),
    '容器必须显式锁高 282px = 原网格高（卡高一个像素不变的生死线）');
  assert.equal(box.querySelectorAll('a').length, 17, '17 张图全部注入');
  assert.equal(box.querySelectorAll('a[target="_blank"]').length, 17, '点击 = 新标签开原图');
  const hidden = [...row.children].filter((c) => c !== box)
    .filter((c) => /display\s*:\s*none/i.test(c.getAttribute('style') || ''));
  assert.equal(hidden.length, 9, '原有 9 格全部 display:none（保留原内联，只追加 display）');
  assert.ok(/padding-left/.test(hidden[0].getAttribute('style')), '原格的内联 padding 必须保留');
});

test('DOM：幂等 —— 第二轮扫描零新增；关档完整还原', { skip: !parseHTML && 'linkedom 未安装' }, async () => {
  resetMorePicsCache();
  const { document } = parseHTML('<html><body></body></html>');
  const { card, row } = buildCard(document);
  const deps = {
    fetcher: jsonFetcher(detailJson17()),
    measure: () => ({ width: 409.75, height: 282 }),
    visible: () => true,
  };

  applyMorePics(card, true, deps);
  await new Promise((r) => setTimeout(r, 0));
  applyMorePics(card, true, deps);   // 第二轮：已有标记 ⇒ 零写入
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(countMoreGrids(document), 1, '幂等：仍只有 1 个容器');
  assert.equal(row.querySelectorAll('a').length, 17, '不会重复注入 17 格');

  // 关档 ⇒ 还原
  const res = applyMorePics(card, false, deps);
  assert.equal(res.removed, 1);
  assert.equal(countMoreGrids(document), 0, '容器已摘');
  const cells = [...row.children];
  assert.equal(cells.length, 9, '行里回到原有 9 格');
  assert.ok(cells.every((c) => !/display\s*:\s*none/i.test(c.getAttribute('style') || '')),
    '所有原格的 display:none 都已摘除（内联 padding 保留）');

  // removeMoreGrids（停管线出口）等价可逆
  applyMorePics(card, true, deps);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(removeMoreGrids(document), 1);
  assert.equal(countMoreGrids(document), 0);
  assert.ok([...row.children].every((c) => !/display\s*:\s*none/i.test(c.getAttribute('style') || '')),
    '整页摘除同样还原原格');
});

test('DOM：视口外不取数；无 bid 不取数；≤9 张不注入', { skip: !parseHTML && 'linkedom 未安装' }, async () => {
  resetMorePicsCache();
  const { document } = parseHTML('<html><body></body></html>');
  const { card } = buildCard(document);

  let calls = 0;
  const deps = {
    fetcher: (u) => { calls++; return jsonFetcher(detailJson17())(u); },
    measure: () => ({ width: 409.75, height: 282 }),
    visible: () => false,   // 回收位槽位（视口外）
  };
  const res = applyMorePics(card, true, deps);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(res.requested, 0, '视口外不得发起取数（回收位槽位防误发）');
  assert.equal(calls, 0);
  assert.equal(countMoreGrids(document), 0);

  // 去掉 bid 链接 ⇒ 不取数
  const { card: card2 } = buildCard(document);
  const a = card2.querySelector('a[href]');
  a.removeAttribute('href');
  applyMorePics(card2, true, { ...deps, visible: () => true });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls, 0, '取不到 bid 的卡不得发请求');

  // 详情响应只有 9 张 ⇒ 不注入（微博本来就展示得下）
  const { card: card3, row: row3 } = buildCard(document);
  applyMorePics(card3, true, {
    ...deps, visible: () => true,
    fetcher: jsonFetcher({ pic_num: 2, pic_ids: SAMPLE_JSON.pic_ids, pic_infos: SAMPLE_JSON.pic_infos }),
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(row3.querySelectorAll(MOREGRID_SEL[0]).length, 0, '≤9 张不注入（微博本来就展示得下）');
});
