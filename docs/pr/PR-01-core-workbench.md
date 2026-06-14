# PR-01：VoiceCanvas 核心工作台（前后端 + 多模式引擎）

**合并方向：** `integrate` ← `pr/01-core-workbench`  
**对应提交：** `40c986e`

## 功能描述

实现七牛云题目二「AI 语音绘图工具」的首个可运行版本：

- **自由画布**：Fabric.js 矢量绘图（圆/矩形/星形/箭头等）、样式与变换、撤销重做
- **AI 创作**：DeepSeek 意图解析 + MiniMax/豆包文生图
- **九宫格**：切格、扩格、重绘、瓦片导出
- **漫画创作**：多项目、角色/剧本/分集生图、PDF 导出
- **3D**：图生模型预览
- **语音管道**：浏览器 ASR + 讯飞 OST、本地快路径、TTS 播报
- **文档**：`docs/DESIGN.md`、`docs/ARCHITECTURE.md`、`docs/VOICE_COMMANDS.md` 初版

## 实现思路

- 前端 React + Zustand；`useVoicePipeline` 串联识别 → 本地命令 / LLM Tool Calling → `toolExecutor`
- 后端 FastAPI：`/api/v1/intent`、`/voice/transcribe`、漫画/生图/3D 路由
- 漫画资产 IndexedDB 持久化；九宫格与漫画专用 Tool Schema

## 测试方式

1. 配置 `backend/.env`，启动前后端
2. 说「画红色圆形」「撤销」「保存图片」验证矢量路径
3. 说「切换漫画创作」「指令手册」验证模式与 UI
4. 说「生成赛博朋克城市」（AI 模式）验证生图链路

## 其他说明

- 本 PR 为项目基线提交；后续 PR 在此基础上迭代文档、语音稳定性与 Demo 链接。
