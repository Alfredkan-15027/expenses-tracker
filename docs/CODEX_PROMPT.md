# 给 ChatGPT Codex 的提示词（观感设计）

把下面整段复制给 Codex（Codex 网页版连接 GitHub 仓库 `Alfredkan-15027/expenses-tracker`，或在本机用 Codex CLI 打开这个文件夹）。

---

```text
你是一名资深 Apple 设计师兼前端工程师。请为这个仓库（Expenses Tracker：只给我一个人用的 iPhone 记账 PWA）完成「观感设计」精修。功能与逻辑已经完成并通过测试，你只负责视觉。

【开始前必须完整阅读】
1. AGENTS.md —— 权限边界，必须严格遵守
2. CODEX_DESIGN.md —— 设计任务书：iOS 27 设计方向、页面结构、class 清单、无障碍要求、验收方式

【硬性规则（违反即失败）】
- 只允许修改：styles/*.css、assets/icons/*（sprite.svg 与 PNG 图标，文件名、尺寸、图标 id 都不能变）、docs/codex-proposals.md
- 其他所有文件一律只读：src/**、index.html、sw.js、manifest.webmanifest、tests/**、scripts/**、.github/**、package.json、所有 .md 文档；也不能新增、删除、改名任何文件
- 不能改 CSS class 名称和图标 id（JavaScript 依赖它们）
- 不能引入任何外部资源：网络字体、CDN、远程图片、@import、url(http…)
- .lock-screen 必须完全不透明；html.is-locked #app 与 html.is-concealed #app 必须保持隐藏（隐私保护）
- 需要改结构、加 class 或改逻辑的想法，写进 docs/codex-proposals.md，不要自己动手

【设计目标：最新 iOS 27 Liquid Glass，不要旧版 iOS 的样子】
- 玻璃材质用 iOS 27 改良版：比 iOS 26 更不透明、更易读；边缘一圈较深的细描边 + 上缘较亮的 specular 高光；用描边分层，不靠重阴影；深色模式的玻璃明显比 iOS 26 亮
- 悬浮胶囊 Tab Bar：选中项的底色比玻璃更深（iOS 27 改动）；右侧「＋」是 prominent 强调色圆钮
- 滚动边缘效果：页面在顶部时导航栏透明；内容滚到下方时变成实色模糊 + 底部细线（hard edge），并淡入小标题
- 大圆角、同心圆角、胶囊按钮；iOS 26/27 的 Alert（并排胶囊按钮）与加宽 Switch
- 字体：SF Pro + PingFang SC；大额数字用 SF Pro Rounded（ui-rounded）
- 浅色、深色模式都要精修；hero 卡、Activity 风格圆环、图表、类别图标、键盘按键、Sheet 的质感都要更精致
- 底部 5 个分页（今天 · 记录 · 分析 · 投资 · 设置）：每个分页在 375px 宽时不能小于 44px
- 投资页（像 Apple「股市」+「健康」）：大数字市值、完成度、8%/9%/10% 三格对照、预测带状图、持仓列表；图表线条细、网格淡
- 记一笔的「收入」模式（「类型 ▾」按钮）与 6 位数密码画面（含 Face ID 键，必须完全不透明）
- 可以重新设计 App 图标（Liquid Glass 多层质感），保留原文件名与尺寸（180、192、512、512 maskable）

【必须保持】
文字对比度 ≥ 4.5:1、可点区域 ≥ 44px、输入框字体 ≥ 16px、safe area、prefers-reduced-motion / prefers-reduced-transparency / prefers-contrast 的处理、状态不能只靠颜色表达、.haptic-proxy 保持不可见。

【预览】
npm run dev → http://localhost:5173/?demo=1（演示资料，已开始投资）；http://localhost:5173/?demo=2（投资准备阶段）
视窗 390×844 与 375×667，浅色与深色各检查一次。页面：#/today、#/history、#/insights、#/invest、#/settings；记一笔：点右下角 ＋（收入模式：?demo=1&add=income）。

【完成前必须全部通过】
npm test
npm run check:security
node scripts/check-codex-scope.mjs

【交付】
在名称以 codex 开头的新分支开 Pull Request（GitHub Actions 会自动再跑一次越界检查），说明改了哪些地方，并附上浅色与深色的截图：今天、记录、分析、投资、设置、记一笔（支出与收入）。
```
