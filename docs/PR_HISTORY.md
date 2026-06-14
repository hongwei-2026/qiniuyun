# PR 历史补录说明

本仓库首版 `40c986e` 已直接落在 `main`；后续改动按 `PROJECT_GUIDE.md` 第六节拆为 **4 个增量 PR** 补录到 `integrate` 分支（与 `main` 同步）。

## 分支与提交

| PR | 分支 | 相对上一节点新增提交 | 说明 |
|:--:|------|----------------------|------|
| — | `main` / `integrate` @ `40c986e` | 首版全功能工作台 | 直接提交（基线） |
| #1 | `pr/02-docs-team` | `3d73d12` | 赛题文档与分工 |
| #2 | `pr/03-voice-pipeline` | `720a329` | 语音管道修复 |
| #3 | `pr/04-demo-video` | `7f2ed1e` | B 站 Demo 链接 |
| #4 | `pr/05-dev-tooling` | `877727e` | 推送脚本 |

> 首版功能说明见 [PR-01 归档](pr/PR-01-core-workbench.md)（无独立 GitHub PR，已包含在 `40c986e`）。

## 方式 A：脚本（需 GitHub CLI）

```powershell
# 1. 推送分支
git push origin integrate pr/02-docs-team pr/03-voice-pipeline pr/04-demo-video pr/05-dev-tooling

# 2. 安装并登录 gh：https://cli.github.com/
gh auth login

# 3. 自动创建并合并 4 个 PR
.\scripts\create-pr-history.ps1
```

## 方式 B：GitHub 网页手动

每个 PR：**base** = `integrate`，**compare** = 上表分支，合并后 `integrate` 前进一档。

| 次序 | base | compare | 标题 |
|:--:|------|---------|------|
| 1 | `integrate` @ 40c986e | `pr/02-docs-team` | `docs: 赛题文档对齐、指令速查与队员分工` |
| 2 | 合并后 `integrate` | `pr/03-voice-pipeline` | `fix: 语音管道稳定性、漫画切换与空间指令` |
| 3 | 合并后 `integrate` | `pr/04-demo-video` | `docs: 添加 B 站 Demo 视频链接` |
| 4 | 合并后 `integrate` | `pr/05-dev-tooling` | `chore: Windows 下 GitHub 推送辅助脚本` |

正文复制 `docs/pr/PR-0x-*.md` 中 `## 功能描述` 起全部内容。

## PR 正文文件

- [PR-01 归档](pr/PR-01-core-workbench.md)（基线提交说明）
- [PR-02](pr/PR-02-docs-and-team.md)
- [PR-03](pr/PR-03-voice-pipeline.md)
- [PR-04](pr/PR-04-demo-video.md)
- [PR-05](pr/PR-05-dev-tooling.md)

## 队员 commit 建议

| 成员 | 建议 |
|------|------|
| 于鸿伟 | 已提交开发相关 commit；运行 `create-pr-history.ps1` 生成 PR 记录 |
| 于鸿明 | 用**本人账号**提交 `docs/TEST_REPORT.md` 或向 `pr/02-docs-team` 提 PR |
