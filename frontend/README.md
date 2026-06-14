# VoiceCanvas Frontend

React + TypeScript + Fabric.js 前端：语音管道、画布引擎、漫画/九宫格 UI。

## 启动

```bash
npm install
npm run dev
```

浏览器访问 http://localhost:5173（需同时启动 backend）。

## 构建

```bash
npm run build
```

产物在 `dist/`，已加入 `.gitignore`。

## 核心目录

| 路径 | 说明 |
|------|------|
| `src/hooks/useVoicePipeline.ts` | 语音识别与指令调度 |
| `src/engines/toolExecutor.ts` | 工具执行与画布上下文 |
| `src/data/commandManual.ts` | 指令手册文案 |
| `src/engines/comicEngine.ts` | 漫画生成引擎 |
