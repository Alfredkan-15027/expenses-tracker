# 部署与更新

## 隐私前提

GitHub 帐号已开启 **Keep my email addresses private** 与 **Block command line pushes that expose my email**。
网页上的提交与合并只会显示 `…@users.noreply.github.com`，不会公开你的 Gmail。**请保持这两个选项开启。**

## 部署状态

| 项目 | 内容 |
|---|---|
| 代码仓库 | `https://github.com/Alfredkan-15027/expenses-tracker`（Public） |
| App 网址 | `https://alfredkan-15027.github.io/expenses-tracker/` |
| 托管 | GitHub Pages（免费，自带 HTTPS），来源：`main` 分支根目录 |
| 费用 | RM 0：没有服务器、没有数据库、没有付费 API |

仓库是公开的，因为免费方案的 GitHub Pages 只支持公开仓库。仓库里**只有程序代码**：没有任何记账资料、
金额、邮箱或密钥（每次发布前都跑 `npm run check:security` 确认）。你的记账资料只存在 iPhone 上。

## 更新流程

1. 修改代码并在本机测试：`npm run dev` → <http://localhost:5173/?demo=1>
2. 跑检查：`npm test`、`npm run check:security`
3. 推送到 GitHub 的 `main` 分支（任选一种）：
   - **GitHub Desktop**（免费、最简单）：打开这个文件夹 → Commit → Push
   - **命令行**：`git push origin main`（第一次会弹出浏览器让你登录 GitHub 授权 Git Credential Manager，之后不用再登录）
   - **网页**：在仓库页面「Add file → Upload files」
4. 约 1 分钟后 GitHub Pages 自动更新
5. iPhone 上的 App 会在**下一次打开时**自动拿到新版本（离线缓存会在后台更新）；如果改了 `sw.js`，App 会提示「有新版本可用」

## 交给 Codex 做观感设计

1. 在 ChatGPT 打开 **Codex**，连接 GitHub，选择 `Alfredkan-15027/expenses-tracker`
2. 把 `PROMPT_FOR_CODEX` 那段提示词（见交付报告）贴给 Codex
3. Codex 会开一个 `codex/…` 分支的 Pull Request，GitHub Actions 会自动跑：
   - 单元测试
   - 隐私 / 安全检查
   - **Codex 越界检查**（改到 `styles/`、`assets/icons/` 以外的文件会直接失败）
4. 三个检查都是绿色 ✓，再看截图满意，就按「Merge」；约 1 分钟后手机上的 App 就会更新

如果是在电脑上用 **Codex CLI**，它会自动读取仓库根目录的 `AGENTS.md`（权限规则）和 `CODEX_DESIGN.md`（设计任务书）；
完成后在本机跑 `node scripts/check-codex-scope.mjs` 确认没有越界。
