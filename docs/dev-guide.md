# SpecBase Helper · 开发者指南

> 面向 **开发者 / agent / 大模型**。用户手册（README）暂不创建 —— 产品尚未成形（PROJECT.md §2）。
> 本工程的**权威规范**是仓库根目录的 `PROJECT.md`；本文件只讲「怎么构建 / 怎么测 / 怎么侦察」。

---

## 1. 这是什么

`SpecBase Helper` 是 PROJECT.md 里那个「Web微博过滤器」的成品名与伪装身份：

- 交付物 = **1 个纯文本 userscript**：`dist/specbase-helper.user.js`
- 运行环境 = Tampermonkey + 最新版 Chromium（本机 Chrome 154 / Edge 154）
- **用户侧零依赖**：只有「把 .user.js 导入 Tampermonkey」一步。Node 只在开发机上用于打包与测试。

## 2. 仓库结构

```
WeiboFilter/
├── PROJECT.md              权威规范（需求已闭环 §12；下一步是 M0 侦察 §13）
├── package.json
├── docs/dev-guide.md       本文件
├── src/                    源码（分模块，esbuild 会打成单文件）
│   ├── main.js             入口：读配置 → 逐档应用；document-start 下执行
│   ├── config.js           配置读写（GM_setValue）+ 默认值 + 深合并
│   ├── core/
│   │   └── decision.js     判定核心（纯函数，§6 第②层）—— M1 才填实现
│   └── features/
│       └── l0.js           L0 标签页伪装（title + favicon），纯函数 + DOM 应用
├── tools/
│   ├── build.mjs           esbuild 打包（写入 userscript 元数据块）
│   ├── build.ps1           PowerShell 包装（首次自动 npm install）
│   └── recon/
│       └── recon.js        M0 结构侦察脚本（DevTools Console 粘贴即用）
└── tests/
    ├── fixtures/           DOM 快照夹具（⚠️ 含真实内容，已 gitignore）
    ├── l0.test.mjs
    └── core.test.mjs
```

## 3. 构建

```powershell
# 方式一（推荐）：PowerShell 包装，首次会自动装依赖
powershell -ExecutionPolicy Bypass -File tools\build.ps1

# 方式二：直接跑
npm install
npm run build
```

产物：`dist/specbase-helper.user.js`。把它拖进 Tampermonkey 或复制内容新建脚本即可。

> ⚠️ 交付脚本的中文文件一律 **UTF-8 with BOM**（PowerShell 5.1 按 ANSI 解码会乱码）；
> `tools/build.ps1` 已按此约定保存，改动它时别把 BOM 丢了。

## 4. 测试

```powershell
npm test          # 等价于 node --test tests/
```

零依赖，用 Node 内置 `node:test` + `node:assert`（PROJECT.md §12-A9）。

**为什么判定核心必须能在 Node 里 import**（§6）：过滤逻辑要在不开浏览器的情况下被测。
所以 `src/core/` 下**禁止**出现 DOM / `window` / `document` 引用；一旦需要，说明它放错了层。

## 5. M0 侦察（当前第一优先级，§12-B / §13）

过滤与低调模式的选择器**必须先拿到真实页面数据**，否则写下的都是会被推翻的猜测。

**步骤：**

1. Chrome 打开 `https://weibo.com/home`，等信息流加载、滚动出内容（最好含 ≥2 条广告/推广）。
2. F12 → Console → 粘贴 **`tools/recon/recon.js` 全文** → 回车。脚本会打印一份结构报告。
3. 存两份产物：
   - `SpecBaseRecon.downloadReport()` → JSON（回答 B1/B3/B4/B5/B7）
   - `SpecBaseRecon.saveSnapshot()` → HTML（放进 `tests/fixtures/`，作为离线单测输入）
4. 需要时手动补跑：
   - `SpecBaseRecon.testHeight()` —— 量 `display:none` 残留 vs 1px 容器（B2）
   - `SpecBaseRecon.watchTitle(20)` —— 观察 20s，看微博是否自己改写 title/favicon（B7）
5. 对**分组页 / 详情页 / 关注页**各存一份快照（§12 采集方式）。

建议的夹具命名：`home-timeline.html`、`home-group.html`、`detail.html`。

> **隐私红线**：夹具与快照含真实微博内容，属私有数据。`tests/fixtures/*` 已在 `.gitignore` 里，
> 任何时候都不要提交到远端。诊断报告（JSON）同样只含结构与统计，不入库。

### 5.1 离线结构分析（拿快照后跑）

```powershell
node tools\recon\analyze-snapshot.mjs tests\fixtures\snapshot-YYYYMMDD-HHMM.html recon-out\structure-<stamp>.json
```

输出「结构报告」：class 词汇表（**稳定 vs 构建哈希**）、卡片层级骨架、广告线索、帖子 ID 线索。
纯正则、零依赖。产物写进 `recon-out/`（已 gitignore）。

### 5.2 侦察已确认的结构事实（2026-10-13）

| 事实 | 值 |
| --- | --- |
| 容器 | `div.vue-recycle-scroller__item-wrapper` |
| 项（虚拟槽位） | `div.vue-recycle-scroller__item-view`（带 `data-index`） |
| 卡 | `div.wbpro-scroller-item` → `article` |
| **帖子 ID** | 时间链接 `https://weibo.com/<uid>/<bid>` 里的 `bid` |
| **可靠 class** | `wbpro-*`（`wbpro-scroller-item` / `wbpro-feed-content` / `wbpro-feed-ogText` / `wbpro-feed-reText` / `wbpro-textcut`）<br>`woo-*`（`woo-avatar-img` / `woo-icon-vipimg` / `woo-picture-main` / `woo-panel-main`）<br>`vue-*` / `vjs-*` |
| ⛔ **禁止用作选择器** | `_name_hash_lineno`，形如 `_num_198pe_46`、`_normal_ecgcn_34`（构建哈希） |
| ⛔ **也不能依赖** | `__yawf_*` —— **外部脚本运行时注入**，同一次微博构建下时有时无（实测 1928 处 ↔ 0 处） |
| 原创正文 / 转发原文 | `.wbpro-feed-ogText` / `.wbpro-feed-reText` |
| 头像 | `img.woo-avatar-img`（52px） |
| 作者 / 时间 / 来源 | ⚠️ 真实 DOM 里**没有语义类名**，只有 `usercard="<uid>"` 等弱钩子 ⇒ 需「多级回退选择器 + 探针」 |

⚠️ **自测时请先关掉其它微博相关脚本/扩展**（`__yawf_*` 与 `data-shipian-*` 都说明页面上还有别的注入源），否则快照不可比。

仍未定：**广告判据（B1）**、**高度行为（B2）**、**title/favicon 是否被改写（B7）** —— 见 PROJECT.md §12-B。

## 6. 里程碑与进度（§13）

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| **M0 侦察** | 侦察采集 + DOM 快照夹具 + 结构报告 | 🟡 首轮已跑（B3/B4/B5/B6 ✅）；**待补 B1 广告 / B2 高度 / B7 title** |
| **M1 管线** | 调度层 / 判定核心 / 应用层 + 广告识别 + 关键词过滤 | ⛔ 依赖 M0 结论 |
| **M2 低调模式** | L1 + L2 落地、首帧注入、可逆 | 🟡 **L0 已落地**（零适配成本，不依赖 M0） |
| **M3 入口与面板** | 隐藏热区 + TM 菜单 + 配置导入导出 + 可解释性 + 探针注册表 + 诊断页 | ⛔ |

## 7. 三条不可违背的工程纪律（摘自 PROJECT.md）

1. **不动信息流 DOM 结构**：L2 重排只允许 CSS（`grid/flex/order/absolute`），禁止移动/克隆/删除节点（§7.5.4）。
2. **不碰内容列宽度**：改列宽会触发虚拟列表高度重算（§7.6 风险 1）。切换 L0/L1/L2 后**自动刷新页面**。
3. **每条适配规则必须配一个探针**（§6.1）：没有探针 = 改版后无法自检的规则。

## 8. 验收三步（§14）

1. 构建：`tools\build.ps1` 产出 `.user.js` 无报错
2. 自测：`npm test` 全绿
3. **真机冒烟**：Chrome 里加载脚本，肉眼确认过滤生效、无首帧闪烁、关掉后页面完全恢复

> `git push` 由用户手动执行（本机凭据助手非交互）。
