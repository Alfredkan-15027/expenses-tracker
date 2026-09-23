# Expenses Tracker — 开发进度日志

> 如果开发中途被 Usage Limit 打断，回来时说一声「继续」，从这里最后一个未完成的步骤接着做。

开始：2026-09-23 04:10 (MYT)

## 决定
- 形式：PWA（纯 HTML/CSS/JS，零依赖，零成本），计划部署在 GitHub Pages
- 资料：只存在手机本地 IndexedDB，不上传任何服务器
- 设计：iOS 27 Liquid Glass（悬浮胶囊 Tab Bar、选中项深色底、玻璃深色描边 + 高光、滚动时顶部硬边模糊条）
- 分析基准：EPF Belanjawanku 2024/2025 巴生谷单身（公共交通 RM1,970 / 有车 RM2,800）+ 2019 版分类结构 + 吉隆坡市场租金
- Codex 只能改 `styles/**` 与 `assets/icons/**`，由 `scripts/check-codex-scope.mjs` 与 GitHub Action 把关

## 步骤
- [x] 需求确认、研究 iOS 27 设计、吉隆坡开销基准
- [x] 核心逻辑（money / dates / analysis / benchmarks / recurring / backup）+ 23 个自动测试
- [x] 资料层（IndexedDB + 内存 store + 演示模式 + 密码锁）
- [x] UI：Tab Bar、今天、记录、分析、设置、记一笔 Sheet、引导页、密码锁、备份
- [x] 样式（iOS 27）+ App 图标
- [x] Service Worker / Manifest / 离线（已实测：关掉服务器仍可打开）
- [x] 浏览器模拟 iPhone（375×812、375×667、浅色/深色）逐页测试，修正 12 个问题
- [x] Codex 文档（AGENTS.md、CODEX_DESIGN.md、docs/CODEX_PROMPT.md）+ 越界检查脚本 + CI
- [x] 安全排查（个人资料、外部请求、XSS、CSP、git 作者邮箱、锁屏不透明、App 切换器隐藏金额）
- [x] 部署 GitHub Pages（你开启 GitHub 邮箱隐私后，于 2026-09-23 完成；网页提交只会显示 noreply 地址）
- [x] iPhone 安装 / 提醒 / 备份指南（docs/IPHONE_SETUP.md）、Codex 提示词

## 测试中发现并修正的问题
1. 本月圆环数字被截断 → 改成 Apple Activity 同心圆环
2. 左滑行右侧露出红边 → 未滑动时隐藏删除按钮
3. Toast 文字被截断（fixed + left:50% 宽度问题）
4. 深色模式 Sheet 内的按键与 chip 看不见 → 新增 `--sheet-surface`
5. 房租在月初付款会被「整月推算」放大 → 固定支出不外推
6. 月中开始使用时「今天还能花」虚高 → 第一个月按剩余天数折算预算
7. 开始记录前付的房租占用折算预算 → 只计算开始日之后的支出
8. 引导页按钮文字未随输入更新
9. 「名称」输入框被 flex 压扁
10. 左滑后的 click 事件把刚打开的删除按钮关掉
11. **锁屏半透明，金额透出来** → 改为完全不透明，先解锁再渲染，App 切换器中隐藏内容
12. iPhone SE 上数字键盘最后一行被切掉 → 支出/收入切换移到 Sheet 标题栏，小屏幕紧凑排版
