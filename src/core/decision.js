/**
 * 判定核心（PROJECT.md §6 第 ② 层）
 *
 * 纪律：**纯函数 —— 输入一条微博的结构化数据，输出动作，绝不碰 DOM。**
 * 唯一目的是让判定逻辑能在不开浏览器的情况下被 Node 单测（配 tests/fixtures 的 DOM 快照夹具）。
 *
 * ⚠️ M0 侦察（§12-B1/B3）完成后，本模块才会填入真实的选择器派生字段与广告识别特征。
 * 现在只建立**契约与骨架**，避免在拿到真实页面数据前写下会被推翻的猜测。
 *
 * @typedef {Object} ItemData  由适配层（第 ③ 层）从 DOM 抽出的结构化数据
 * @property {string} id                  微博 ID（§12-B3：「标记跟着数据走」的前提）
 * @property {string} [text]              正文纯文本
 * @property {string} [repostText]        转发原文
 * @property {string[]} [topics]          话题
 * @property {string} [author]            作者昵称
 * @property {Object} [flags]             适配层判定的元数据（如 { promo: true }）
 *
 * @typedef {Object} Decision
 * @property {'keep'|'hide'|'highlight'} action
 * @property {string|null} reason         命中的规则 / 判定广告的理由（§9「可解释性」纪律）
 *
 * @param {ItemData} _item
 * @param {Object} _config
 * @returns {Decision}
 */
export function decide(_item, _config) {
  // TODO(M1)：关键词匹配（字段白名单见 §12-A3）+ 广告识别（依赖 §12-B1）。
  return { action: 'keep', reason: null };
}
