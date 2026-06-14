"""
VoiceCanvas 后端服务 - 纯语音 AI 绘图工作台

功能模块：
- 意图解析：将用户语音转换为结构化工具调用
- 图像生成：集成 MiniMax/豆包文生图服务
- 漫画创作：角色设计、剧本生成、分镜绘制
- 3D 模型：图生三维模型
- 语音识别：讯飞 ASR 接口
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import comic, config_router, image, intent, model3d, voice

# 加载应用配置（从环境变量或 .env 文件）
settings = get_settings()

# 创建 FastAPI 应用实例
app = FastAPI(
    title="VoiceCanvas API",
    description="纯语音绘图工具后端",
    version="0.1.0",
)

# 配置 CORS 中间件，允许前端跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,  # 允许的源地址列表
    allow_credentials=True,
    allow_methods=["*"],  # 允许所有 HTTP 方法
    allow_headers=["*"],  # 允许所有请求头
)

# 注册各功能模块的路由
# 漫画创作路由（角色、剧本、分集、PDF导出）
app.include_router(comic.router)
# 语音相关路由（讯飞录音上传接口）
app.include_router(voice.router)
# 意图解析路由（DeepSeek LLM 工具调用解析）
app.include_router(intent.router)
# 图像生成路由（文生图接口）
app.include_router(image.router)
# 3D 模型生成路由（图生 3D）
app.include_router(model3d.router)
# 配置路由（前端获取可用 AI 服务状态）
app.include_router(config_router.router)


@app.get("/health")
async def health():
    """健康检查接口，用于前端检测后端是否在线"""
    return {"status": "ok", "service": "voicecanvas-backend"}
