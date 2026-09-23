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
- 记一笔（支出 / 收入）：点右下角 ＋，或 `?demo=1&add=expense`、`?demo=1&add=income`

---

## 三、设计方向：iOS 27 Liquid Glass

使用者明确要求**最新的 iOS 27 风格，不要旧版 iOS 的样子**。重点：

1. **Liquid Glass 材质（iOS 27 改良版）**：比 iOS 26 更不透明、更好读；边缘有一圈**较深的细描边**，上缘有**较亮的高光（specular highlight）**，靠描边分层而不是重阴影。token：`--glass-bg`、`--glass-edge`、`--glass-highlight`、`--glass-shadow`。
2. **悬浮胶囊 Tab Bar（5 个分页：今天 · 记录 · 分析 · 投资 · 设置）**：底部悬浮、与屏幕边缘留空；**选中项底色比玻璃更深**（iOS 27 改动，`--glass-selected`），不是 iOS 26 的白色亮块。右侧「＋」是独立的强调色圆形按钮（iOS 27 的 prominent tab）。在 375px 宽的 iPhone 上每个分页约 53px，**任何调整都不能让单个分页小于 44px**。
3. **滚动边缘效果**：页面在顶部时导航栏完全透明；内容滚到导航栏下方时，出现**实色模糊 + 底部细线**的「硬边」效果（iOS 27 默认 hard style），并淡入小标题。
4. **深色模式的玻璃比 iOS 26 明显更亮**（已在 token 调整）。
5. **大圆角与同心圆角**：卡片 26px、Sheet 38px、按钮全胶囊；内层圆角要与外层同心。
6. **Sheet**：悬浮在屏幕内缘（左右下各留 6px），顶部有 grabber，关闭按钮是明显的玻璃圆钮；叠加第二层时，下层会缩小后退。
7. **Alert**：大圆角玻璃卡片，按钮是并排的胶囊按钮（iOS 26/27 样式）。
8. **Switch**：iOS 26/27 的加宽胶囊开关（track 62×28，knob 为横向胶囊）。
9. **字体**：SF Pro（`-apple-system`）+ 中文 PingFang SC；大额数字用 **SF Pro Rounded**（`ui-rounded`）。字级遵循 iOS Dynamic Type 的默认值（Large Title 34 / Headline 17 / Body 17 / Footnote 13）。
10. **颜色**：使用 iOS 26/27 的系统色（已在 `tokens.css`：`--c-blue #0088FF` 等，深色模式另有一套）。状态色（good / warn / bad / info）只用于状态，不可拿来当类别色。

11. **投资页**：像 Apple「股市」+「健康」的混合——大数字市值、完成度进度条、8%/9%/10% 三格对照、预测带状图（`--proj-band` 区间、`--proj-actual` 实际线、`--proj-target` 目标线）。图表线条要细、网格要淡，数字用 tabular-nums，不要堆满标签。
12. **密码画面**：和 iPhone 解锁画面一样的 6 个圆点与圆形数字键，Face ID 键在左下角。**必须保持完全不透明**。

可以自由发挥的方向：玻璃的层次与高光质感、hero 卡的氛围色、卡片与列表的节奏、动效的弹性（spring）、图标的精致度、App 图标的 Liquid Glass 多层质感。

---

## 四、页面结构与 class 清单（样式契约）

### 全局骨架（`src/main.js`）

| class | 说明 |
|---|---|
| `.app` | 根容器 |
| `.navbar` / `.navbar__inner` / `.navbar__title` / `.navbar__leading` / `.navbar__trailing` | 顶部导航栏。状态：`.is-scrolled`（内容滚到下方）、`.show-title`（显示小标题） |
| `.screen` | 当前页面内容。切换时加 `.is-entering` |
| `.screen__header` / `.eyebrow` / `.large-title` | 大标题区 |
| `.tabbar` / `.tabbar__group` / `.tabbar__item` / `.tabbar__icon` / `.tabbar__label` | 悬浮 Tab Bar。选中：`.tabbar__item.is-active` |
| `.tabbar__add` | 「＋ 记一笔」按钮 |
| `.demo-flag` | 演示模式标记 |
| `.section` / `.section__header` / `.section__title` / `.section__hint` / `.section__meta` / `.section__footer` | 分组标题与说明 |

### 通用组件（`components.css`）

| 组件 | class |
|---|---|
| 玻璃材质 | `.glass`（以及 tabbar、`.btn--glass`、toast 等共用同一套 token） |
| 按钮 | `.btn` + `.btn--primary` / `.btn--glass` / `.btn--plain` / `.btn--danger` / `.btn--small` / `.btn--large` / `.btn--block` / `.btn--icon`；文字链接 `.link` |
| 卡片 | `.card`、`.card--flush`、`.card__pad`、`.card__eyebrow`、`.card__title`、`.card__footnote`、`.card--setup`（`__title`、`__cta`） |
| 列表 | `.list`（inset grouped）、`.list--plain`、`.list--choices`；行 `.row`、`.row__main`、`.row__body`、`.row__title`、`.row__subtitle`、`.row__value`（`.is-income`）、`.row__detail`、`.row__chevron`、`.row__check`、`.row__glyph`、`.row__glyph-tile[data-color]`、`.row__trail`、`.row__reorder`；变体 `.row--tx`、`.row--danger`、`.row--static`、`.row--toggle`、`.row--choice.is-selected`、`.row--manage`、`.row.is-paused` |
| 左滑删除 | `.swipe` > `.swipe__action` + `.swipe__content`；状态 `.is-swiping`、`.is-open`、`.is-animating` |
| 标签 | `.tag`、`.tag--business`（创业）、`.tag--fixed`（固定） |
| 金额 | `.money` > `.money__sign`、`.money__cur`、`.money__int`、`.money__dec`；大号 `.money--hero` |
| 类别图标 | `.cat-icon[data-color]`（尺寸 `.cat-icon--xs` / `.cat-icon--lg`，用 `--size` 控制） |
| 类别格 | `.cat-grid` / `.cat-grid--compact` / `.cat-grid__item`（`.is-selected`）/ `.cat-grid__label` |
| Chips | `.chips`、`.chips--scroll`、`.chip`、`.chip--pick`、`.chip--toggle.is-on`、`.chip--field`、`.chip--date`、`.chip__input`、`.chip__overlay`、`.chip__value` |
| 分段控件 | `.segmented`、`.segmented--small`、`.segmented--wrap`、`.segmented__item.is-active` |
| 表单 | `.form`、`.form__error`、`.field`、`.field__label`、`.field__hint`、`.field__control`、`.field__prefix`、`.field__input`、`.field__input--text`、`.field--money`、`.field--inline`、`.field__select` |
| 开关 | `.switch`（`<input type=checkbox switch>`） |
| 搜索 | `.search`、`.search__input` |
| 徽章 | `.badge[data-tone=good｜warn｜bad｜info｜muted]`（永远是图标 + 文字，不能只靠颜色） |
| 横幅 / 提示 | `.banner`（`--warn`）、`.banner__icon`、`.banner__text`、`.banner__chevron`；`.callout`、`.callout--good` |
| 空状态 | `.empty-state`、`.empty-state__icon`、`.empty-state--error`、`.empty-state__detail` |
| Sheet | `.sheet-layer`（`.is-open`、`.is-behind`，变体 `--entry`、`--onboarding`）、`.sheet-backdrop`、`.sheet`（`--large`、`--medium`、`--auto`、`--full`，拖动中 `.is-dragging`）、`.sheet__grab`、`.sheet__grabber`、`.sheet__header`、`.sheet__close`、`.sheet__title`、`.sheet__actions`、`.sheet__body` |
| Alert | `.alert-layer.is-open`、`.alert-backdrop`、`.alert`、`.alert__text`、`.alert__title`、`.alert__message`、`.alert__buttons`（`.is-stacked`）、`.alert__btn--default｜cancel｜destructive` |
| Toast | `.toast`（`.is-visible`、`[data-tone=success｜error]`）、`.toast__icon`、`.toast__text`、`.toast__action` |
| 数字键盘 | `.keypad`、`.keypad--pin`、`.keypad__key`、`.keypad__key--fn`、`.keypad__spacer` |
| 金额显示 | `.amount-display`（`.is-empty`、`.is-shaking`、`[data-kind=expense｜income]`）、`.amount-display__cur`、`.amount-display__value` |
| 圆环 | `.rings`、`.rings__svg`、`.ring`（`--spend`、`--over`、`--save`）、`.ring__track`、`.ring__value`（`.is-zero`）、`.rings__legend`、`.rings__item[data-tone]`、`.rings__label`、`.rings__value`、`.rings__sub` |
| 进度条 | `.progress`（`--spend`、`--warn`、`--bad`、`--save`、`--group-need｜want｜growth｜business｜other`，`.is-over`）、`.progress__fill`、`.progress__marker` |
| 占比条 | `.stackbar`、`.stackbar__seg[data-color]`、`.legend`、`.legend__item`、`.legend__swatch`、`.legend__value` |
| 生活费对照尺 | `.gauge`、`.gauge__track`、`.gauge__zone[data-tone=lean｜ok｜high｜over]`、`.gauge__marker`、`.gauge__pin`、`.gauge__ticks`、`.gauge__tick`、`.gauge__legend` |
| 6 个月趋势 | `.trend`、`.trend__readout`、`.trend__caption`、`.trend__value`、`.trend__sub`、`.trend__plot`、`.trend__grid`、`.trend__gridline`（`--base`）、`.trend__budget`、`.trend__cols`、`.trend__col.is-selected`、`.trend__bar.is-over`、`.trend__axis` |
| 与上月比较 | `.diverge`、`.diverge__row`、`.diverge__label`、`.diverge__track`、`.diverge__axis`、`.diverge__bar.is-up｜is-down`、`.diverge__value` |
| 说明页 | `.prose`、`.steps`、`.steps__item`、`.steps__num`、`.steps__text`、`.steps__icon`、`.tips`、`.sources`、`.stack` |
| 密码 | `.pin`、`.pin__icon`、`.pin__title`、`.pin__subtitle`、`.pin__dots`（`.is-shaking`）、`.pin__dot.is-filled`、`.lock-screen`（`.is-leaving`）、`.lock-screen__forgot` |

### 页面专属（`screens.css`）

| 页面 | class |
|---|---|
| 今天 | `.card--hero[data-tone=good｜warn｜bad]`、`.hero-amount`、`.hero-sub`、`.hero-foot`、`.hero-note`（`--bad`）、`.card--rings` |
| 记录 | `.toolbar`、`.month-switch`、`.month-switch__label`、`.summary-row`、`.summary-row__item`、`.section--day`、`.section__title--day` |
| 分析 | `.stat-grid`、`.stat`、`.stat__label`、`.stat__value`（`.is-income`、`.is-negative`）、`.stat__note`、`.card--benchmark[data-tier]`、`.benchmark__head`、`.benchmark__profile`、`.benchmark__amount`、`.benchmark__note`、`.insights`、`.insight[data-tone]`、`.insight__icon`、`.insight__text`、`.card--groups`、`.groups`、`.groups__row[data-group]`、`.card--runway[data-tone]`、`.runway__main`、`.runway__value`、`.runway__unit`、`.runway__text`、`.goal`、`.goal__head` |
| 记一笔 | `.entry[data-kind=expense｜income]`、`.entry__type`（标题栏的支出/收入切换）、`.entry__hint`、`.entry__meta`、`.entry__delete`、`.entry__save`；收入类型按钮 `.type-picker`（`.is-set`）、`.type-picker__label`、`.type-picker__value`、`.type-picker__chevron` |
| 投资 | `.card--goal[data-status=preparing｜ahead｜tight｜behind｜done｜missed]`、`.goal-card__head`、`.card--trigger[data-reached]`、`.trigger__title`、`.card--plan`、`.plan__lead`、`.rate-table`、`.rate-table__cell`（`.is-mid` = 建议值）、`.rate-table__rate`、`.rate-table__amount`、`.plan__facts`、`.projection`、`.projection__svg`、`.projection__grid`、`.projection__target`、`.projection__band`、`.projection__edge--high｜--low`、`.projection__actual`、`.projection__dot`、`.projection__today`、`.projection__xlabel`、`.projection__ylabel`、`.legend--projection`、`.legend__swatch--band｜--actual｜--target`、`.milestones`、`.insight-line[data-tone]`、`.row--holding`、`.delta.is-up｜.is-down`、`.disclaimer` |
| 投资表单 | `.invest-form`、`.plan-editor`、`.holding-detail`、`.holding-detail__head`、`.holding-detail__kind`、`.action-row`、`.chip--select.is-on`、`.choice-cards--wrap`、`.list--values`、`.row--value`、`.value-input`、`.row--history`、`.row__delete` |
| 密码 | `.pin__dots[data-length=4｜6]`、`.keypad__key--faceid` |
| 资料检查 | `.health`、`.health-item[data-level=warn｜info]`、`.health-item__head`、`.health-item__icon`、`.health-item__title`、`.health-item__body`、`.health-item__rows` |
| 恢复密钥（Google Drive 加密） | `.recovery`、`.recovery__form`、`.recovery__intro`、`.recovery__icon`、`.recovery-key`（7 组 × 4 字，等宽字体，必须清楚易抄）、`.recovery__input`、`.recovery__error` |
| 设定表单 | `.plan-preview[data-tone]`、`.cat-editor`、`.cat-editor__preview`、`.rec-editor`、`.cat-manager`、`.rec-manager`、`.swatches`、`.swatch.is-selected`、`.icon-grid`、`.icon-grid__item.is-selected` |
| 引导页 | `.onboarding`、`.onboarding__content`、`.onboarding__hero`、`.onboarding__appicon`、`.onboarding__title`、`.onboarding__lead`、`.onboarding__head`、`.onboarding__footer`、`.onboarding__dots`、`.features`、`.features__icon[data-color]`、`.choice-cards`、`.choice-card.is-selected` |

### data 属性

- `data-color`：13 个类别色 `red orange yellow green mint teal cyan blue indigo purple pink brown gray` → 在 `tokens.css` 映射成 `--cat`
- `data-tone`：`good`、`warn`、`bad`、`info`、`muted`（状态）；hero 另有同名 tone
- `data-tier`：`lean`、`ok`、`high`、`over`（生活费对照）

### 图标 id（`sprite.svg`，全部必须保留）

类别：`i-food i-coffee i-groceries i-transport i-car i-housing i-utilities i-phone i-health i-family i-gift i-shopping i-social i-subscriptions i-learning i-business i-travel i-pet i-sport i-beauty i-game i-other i-salary i-bizincome i-freelance i-otherincome`

界面：`i-today i-list i-chart i-invest i-settings i-plus i-close i-chevron-left i-chevron-right i-chevron-down i-search i-trash i-calendar i-note i-check i-lock i-faceid i-key i-cloud i-share i-download i-upload i-bell i-info i-warning i-sparkles i-trendUp i-trendDown i-target i-savings i-wallet i-backspace i-add-home i-shield i-arrow-up i-arrow-down i-help i-clock i-sun`

图标为 24×24 网格、`currentColor` 描边；类别图标会显示在彩色方块上（白色）。

---

## 五、必须遵守的可用性与无障碍要求

- 文字对比度 ≥ 4.5:1（大字 ≥ 3:1），浅色和深色模式都要检查
- 可点区域 ≥ 44×44px；键盘按键不小于现在的尺寸
- 输入框字体 ≥ 16px（否则 iOS 会自动放大画面）
- 保留 `:focus-visible` 焦点样式
- 保留 `prefers-reduced-motion`、`prefers-reduced-transparency`、`prefers-contrast: more` 的处理
- 保留 safe area（`env(safe-area-inset-*)`），Tab Bar 与 Sheet 不可被刘海或 Home 指示条遮住
- 状态不可只用颜色表达（徽章都有图标 + 文字）
- `.haptic-proxy` 必须保持不可见（它是 iPhone 触感反馈用的隐藏开关）
- 金额与数字对齐的地方使用 `tabular-nums`；hero 大数字用比例数字

---

## 六、交付

1. 只改上面允许的文件
2. 三项检查全部通过
3. 在 PR / 回复里附上：改了什么、浅色与深色的截图（今天、记录、分析、设置、记一笔）
4. 需要改结构或逻辑的想法 → 写在 `docs/codex-proposals.md`
