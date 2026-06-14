# PR-02：赛题文档对齐与队员分工

**合并方向：** `integrate` ← `pr/02-docs-team`  
**对应提交：** `3d73d12`（基于 PR-01）

## 功能描述

按 `PROJECT_GUIDE.md` 补齐交付文档与仓库规范：

- 扩充 `docs/DESIGN.md`（计划指令 / 已实现 / 未完成及原因）
- 新增 `docs/VOICE_COMMANDS.md` 语音指令速查
- 新增 `docs/GITHUB_ABOUT.md`、前后端子目录 README
- 根目录 `README.md` 增加议题对应表、依赖说明、队员分工
- 添加 `.github/pull_request_template.md` 与 `.gitignore` 密钥规则

## 实现思路

对照赛题第十条交付清单逐项补全 Markdown；分工表明确于鸿伟（开发）与于鸿明（测试）。

## 测试方式

1. 阅读 `README.md` 按步骤克隆启动，确认与文档一致
2. 核对 `docs/DESIGN.md` 三节结构完整
3. 在 GitHub 新建 PR 时确认自动加载 PR 模板

## 其他说明

- 无运行时逻辑变更，主要为文档与协作规范。
