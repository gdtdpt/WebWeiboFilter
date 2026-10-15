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
│   │   ├── keyword.js      **关键词过滤**（字段白名单见 §12-A3）
│   │   └── time-text.js    **时间文本规则**（`title` → 绝对短格式，纯函数）
│   ├── apply/              **应用层**（§6 第③层出口）
│   │   ├── style.js        样式（首帧注入）：一条属性 + 两条 CSS
│   │   ├── mark.js         幂等打标记 / 撤销标记
│   │   └── time.js         时间文本改写 / 还原（`data-spb-t` 存原文）
│   ├── adapters/
│   │   ├── weibo-home.js   微博首页适配层：卡片信号抽取 + 页面广告位发现 + 探针注册表
│   │   └── weibo-shell.js  外壳层适配（logo / 身份角标）+ 探针表
│   └── features/
│       ├── l0.js           L0 标签页伪装（title + favicon），纯函数 + DOM 应用
│       ├── l1.js           L1「素净」规则（零高度影响子集）
│       ├── theme.js        「去橙红」：CSS 变量覆盖（哑色，零选择器）
│       └── appearance.js   档位 → CSS 的纯函数（L2 蕴含 L1）
├── tools/
│   ├── build.mjs           esbuild 打包（写入 userscript 元数据块）
│   ├── build.ps1           PowerShell 包装（首次自动 npm install）
│   └── recon/
│       ├── recon.js                 M0 结构侦察脚本（DevTools Console 粘贴即用）
│       ├── firstframe-probe.user.js 一次性油猴脚本：**首帧**注入「真实缩短卡片内容」验「改高度行不行」（v3，@run-at document-start）
│       ├── analyze-snapshot.mjs     离线「体检」：class 词汇表 + 逐卡对照表（纯正则）
│       ├── inspect-card.mjs         离线「卡片结构取样」：article 子树 + 每层 class 可锚性（linkedom；A0/§12-B13）
│       ├── probe-ad-label.js        真机「广告标签」取样（Console）：定位「广告」二字长在哪个元素（§12-B13 ⑨）
│       ├── probe-media.js           真机媒体尺寸取样（Console）：单图/九宫格/视频的 rect、容器链、高度由什么决定（媒体缩略化前置，§12-B16 待立）
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
    ├── time-text.test.mjs      时间文本纯规则（title 判别 / 输出格式 / 跨年不动）
    ├── time-apply.test.mjs     时间改写的端到端（改写 / 幂等 / 还原 / 槽位复用）
    ├── summary.test.mjs        A1 摘要条（§12-B15：读数 / 建→幂等→更新→摘除 / 真快照回放）
    ├── probes.test.mjs         探针注册表结构 + 真快照自检（§6.1）
    ├── l1.test.mjs             L1 守卫（尺寸黑名单**含 display** / 锚点 / 禁写死色 / grayscale 白名单 /
    │                           归因条**必须保留** / 「更多」箭头必须行内限定 / 真夹具不空转）
    ├── theme.test.mjs          「去橙红」取值纪律（哑色色相与饱和度）
    ├── userscript-expose.test.mjs  把手必须挂在**页面 window**（TM 沙箱坑）
    ├── recon-smoke.test.mjs    recon.js 无浏览器冒烟（vm 沙箱 + 真快照 + 合成页）
    ├── ffprobe-rule.test.mjs   首帧探针注入的规则守卫（禁「不动边框盒」的手法 + 每卡恰好命中 1 个）
    └── ffprobe-verdict.test.mjs 首帧探针 v3 判词（四个世界：跟着走 / 停在原处 / 改槽不改卡 / 没生效）
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
   - `SpecBaseRecon.probeTheme()` —— **M2 取样用**（2026-10-13 新增；同日按首轮结果补了 `theme` / `layout` 两段）：一次取回
     ① 样式表里定义的自定义属性（`--w-*` / `--weibo-*`）及其定义选择器 ② `:root` 上生效的变量值 + 疑似**品牌暖色**清单
     ③ 页面元素的暖色分布（「去橙红」的着力点）④ 外壳几何（logo / 顶栏 / 左栏 / 右栏 / 底部候选的稳定签名与矩形；
     含 `rightAny` / `bottomAny`「不设尺寸阈值」的兜底清单，以及 `inViewport` 标记）
     ⑤ `woo-icon-*` 家族 ⑥ 时间锚点样本（验证「相对时间 → 绝对短格式」的策略）⑦ 我方 L1 规则的命中数
     ⑧ **`theme` 段**：`<html data-theme / data-layout / data-dpr>` + 关键令牌取值（正文色 / 卡片底 / 分割线 / 品牌色 / `--main-width` / `--simple-width` …）
     ⑨ **`layout` 段**：当前走 `simple`（微博自己收起右栏）还是 `full`，判据是**算术**（内容宽 vs `--main-width`），不靠猜。
     **跑完自动下载 JSON**。⚠️ 它要遍历数千元素做 `getComputedStyle`，页面会卡半秒左右。
   - `SpecBaseRecon.probeHeightCache()` —— **改高度可不可行**（2026-10-14 新增）。
     ⚠️ **它只回答一半**：答「列表**重建**时会不会重测」，**答不了「首帧注入行不行」**
     （Console 注入天然晚于微博那次写入 ⇒ 物理上问不到）。
     🔴 **更要紧的一条**：它注入的是 `margin-bottom` —— **只压矮槽位、不动卡片的边框盒**
     （margin 不进 `getBoundingClientRect()`），而微博的尺寸缓存跟的是**卡片高**（§12-B11）
     ⇒ **它连「改高度可不可行」也答不了**。它的判词里现在挂着这句提醒；
     但它的**副产品**很有价值：注入后打印的 `matchRateCard` / `cardGapMedian` 会**直接显示**
     「d 跟的是卡片高」这件事。
     判据两条：① 相邻槽的内联 `translateY` 差值 d(i) 是否等于上一槽的实际高度 h(i)（顺带记**小数位**
     ——`287.9px` 这种值只可能来自实测）；② 注入 `-60px` 后 d 是否仍等于 h、卡片之间**有没有洞**。
     **第一段**还带一条**结构自证**：`卡片高 − 槽高` 应 ≈ 60px —— 用来把「CSS 生效了」与
     「没有洞」**分成两件事**分别证明（规则没命中时也会「没有洞」，那是假阳性）。
     **两段式**：跑一次（给基线并注入 -60px）→ **换一次路由**让列表重建
     （⚠️ **不是切「推荐 / 关注」tab** —— 2026-10-14 实测那不会重建；**也不是刷新**，刷新会同时丢掉
     注入的 CSS 与基线）→ 再跑一次（给结论、自动撤掉注入）。
     中途不想继续：`SpecBaseRecon.probeHeightCache({clear:true})`。**跑完自动下载 JSON**。
   - `tools/recon/firstframe-probe.user.js` —— **首帧路径**验证（**一次性**油猴脚本，**装上、刷一次即可**）。
     这才是决定性的一问：「微博**在什么时刻**写槽位尺寸缓存」——
     在**首次渲染时**写 ⇒ `document-start` 注入的 CSS 会被一起量进去 ⇒ 改高度不留洞。
     Console 探针做不到这件事（它只能渲染后注入，那正是 B2 已证无效的情形）。
     🆕 **v3.0.0（2026-10-14 改）**：v2 用 `margin-bottom` 测，**测错了对象**（只动槽位、不动卡片，
     §12-B11）⇒ 判词改成**两态对撞**：A 态（注入态）量 d 与**卡片高**，撤掉样式后 B 态量同一批条目的
     **自然卡片高**，看 d 贴近哪一个 —— 两候选相差几百 px，**不靠阈值猜**。
     注入的规则也换成**真实缩短卡片内容**（隐藏内容主体 + 统计行）。自证改为
     「B 态卡片高 − A 态卡片高」的中位数必须 > 0（否则说明规则没命中 ⇒ 整组读数作废）。
     另有一道闸 `cardGapOk`：要求**卡片高 ≈ 槽高**，一旦又变成「改槽不改卡」就判读数无效。
     **怎么用**：装脚本 → 打开 `https://weibo.com/home` → **刷新一次** → **不要滚动**，
     等 Console 自动打出结论（并自动下载 `ffprobe-firstframe-*.json`）。
     另记一条**时间线旁证**：`timeline.msStyleBeforeFirstSlot`（CSS 比第一个槽位元素早出现多少 ms）
     —— 元素被测量不可能早于它被创建，这个值为正就排除了「微博在我们注入之前就量完了」。
     测完请**卸载**并刷新（它会把卡片内容一直藏着）。
     🆕 **v2.1.0 起还有一道「读数无效」自检**：若所有槽位的盒子都量不到（`h/top/bottom` 全 0，
     而内联 `translateY` 仍有值）⇒ 说明页面处于异常态（某个祖先被 `display:none`），
     脚本会**直接告诉你读数作废并让你去查 A 类收口**，不再打出一堆看着像数据的数。
     （`probeHeightCache()` 同样有这道闸：`boxesMissing`。）
     ✅ **已验证（2026-10-14 15:18）：判「✅ 改高度可行」** —— 5/5 对 `d` 贴近**注入态**卡高（误差 ≤ 0.9px）、
     贴近自然态 0/5，两候选相差中位 257.6px；四道自证闸（`boxesMissing` / `cardGapOk` / `selfProofOk` /
     时间线 1693ms）全过 ⇒ 首帧注入的 CSS 被算进尺寸，**§12-B12 定案**。该工具使命已完成，**可从 TM 卸掉**。
   - `SpecBaseRecon.probeCardRows()` —— **卡片内部结构（A0 取样，2026-10-14 新增，§12-B13）**。
     列出每张卡的「`article` 直接子块 + 各自高度 + 可锚性分类（库类 / 语义类 / 构建哈希 / ⛔外部注入）」，
     并专门去抓**社交提示行**（§7.5-E 的「统计行」）—— 它是**条件渲染**。
     ✅ **已定案（2026-10-14 16:28 真机）**：它就是 `article` 的**第一个子** `div._wrap_sssx9_11`
     （**h 恒 35px**），文案有**「xx 赞过」与「xx 关注了」两种**，锚 `article > div[class*="_wrap_"]`。
     ⚠️ 早先「`_placebox_*` 是统计行容器」的推断**已被真机证伪**（§12-B13 ②-cold）。
     · 离线那半（结构树，不开浏览器）：`node tools/recon/inspect-card.mjs [-d 6] [--find 文本] [--only 1449]`
     · 已确认的结论：`article > footer` = **互动按钮行**（39/39 张卡恰好 1 个、**h 恒 40px**），可直接作 `display:none` 的落点。
     · 🔴 **采集前先卸掉首帧探针** `firstframe-probe.user.js` —— 它注入的
       `.wbpro-scroller-item article > footer{display:none}` 藏的正是本次目标。TM 里禁用后**要刷新**
       （它注入的 `<style id="spb-ffprobe-style">` 不会被卸载带走），或就地跑
       `document.getElementById("spb-ffprobe-style")?.remove()`（不丢滚动位置）。
       **主脚本 SpecBase Helper 不用停**（理由见 PROJECT.md §12-B13 ⑤）。
       探针已有 **`footersHidden` 第二道闸**把「footer 全高 0」直接判成**无效读数**（`boxesMissing`
       只看卡片高，拦不住这种「卡片有高、只有 footer 被藏」的情况 —— 会打出假好消息）。
     · ⭐ 关键字段：`cardsWithSocialRow`（**结构判据** `article > div[class*=_wrap_]`）vs `cardsWithLikeRowText`
       （**文本判据** 赞过/关注了）—— **两者不一致时探针会自己喊**（真机就发生过：只认「赞过」时 13 张漏报 5 张）、
       `rows[].likeRow.socialRow`（`index` / `h` / 原文案）、`rows[].footer.h`（**恒 40px**）。
     用途：外壳类名**全是构建哈希**，只能靠取样拿锚点 —— 不猜（§6.1）。

> ⚠️ **颜色规则一律走主题令牌，禁止写死明暗色**（2026-10-13 真机取样后的硬纪律，PROJECT.md §12-B9）。
> 实测：用户的微博跑在**深色主题**（`<html data-theme="dark">`，`--w-card-background: #191919`、`--w-main: #bfbfbf`），
> 而深色主题会在 `[data-theme="dark"]:root` 里用**字面量**重定义同一批配色变量。
> ⇒ 任何"写死颜色"的规则都会在其中一套主题上翻车（L1 第一批的 `#333` / `#e6e6e6` 就是这样，
> 深色下分别变成"正文消失"和"一条白线"）。
> 只用 `var(--w-main)` / `var(--w-sub)` / `var(--w-dividing-line)`；
> `tests/l1.test.mjs`（扫外观 CSS 里的十六进制色）与 `tests/theme.test.mjs`（扫变量覆盖表的取值）各有一条守卫拦着。

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
| 项（虚拟槽位） | `div.vue-recycle-scroller__item-view`（`transform: translateY(...)` **绝对定位**，回收位为 `translateY(-9999px); opacity:0`）；⚠️ **`data-index` 不在槽位上**，在它里面的 `div.wbpro-scroller-item` 上（2026-10-14 实测纠正） |
| 卡 | `div.wbpro-scroller-item` → `article` |
| ⭐ **尺寸缓存对照的是「卡」，不是「槽」**（2026-10-14） | 槽位的内联 `translateY` 步长 `d` 逐对等于**卡片（`.wbpro-scroller-item`）的边框盒高**，与槽位高不一定相等（实测 `d=837` vs 槽高 `777.9` vs 卡片高 `837.9`，误差 ≤1px）。正常页面里**槽高 == 卡片高**所以看不出来；一旦用 `margin` 这类「只动槽位、不动卡片边框盒」的手法，就会自造出与 `d` 等宽的洞。⇒ **要改高度就改卡片自己的内容**（`display:none` 掉真实内容块）；⛔ `margin` / `transform` / `clip` / `opacity` / `filter` 全都测不出东西（§12-B11） |
| **帖子 ID** | 时间链接 `https://weibo.com/<uid>/<bid>` 里的 `bid`（base62） |
| **可靠 `id` 锚点** | `#scroller`（虚拟列表容器）/ `#homeWrap`（首页整个主栏）/ `#app` |
| **首页主栏的真实结构**（2026-10-14 事故后更正） | `#homeWrap` 只有 2 个直接子节点：`div.woo-panel-main…`（发布器）+ 一个**匿名 div**；而那个匿名 div 里依次是 **A 类广告 banner（`div.woo-box-flex…`，85px）→ `div._visable_*`（另一块，含 `wbpro-tab2`，**不是广告**）→ 时间线（`div > #scroller`）**。⚠️ **广告与时间线是兄弟**；把它俩当成上下级会让 A 类收口连时间线一起收掉（§12-B10） |
| **可靠 class** | `wbpro-*`（`wbpro-scroller-item` / `wbpro-feed-content` / `wbpro-feed-ogText` / `wbpro-feed-reText` / `wbpro-tag`）<br>`woo-*`（`woo-avatar-img` / `woo-icon-vipimg` / `woo-picture-main` / `woo-panel-main`）<br>`vue-*` / `vjs-*` |
| ⛔ **禁止用作选择器** | `_name_hash_lineno`，形如 `_num_198pe_46`、`_normal_ecgcn_34`（构建哈希） |
| ⛔ **也不能依赖** | `__yawf_*` —— **上游油猴脚本运行时注入**（已查明并卸载；同一次微博构建下实测 1928 处 ↔ 0 处） |
| 原创正文 / 转发原文 | `.wbpro-feed-ogText` / `.wbpro-feed-reText` |
| 头像 | `img.woo-avatar-img`（52px） |
| **视频**（⚠️ 不是 `woo-picture`） | **video.js**：`div.video-js.vjs-paused` → `video.vjs-tech` + `div.vjs-poster > picture.vjs-poster > img`（封面）<br>`vjs-*` 是 **video.js 库**的类名 ⇒ 可锚；外层 `_videoBox_12xiz_*` / `_feedVideo_989gf_*` 是构建哈希 ⇒ 不可锚<br>卡外另有小窗播放器 `div.mini-player` → `#vjs_video_3`（每页恒定 1 个）⇒ 视频规则要**限定在 `.wbpro-scroller-item` 卡内** |
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
| **M1 管线** | 调度层 / 判定核心 / 应用层 + 广告识别 + 关键词过滤 | 🟢 **已接线 + 真机验收通过**（2026-10-13）：判定核心（`ad-detect` + `keyword` + `decision`）+ 调度层（`scheduler.js`）+ 应用层（`apply/`）；单测 **139/139 全绿**（含 4 份真快照上的端到端管线）。<br>真机：过滤生效、滚动无异常、可逆。<br>🔴 **2026-10-14 修正**：其中「A 类收掉无跳变」**不成立为验收证据** —— A 类 banner 间歇投放，那次很可能没遇到广告；遇到时会把**整条时间线**一起 `display:none`（信息流整页空白），见 PROJECT.md §12-B10。<br>遗留：关键词 `highlight` 只留接口未落样式；关键词规则暂无配置 UI（M3） |
| **M2 低调模式** | L1 + L2 落地、首帧注入、可逆 | 🟡 **L0 已落地**；**L1 第一批（零高度影响子集）已落地且真机验收通过**（`src/features/l1.js` + `features/appearance.js`，**13 条规则**，`l1.test.mjs` 用「会改尺寸的属性」黑名单（**含 `display`**：2026-10-14 补掉的盲区）+ 锚点纪律 + **禁写死颜色** + **grayscale 白名单**四条通用守卫）；**「全局去橙红」已落地并验收**（`src/features/theme.js`：**零选择器**，只覆盖 26 个 CSS 变量；2026-10-14 用户定调「降彩度、不灭色相」⇒ 取值为同色相哑色 hsl，`theme.test.mjs` 守着色相/饱和度纪律；产物已改 `minify:true` 剥注释）；**L1 第二批开工：① 时间相对 → 绝对短格式已落地 + 真机验收通过**（`core/time-text.js` + `apply/time.js`，JS 改写 + `data-spb-t` 存原文可逆，`time-apply.test.mjs` 10 条守着）**② 视频封面 / 暂停帧降饱和已落地 + 真机验收通过**（视频走 **video.js** 而不是 `woo-picture` ⇒ 单加 `.vjs-poster img` + `.video-js.vjs-paused video.vjs-tech` 两条规则，**限定在卡内**；`l1.test.mjs` 三条守卫 + 探针 `video`。真机确认：封面变淡 / 播放恢复全彩 / 暂停又淡 / 小窗播放器不受影响）；L2 重排与其余改高度项待做。**③ 社交归因条「保留 + 中性化」已落地（2026-10-14）**：卡片顶部那行「xx 赞过 / xx 关注了」按用户定调**不隐藏**（它是来源归因 —— 「这条我没关注的人发的微博为什么出现在这里」）；昵称与整行转 `var(--w-sub)`、行尾「更多」箭头隐藏；**整行 35px 保留 ⇒ 零高度影响**，锚 `article > div:has(a.feed-title_a)`（用**库类名** `a.feed-title_a` 反推，不用泛词干 `_wrap_`）；`l1.test.mjs` 三条针对性守卫 + **变异测试验过能红**。⚠️ 真机待验收（重点量高度是否仍 35px，§12-B13 ⑧）**④ A1 互动按钮行「缩略为摘要条」已落地（2026-10-15，§12-B15，改高度批次第一枪）**：`article > footer`（h 恒 40px）`display:none` ⇒ 卡真实矮 40px（前提 §12-B12）+ `apply/summary.js` 每轮幂等在原位置叠**绝对定位**摘要条 <a>「N 转发 · N 评论 · N 赞」（读数锚 `woo-font--retweet/comment`、`woo-like-count`，链接取时间锚 = 详情页），**点一下进详情、无 hover**（用户拍板方案 ②）；l1.js 加 footer 隐藏 / article relative / 摘要条样式 3 条（规则 13→16）；`l1.test.mjs` 尺寸黑名单升级为 **SIZE_EXEMPT 登记表**（A1 是第一个登记的改高度项）+ `summary.test.mjs` 端到端。⚠️ 真机待验收「**不留洞** + 入口可点」（冒烟清单第 18 项）⚠️ **改高度项的前置假设仍在验**（§12-B11：缓存对照的是**卡片边框盒**而非槽位 ⇒ 2026-10-14 15:01 那次首帧读数判的「❌」是**注入手法**的否证、不是结论；`firstframe-probe.user.js` 已升 **v3** 重测） |
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
      └─(L1 开着时) 顺带 apply/time.js 改写时间 ──▶  data-spb-t=<原文> + 文本换成绝对短格式
                                                        apply/style.js（首帧注入 CSS）
```

**四条必须记住的约束**（都有测试守着）：

1. **标记不持久**：槽位会被回收复用，所以每轮扫描都**重新判定 + 幂等设置/清除**标记（§5.2 第 ④ 条）。`pipeline.test.mjs` 有一条「槽位复用后标记必须跟着内容走」。
2. **两种广告、两套机制**：B 类（信息流内）`visibility:hidden` **保高度**（§12-B2 定论，不能删）；A 类（流外 banner）`display:none` 真正收掉。
3. **不观察 attributes**：虚拟列表疯狂写 `style.transform`，观察它会互相触发；只 observe `childList + subtree + characterData` + scroll(capture) 兜底。
4. **可逆**：`scheduler.stop()` 清空全部标记；`config.filter.enabled = false` 即不启动。

**L1 的时间改写（第二批 · §7.5 D 组）**——唯一一处**改写了 DOM 文本**的地方：

| 关注点 | 做法 |
| --- | --- |
| 怎么认出时间锚点 | 类名是构建哈希 ⇒ 只认 `title` 的**日期格式**（`a[title^="20"]` 粗筛 + 正则复核）。作者昵称等 `title` 匹配不上 ⇒ 零误伤 |
| 为什么不用纯 CSS | `visibility:hidden` 的原文**仍占位**，`::after{content:attr(title)}` 只能接在占位之后 ⇒ 会渲染成「若干字空隙 + 绝对时间」；绕开它要动 `font-size:0` / `overflow:hidden`，属改尺寸项（B2 禁止） |
| 输出格式 | 对齐微博自身的短格式：月日不补零、时分补零（`10-8 22:51`）⇒ 宽度不超原生渲染，不会把头部挤换行 |
| 跨年怎么办 | **不动** —— 旧内容微博本就渲染绝对日期，去年份反而丢信息 |
| 怎么还原 | 改写前把原文存进 `data-spb-t`（不 observe attributes ⇒ 不自触发）；档位关掉或 `stop()` 时逐字还原 |
| 幂等怎么写 | 已是目标文本 ⇒ 不写；`data-spb-t` **只在首次改写时**写入（覆盖它 = 把改写结果当原文，还原时会写回假原文 —— `time-apply.test.mjs` 有专门一条守着） |

**页面上的调试把手**（无界面，低调 —— §8.2 只约束「可见」入口）：

```js
__spb.stats()    // { scans, slots, hidden, pageAds, pageAdsRefused, records, lastScanAt, hidden/pageAd 当前计数 }
__spb.recent()   // 最近命中（内存态，最多 200 条；刷新即清）
__spb.rescan()   // 立刻重扫一次
__spb.off()      // 停掉过滤并清空全部标记 —— 用来肉眼验证「关掉后完全恢复」
__spb.on()       // 再打开
__spb.inspect($0) // ⭐ 现场判定一张卡（2026-10-14 新增）：Elements 面板选中卡内任意元素后跑，
                  // 用与管线同一套 readCardSignals + decide 吐出 signals + decision
                  //（action / adScore / reasons / suspect）。专门回答「这张卡为什么**没**被处理」——
                  // recent() 只记「动作非 KEEP」的卡，漏网卡恰好不留痕。
                  // ✅ 首战战果（同日）：定位到漏网广告卡 = 「广告」徽章**烤在图片里**
                  //（wbpro-tag-img > img[icon_auth_black.png]，56×30 像素即「广告」二字），
                  // 旧代码把它当认证图标跳过 ⇒ 已修复：图片型标签折算 tagTexts「广告」（§12-B13 ⑨）。
```

⚠️ `pageAdsRefused`（2026-10-14 事故后新增）= 这一轮有**几处 A 类广告位找不到安全落点而放弃收掉**。
正常应为 `0`。非 0 说明适配层宁可让广告露着也不愿冒吞掉时间线的风险 —— **这时页面是好的，请把这条反馈给我**
（说明 `resolvePageAdContainer()` 的走位在这台机器上又变了，见 PROJECT.md §12-B10）。

⚠️ **把手挂在「页面 window」上，不是脚本沙箱**（2026-10-13 真机踩到，已修）：
脚本声明了 `@grant GM_getValue/GM_setValue`（配置存 TM 存储，§9）⇒ Tampermonkey 启用**沙箱**，
脚本里的 `window` 是**沙箱对象** ⇒ `window.__spb = ...` 只写进沙箱，页面控制台访问不到
（症状：`Uncaught ReferenceError: __spb is not defined`，而**过滤本身完全正常** —— 所以这个错只在
「想用把手调试」的那一刻才暴露，最容易蒙混过关）。
实现改为经 `unsafeWindow` 挂到页面 window（元数据里的 `@grant unsafeWindow` **不能删**，
否则沙箱里取不到它），非 TM 环境退回 `window`。
`tests/userscript-expose.test.mjs` 用 `node:vm` 造出**两个不同的 window** 把这条焊住：
谁改回 `window.__spb = ...`，测试立刻变红。

**外观档位怎么切**（L1 第一批已落地）：

```js
__spb.appearance({ l1: true })    // 开 L1（写进 TM 存储）
__spb.appearance({ l1: false })   // 关
__spb.css()                       // 看当前实际注入了哪些 CSS（排查"规则到底生效没有"）
```

⚠️ 改完**刷新页面**才生效（§7.4 约束：切档后自动刷新）—— 样式虽是首帧注入，
但当前页面里微博已按旧样式测量过虚拟列表高度。

⚠️ **L1 的规则分两类**：
- **零高度影响**（去色 / 灰度 / 滤镜 / 装饰替换 / **社交归因条中性化**）—— 已落地；
- **改卡片高度**（媒体缩略化到 60px / 隐藏互动按钮行 / 字号行距）—— 待做。虚拟列表的槽位位置来自
  一份预计算的 `translateY`，改高度可能留洞或漂移。
  ℹ️ 原列表里的「隐藏统计行」**已移出**：2026-10-14 用户改为「**保留 + 中性化**」（§7.5-E / §12-B13 ⑧）
  —— 整行 35px 保留 ⇒ 零高度影响，已随第一批一起落地。

**前提的实测（2026-10-14）—— ✅ 已定案：改高度可行**：
① 缓存 = **卡片边框盒**实测高度（不是「预先定好的高度表」）✅（§12-B11）；
② 预测位置与卡片高**逐对吻合**、无洞 ✅；③ 切「推荐 / 关注」tab **不重建**列表 ❌
（这条只是排除了「靠切 tab 重算」的读法，与可行性无关）；
④ ⭐ **首帧注入的 CSS 会被算进尺寸** ✅（§12-B12：5/5 对 `d` 贴近注入态卡高、误差 ≤ 0.9px；
四道自证闸全过）⇒ **L1 剩余 3 项 + L2 重排的前提成立**。
- 判「改高度行不行」**必须**用**真实缩短卡片内容**的规则去测；`margin` / `transform` / `opacity` 那类
  「不动边框盒」的手法**只能测出自己的影子**（v2 就是这么翻车的，§12-B11）。
- ⚠️ 旧记「渲染后改高度绝不回写 = 已证」**已降级为未验证**（那条读数的观察对象其实是**槽位**）。
  本项目不走「运行中热改高度」这条路（切档后强制刷新），所以不影响动工，但**别拿它当许可**。
- ⚠️ 覆盖边界：§12-B12 只验了**普通博文卡**；推荐关注 / 话题 / 头条类大卡未验。
- 新增规则时 `tests/l1.test.mjs` 会用一张「会改尺寸的属性」黑名单（**含 `display`** —— 2026-10-14
  补掉的盲区：此前「把内容块 `display:none` 掉」这类改动测试**拦不住**）+ 锚点纪律
  （禁构建哈希 / `__yawf_*`）把它拦下来。白名单只放行**行内叶子图标**的 `display:none`
  （`woo-icon*` 认证角标 / `woo-font--*` 字体图标）。

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
| 3b | ⛔ **A 类收口绝不能吞掉信息流**（2026-10-14 真机事故后新增，**最高优先级**） | 页面上**出现广告 banner** 时刷新：中间那栏必须**照常是信息流**。事故形态 = 广告与时间线一起消失（整栏空白）；原因与修法见 PROJECT.md §12-B10。控制台 `__spb.stats()` 里 `pageAds` 应为 1 且 `pageAdsRefused` 为 0；若 `pageAdsRefused > 0`，说明适配层放弃了收掉（广告露着）—— 把这条反馈给我 |
| 4 | **首帧不闪**：既不闪微博原皮，也不闪广告 | 硬刷新（Ctrl+Shift+R）时观察 |
| 5 | **可逆**：`__spb.off()` 之后页面与没装脚本时一模一样 | 控制台跑 `__spb.off()`，确认被隐藏的卡全部回来、banner 也回来 |

> 前置检查：控制台里 `typeof __spb` 应返回 `"object"`。若报 `__spb is not defined` ⇒ TM 沙箱问题（见 §6.5 的 ⚠️），
> 先确认用的是最新 `dist/specbase-helper.user.js`（元数据里带 `@grant unsafeWindow`）并重新导入。

### 8.2 M2（L1）的真机冒烟清单 —— 第 1~9 项是第一批（零高度影响），第 10~17 项是后续已落地项（时间改写 + 视频降饱和 + 社交归因条 + 空位占位）

| # | 要确认的事 | 怎么看 |
| --- | --- | --- |
| 1 | 开 L1 后**页面没留洞、没漂移** —— 这是第二批的前提 | `__spb.appearance({ l1: true })` → 刷新 → 上下滚十几屏：卡片间距应均匀，没有越来越大的空隙 |
| 2 | 头像 / 图片**降饱和（淡彩）但保留色相**、尺寸不变 | 对比开关前后同一张卡：头像仍是 52px、图片仍是原来的框；颜色应当仍分得出蓝绿红，只是不扎眼（2026-10-14 用户定调「降彩度、不灭色相」） |
| 3 | 卡片之间是**细灰线**而不是阴影卡片 | 卡片应当看不出"浮起来"的圆角块 |
| 4 | 正文话题 / `@` / 外链**不再是蓝色**，但**仍可点** | 点一个话题，应当照常跳转 |
| 5 | 顶栏 logo 变灰但位置不变 | 左上角 logo 应仍是原来的大小与位置（logo 是伪装层，**刻意保留全灰**） |
| 6 | **可逆**：关掉 L1 后与没装脚本时一致 | `__spb.appearance({ l1: false })` → 刷新 |
| 7 | 过滤功能没被影响 | 广告仍被过滤（L1 与过滤互不干扰） |
| 8 | **橙红全退成哑色**（2026-10-13 新增，10-14 改口径） | 顶栏最顶上那条 2px 橙线、主按钮、热搜条目、"关注"按钮、点赞过的红心 —— 应变成**暖灰橙 / 砖红**（不是刺眼的原橙，也不是纯灰） |
| 9 | **深浅主题都对**（2026-10-13 新增） | ⚠️ 你的微博是**深色主题**。重点看：正文**看得见**（不能变成深灰压深灰）、卡片下方是一条**暗灰线**而不是白线。若换到浅色主题（微博设置里切）也应同样成立 —— 这是本轮修掉的那个 bug（§12-B9） |
| 10 | **时间已是绝对短格式**（2026-10-14 新增） | 卡片头部的时间应显示成 `10-13 08:13` 这种绝对时间，而不是「3小时前 / 昨天 09:40」；**头部不该被挤换行**（宽度对齐微博自身格式）；旧帖（本就是 `10-8   22:51`）不变形 |
| 11 | **时间改写可逆**（2026-10-14 新增） | 控制台跑 `__spb.off()` → 时间应立即回到「3小时前」（`data-spb-t` 里存着原文）；`__spb.on()` 再打开又会变回来 |
| 12 | **反复滚动不串号**（2026-10-14 新增） | 上下滚十几屏后，时间列不许出现「空白 / 两个时间 / 半截文本」—— 槽位复用后时间应始终更新成新卡自己的 |
| 13 | **视频封面也淡了**（2026-10-14 新增） | 未播放的视频卡：封面应和图片一样是**淡彩**（不再是一整块鲜艳画面）—— 视频走 video.js（`.vjs-poster img`），不归 `woo-picture` 那条规则管 |
| 14 | **点开播放恢复全彩、暂停又淡回去**（2026-10-14 新增） | 点播放：画面/封面恢复正常（规则靠 `.vjs-paused` 限定，播放时自动失效）；暂停后停在的那一帧重新变淡；**全屏播放时不淡** |
| 15 | **小窗播放器不受影响**（2026-10-14 新增） | 把视频弹成**小窗播放**（卡片外的 `div.mini-player`）：它不该被淡化 —— 我们的视频规则只作用于信息流卡内 |
| 16 | **归因条保留了、只是变中性了**（2026-10-14 新增） | 卡片**最顶部**那行「xx 赞过 / xx 关注了」：文字应变成**中性灰**（不再是蓝链、无下划线），**信息一字不少**；行尾的「更多」V 箭头**不见了**。✅ **2026-10-14 17:10 A/B 结案**：该行高度 **34.5 是自然值**（箭头 `visibility:hidden` / `visibility:visible` / `display:none` **三态同值** ⇒ 箭头对高度零影响）；卡片之间无洞 ✅ |
| 17 | **B 类空位有占位提示**（2026-10-15 新增，§12-B14） | 被过滤的卡留下的空白**中央**应有一行淡灰小字「**已过滤**」；空位高度与原卡一致（上下卡位置不动、无洞无错位）；点空位**不应**有任何反应（`pointer-events:none`）；`__spb.off()` 后占位与隐藏**一并消失** |
| 18 | **A1：互动按钮行 → 空位摘要条（两条，同一设计语言）**（2026-10-15 新增，§12-B15；✅ **已验收通过**） | ① 卡自身与**转发块**的按钮行都**不可见但占位**（约 40px 空位），各自的摘要条落在空位内、**不遮挡视频/图片**；② 摘要条「N 转发 · N 评论 · N 赞」进**本卡**详情；转发块摘要条带「**原微博**」前缀（有时间锚时带原文时间），进**原微博**详情；③ 两条都可点（刻意点击，无 hover）；④ 上下反复滚动多屏：无洞、无错位；⑤ 槽位复用后两条摘要条都跟着新卡走；⑥ `__spb.off()` 后按钮行与摘要条一并恢复；⑦ 卡内有无绝对定位元素错位（article / .retweet 变 relative 的副作用排查） |
| 19 | **媒体缩略化（竖图压到 140px）**（2026-10-15 新增，§12-B16 —— **改高度项，重点验洞**） | ① **竖图**卡明显变矮（224→140，图片为裁切后的横条，cover 不变形、主体仍可辨）；② **横图 / 九宫格尺寸不变**（126 / 132.6 低于阈值，天然免疫）；③ 上下反复滚动多屏：**无洞、无错位、无累积漂移**（首帧缓存应已把缩高算进去 —— §12-B12 的真机复验）；④ 点图仍进**原生大图查看器**；⑤ 视频卡不受影响（封面仍约 305px、可正常播放）；⑥ `__spb.off()` 后媒体恢复原高 |

> ✅ **2026-10-14 09:09 用户「验收通过」**：第 10~15 项（时间改写 + 视频降饱和）全部通过。
> ⏳ **第 16 项（社交归因条）待验收**（2026-10-14 落地，§12-B13 ⑧）。它的特殊之处：**不是隐藏项，是保留项** ——
> 用户明确要求留着，因为它是「这条我没关注的人发的微博为什么出现在这里」的**来源归因**。
> ✅ **2026-10-15 用户「验收通过」：第 17 项（空位占位）** —— 占位可见 / 高度不变 / 可逆，§12-B14 结案。
> ✅ **2026-10-15 用户「验收通过」：第 18 项（A1 空位摘要条）** —— 用户三轮拍板（拒 hover / 拒遮挡 /
> 统一设计语言为 L2 日志形态铺路），§12-B15 结案。**A1 退出改高度批次**（零高度影响），
> 改高度批次顺延给媒体缩略化 / 字号行距。
> ⏳ **第 19 项（媒体缩略化 140px）待验收**（2026-10-15 落地，§12-B16）—— 改高度批次接力第一枪，
> probeMedia() 读数定稿手法（容器 max-height 数值法 + img height:100%）；**视频不动**（二期单独评估）。
> 🔓 **再下一步**：字号行距（改高度批次收尾）→ L2 日志形态重排（需先讨论设计）→ M3 面板（关键词配置 UI）。
> 开工前提已由 §12-B12 实测打开 —— 每条落地后都要真机复验「**不留洞**」（滚动 + 反复上下 + `__spb.off()` 恢复）。
> `git push` 由用户手动执行（本机凭据助手非交互）。
