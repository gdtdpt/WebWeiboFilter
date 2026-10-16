# SpecBase Helper

微博网页版（weibo.com）的**信息流过滤 + 低调模式**用户脚本（Tampermonkey）。

- **过滤**：信息流广告卡自动隐藏（埋点 / 文本 / 图片徽标三路识别，权重判定），关键词规则支持隐藏或高亮
- **低调模式**：三档外观（L0/L1/L2）——标签页伪装、去橙红降彩度、版面重排与品牌信息弱化，把页面收拾成适合「摸鱼状态下路过同事屏幕」的样子
- **纯本地**：不上报任何数据；配置只存在 Tampermonkey 本地存储

> 个人自用工具，非官方；微博改版可能导致部分功能失效（会在真机复验后跟进修复）。

## 功能一览

| 能力 | 说明 |
|---|---|
| 广告过滤 | 权重累加判定（≥3 判广告）：推广埋点、营销文案、图片烤印「广告」徽标、流外 banner；识别为广告的卡压缩成一行细条，列表自动补位 |
| 关键词过滤 | 按正文 / 转发文本 / 话题 / 作者匹配，命中可隐藏或高亮 |
| L0 标签页伪装 | 标签页标题与 favicon 换成中性内容，SPA 切页持续校正 |
| L1 素净 | 全局去橙红（映射为同色相哑色，不灭色相）、媒体降饱和、图片/视频缩略化、正文字号行距收紧 |
| L2 工作台重排 | 蕴含 L1；三列重排（主列第一）、右栏收起、头像水印、顶栏降显著、品牌文案换中性（logo → SpecBase 文字标）、写死鲜色运行时灰度 |
| 「+N」全图展示 | 九宫格截断（如「+17」）的卡片自动取详情接口，把全部图片以等高网格展开，卡片高度不变 |

## 安装

产物不在仓库中（`dist/` 不入库），需要自行构建一次：

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 克隆本仓库，构建单文件脚本（需要 Node.js ≥ 22）：

   ```powershell
   npm install
   npm run build
   ```

3. 打开 Tampermonkey 管理面板 → 「实用工具」→ 导入文件 `dist/specbase-helper.user.js`（或新建脚本粘贴全文）
4. 打开 weibo.com 即生效

开发者向的构建细节、仓库结构、探针工具见 [docs/dev-guide.md](docs/dev-guide.md)；完整需求与实测档案见 [PROJECT.md](PROJECT.md)。

## 低调模式三档

| 档位 | 内容 | 默认 |
|---|---|---|
| **L0** | 标签页伪装（标题 / favicon） | 开 |
| **L1** | 去橙红 / 降彩度 / 媒体缩略化 / 字号行距 | 关 |
| **L2** | 蕴含 L1；版面重排 / 头像水印 / 顶栏降显著 / 品牌文案换中性 | 关 |

切换方法（浏览器控制台）：

```js
__spb.appearance({ l2: true })   // 开 L2（蕴含 L1）
__spb.appearance({ l1: true })   // 只开 L1
__spb.appearance({ l1: false, l2: false })   // 全关，只留 L0 与过滤
```

⚠️ **切换档位后必须刷新页面**——虚拟列表的布局按首帧样式测量，运行中热切会错位。

## 常用控制台命令

脚本在页面暴露一个调试把手 `__spb`：

| 命令 | 作用 |
|---|---|
| `__spb.off()` | 关闭过滤并撤掉全部注入（还原所有被改写的 DOM），用于验证可逆性 |
| `__spb.on()` | 重新开启 |
| `__spb.stats()` | 当前计数（隐藏数 / 改写数 / 灰度数等） |
| `__spb.rescan()` | 立即重扫一遍 |
| `__spb.inspect($0)` | 现场判定一张卡：在 Elements 面板选中卡内元素后执行，回答「这张卡为什么没被处理」 |
| `__spb.css()` | 查看当前实际注入的完整样式 |

## 配置把手

配置存在 Tampermonkey 存储，图形面板尚在开发中；当前通过控制台 `__spb.appearance({ ... })` 修改（**改完刷新**）。常用项：

| 把手 | 默认 | 说明 |
|---|---|---|
| `mediaMaxH` | 90 | 图片缩略化高度上限（px），宽默认跟随成正方格 |
| `mediaMaxWGrid` | 76 | 多图网格专属宽度（px）；单图行不变窄 |
| `videoMaxH` | null | 视频缩略化高度（null = 跟随图片）；只作用未播放态 |
| `morePics` | true | 「+N」截断格全量展示 |
| `textFontSize` / `textLineHeight` | null | 正文字号 / 行距（null = 跟随档位） |
| `avatarVariant` | 'beta' | 头像形态：beta = 图片作整行背景水印渐隐 |
| `avatarBgSize` / `avatarBgOpacity` | 120 / 0.2 | 水印边长 / 不透明度 |
| `layoutMarginLeft` / `layoutGap` | 12 / 12 | 版面呼吸：左缘留白 / 列间距 |
| `brandNeutral` | true | L2：品牌文案换中性 + logo 换 SpecBase 文字标 |
| `topbarQuiet` | true | L2：顶栏头像 / 彩色图标灰度，分类条整行收掉 |
| `vividQuiet` | true | 写死鲜色（非 CSS 变量）的运行时灰度网，全站生效 |

完整默认值见 [`src/config.js`](src/config.js)。

### 关键词规则

`filter.keywords` 为规则数组，示例：

```json
[
  { "content": "抽奖", "action": "hide" },
  { "content": "某话题", "action": "highlight", "fields": ["topics"] }
]
```

- `action`：`hide`（隐藏）/ `highlight`（高亮）
- `fields`：匹配范围，可选 `text`（正文）/ `repostText`（转发文本）/ `topics`（话题）/ `author`（作者），缺省为全部
- 图形化配置在路线图中；当前版本修改规则需编辑源码默认值后重新构建

## 常见问题

- **改了配置没生效？** 档位与外观把手全部要求**刷新页面**后生效。
- **`__spb is not defined`？** 过滤功能不受影响；这是脚本沙箱与页面 window 的隔离问题，刷新一次即可。
- **图片出现黑块 / 列表出现空洞？** 先刷新；仍复现请到 [Issues](../../issues) 反馈，附 `__spb.stats()` 输出。
- **隐私**：脚本不向任何第三方上报数据；唯一的额外请求是「+N」全图展示调用微博自己的详情接口（同源 `/ajax/statuses/show`）。
