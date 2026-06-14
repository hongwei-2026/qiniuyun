from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import comic, config_router, image, intent, model3d, voice

settings = get_settings()

app = FastAPI(
    title="VoiceCanvas API",
    description="纯语音绘图工具后端",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(comic.router)
app.include_router(voice.router)
app.include_router(intent.router)
app.include_router(image.router)
app.include_router(model3d.router)
app.include_router(config_router.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "voicecanvas-backend"}
