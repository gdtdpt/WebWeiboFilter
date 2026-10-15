/**
 * 样式注入（PROJECT.md §5.2 第 ③ 条：首帧注入）
 *
 * 「首帧」的硬要求（§7.4 约束 1）：样式必须在 `document-start` 就位，
 * 否则会先闪一下微博原皮 / 先露出一条未处理的广告。
 *
 * ── 为什么只有一个属性 + 一条 CSS ──────────────────────────────────
 * 所有压制都通过**一个自定义属性**`data-spb` 的两个取值来表达：
 *   [data-spb="hidden"] → visibility: hidden   （B 类：信息流内的卡 —— 保高度，§12-B2）
 *   [data-spb="ad"]     → display: none        （A 类：页面级 banner —— 流式布局，可安全收掉）
 * 好处：① 撤销 = 删属性，不残留内联样式；② 不碰微博自己写的内联 style
 *      （虚拟列表会往槽位上写 `transform`，若我们直接改 `style` 容易互相打架）。
 *
 * ── B 类空位的占位提示（2026-10-15 用户拍板方案 A）─────────────────
 * 广告 / 关键词卡隐藏后留下一块等高空白，观感上像「页面坏了」。
 * `visibility` 是少数**可被后代重新置回 visible** 的继承属性（`display:none` 不行），
 * 所以占位可以做成**槽位的 `::after`**：卡整卡隐藏，空位中央叠一条中性小字。
 * 好处：零 JS 改动、零新增 DOM 属性（低调纪律不破）、撤销仍是删一个属性。
 *
 * ⚠️ 属性名刻意取短且不自述（不用 `data-specbase-filtered` 这种一看就知道装了什么的写法）：
 *    低调是项目核心目标，DOM 里不该留下自我介绍的痕迹。
 */

/** 唯一的压制属性 */
export const MARK_ATTR = 'data-spb';

/** 取值：B 类卡（信息流内）—— 保高度隐藏 */
export const MARK_HIDDEN = 'hidden';

/** 取值：A 类 banner（流外）—— 真正收掉 */
export const MARK_PAGE_AD = 'ad';

/** 样式表元素 id（便于撤销与幂等检查） */
export const STYLE_ID = 'spb-style';

/**
 * 过滤用的规则（与外观档位无关，**永远注入**）。
 * 这套选择器只依赖我们自己写的属性，微博改版也不会让它失效。
 */
export const FILTER_CSS = [
  `[${MARK_ATTR}="${MARK_HIDDEN}"]{visibility:hidden !important}`,
  `[${MARK_ATTR}="${MARK_PAGE_AD}"]{display:none !important}`,
  // B 类空位占位（方案 A）：::after 是槽位的后代 ⇒ 能把 visibility 重新置回 visible。
  // 绝对定位 + pointer-events:none ⇒ 不改布局、不接交互；颜色用主题变量（禁写死，见 §7.5）。
  `[${MARK_ATTR}="${MARK_HIDDEN}"]::after{`
    + 'content:"已过滤";'
    + 'visibility:visible !important;'
    + 'position:absolute;'
    + 'inset:0;'
    + 'display:flex;'
    + 'align-items:center;'
    + 'justify-content:center;'
    + 'font-size:13px;'
    + 'letter-spacing:.08em;'
    + 'color:var(--w-sub);'
    + 'opacity:.55;'
    + 'pointer-events:none'
    + '}',
].join('\n') + '\n';

/** 旧名（= `FILTER_CSS`），保留给既有调用与测试 */
export const CSS = FILTER_CSS;

/** 组装多段 CSS（过滤 + 外观档；空段自动跳过） */
export function composeCss(...parts) {
  return parts.filter((p) => Boolean(p)).join('\n');
}

/**
 * 幂等地注入样式表。`document-start` 时 `<head>` 可能还不存在，
 * 所以退回挂到 `documentElement`（同样生效）。
 *
 * ⚠️ 内容不一致时会**更新**已有样式表（切档位后重新注入用得上）；
 *    内容一致则不动、返回 false（保证幂等）。
 *
 * @param {Document} doc
 * @param {string} [cssText] 缺省用过滤规则（兼容既有调用）
 * @returns {boolean} 本次是否真的改动/插入了
 */
export function ensureStyle(doc, cssText) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || !d.createElement) return false;

  const text = cssText || FILTER_CSS;
  const existing = d.getElementById ? d.getElementById(STYLE_ID) : null;
  if (existing) {
    if (existing.textContent === text) return false;
    existing.textContent = text;
    return true;
  }

  const root = d.head || d.documentElement;
  if (!root || !root.appendChild) return false;

  const el = d.createElement('style');
  el.id = STYLE_ID;
  el.textContent = text;
  root.appendChild(el);
  return true;
}

/**
 * 移除样式表（关闭开关时用）。
 * @param {Document} doc
 * @returns {boolean}
 */
export function removeStyle(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || !d.getElementById) return false;
  const el = d.getElementById(STYLE_ID);
  if (!el || !el.parentNode) return false;
  el.parentNode.removeChild(el);
  return true;
}
