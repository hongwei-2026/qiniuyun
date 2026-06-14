# VoiceCanvas — 纯语音 AI 绘图工作台

> **七牛云作品活动 · 题目二：AI 语音绘图工具**

**纯语音驱动的 AI 创作工具**：不用鼠标键盘，说话即可矢量绘图、文生图、九宫格素材、漫画连载与图生 3D。

仓库：[https://github.com/hongwei-2026/qiniuyun](https://github.com/hongwei-2026/qiniuyun)

---

## 议题对应说明

| 题目要求 | 本项目实现 |
|----------|------------|
| 纯语音控制绘图 | 连续语音识别 + 本地快路径 + DeepSeek 意图解析 → 工具调用驱动画布 |
| 指令理解准确性 | 结构化 Tool Schema、漫画/九宫格专用规划器、口语归一化与同义词容错 |
| 响应性能 | 简单矢量指令本地直执行；复杂指令走 LLM；自适应停顿（短句快、长句可思考） |
| 复杂指令拆解 | 多 Tool 顺序执行、工作流宏（如地图初始化）、多集漫画/多页重绘 |

---

## 功能概览

| 模式 | 能力 | 语音示例 |
|------|------|----------|
| 自由画布 | 矢量图形、样式、变换 | 画红色圆形、改成蓝色、放大一倍、撤销、保存图片 |
| AI 创作 | 文生图 | 生成赛博朋克城市、重新生成、切换豆包/MiniMax |
| 九宫格 | 切格、扩格、重绘、导出 | 新建九宫格、重绘第 3 格、导出瓦片集 |
| 漫画创作 | 角色、剧本、分集生图、PDF | 画角色立绘小明、生成第一集漫画、重绘第五页 |
| 3D | 图生三维 | 把当前图生成 3D 模型 |
| 系统 | 手册、识别切换 | **指令手册**、切换讯飞识别、帮助 |

说 **「指令手册」** 或 **「查看指令」** 可打开完整指令列表。  
文字版速查：[docs/VOICE_COMMANDS.md](docs/VOICE_COMMANDS.md)

---

## Demo 视频

**[【AI语音绘画】B 站演示](https://www.bilibili.com/video/BV1oCJw6nE18/)**

演示要求：语音讲解 + **纯语音操作**完整流程（见 [PROJECT_GUIDE.md](PROJECT_GUIDE.md) 第七节）。

本地源文件（未入库）：`docs/demo/voicecanvas-demo.mp4`

---

## 快速开始

### 环境要求

- Node.js 18+
- Python 3.10+
- Chrome / Edge（推荐，需 HTTPS 或 localhost 以使用浏览器语音识别）

### 1. 克隆与配置

```bash
git clone https://github.com/hongwei-2026/qiniuyun.git
cd qiniuyun
cp .env.example backend/.env
# 编辑 backend/.env，填入各 API Key（勿提交 .env）
```

### 2. 启动后端

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 3. 启动前端

```bash
cd frontend
npm install
npm run dev
```

浏览器打开 **http://localhost:5173** ，允许麦克风。启动后会播报欢迎语并进入连续聆听。

---

## API 配置说明

所有密钥通过 **`backend/.env`** 配置，**已加入 `.gitignore`，请勿提交到 Git**。

| 变量 | 用途 | 是否必选 |
|------|------|----------|
| `DEEPSEEK_API_KEY` | 语音意图理解 / LLM | 必选（AI 指令） |
| `MINIMAX_API_KEY` | MiniMax 生图 | 生图时二选一 |
| `ARK_API_KEY` | 豆包 Seedream 生图 + Seed3D | 生图/3D 时二选一 |
| `XFYUN_APP_ID` / `XFYUN_API_KEY` / `XFYUN_API_SECRET` | 讯飞极速转写 | 可选（默认可用浏览器识别） |

详细字段见 [.env.example](.env.example)。

语音切换：

- 「切换讯飞识别」/「切换浏览器识别」
- 「切换豆包生图」/「切换 MiniMax」

---

## 项目结构

```
qiniuyun/
├── frontend/          # React + TypeScript + Fabric.js（见 frontend/README.md）
├── backend/           # FastAPI + DeepSeek / 生图 / ASR（见 backend/README.md）
├── docs/
│   ├── DESIGN.md           # 设计文档（计划/已实现/未完成）
│   ├── ARCHITECTURE.md     # 系统架构
│   ├── VOICE_COMMANDS.md   # 语音指令速查
│   └── GITHUB_ABOUT.md     # GitHub 仓库描述与 Topics
├── .github/
│   └── pull_request_template.md
├── .env.example
├── PROJECT_GUIDE.md
└── README.md
```

---

## 设计文档

按活动要求，设计文档见 **[docs/DESIGN.md](docs/DESIGN.md)**，包含：

1. 计划支持的指令能力  
2. 最终实现的指令能力  
3. 未完成部分及原因说明  

---

## 第三方依赖与原创功能

| 依赖 | 用途 |
|------|------|
| React / Vite / Fabric.js / Three.js | 前端 UI、2D 画布、3D 预览 |
| FastAPI | 后端 API |
| DeepSeek API | 自然语言 → 结构化工具调用 |
| MiniMax / 火山方舟（豆包） | 文生图、图生 3D |
| Web Speech API | 浏览器语音识别与 TTS |
| 讯飞极速转写 OST | 高精度 ASR（可选） |

**原创部分：** 语音工具编排引擎、本地快路径与自适应断句、九宫格/漫画专用 Tool Schema 与执行器、多项目漫画资产管理（IndexedDB）、中文对白 Canvas 叠加与 PDF 导出等。

---

## 队员分工

| 成员 | 分工 |
|------|------|
| 于鸿伟 | 项目开发：前端语音管道、画布/漫画/九宫格引擎，后端 API 与意图解析 |
| 于鸿明 | 测试：功能验证、语音指令回归、Demo 流程走查 |

> 多人组队时每位成员须用各自账号提交 commit；PR 中说明分工（见 [PROJECT_GUIDE.md](PROJECT_GUIDE.md) 8.1）。

---

## 交付清单（自检）

- [x] 公开仓库与 README（运行说明、依赖、Demo 占位）
- [x] 设计文档 `docs/DESIGN.md`（计划 / 已实现 / 未完成）
- [x] 语音指令说明 `docs/VOICE_COMMANDS.md`
- [x] 主分支可克隆运行（配置 `.env` 后）
- [x] `.env` / 真实 API Key **不进入版本库**
- [x] Demo 视频（[B 站 BV1oCJw6nE18](https://www.bilibili.com/video/BV1oCJw6nE18/)）
- [x] PR 补录说明与分支（见 [docs/PR_HISTORY.md](docs/PR_HISTORY.md)，运行 `scripts/create-pr-history.ps1`）

---

## 许可证与说明

本项目为七牛云活动参赛作品。API Key 等敏感信息请仅保存在本地 `backend/.env`，切勿提交至公开仓库。

---

## 相关链接

- 比赛指南：[PROJECT_GUIDE.md](PROJECT_GUIDE.md)
- 设计文档：[docs/DESIGN.md](docs/DESIGN.md)
- 架构说明：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 指令速查：[docs/VOICE_COMMANDS.md](docs/VOICE_COMMANDS.md)
- GitHub 描述文案：[docs/GITHUB_ABOUT.md](docs/GITHUB_ABOUT.md)
