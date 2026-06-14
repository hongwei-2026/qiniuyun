# PR-04：Demo 视频 B 站链接与交付说明

**合并方向：** `integrate` ← `pr/04-demo-video`  
**对应提交：** `7f2ed1e`（基于 PR-03）

## 功能描述

满足 `PROJECT_GUIDE.md` 第七节 Demo 要求：

- README 填写 B 站演示链接：[BV1oCJw6nE18](https://www.bilibili.com/video/BV1oCJw6nE18/)
- `docs/demo/README.md` 说明本地 mp4 不入库、外链提交方式
- 交付清单勾选 Demo 项

## 实现思路

mp4 约 1.1GB 放 `.gitignore`，仅推送可访问外链；符合赛题「上传 B 站/云盘 + README 贴链接」。

## 测试方式

1. 打开 README 中 B 站链接，确认可播放
2. 视频含语音讲解 + 纯语音操作核心模块演示

## 其他说明

- 本地源文件：`docs/demo/voicecanvas-demo.mp4`
