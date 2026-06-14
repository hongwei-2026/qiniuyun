from fastapi import APIRouter

from app.config import get_settings

router = APIRouter(prefix="/api/v1/config", tags=["config"])


@router.get("/")
async def get_config():
    settings = get_settings()
    return {
        "deepseek": {
            "configured": bool(settings.deepseek_api_key),
            "default_mode": settings.deepseek_mode,
            "modes": [
                {"id": "auto", "label": "Auto（常规 Flash / 复杂 Pro）", "model": "auto"},
                {"id": "v4-pro", "label": "V4 Pro（深度推理）", "model": "deepseek-v4-pro"},
                {"id": "flash", "label": "Flash（快速）", "model": "deepseek-chat"},
                {"id": "chat", "label": "Chat（对话）", "model": "deepseek-chat"},
            ],
        },
        "image": {
            "default_provider": settings.image_provider,
            "providers": [
                {"id": "minimax", "label": "MiniMax 生图", "configured": bool(settings.minimax_api_key)},
                {"id": "doubao", "label": "豆包 Seedream 生图", "configured": bool(settings.ark_api_key)},
            ],
        },
        "model3d": {
            "configured": bool(settings.ark_api_key),
            "provider": "doubao-seed3d",
            "model": settings.ark_3d_model,
        },
        "asr": {
            "default_provider": settings.asr_provider,
            "xfyun_product": settings.xfyun_asr_product,
            "providers": [
                {"id": "browser", "label": "浏览器语音识别", "configured": True},
                {
                    "id": "xfyun",
                    "label": (
                        "讯飞极速录音转写"
                        if settings.xfyun_asr_product == "ost"
                        else "讯飞语音听写（流式）"
                    ),
                    "configured": bool(
                        settings.xfyun_app_id
                        and settings.xfyun_api_key
                        and settings.xfyun_api_secret
                    ),
                },
            ],
        },
    }
