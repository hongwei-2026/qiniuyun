# VoiceCanvas Backend

FastAPI 后端：DeepSeek 意图解析、MiniMax/豆包生图、讯飞 ASR、漫画剧本 API。

## 启动

```bash
pip install -r requirements.txt
cp ../.env.example .env   # 在 backend 目录，或复制到 backend/.env
uvicorn app.main:app --reload --port 8000
```

健康检查：`GET http://127.0.0.1:8000/api/v1/config/`

## 主要路由

| 路径 | 说明 |
|------|------|
| `/api/v1/intent/parse` | 语音文本 → 工具调用 |
| `/api/v1/image/generate` | 文生图 |
| `/api/v1/comic/*` | 漫画剧本与角色 |
| `/api/v1/voice/transcribe` | 讯飞极速转写 |

密钥配置见根目录 `.env.example`，**勿提交 `.env`**。
