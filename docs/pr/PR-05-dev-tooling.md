# PR-05：GitHub 推送辅助脚本

**合并方向：** `integrate` ← `pr/05-dev-tooling`  
**对应提交：** `877727e`（基于 PR-04）

## 功能描述

新增 `scripts/push-github.ps1`，在 Windows + 代理环境下推送代码：

- 自动设置 HTTP/HTTPS 代理
- 跳过 Git LFS 推送与锁校验（本仓库不使用 LFS）

## 实现思路

通过环境变量 `GIT_LFS_SKIP_PUSH` 与 `git -c lfs....locksverify=false` 避免 LFS 钩子导致 push 失败。

## 测试方式

```powershell
.\scripts\push-github.ps1 -Port 7890
```

代理开启时应能 `git push origin main` 成功。

## 其他说明

- 可选工具脚本，不影响应用运行。
