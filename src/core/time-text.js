/**
 * 「相对时间 → 绝对短格式」的**纯文本规则**（PROJECT.md §7.5 D 组 · §13-M2 第二批）
 *
 * ── 依据（2026-10-13 夹具实测，四份快照一致）────────────────────────
 * 每个时间锚点都长这样（类名是构建哈希，不可用）：
 *
 *   <a title="2026-10-11 15:49" href="https://weibo.com/<uid>/<bid>">10-11   15:49</a>
 *   <a title="2026-10-13 08:13" href="https://weibo.com/<uid>/<bid>">6小时前</a>
 *   <a title="2026-10-12 09:40" href="https://weibo.com/<uid>/<bid>">昨天 09:40</a>
 *
 * 三个可直接利用的事实：
 *   ① **`title` 恒为 `YYYY-MM-DD HH:MM`** —— 这是格式判别依据，零误伤
 *      （卡内还有别的带 `title` 的链接，如作者昵称链接 `title="一年只改这一次昵称"`，匹配不上）；
 *   ② **微博自己的绝对短格式是 `10-8   22:51`**（不带年、月日不补零、时分补零）
 *      ⇒ 我们按同一格式输出，**宽度不会超过微博原生渲染**（不会把头部行挤换行）；
 *   ③ 旧帖的可见文本本来就已经是绝对格式 ⇒ 改写对它们是**幂等**的。
 *
 * ── 跨年怎么办：不动 ─────────────────────────────────────────────
 * 年份与当前年不同的（如 `2024-05-01 12:00`）**返回 null = 不改**：
 * 微博对旧内容本来就渲染绝对日期，去掉年份反而丢信息（§7.5.0「信息一个不删」）。
 *
 * ⚠️ 本模块是**纯函数**（§6 第 ② 层）：禁止引用 DOM / window / document，
 *    必须能在 Node 里直接单测。
 */

/** `title` 的日期格式（微博生成，稳定） */
export const TIME_TITLE_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

/**
 * 解析 `title` 里的绝对时间。
 * @param {string} title
 * @returns {{year:number,month:number,day:number,hour:number,minute:number,hourText:string,minuteText:string}|null}
 */
export function parseTimeTitle(title) {
  if (typeof title !== 'string') return null;
  const m = TIME_TITLE_RE.exec(title.trim());
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);

  // 合法性校验：防止把 `2026-13-45 99:99` 这种脏数据当成时间锚点
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59) return null;

  return { year, month, day, hour, minute, hourText: m[4], minuteText: m[5] };
}

/** 这个 `title` 是不是微博的绝对时间（适配层用它挑时间锚点） */
export function isTimeTitle(title) {
  return parseTimeTitle(title) !== null;
}

/**
 * 把 `title` 里的绝对时间转成**微博自己的短格式**；不该改时返回 `null`。
 *
 * @param {string} title  如 `"2026-10-08 22:51"`
 * @param {Date}   [now]  当前时间（注入以便单测；缺省取系统时间）
 * @returns {string|null} 如 `"10-8 22:51"`；跨年 / 非法格式返回 null（= 保持原样）
 */
export function absoluteShortText(title, now) {
  const p = parseTimeTitle(title);
  if (!p) return null;

  const ref = now instanceof Date ? now : new Date();
  if (Number.isNaN(ref.getTime())) return null;

  // 跨年不动（见文件头说明）
  if (p.year !== ref.getFullYear()) return null;

  // 月 / 日不补零（对齐微博自身的 `10-8`），时 / 分补零（对齐 `09:40`）
  return `${p.month}-${p.day} ${p.hourText}:${p.minuteText}`;
}
