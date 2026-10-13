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
├── PROJECT.md              权威规范（需求已闭环 §12；M0 侦察已出结论 §12-B）
├── package.json
├── docs/dev-guide.md       本文件
├── src/                    源码（分模块，esbuild 会打成单文件）
│   ├── main.js             入口：首帧（样式 + L0）→ DOM 就绪后启动过滤管线
│   ├── config.js           配置读写（GM_setValue）+ 默认值 + 深合并
│   ├── scheduler.js        **调度层（§6 第①层）**：唯一接触 MutationObserver 的地方
│   ├── core/               判定核心（纯函数，§6 第②层）—— 禁止引用 DOM
│   │   ├── decision.js     两条判定线的合成：广告 ∪ 关键词 → 一个动作
│   │   ├── ad-detect.js    **广告识别**（判据见 PROJECT.md §12-B1）
│   │   └── keyword.js      **关键词过滤**（字段白名单见 §12-A3）
│   ├── apply/              **应用层**（§6 第③层出口）
│   │   ├── style.js        样式（首帧注入）：一条属性 + 两条 CSS
│   │   └── mark.js         幂等打标记 / 撤销标记
│   ├── adapters/
│   │   └── weibo-home.js   微博首页适配层：卡片信号抽取 + 页面广告位发现 + 探针注册表
│   └── features/
│       └── l0.js           L0 标签页伪装（title + favicon），纯函数 + DOM 应用
├── tools/
│   ├── build.mjs           esbuild 打包（写入 userscript 元数据块）
│   ├── build.ps1           PowerShell 包装（首次自动 npm install）
│   └── recon/
│       ├── recon.js                 M0 结构侦察脚本（DevTools Console 粘贴即用）
│       ├── analyze-snapshot.mjs     离线「体检」：class 词汇表 + 逐卡对照表（纯正则）
│       └── find-ad-slots.mjs        离线「广告位定位」：真 DOM + 祖先链 + 稳定签名（parse5）
└── tests/
    ├── fixtures/           DOM 快照夹具（⚠️ 含真实内容，已 gitignore）
    ├── _fixture-expect.mjs     夹具期望值表（**唯一一份**，多个测试共用）
    ├── l0.test.mjs
    ├── core.test.mjs
    ├── ad-detect.test.mjs      广告判据单测（全部基于实测字符串）
    ├── keyword.test.mjs        关键词过滤单测（核心是 §12-A3 字段白名单）
    ├── decision.test.mjs       两条判定线合成的边界（并集 / 优先级 / 存疑不动手）
    ├── fixture-ad.test.mjs     夹具回放：真快照上跑适配层 + 判定核心
    ├── pipeline.test.mjs       **端到端**：调度层 + 核心 + 应用层跑在真快照上
    ├── probes.test.mjs         探针注册表结构 + 真快照自检（§6.1）
    └── recon-smoke.test.mjs    recon.js 无浏览器冒烟（vm 沙箱 + 真快照 + 合成页）
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
npm test          # 等价于 node --test（无参数会自动发现测试文件）
```

用 Node 内置 `node:test` + `node:assert`（PROJECT.md §12-A9）。

> ⚠️ **不要写成 `node --test tests/`** —— Node 22 会把目录当模块加载，直接报 `MODULE_NOT_FOUND`。
> 必须用无参形式让它自动发现。

**为什么判定核心必须能在 Node 里 import**（§6）：过滤逻辑要在不开浏览器的情况下被测。
所以 `src/core/` 下**禁止**出现 DOM / `window` / `document` 引用；一旦需要，说明它放错了层。

测试分两层：

| 层 | 文件 | 依赖 | 说明 |
| --- | --- | --- | --- |
| 纯函数单测 | `tests/*.test.mjs` | **零依赖** | 判定核心的输入输出契约 |
| **夹具回放** | `tests/fixture-ad.test.mjs` | `linkedom`（devDep） | 用**真 DOM** 在真实快照上跑适配层 + 判定核心。夹具不在（如新克隆的机器）时**整个文件自动跳过**，不会把 `npm test` 弄红 |

夹具回放的期望值写在 `tests/fixture-ad.test.mjs` 的 `EXPECT` 表里（按文件名子串匹配），
新增夹具时照着补一行即可；未登记的夹具只做「不崩」冒烟。

## 5. M0 侦察（当前第一优先级，§12-B / §13）

过滤与低调模式的选择器**必须先拿到真实页面数据**，否则写下的都是会被推翻的猜测。

**步骤：**

1. Chrome 打开 `https://weibo.com/home`，等信息流加载、滚动出内容（最好含 ≥2 条广告/推广）。
2. F12 → Console → 粘贴 **`tools/recon/recon.js` 全文** → 回车。脚本会打印一份结构报告。
3. 存两份产物：
   - `SpecBaseRecon.downloadReport()` → JSON（回答 B1/B3/B4/B5/B7）
   - `SpecBaseRecon.saveSnapshot()` → HTML（放进 `tests/fixtures/`，作为离线单测输入）
4. 需要时手动补跑：
   - `SpecBaseRecon.probeAds()` —— 广告判据实测（B1）：逐条打印 A 类广告位 / B 类推广卡 / **存疑卡**命中了哪条判据
   - `SpecBaseRecon.testHeight()` —— 量隐藏一项后的上移量 / 残留空洞 / 延迟重排（B2）。**跑完自动下载 JSON**。
     跑**四组**实验：`display:none` / `1px 容器` / `1px + 主动触发重测量` / `visibility:hidden`（对照组）；
     并探测虚拟列表 Vue 实例是否暴露 `sizes[]`（决定 CSS 之外还有没有 JS 路径）。
   - `SpecBaseRecon.watchTitle(20)` —— 观察 20s，看微博是否自己改写 title/favicon（B7）。**跑完自动下载 JSON**
5. 对**分组页 / 详情页 / 关注页**各存一份快照（§12 采集方式）。

> ⚠️ **`testHeight()` 每次都会打印「目标身份」并把校验结果放在 `sanity` 里。**
> 若 `sanity.warning` 非空（目标不是 `.vue-recycle-scroller__item-view` 槽位）⇒ **本次读数作废**。
>
> 这是 2026-10-13 踩过的真坑：探针按 `findContainers()` 的最高分容器取项，结果钻进了**卡片内的九宫格图片格**
> （`woo-box-item-inlineBlock _item_a3hty_47 __yawf_feed-picture_item`，高 137px），打出 `delta: 0 / residual: 137`
> —— 看着像结论、其实无意义。现在 `feedItems()` 只认 `item-wrapper` 的**直接子槽位**，
> `scoreContainer()` 给「子节点是虚拟槽位」的组 **+1000** 加权，`tests/recon-smoke.test.mjs` 有 2 条夹具回归测试守着。
> **教训（可迁移）**：靠「同签名子节点 ≥3」这类**结构启发式**找容器，一定会被嵌套网格抢走；
> 必须优先用**语义锚点**（`item-wrapper` → `item-view`），启发式只当兜底，而且取到对象后要**校验身份**。

**结果怎么拿走（不用从 Console 复制对象）**

Console 里直接打印的 JS 对象是**复制不出来**的（右键复制会退化成浅拷贝，长对象还会被折叠）。
所以脚本把每个探针的结果都存进 `SpecBaseRecon._results`，并提供三条出口：

| 出口 | 做什么 |
| --- | --- |
| `testHeight()` / `watchTitle(20)` | 跑完**自动下载** `probe-height-*.json` / `probe-title-*.json` |
| `SpecBaseRecon.exportResults()` | 把**已跑过的所有**探针结果汇总成一份 `probe-all-*.json` |
| `SpecBaseRecon.copyResult()` | 兜底（下载被浏览器拦时）：把结果 JSON 塞进剪贴板；失败则打印可右键复制的字符串 |

> 临时救急（不想重贴脚本时）：`copy(JSON.stringify(SpecBaseRecon.testHeight()))`、或
> `SpecBaseRecon.watchTitle(20).then(r => copy(JSON.stringify(r)))` —— DevTools 的 `copy()` 会把 JSON 放进剪贴板。

> ⚠️ **采集前先确认浏览器里没有别的微博脚本/扩展在跑** —— 首轮的 `__yawf_*` 就是上游油猴脚本注入的，
> 让整批夹具不可比。确认干净再存快照。

建议的夹具命名：`home-timeline.html`、`home-group.html`、`detail.html`。

> **隐私红线**：夹具与快照含真实微博内容，属私有数据。`tests/fixtures/*` 已在 `.gitignore` 里，
> 任何时候都不要提交到远端。诊断报告（JSON）同样只含结构与统计，不入库。

### 5.1 离线分析（拿快照后跑）

```powershell
# ① 粗粒度「体检」：class 词汇表（稳定 vs 构建哈希）、逐卡对照表、广告线索
node tools\recon\analyze-snapshot.mjs tests\fixtures\snapshot-YYYYMMDD-HHMM.html recon-out\structure-<stamp>.json

# ② 精确定位：广告位的**祖先链**与稳定签名、广告埋点链接、「关注」按钮、认证标签
node tools\recon\find-ad-slots.mjs tests\fixtures\snapshot-YYYYMMDD-HHMM.html
node tools\recon\find-ad-slots.mjs tests\fixtures\snapshot-YYYYMMDD-HHMM.html --json recon-out\ad-slots-<stamp>.json
```

- ① 纯正则、零依赖，看**全局分布**。
- ② 用 `parse5` 建**真 DOM 树**，能回答「这个节点的第 N 级祖先是谁」这类正则做不到的问题 ⇒ 看**单个广告位的确切落点**。

产物写进 `recon-out/`（已 gitignore）。

### 5.2 侦察已确认的结构事实（2026-10-13 · 四份快照）

| 事实 | 值 |
| --- | --- |
| 容器 | `div#scroller.vue-recycle-scroller` → `div.vue-recycle-scroller__item-wrapper` |
| 项（虚拟槽位） | `div.vue-recycle-scroller__item-view`（`transform: translateY(...)` **绝对定位**，带 `data-index`） |
| 卡 | `div.wbpro-scroller-item` → `article` |
| **帖子 ID** | 时间链接 `https://weibo.com/<uid>/<bid>` 里的 `bid`（base62） |
| **可靠 `id` 锚点** | `#scroller`（虚拟列表容器）/ `#homeWrap`（首页整个主栏：发布器卡 → A 类广告位 → 时间线）/ `#app` |
| **可靠 class** | `wbpro-*`（`wbpro-scroller-item` / `wbpro-feed-content` / `wbpro-feed-ogText` / `wbpro-feed-reText` / `wbpro-tag`）<br>`woo-*`（`woo-avatar-img` / `woo-icon-vipimg` / `woo-picture-main` / `woo-panel-main`）<br>`vue-*` / `vjs-*` |
| ⛔ **禁止用作选择器** | `_name_hash_lineno`，形如 `_num_198pe_46`、`_normal_ecgcn_34`（构建哈希） |
| ⛔ **也不能依赖** | `__yawf_*` —— **上游油猴脚本运行时注入**（已查明并卸载；同一次微博构建下实测 1928 处 ↔ 0 处） |
| 原创正文 / 转发原文 | `.wbpro-feed-ogText` / `.wbpro-feed-reText` |
| 头像 | `img.woo-avatar-img`（52px） |
| 作者 / 时间 / 来源 | ⚠️ 真实 DOM 里**没有语义类名**，只有 `usercard="<uid>"` 等弱钩子 ⇒ 需「多级回退选择器 + 探针」 |

⚠️ **自测时请先关掉其它微博相关脚本/扩展**（`__yawf_*` 与 `data-shipian-*` 都说明页面上还有别的注入源），否则快照不可比。

### 5.3 广告判据（B1 ✅ 已定稿 —— 详见 PROJECT.md §12-B1）

**判定规则**：各路判据按**权重累加** —— **≥3 分判广告、1~2 分判「存疑」、0 分判干净**。

| 类 | 位置 | 判据（含权重） |
| --- | --- | --- |
| **A 类** 页面 banner | 发布器正下方、**不在信息流里** | `img[src*="kadmimage.biz.weibo.com"]`（广告投放 CDN）＋ 自带关闭按钮 `…/948/2022/09/21/close.png`。**间歇投放**（实测 4 份里 3 份有） |
| **B 类** 信息流推广卡 | `.wbpro-scroller-item` 内 | ① 外链广告埋点（**3** 分，见下）<br>② 卡内图片来自广告 CDN（**3** 分）<br>③ 头部标签槽文案 `div.wbpro-tag`（**3** 分，**整串精确比对**）<br>④ 卡内「关注」按钮 `button[_followbtn_*]`（**2** 分，单独只判存疑） |

**B 类判据①的埋点变体**（`src/core/ad-detect.js` 里各自带权重，顺序=优先级）：

| id | 权重 | 实测原文（已解码） | 说明 |
| --- | --- | --- | --- |
| `campaign` | **3** | `mark=3_reallog_mark_ad:8\|3_<19位活动ID>` | 商业投放，**最硬** ⇒ 可单独判广告 |
| `natural` | **1** | `mark_id=999_reallog_mark_ad:999\|WeiboADNatural` | 🔴 **已降级为存疑级**（2026-10-13 用户人工核对「饼干姐」卡后定：那条内容完全不像广告）⇒ 单独出现只报 `suspect`，不判广告 |
| `weiboad` | **2** | `…_weiboad=`（`shorturl.biz.weibo.cn`） | 广告短链令牌 |
| `reallog_mark_ad` / `sclick` / `spm_mark` | **2** | 兜底 / 电商跳转 / 投放位标记 | 均需旁证 |

⚠️ **改这张表时注意**：`AD_URL_MARKERS` 的**表序 = 优先级**（每个 URL 只取第一个命中的标记），
`natural` **必须排在兜底的 `reallog_mark_ad` 之前**，否则 `999_reallog_mark_ad` 会被兜底规则按 2 分算，
降级就失效了。`tests/ad-detect.test.mjs` 有断言守这个顺序。

**⛔ 五个「不要」（都踩过/验证过）**：
1. 不要用卡片修饰符 —— 广告卡与自然卡同为 `_wrap_ecgcn_2 _normal_ecgcn_34`。
2. 不要找 `ad/promo/sponsor` 类名 —— 四份快照全为 0。
3. 不要在 DOM 里搜「广告」二字 —— banner 的标识是**烤在图片里**的。
4. 不要把 `div.wbpro-tag-img`（认证图标）当广告信号 —— 它在**自然卡**上。
   另：`video.weibo.com/show` 链接本身是自然的（干净快照也有 3 条）—— **只有带埋点的才算广告**。
5. **不要假设广告在 UI 上有可见标识** —— 1449「饼干姐」卡无标签、无「关注」按钮、无广告图、无播放器，
   唯一证据是转发原文视频链接上的埋点 ⇒ **埋点是唯一兜底，必须保证它单独可靠**。

**活页面上随时复查**：Console 里跑 `SpecBaseRecon.probeAds()`，会分别列出「推广卡」与「存疑卡」并打印命中了哪条判据。

**B7 已定（2026-10-13 16:13）**：`watchTitle(20)` 实测 20s 静置期 `changeCount: 0`（title / favicon 都没被改写）；
但实测到 title 有两种（`微博 – 随时随地发现新鲜事` / `最新微博 - 首页 - 微博`）⇒ **微博是 SPA，切页会改 title**
⇒ L0 必须 `MutationObserver` **持续校正**（覆盖 SPA 换页 + 新消息计数），不能只写一次。

**B2 已定（2026-10-13 16:21）**：`probe-height-20261013-1621.json`（`sanity.warning: null` ⇒ 目标确为信息流槽位）实测四组 ——
`display:none` / `1px` / `1px + 主动触发重测量` / `visibility:hidden` ⇒ **四组结论完全一致：后续项上移 `0px`、残留空洞 `287px`、无延迟重排**；
且 `item-wrapper` 的 `scrollHeight`/`clientHeight` 前后**恒为 5311px 不变** ⇒ 虚拟列表从不重测尺寸。
⇒ **「删除式隐藏」技术上不可能**，过滤命中卡只能 **保高度 + 降显著度**（形式见 PROJECT.md §7.5.0 的三方案待拍板）。
另外两条实测确认：`nextOffsetTop` 恒为 `0`（**`offsetTop` 无判别力**，必须用 `getBoundingClientRect()`）；
`findScrollerVm()` 未找到虚拟列表 Vue 实例 ⇒ **不用 JS 路径**。
（首测为何作废见 §5 的踩坑框。）

## 6. 里程碑与进度（§13）

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| **M0 侦察** | 侦察采集 + DOM 快照夹具 + 结构报告 | 🟢 **全部闭环**：B1 ✅（广告判据）· B2 ✅（2026-10-13 16:21 实测 ⇒ **隐藏不可行**）· B3~B7 ✅（含 B7 ⇒ L0 走持续校正） |
| **M1 管线** | 调度层 / 判定核心 / 应用层 + 广告识别 + 关键词过滤 | 🟢 **已接线**（2026-10-13）：判定核心（`ad-detect` + `keyword` + `decision`）+ 调度层（`scheduler.js`）+ 应用层（`apply/`）；单测 **86/86 全绿**（含 4 份真快照上的端到端管线）；**真机冒烟待做**（见 §8 的验收清单） |
| **M2 低调模式** | L1 + L2 落地、首帧注入、可逆 | 🟡 **L0 已落地**（零适配成本，不依赖侦察结论）；L1/L2 待做 |
| **M3 入口与面板** | 隐藏热区 + TM 菜单 + 配置导入导出 + 可解释性 + 探针注册表 + 诊断页 | ⛔ （探针**注册表**已在 `src/adapters/weibo-home.js#PROBES` 落好并有测试守着，M3 只差 UI；`scheduler.recent()` / `stats()` 已备好数据源） |

## 6.5 M1 管线怎么跑（接线后的数据流）

```
[DOM] ──适配层(readCardSignals)──▶ [数据包] ──判定核心(decide)──▶ [动作]
  ▲                                     ▲                          │
  │                            core/ad-detect.js（广告，§12-B1）    │
  │                            core/keyword.js   （关键词，§12-A3）  │
  │                                     ▲                          ▼
  └──调度层(scheduler.js)───────────────┘              应用层(apply/mark.js)
      MutationObserver + scroll 去抖(120ms)                data-spb="hidden" / "ad"
      每轮对**当前渲染的每个槽位重新判定**                      │
                                                        apply/style.js（首帧注入 CSS）
```

**四条必须记住的约束**（都有测试守着）：

1. **标记不持久**：槽位会被回收复用，所以每轮扫描都**重新判定 + 幂等设置/清除**标记（§5.2 第 ④ 条）。`pipeline.test.mjs` 有一条「槽位复用后标记必须跟着内容走」。
2. **两种广告、两套机制**：B 类（信息流内）`visibility:hidden` **保高度**（§12-B2 定论，不能删）；A 类（流外 banner）`display:none` 真正收掉。
3. **不观察 attributes**：虚拟列表疯狂写 `style.transform`，观察它会互相触发；只 observe `childList + subtree + characterData` + scroll(capture) 兜底。
4. **可逆**：`scheduler.stop()` 清空全部标记；`config.filter.enabled = false` 即不启动。

**页面上的调试把手**（无界面，低调 —— §8.2 只约束「可见」入口）：

```js
__spb.stats()    // { scans, slots, hidden, pageAds, records, lastScanAt, hidden/pageAd 当前计数 }
__spb.recent()   // 最近命中（内存态，最多 200 条；刷新即清）
__spb.rescan()   // 立刻重扫一次
__spb.off()      // 停掉过滤并清空全部标记 —— 用来肉眼验证「关掉后完全恢复」
__spb.on()       // 再打开
```

## 7. 三条不可违背的工程纪律（摘自 PROJECT.md）

1. **不动信息流 DOM 结构**：L2 重排只允许 CSS（`grid/flex/order/absolute`），禁止移动/克隆/删除节点（§7.5.4）。
2. **不碰内容列宽度**：改列宽会触发虚拟列表高度重算（§7.6 风险 1）。切换 L0/L1/L2 后**自动刷新页面**。
3. **每条适配规则必须配一个探针**（§6.1）：没有探针 = 改版后无法自检的规则。

## 8. 验收三步（§14）

1. 构建：`tools\build.ps1` 产出 `.user.js` 无报错
2. 自测：`npm test` 全绿
3. **真机冒烟**：Chrome 里加载脚本，肉眼确认过滤生效、无首帧闪烁、关掉后页面完全恢复

### 8.1 M1 的真机冒烟清单（自动化测不了的部分）

| # | 要确认的事 | 怎么看 |
| --- | --- | --- |
| 1 | 广告卡消失了，**位置留空**而不是「后面的卡跳上来」 | 滚到广告卡处：应看到一块与原卡等高的空白；页面上下的卡位置不动 |
| 2 | **反复上下滚动后没有串号** —— 普通微博不会被误隐藏，广告卡也不会又露出来 | 来回滚十几屏，扫一遍 `__spb.stats()` 的 `hidden` 是否稳定；发现异常卡用 `__spb.recent()` 查理由 |
| 3 | A 类 banner 收掉后**内容上移是否顺滑**（虚拟列表会不会跳变） | 刷新页面时盯着发布器下方：banner 应直接不出现，其余内容不闪动 |
| 4 | **首帧不闪**：既不闪微博原皮，也不闪广告 | 硬刷新（Ctrl+Shift+R）时观察 |
| 5 | **可逆**：`__spb.off()` 之后页面与没装脚本时一模一样 | 控制台跑 `__spb.off()`，确认被隐藏的卡全部回来、banner 也回来 |

> `git push` 由用户手动执行（本机凭据助手非交互）。
