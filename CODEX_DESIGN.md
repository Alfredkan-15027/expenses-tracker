# CODEX_DESIGN.md — Expenses Tracker 观感设计任务书

> 这份文件是给 **ChatGPT Codex** 的设计交接文档。
> 功能、资料、逻辑都已经由 Claude 完成并测试；Codex 只负责**观感设计（Visual Design）**。
> 开始前请完整读完「一、权限边界」。

---

## 一、权限边界（最重要，不可越界）

### ✅ Codex 可以编辑

| 路径 | 内容 |
|---|---|
| `styles/tokens.css` | 设计 token：颜色、字体、圆角、间距、玻璃材质、动画曲线（浅色 + 深色） |
| `styles/base.css` | 全局排版、页面布局、标题、section |
| `styles/components.css` | 所有组件样式（Tab Bar、Sheet、按钮、列表、键盘、图表……） |
| `styles/screens.css` | 各页面专属布局（今天 / 记录 / 分析 / 设置 / 记一笔 / 引导页） |
| `assets/icons/sprite.svg` | 界面与类别图标（可以重画，**id 不可删改**） |
| `assets/icons/*.png` | App 图标（文件名、尺寸不可变：180、192、512、512 maskable） |
| `docs/codex-proposals.md` | 需要改到范围外的想法，写在这里（不要自己改） |

### ⛔ Codex 不可以编辑（只读）

`src/**`（全部 JavaScript）、`index.html`、`sw.js`、`manifest.webmanifest`、`tests/**`、`scripts/**`、
`.github/**`、`package.json`、`AGENTS.md`、`CODEX_DESIGN.md`、`README.md`、`PROGRESS.md`、`docs/`（`codex-proposals.md` 除外）。

也不可以：

- 新增、删除、改名任何文件（上表允许的文件只能修改内容）
- 改 CSS class 名称或图标 id（JavaScript 依赖它们，而你不能改 JavaScript）
- 引入外部资源：网络字体、CDN、远程图片、`@import`、`url(https://…)`
- 在 SVG 里放 `<script>`、`on*=` 事件、外部链接
- 削弱隐私样式：`.lock-screen` 必须**完全不透明**；`html.is-locked #app`、`html.is-concealed #app` 必须保持隐藏

### 🔒 自动把关

```bash
npm test                              # 23 个单元测试
npm run check:security                # 隐私 / 安全检查
node scripts/check-codex-scope.mjs    # 越界检查：改到范围外的文件会直接报错
```

三个都必须通过才算完成。GitHub 上分支名以 `codex` 开头的 Pull Request 会自动跑越界检查。

---

## 二、怎么预览

```bash
npm run dev
```

- 真实模式：<http://localhost:5173/>（第一次会出现引导页）
- **演示模式（推荐做设计时用）**：<http://localhost:5173/?demo=1>，会载入 6 个月的吉隆坡生活示例资料，以及「已经开始投资」的投资资料，不会写入资料库
- **演示模式 2**：<http://localhost:5173/?demo=2>，投资「准备阶段」（还没有持仓、显示开始条件卡片）
- 用浏览器开发者工具把视窗设成 **390 × 844**（iPhone 15/16）与 **375 × 667**（iPhone SE），并分别检查 **浅色 / 深色模式**
- 页面切换：`#/today`、`#/history`、`#/insights`、`#/invest`、`#/settings`
- 记一笔（支出 / 收入）：点底部中间的 ＋，或 `?demo=1&add=expense`、`?demo=1&add=income`

---

## 三、设计方向：「Tide 潮汐」（1.5 起）

1.5 把界面从头重做了一遍，不再沿用 1.x 的 iOS 分组列表。核心想法：**钱是液体**。

**每一页 = 场景 + 面板**

- **场景（`.scene`）**：页面最上面的一块，只讲这一页最重要的那一个数字，用一幅图来讲：
  - 今天：一片真的水（`src/ui/water.js` 画在 `<canvas class="water">` 上）。水位 = 今天的额度还剩多少；花了钱水位下降并晃动，手指碰水面会溅起水花；超出额度时只剩浅浅一层，颜色变成警告色。
  - 记录：这个月每天一根柱子（`.daybars`），点一根只看那一天。
  - 分析：结余大数字 + 收入／支出两根同比例的横条（`.flow`）。
  - 投资：一道 240° 的弧（`.goal-arc`），表示离目标多远，弧上的小刻度是时间过了多少。
- **面板（`.panel`）**：其余内容放在一张圆角的面板上，面板盖住场景的下缘；往上滑时面板盖过场景（场景是 `position: sticky`），场景里的内容同时下沉、变淡（`--scroll` 0 → 1，由 `main.js` 写在 `.screen` 上）。
- 「设置」没有场景，整页就是面板（`.panel--page`），从右上角的齿轮进入，左上角返回。

**四层材质，由后到前**

1. **画布**：底色 `--bg` + 这一页自己的光（`--scene-a`、`--scene-b`，强度 `--scene-mix`），画在 `body::before`。每页的颜色在 `screens.css` 最上面按 `html[data-screen]` 设定（今天蓝／青、记录紫、分析青绿、投资金），同时给出文字用的 `--scene-ink`。今天超出额度时光变暖，整期超支时变红。最上缘保持纯 `--bg`，和 `index.html` 的 `theme-color` 一致，状态栏下面没有接缝。
2. **面板**：`--panel`，上缘 `--panel-edge`。
3. **表面**：卡片、列表、tile —— `--surface` + `--surface-rim` + `--surface-shadow`；卡片里凹下去的控件（键盘键、输入框、分段控件的轨道）用 `--surface-2`。
4. **玻璃**：底部 dock、圆形按钮、切换器、Sheet、Alert、Toast —— 真的 `backdrop-filter` 模糊，token 是 `--glass-*`。Sheet 里面把 `--surface` 换成 `--sheet-surface`、`--surface-2` 换成 `--sheet-well`。

**几条贯穿全局的决定**

- **主按钮是墨色，不是彩色**：`.btn--primary`、选中的分段、选中的 chip、dock 上选中的那一页都用 `--ink`（浅色模式近黑、深色模式近白）配 `--on-ink`。颜色留给数据。
- **数字用圆体**：金额、标题用 `--font-round`（iPhone 上是 SF Pro Rounded）。
- **类别图标是「同色淡底 + 同色图形」的圆**（`--cat-wash`、`--cat-ink`），不是实色方块，长列表更安静。
- **Dock**：一条玻璃胶囊，四个页面 + 中间的「＋」，**只有图标，没有文字**（名称留在 `aria-label`）。选中页是一颗墨色的圆（`.dock__lens::after`，位置由 `main.js` 写在镜片自己身上的 `--lens-x`／`--lens-w`；拖动时每一帧由 JS 移动，所以 `.is-dragging` 下不要给它的 `transform` 加 transition，镜片要保持 `will-change: transform`），图标反白；「＋」用这一页的场景色（`--scene-a`／`--scene-b`）。手指按住 dock 横向滑动时（`.is-dragging`）镜片变大并跟着手指，手指下的那一项抬起（`.is-under`），松手就切到那一页。
- **为什么不直接用 liquid-glass-react／liquid-glass-js**：它们靠 SVG 位移滤镜或 WebGL + html2canvas 做折射，iPhone 的 Safari 不支持前者，后者要从 CDN 载入脚本（本 App 的 CSP 禁止外部资源）。所以这里取它们的想法（会跟手的弹性镜片、高光）用纯 CSS 变量实现；中间凸起的「＋」这个布局来自 CYLTabBarController。

**干净（1.5 第二轮起的硬规矩）**

使用者要的是「第一眼就看完」。所以：

- **按钮旁边不放说明小字**。能用图标说清楚的只放图标（dock、日期、备注、搜索、选日期）；文字只留给不说就会误会的开关（例如「创业」）。提示只在出错时出现（`.entry__hint` 平时是空的、不占位置）。
- **首页只有四样**：今天还能花（水）、手上的钱、常用（最近 30 天买得最多的 4 样，会跟着变）、最近 24 小时的记录 +「全部记录」。本期预算、预计结余这些分析放在「分析」页。
- **列表一次只给一页**：记录页是一张平的列表，每行「名称 ／ 类别 · 日期 时间 ／ 金额」，先 12 笔，底下「查看更多」（`.more`）；筛选、选某一天（`.tool` 里的日历）和搜索都收在一排小按钮里，搜索框点了才出现。
- **选项多就先给常用的**：记一笔只摆最常用的 4 个类别 +「更多」；分析页的类别只列前 5 个 +「查看全部」，每一行的参考范围、评级说明点开才看得到（`.cat__detail`）。
- 细则、解释一律收进 ⓘ。新增任何东西之前先问：不看它，这一页还成立吗？成立就不要默认显示。

---

## 四、页面结构与 class 清单（样式契约）

### 全局骨架（`src/main.js`、`base.css`）

| class | 说明 |
|---|---|
| `.app` | 根容器。`<html data-screen="today｜history｜insights｜invest｜settings">` 由 `main.js` 写入 |
| `.navbar` / `.navbar__inner` / `.navbar__title` / `.navbar__leading` / `.navbar__trailing` | 顶部栏（右边是齿轮和页面自己的按钮，设置页左边是返回）。面板滑到它下面时：`.is-scrolled`（出现柔和的模糊边缘）、`.show-title`（显示页面名） |
| `.screen` | 当前页面。切换时加 `.is-entering`，方向在 `data-dir="forward｜back｜none"`；`--scroll` 是场景被盖住的程度 |
| `.scene`（`--today｜--history｜--insights｜--invest`）、`.scene__content`、`.scene__top`（小字 `.eyebrow` + `.large-title`，和顶部栏同一行） | 场景 |
| `.scene__label`、`.scene__figure`（`.is-negative`、`.is-income`）、`.scene__sub` | 场景里的标签、大数字、副文字 |
| `.panel`、`.panel--page` | 面板；没有场景的页面用 `--page` |
| `.dock`、`.dock__bar`（`.has-lens`、`.is-dragging`）、`.dock__lens`、`.dock__item`（`.is-active`、`.is-under`）、`.dock__icon`、`.dock__add` | 底部 dock（只有图标）。**每一项不得小于 44px 宽** |
| `.demo-flag` | 演示模式标记 |
| `.section` / `.section__header` / `.section__title` / `.section__hint` / `.section__meta` / `.section__footer` | 面板里的分组标题与说明 |
| `.switcher`、`.switcher__btn`、`.switcher__label` | ‹ 2026年11月 › 月份／周期切换器（一条玻璃胶囊） |

### 通用组件（`components.css`）

| 组件 | class |
|---|---|
| 玻璃材质 | `.glass`（以及 dock、`.btn--glass`、toast、`.switcher` 共用同一套 token） |
| 按钮 | `.btn` + `.btn--primary`（墨色）/ `.btn--glass` / `.btn--plain` / `.btn--danger` / `.btn--small` / `.btn--large` / `.btn--block` / `.btn--icon`；文字链接 `.link` |
| 卡片 | `.card`、`.card--flush`、`.card__pad`、`.card__eyebrow`、`.card__title`、`.card__footnote`、`.card--setup`（`__title`、`__cta`） |
| Tile | `.tile`（一格一个数字）、`.tile__label`、`.tile__value`（`--text`、`.is-negative`）、`.tile__sub`、`.tile--wide`、`.tile__icon`（`--ink`）、`.tile__body`、`.tile__aside`、`.tile__chevron`、`.tile__mark`、`.tile__meter`；容器 `.tiles`（`--set`） |
| 列表 | `.list`、`.list--plain`、`.list--choices`；行 `.row`、`.row__main`、`.row__body`、`.row__title`、`.row__subtitle`、`.row__value`（`.is-income`）、`.row__detail`、`.row__chevron`、`.row__check`、`.row__glyph`、`.row__glyph-tile[data-color]`、`.row__trail`、`.row__reorder`、`.row--danger`、`.row--static`、`.row--toggle`、`.row--choice.is-selected`、`.row--tx`、`.row.is-paused` |
| 左滑删除 | `.swipe` > `.swipe__action` + `.swipe__content`；状态 `.is-swiping`、`.is-open`、`.is-animating` |
| 标签 | `.tag`、`.tag--business`（创业）、`.tag--fixed`（固定） |
| 金额 | `.money` > `.money__sign`、`.money__cur`、`.money__int`、`.money__dec`；大号 `.money--hero` |
| 类别图标 | `.cat-icon[data-color]`（尺寸 `.cat-icon--xs` / `.cat-icon--lg`，用 `--size` 控制） |
| 类别格 | `.cat-grid`（`.is-all` = 已展开全部）/ `.cat-grid--compact` / `.cat-grid__item`（`.is-selected`）/ `.cat-grid__label` / `.cat-grid__more` + `.cat-icon--more`（「更多 / 收起」那一格） |
| Chips | `.chips`、`.chips--scroll`、`.chip`、`.chip--toggle.is-on`、`.chip--select.is-on`、`.chip--field`、`.chip--date`（`.is-on` = 不是今天）、`.chip--icon`（只有图标的圆 chip）、`.chip__input`、`.chip__overlay`、`.chip__value` |
| 分段控件 | `.segmented`、`.segmented--small`、`.segmented--wrap`、`.segmented__item.is-active`（墨色） |
| 表单 | `.form`、`.form__error`、`.field`、`.field__label`、`.field__hint`、`.field__control`、`.field__prefix`、`.field__input`、`.field__input--text`、`.field--money`、`.field--inline`、`.field__select` |
| 开关 | `.switch`（`<input type=checkbox switch>`） |
| 搜索 | `.search`、`.search__input` |
| 徽章 | `.badge[data-tone=good｜warn｜bad｜info｜muted]`（永远是图标 + 文字，不能只靠颜色） |
| 横幅 / 提示 | `.banner`（`--warn`）、`.banner__icon`、`.banner__text`、`.banner__chevron`；`.callout`、`.callout--good`、`.callout--bad` |
| 空状态 | `.empty-state`、`.empty-state__icon`、`.empty-state--error`、`.empty-state--quiet`（面板里的小号空状态）、`.empty-state__detail` |
| 查看更多 / 小工具按钮 | `.more`（`.more--inset`；里面的 `<span>` 是「还有 N 笔」）；`.tool`（44px 圆按钮，`.is-on`；选日期那颗里面盖着透明的 `<input type=date class=chip__overlay>`） |
| Sheet | `.sheet-layer`（`.is-open`、`.is-behind`，变体 `--entry`、`--onboarding`）、`.sheet-backdrop`、`.sheet`（`--large`、`--medium`、`--auto`、`--full`，拖动中 `.is-dragging`）、`.sheet__grab`、`.sheet__grabber`、`.sheet__header`、`.sheet__close`、`.sheet__title`、`.sheet__center`、`.sheet__actions`、`.sheet__body` |
| Alert | `.alert-layer.is-open`、`.alert-backdrop`、`.alert`、`.alert__text`、`.alert__title`、`.alert__message`、`.alert__buttons`（`.is-stacked`）、`.alert__btn--default｜cancel｜destructive` |
| Toast | `.toast`（`.is-visible`、`[data-tone=success｜error]`）、`.toast__icon`、`.toast__text`、`.toast__action` |
| 数字键盘 | `.keypad`、`.keypad--pin`、`.keypad__key`、`.keypad__key--fn`、`.keypad__key--faceid`、`.keypad__spacer` |
| 金额显示 | `.amount-display`（`.is-empty`、`.is-shaking`、`[data-kind=expense｜income]`）、`.amount-display__cur`、`.amount-display__value`（后面闪烁的光标是它的 `::after`） |
| 进度条 | `.progress`（`--spend`、`--warn`、`--bad`、`--save`、`--group-need｜want｜growth｜business｜other`，`.is-over`）、`.progress__fill`、`.progress__marker`。颜色只设 `--bar` |
| 每日柱（skyline） | `.daybars`、`.daybars__col`（`.is-past｜is-today｜is-future`、`.is-over`、`.is-empty`、`.is-selected`；记录页是 `<button data-day>`）、`> i` 是柱子（高度 `--h`，次序 `--i`）、`.daybars__limit`（每日额度线） |
| 环形图 | `.donut`、`.donut__svg`、`.donut__track`、`.donut__seg[data-color]`、`.donut__center`、`.donut__label`、`.donut__value` |
| 占比条 | `.stackbar`、`.stackbar__seg[data-color]`、`.legend`、`.legend__item`、`.legend__swatch`、`.legend__value` |
| 仪表盘（生活费对照） | `.dial`、`.dial__svg`、`.dial__zone[data-tone=lean｜ok｜high｜over]`、`.dial__tick`、`.dial__needle`（角度 `--to`）、`.dial__hub`、`.dial__legend` |
| 目标弧 | `.goal-arc`、`.goal-arc__svg`、`.goal-arc__track`、`.goal-arc__value`（`.is-zero`）、`.goal-arc__stop` / `--end`（渐层色标）、`.goal-arc__marker`、`.goal-arc__center` |
| 6 期趋势 | `.trend`、`.trend__readout`、`.trend__caption`、`.trend__value`、`.trend__sub`、`.trend__plot`、`.trend__grid`、`.trend__gridline`（`--base`）、`.trend__budget`、`.trend__cols`、`.trend__col.is-selected`、`.trend__bar`（`.is-over`、`.is-partial`）、`.trend__axis` |
| 与上期比较 | `.diverge`、`.diverge__row`、`.diverge__label`、`.diverge__track`、`.diverge__axis`、`.diverge__bar.is-up｜is-down`、`.diverge__value` |
| 投资预测图 | `.projection`、`.projection__svg`、`.projection__grid`、`.projection__target`、`.projection__band`、`.projection__stop`（`--end`）、`.projection__edge`（`--high`、`--low`）、`.projection__end`、`.projection__actual`、`.projection__dot`、`.projection__today`、`.projection__xlabel`、`.projection__ylabel`、`.legend--projection`、`.legend__swatch--band｜actual｜target`、`.milestones` |
| 说明页 | `.prose`、`.steps`、`.steps__item`、`.steps__num`、`.steps__text`、`.steps__icon`、`.tips`、`.sources`、`.stack` |
| 密码 | `.pin`、`.pin__icon`、`.pin__title`、`.pin__subtitle`、`.pin__dots`（`[data-length=4｜6]`、`.is-shaking`）、`.pin__dot.is-filled`、`.lock-screen`（`.is-leaving`）、`.lock-screen__forgot` |

### 页面专属（`screens.css`）

| 页面 | class |
|---|---|
| 今天 · 场景 | `.scene--today[data-tone=good｜warn｜bad｜calm]`、`.water`（canvas；颜色读 `--water-top｜bottom｜back｜line｜glint`）、`.allowance[data-tone]`、`.allowance__label`、`.allowance__amount`、`.allowance__sub`、`.allowance--setup`、`.allowance__setup` |
| 今天 · 面板 | `.hero-notes`（警告 + ⓘ 的说明）；手上的钱 `.cash-tile[data-tone=warn]`、`.cash-tile__icon`、`__body`、`__label`、`__sub`（只在有保留存款或太久没对账时出现）、`__value`、`__cta`；常用 `.picks`（四格）、`.pick`、`.pick__name`、`.pick__amount`；最近 24 小时用通用的 `.list` + `.row--tx`、`.more` |
| 分析 · 本期卡片（`src/ui/screens/period.js`） | `.period`、`.period__head`、`.period__title`、`.period__range`、`.period__left`、`.period__spend[data-tone=spend｜over]`、`.period__saving`、`.period__figure`、`.period__label`、`.period__value`（`.is-negative`）、`.period__sub`、`.period__foot`、`.period__days`、`.period__axis`、`.period__now` |
| 对账 | `.cash-form`、`.cash-recorded`、`.cash-recorded__value`、`.cash-breakdown`（`.is-income`）、`.cash-split`、`.cash-diff[data-tone=good｜warn｜info｜bad]`、`.cash-choice`、`.cash-choice__row`、`.cash-choice__sub` |
| 记录 | `.scene--history`、`.month`、`.month__figure`、`.month__days`、`.month__axis`；面板：`.toolbar`（分段控件 + 两颗 `.tool`）、`.search`（点了搜索才出现）、`.day-chip`（选中某一天时，点它取消）、一张 `.list`、`.more` |
| 分析 · 场景 | `.scene--insights`、`.flow[data-tone=good｜bad]`、`.flow__bars`、`.flow__row`（`--in`、`--out`）、`.flow__label`、`.flow__track`、`.flow__value` |
| 分析 · 面板 | `.tiles`、`.tile--rate[data-tone]`、`.tile--top`；重点 `.insights`、`.insight[data-tone]`、`.insight__head`、`.insight__icon`、`.insight__title`、`.insight__figure`、`.insight__chevron`、`.insight__body`；钱去哪了 `.where`、`.where__top`、`.groups-box`、`.groups__title`、`.groups`、`.groups__row[data-group]`、`.groups__label`、`.groups__value`、`.cat`（`.is-extra` = 前 5 名以外，默认隐藏）、`.cat__detail`（点开才有的参考范围）、`.row--cat`、`.row__share`、`.row__sharebar`；对照 `.bench[data-tier]`、`.bench__head`、`.bench__profile`、`.bench__amount`；Runway `.runway[data-tone]`、`.runway__main`、`.runway__value`、`.runway__unit`、`.runway__cells`、`.runway__cell`（一格 = 一个月）、`.runway__scale`、`.runway__text`、`.goal`、`.goal__head`；`.stat-grid`、`.stat`、`.stat__label`、`.stat__value`（`.is-income`、`.is-negative`）、`.stat__note`、`.insight-line[data-tone]` |
| 记一笔 | `.entry[data-kind=expense｜income][data-ready=true｜false]`（还没输入金额时类别格变淡）、`.entry__type`、`.entry__hint`（只在缺东西时有字）、`.entry__meta`（日期、备注、创业三颗小按钮）、`.entry__note`（点了备注才出现的输入框）、`.entry__delete`、`.entry__save`。支出：点类别即保存；收入：选类型后按「保存收入」 |
| 投资 | `.scene--invest[data-status=preparing｜ahead｜tight｜behind｜done｜missed]`、`.goal-foot`；面板：`.trigger[data-reached]`、`.trigger__head`、`.trigger__title`、`.plan`、`.plan__lead`、`.rate-table`、`.rate-table__cell`（`.is-mid` = 建议值）、`.rate-table__rate`、`.rate-table__amount`、`.plan__facts`、`.holdings`、`.row--holding`、`.delta.is-up｜is-down`、`.disclaimer` |
| 投资表单 | `.invest-form`、`.plan-editor`、`.holding-detail`、`.holding-detail__head`、`.holding-detail__kind`、`.action-row`、`.choice-cards--wrap`、`.list--values`、`.value-input`、`.row--history`、`.row__delete` |
| 设置 | `.page-head`、`.plan-card`、`.plan-card__head`、`.plan-card__label`、`.plan-card__value`、`.plan-card__sum`、`.plan-card__part`、`.plan-card__op`、`.plan-card__rows`、`.tiles--set`、`.tile--set` |
| 资料检查 | `.health`、`.health-item[data-level=warn｜info]`、`.health-item__head`、`.health-item__icon`、`.health-item__title`、`.health-item__body`、`.health-item__rows` |
| 恢复密钥（Google Drive 加密） | `.recovery`、`.recovery__form`、`.recovery__intro`、`.recovery__icon`、`.recovery-key`（7 组 × 4 字，等宽字体，必须清楚易抄）、`.recovery__input`、`.recovery__error` |
| 设定表单 | `.plan-preview[data-tone]`、`.cat-editor`、`.cat-editor__preview`、`.rec-editor`、`.cat-manager`、`.rec-manager`、`.row--manage`、`.swatches`、`.swatch.is-selected`、`.icon-grid`、`.icon-grid__item.is-selected` |
| 引导页 | `.onboarding`、`.onboarding__content`、`.onboarding__hero`、`.onboarding__appicon`、`.onboarding__title`、`.onboarding__lead`、`.onboarding__head`、`.onboarding__footer`、`.onboarding__dots`、`.features`、`.features__icon[data-color]`、`.choice-cards`、`.choice-card.is-selected` |

### 动画（`components.css` 末尾的 Motion 区块；数值的变化由 `src/ui/motion.js` 负责）

画面每次都整页重画，所以「从旧值变到新值」的动画由 `motion.js` 负责，CSS 只定义样子。下面这些 class / 变量名不能改：

- **数字滚动**：带 `data-motion="count"` 和 `data-value`（分）的数字，从旧值滚到新值；刚打开页面时从 0 滚上来。这是 JS 直接改文字，CSS 不用管。
- `.m-digit`、`.is-popping`（金额变了，数字逐个弹出；`--i` 是第几个字，`--elapsed` 是重画前已经播了多久）、`.m-digit--typed`（键盘刚输入的那一位）
- `.screen.is-fresh`（刚打开的页面，约 1.4 秒后移除）：面板里的卡片依次浮起；进度条、每日柱、趋势柱、Runway 格子长出来（`--i` 错开）；环形图顺时针擦出来（`--wipe`）；仪表盘指针从左边甩上来（`--to`）；目标弧画出来（`--c`）
- `.screen.is-entering[data-dir]`：换页时新页面从它在 dock 上所在的那一侧滑进来
- `.swipe.is-new`（刚加的一行）、`.swipe.is-removing`（正在删除的一行，高度收起）
- 水面（`water.js`）自己用 `requestAnimationFrame` 画：页面不可见、被面板盖住、或开了「减少动态效果」时不跑
- 动画用的 token：`--ease-spring`、`--ease-out`、`--ease-pop`、`--dur`、`--dur-pop`、`--dur-enter`、`--dur-sheet`、`--stagger`
- 「减少动态效果」打开时全部不播（`base.css` 的 reduced-motion 规则 + `motion.js`、`water.js` 自己也会检查）

### 一行里的几个数字（`base.css` 的 `.fact`，由 `html.js` 的 `facts()` 加上）

「能用 RM 1,997 · 今天对账」这类用「·」隔开的小字，每一段包在 `.fact` 里（`white-space: nowrap`），所以只会在两段之间换行，不会把「对账」拆开，也不会让「·」出现在行首。`.section__header` 里的标题不换行（连同 ⓘ），旁边的数字在段与段之间换行、靠右。

### 说明 ⓘ（`components.css` 的「说明」区块，由 `src/ui/info.js` 加上）

小字说明默认收起，点标题旁的 ⓘ（「重点」里点整行）才展开，App 重开后又全部收起。下面这些 class 不能改：

- `.info-btn`（ⓘ 按钮，`[aria-expanded="true"]` 时是打开状态）
- `.info-panel`（`[data-open]` 时展开；收起时有 `inert`）、`.info-panel__inner`（裁切）、`.info-panel__box`（里面的底色方块）、`.info-panel--center`
- `.info-list`（说明里「图标 + 一行字」的列表）
- 展开动画：高度用 grid rows 0fr → 1fr，文字淡入、由模糊变清楚；「减少动态效果」时直接显示

### data 属性

- `data-color`：13 个类别色 `red orange yellow green mint teal cyan blue indigo purple pink brown gray` → 在 `tokens.css` 映射成 `--cat`
- `data-tone`：`good`、`warn`、`bad`、`info`、`muted`（状态）；hero 另有同名 tone
- `data-tier`：`lean`、`ok`、`high`、`over`（生活费对照）

### 图标 id（`sprite.svg`，全部必须保留）

类别：`i-food i-coffee i-groceries i-transport i-car i-housing i-utilities i-phone i-health i-family i-gift i-shopping i-social i-subscriptions i-learning i-business i-travel i-pet i-sport i-beauty i-game i-other i-salary i-bizincome i-freelance i-otherincome`

界面：`i-today i-list i-chart i-invest i-settings i-plus i-close i-chevron-left i-chevron-right i-chevron-down i-search i-trash i-calendar i-note i-check i-lock i-faceid i-key i-cloud i-share i-download i-upload i-bell i-info i-warning i-sparkles i-trendUp i-trendDown i-target i-savings i-wallet i-backspace i-add-home i-shield i-arrow-up i-arrow-down i-help i-clock i-sun`

图标为 24×24 网格、`currentColor` 描边；类别图标显示在同色的淡底圆上，图形是类别色本身。

---

## 五、必须遵守的可用性与无障碍要求

- 文字对比度 ≥ 4.5:1（大字 ≥ 3:1），浅色和深色模式都要检查
- 可点区域 ≥ 44×44px；键盘按键不小于现在的尺寸
- 输入框字体 ≥ 16px（否则 iOS 会自动放大画面）
- 保留 `:focus-visible` 焦点样式
- 保留 `prefers-reduced-motion`、`prefers-reduced-transparency`、`prefers-contrast: more` 的处理
- 保留 safe area（`env(safe-area-inset-*)`），Dock 与 Sheet 不可被刘海或 Home 指示条遮住
- 状态不可只用颜色表达（徽章都有图标 + 文字）
- `.haptic-proxy` 必须保持不可见（它是 iPhone 触感反馈用的隐藏开关）
- 金额与数字对齐的地方使用 `tabular-nums`；hero 大数字用比例数字

---

## 六、交付

1. 只改上面允许的文件
2. 三项检查全部通过
3. 在 PR / 回复里附上：改了什么、浅色与深色的截图（今天、记录、分析、设置、记一笔）
4. 需要改结构或逻辑的想法 → 写在 `docs/codex-proposals.md`
