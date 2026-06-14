# 在代理已开启时使用。默认 Clash 端口 7890，可传参：.\scripts\push-github.ps1 -Port 7897
param([int]$Port = 7890)

$proxy = "http://127.0.0.1:$Port"
$env:HTTP_PROXY = $proxy
$env:HTTPS_PROXY = $proxy
$env:ALL_PROXY = $proxy
# 本仓库不使用 Git LFS，跳过 LFS 推送与锁校验
$env:GIT_LFS_SKIP_PUSH = "1"
$env:GIT_CONFIG_COUNT = "1"
$env:GIT_CONFIG_KEY_0 = "lfs.https://github.com/hongwei-2026/qiniuyun.git/info/lfs.locksverify"
$env:GIT_CONFIG_VALUE_0 = "false"

Write-Host "Proxy: $proxy"
Write-Host "Pushing to origin main ..."
git push origin main
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "若提示无法连接 127.0.0.1:$Port ，请先打开 Clash/V2Ray 并确认 HTTP 代理端口。" -ForegroundColor Yellow
  Write-Host "端口不对可执行: .\scripts\push-github.ps1 -Port 你的端口" -ForegroundColor Yellow
  exit $LASTEXITCODE
}
Write-Host "Done." -ForegroundColor Green
