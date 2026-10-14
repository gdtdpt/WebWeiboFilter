/**
 * 首帧探针（`tools/recon/firstframe-probe.user.js`）的**规则守卫**。
 *
 * 为什么需要它：v2 那次实测把「注入 `margin-bottom:-60px`」当成了「改卡片高度」，
 * 而 margin 根本进不了 `getBoundingClientRect()` ⇒ 它只压矮了**槽位**、没动**卡片**，
 * 于是打出一个「❌ 改高度不可行」的结论 —— 那是**手法**的否证，不是结论的否证。
 * 这条测试把那个坑焊死：
 *   ① 注入的规则只许改**卡片自己的内容盒**（`display:none`），不许用对边框盒不可见的手法；
 *   ② 每条选择器必须在**每张卡里恰好命中一个**元素（否则「注入没生效 ⇒ 自然没有洞」的假阳性）；
 *   ③ 规则必须限定在卡内（`.wbpro-scroller-item`）。
 *
 * 夹具是私有数据（`.gitignore`），缺失时跳过。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PROBE = join(ROOT, 'tools', 'recon', 'firstframe-probe.user.js');
const FIXTURE_DIR = join(HERE, 'fixtures');

let parseHTML = null;
try {
  ({ parseHTML } = await import('linkedom'));
} catch (_e) {
  parseHTML = null;
}

/** 从用户脚本里抠出 `var CSS = '…' + '…';` 拼起来的字符串 */
function extractCss(src) {
  const i = src.indexOf('var CSS =');
  assert.ok(i > 0, '探针里找不到 `var CSS =` —— 提取逻辑或脚本结构变了');
  const j = src.indexOf(';', i);
  const seg = src.slice(i, j);
  const parts = [...seg.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  assert.ok(parts.length > 0, '`var CSS =` 后面没找到字符串字面量');
  return parts.join('');
}

const probeSrc = readFileSync(PROBE, 'utf8');
const css = extractCss(probeSrc);
/** 拆出每条规则的选择器（本探针的 CSS 只有最普通的 `选择器{声明}`，没有 @media / 嵌套） */
const selectors = css
  .split('}')
  .map((chunk) => chunk.split('{')[0].trim())
  .filter(Boolean)
  .flatMap((sel) => sel.split(',').map((s) => s.trim()))
  .filter(Boolean);

test('首帧探针：注入的 CSS 不许用「对卡片边框盒不可见」的手法（v2 就是栽在这）', () => {
  // margin / padding / transform / clip / opacity / filter 都不会改变卡片自己的边框盒高度；
  // 拿它们当「改高度」的实验条件，测出来的只是「改槽位」，得不出关于改高度的任何结论。
  const banned = [/\bmargin\b/, /\bpadding\b/, /\btransform\b/, /\bclip(-path)?\b/, /\bopacity\b/, /\bfilter\b/];
  for (const re of banned) {
    assert.ok(!re.test(css), `注入的 CSS 里出现了 ${re} —— 它会绕过卡片边框盒，测不出「改高度」`);
  }
  assert.match(css, /display:\s*none/, '注入的 CSS 应当用 display:none 真正移除内容块');
  assert.match(css, /!important/, '注入的 CSS 应当带 !important，否则可能被微博覆盖');
});

test('首帧探针：注入的规则必须限定在卡片内（不许误伤播放器 / 卡外元素）', () => {
  assert.ok(selectors.length >= 1, '取不到选择器');
  for (const sel of selectors) {
    assert.match(sel, /^\.wbpro-scroller-item\s/, `${sel}：规则必须以 .wbpro-scroller-item 打头（卡内作用域）`);
  }
});

const fixtures = existsSync(FIXTURE_DIR)
  ? readdirSync(FIXTURE_DIR).filter((f) => /^snapshot-.*\.html$/.test(f)).sort()
  : [];

const skip = !fixtures.length
  ? 'fixtures/ 为空（私有不入库）—— 跳过「注入规则真的命中」的校验'
  : (!parseHTML ? 'linkedom 未安装 —— 运行 npm install 后重试' : false);

test('首帧探针：每条注入规则在每张真卡里都恰好命中 1 个元素（不是空转规则）', { skip }, () => {
  for (const file of fixtures) {
    const { document } = parseHTML(readFileSync(join(FIXTURE_DIR, file), 'utf8'));
    const cards = Array.from(document.querySelectorAll('.wbpro-scroller-item'));
    assert.ok(cards.length > 0, `${file}: 夹具里没有卡片 —— 锚点可能变了`);

    for (const sel of selectors) {
      const total = document.querySelectorAll(sel).length;
      assert.ok(total >= cards.length,
        `${file}: 规则 \`${sel}\` 只命中 ${total} 个，卡片有 ${cards.length} 张 —— 会漏掉一部分卡`);

      const oncePerCard = cards.filter((c) => c.querySelectorAll(sel).length === 1).length;
      assert.equal(oncePerCard, cards.length,
        `${file}: 规则 \`${sel}\` 不能做到「每张卡恰好一个」（${oncePerCard}/${cards.length}）`
        + ' —— 命中 0 个会让自证失效（假阳性），命中 >1 个会误伤卡片内部内容');
    }
  }
});
