# 按序在 GitHub 上补录 4 个增量 PR（integrate 分支）
# 需要：gh CLI 已登录
# 用法：.\scripts\create-pr-history.ps1

$ErrorActionPreference = "Stop"
$repo = "hongwei-2026/qiniuyun"
$root = Split-Path $PSScriptRoot -Parent

function Get-PrBody([string]$file) {
    $content = Get-Content (Join-Path $root $file) -Raw -Encoding UTF8
    $lines = $content -split "`n"
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^## 功能描述') {
            return ($lines[$i..($lines.Count - 1)] -join "`n").Trim()
        }
    }
    $content.Trim()
}

$prs = @(
    @{
        Title = "docs: 赛题文档对齐、指令速查与队员分工"
        Head  = "pr/02-docs-team"
        BodyFile = "docs/pr/PR-02-docs-and-team.md"
    },
    @{
        Title = "fix: 语音管道稳定性、漫画切换与空间指令"
        Head  = "pr/03-voice-pipeline"
        BodyFile = "docs/pr/PR-03-voice-pipeline.md"
    },
    @{
        Title = "docs: 添加 B 站 Demo 视频链接"
        Head  = "pr/04-demo-video"
        BodyFile = "docs/pr/PR-04-demo-video.md"
    },
    @{
        Title = "chore: Windows 下 GitHub 推送辅助脚本"
        Head  = "pr/05-dev-tooling"
        BodyFile = "docs/pr/PR-05-dev-tooling.md"
    }
)

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "未找到 gh。请安装 GitHub CLI 或按 docs/PR_HISTORY.md 手动创建。" -ForegroundColor Yellow
    exit 1
}

# 确保 integrate 在基线提交
$integrateSha = git rev-parse 40c986e
Write-Host "integrate 应对齐提交 $integrateSha"
git push origin "${integrateSha}:refs/heads/integrate" 2>$null

foreach ($pr in $prs) {
    $body = Get-PrBody $pr.BodyFile
    Write-Host "`n>> $($pr.Title)"
    $existing = gh pr list --repo $repo --head $pr.Head --base integrate --state all --json number --jq '.[0].number' 2>$null
    if ($existing) {
        Write-Host "   已存在 PR #$existing，跳过"
        continue
    }
    gh pr create --repo $repo --base integrate --head $pr.Head --title $pr.Title --body $body
    $num = gh pr list --repo $repo --head $pr.Head --base integrate --state open --json number --jq '.[0].number'
    if ($num) {
        gh pr merge $num --repo $repo --merge --delete-branch=false
        Write-Host "   已合并 PR #$num → integrate"
    }
    Start-Sleep -Seconds 2
}

Write-Host "`n完成。integrate 应与 main 一致。"
