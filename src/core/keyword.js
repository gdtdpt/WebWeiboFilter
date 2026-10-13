/**
 * 关键词过滤（PROJECT.md §12-A3 / §8.3）—— 判定核心的一部分
 *
 * 纪律（§6）：**纯函数，绝不碰 DOM。**
 *
 * ── 字段白名单（§12-A3，硬约束）────────────────────────────────────
 *   §12-A3 原文：「**禁止裸 `innerText` 全串匹配**（新版把整卡文字混在同一节点，
 *   会把转发链里别人的话也算进去 → 误杀）。只匹配：正文 + 转发原文 + 话题 + 作者昵称；
 *   来源与评论不参与。」
 *
 *   ⇒ 本模块只认四个字段：`text`（原创正文）/ `repostText`（转发原文）/
 *     `topics`（话题）/ `author`（作者昵称）。
 *   ⚠️ **绝不接受整卡字符串**（如 `innerText`）—— 适配层也不提供它，
 *      所以「用整卡文本匹配」在这条管线里根本无从发生。
 *
 * ── 话题字段是怎么来的（诚实说明）──────────────────────────────────
 *   侦察（§12-B4）**没有**确认到独立的话题选择器，所以 `topics` 由**正文文本**里
 *   按 `#…#` 解析得到 ⇒ `topics ⊆ text`。
 *   它的价值在**精度**：用户写 `#广告#` 并只勾「话题」时，只会命中话题形式的出现，
 *   不会命中正文里恰好提到「广告」二字的普通博文。
 */

/** 字段白名单（顺序即面板展示顺序） */
export const KEYWORD_FIELDS = ['text', 'repostText', 'topics', 'author'];

/** 字段的中文名（§9 可解释性：理由要给人看得懂） */
export const KEYWORD_FIELD_LABEL = {
  text: '正文',
  repostText: '转发原文',
  topics: '话题',
  author: '昵称',
};

/** 允许的动作 */
export const KEYWORD_ACTIONS = ['hide', 'highlight'];

/** 规则没写动作时的默认值（过滤的默认语义是「不看」） */
export const DEFAULT_KEYWORD_ACTION = 'hide';

/**
 * 从文本里解析话题（`#话题#`）。
 *
 * ⚠️ 这是**替代方案**：侦察没确认到独立的话题节点，所以只能从正文文本里解。
 * 解析结果 `⊆ text`，因此单独用「话题」字段匹配会比用「正文」更严格（更少误杀）。
 *
 * @param {string} text
 * @returns {string[]} 去重后的话题名（不含 `#`）
 */
export function extractTopics(text) {
  const t = typeof text === 'string' ? text : '';
  const out = [];
  const re = /#([^#\s][^#]{0,48})#/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const name = m[1].trim();
    if (name && out.indexOf(name) === -1) out.push(name);
  }
  return out;
}

/**
 * 归一化一条规则：补默认动作、把字段收窄到白名单内。
 * @param {Object} rule  `{ content, action?, fields? }`
 * @returns {{content:string, action:string, fields:string[]}|null} 内容为空则返回 null（丢弃）
 */
export function normalizeRule(rule) {
  const r = rule || {};
  const content = typeof r.content === 'string' ? r.content.trim() : '';
  if (!content) return null;

  const action = KEYWORD_ACTIONS.indexOf(r.action) !== -1 ? r.action : DEFAULT_KEYWORD_ACTION;

  const raw = Array.isArray(r.fields) && r.fields.length ? r.fields : KEYWORD_FIELDS;
  const fields = raw.filter((f) => KEYWORD_FIELDS.indexOf(f) !== -1);

  return { content, action, fields: fields.length ? fields.slice() : KEYWORD_FIELDS.slice() };
}

/**
 * 编译规则列表。
 *
 * 正则模式下**无效正则不抛异常** —— 用户敲到一半的半成品（如 `[unclosed`）不能炸掉整条管线；
 * 只记进 `errors` 并跳过该条（诊断页会把它显示出来）。
 *
 * @param {Array} rules
 * @param {boolean} regexMode
 * @returns {{compiled:Array, errors:Array<{content:string,error:string}>}}
 */
export function compileRules(rules, regexMode) {
  const compiled = [];
  const errors = [];

  for (const raw of (rules || [])) {
    const rule = normalizeRule(raw);
    if (!rule) continue;

    if (regexMode) {
      try {
        // 不加 g 标志 ⇒ 不含 lastIndex 状态，可安全重复 test
        compiled.push(Object.assign({}, rule, { re: new RegExp(rule.content, 'i') }));
      } catch (e) {
        errors.push({ content: rule.content, error: String((e && e.message) || e) });
      }
    } else {
      compiled.push(Object.assign({}, rule, { needle: rule.content.toLowerCase() }));
    }
  }

  return { compiled, errors };
}

/** 取某个字段在数据包里的值（一律返回字符串数组；话题字段天然是数组） */
function fieldValues(item, field) {
  if (field === 'topics') {
    if (Array.isArray(item.topics)) return item.topics.filter((x) => typeof x === 'string' && x);
    // 适配层没给就自己从正文里解（见文件头「话题字段怎么来的」）
    return extractTopics(item.text || '');
  }
  const v = item[field];
  return typeof v === 'string' && v ? [v] : [];
}

/** 单个值是否命中该规则 */
function valueHits(rule, value) {
  if (rule.re) return rule.re.test(value);
  return value.toLowerCase().indexOf(rule.needle) !== -1;
}

/**
 * 跑一遍关键词规则。
 *
 * 动作优先级：**`hide` > `highlight`**（同一条卡上两者都命中时以隐藏为准 ——
 * 「不想看」比「想留意」更硬；否则会出现「一条被高亮的卡同时又该被隐藏」的自相矛盾）。
 *
 * @param {Object} item    数据包（只用 text / repostText / topics / author 四个字段）
 * @param {Object} config  完整配置（读 config.filter）
 * @returns {{action:'hide'|'highlight'|null, hits:Array, reasons:string[], errors:Array}}
 */
export function matchKeywords(item, config) {
  const f = (config && config.filter) || {};
  const { compiled, errors } = compileRules(f.keywords, !!f.regexMode);
  const src = item || {};

  const hits = [];
  const reasons = [];
  let action = null;

  for (const rule of compiled) {
    for (const field of rule.fields) {
      const values = fieldValues(src, field);
      let matched = false;
      for (const v of values) {
        if (valueHits(rule, v)) { matched = true; break; }
      }
      if (!matched) continue;

      hits.push({ content: rule.content, action: rule.action, field });
      reasons.push(`关键词「${rule.content}」命中${KEYWORD_FIELD_LABEL[field]}`);

      if (rule.action === 'hide') action = 'hide';
      else if (action !== 'hide') action = 'highlight';

      break;   // 同一条规则命中一次就够，不重复记
    }
  }

  return { action, hits, reasons, errors };
}
