/**
 * 样式注入（PROJECT.md §5.2 第 ③ 条：首帧注入）
 *
 * 「首帧」的硬要求（§7.4 约束 1）：样式必须在 `document-start` 就位，
 * 否则会先闪一下微博原皮 / 先露出一条未处理的广告。
 *
 * ── 为什么只有一个属性 + 一条 CSS ──────────────────────────────────
 * 所有压制都通过**一个自定义属性**`data-spb` 的两个取值来表达：
 *   [data-spb="hidden"] → 压缩为一行细条（B 类：信息流内的卡，§12-B19）
 *   [data-spb="ad"]     → display: none        （A 类：页面级 banner —— 流式布局，可安全收掉）
 * 好处：① 撤销 = 删属性，不残留内联样式；② 不碰微博自己写的内联 style
 *      （虚拟列表会往槽位上写 `transform`，若我们直接改 `style` 容易互相打架）。
 *
 * ── B 类：从「保高空块」到「一行细条」（2026-10-16 用户提议，§12-B19）──
 * 旧形态（2026-10-15 方案 A）：`visibility:hidden` 保原高度，空位中央叠「已过滤」
 * —— 广告卡 800px 高就空 800px，观感像「页面坏了」（用户原话「看上去像空了一块」）。
 * 新形态：**槽位压到一行文字高**（22px）+ overflow 裁切。依据：
 *   · vue-recycle-scroller 对每个槽位挂 ResizeObserver（B15 实证：运行中高度变化
 *     会被重测——评论展开 329→548 无洞），压缩后后续卡**预期自动上移补位**；
 *   · 若不感知，行为无害退化：洞从「800px 空块」变「22px 细线」（仍远好于现状）。
 *   ⇒ 两种结果都可接受，无破坏面；真机复验「补位 / 无跳 / 复用还原」。
 * `visibility` 保留：内容已被 overflow 裁掉，visibility 兜底盖住一切逃逸绘制
 * （且它是少数可被 ::after 置回 visible 的继承属性——细条里的那行字靠它点亮）。
 *
 * ⚠️ 属性名刻意取短且不自述（不用 `data-specbase-filtered` 这种一看就知道装了什么的写法）：
 *    低调是项目核心目标，DOM 里不该留下自我介绍的痕迹。
 */

/** 唯一的压制属性 */
export const MARK_ATTR = 'data-spb';

/** 取值：B 类卡（信息流内）—— 压缩为一行细条（§12-B19） */
export const MARK_HIDDEN = 'hidden';

/** 取值：A 类 banner（流外）—— 真正收掉 */
export const MARK_PAGE_AD = 'ad';

/** 样式表元素 id（便于撤销与幂等检查） */
export const STYLE_ID = 'spb-style';

/** B 类细条高度 = 一行文字高（⑧ 正文行盒 14×1.6≈22.4 ⇒ 取 22） */
export const HIDDEN_STRIP_H = 22;

/**
 * 过滤用的规则（与外观档位无关，**永远注入**）。
 * 这套选择器只依赖我们自己写的属性，微博改版也不会让它失效。
 */
export const FILTER_CSS = [
  // B 类压条（§12-B19）：max-height 压槽位（卡内容被 overflow 裁掉），
  // visibility 兜底盖住逃逸绘制。压缩是否触发 scroller 补位见文件头说明。
  `[${MARK_ATTR}="${MARK_HIDDEN}"]{`
    + `visibility:hidden !important;`
    + `max-height:${HIDDEN_STRIP_H}px !important;`
    + 'overflow:hidden !important'
    + '}',
  `[${MARK_ATTR}="${MARK_PAGE_AD}"]{display:none !important}`,
  // B 类细条里的那行字：::after 是槽位的后代 ⇒ 能把 visibility 重新置回 visible。
  // absolute + inset:0 在 22px 细条内居中；底缘一条分割线色（主题令牌，禁写死）
  // 让细条读起来像「一行被压掉的记录」而不是缺口。
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
    + `box-shadow:0 1px 0 var(--w-dividing-line);`
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
