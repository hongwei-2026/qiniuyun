from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Server(服务器)
    backend_port: int = 8000
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # DeepSeek LLM
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    # v4-pro | flash | chat
    deepseek_mode: Literal["v4-pro", "flash", "chat", "auto"] = "auto"
    deepseek_reasoning_effort: Literal["low", "medium", "high"] = "high"
    deepseek_thinking_enabled: bool = True

    # MiniMax Image
    minimax_api_key: str = ""
    minimax_image_url: str = "https://api.minimaxi.com/v1/image_generation"
    minimax_image_model: str = "image-01"

    # Doubao (Volcengine Ark) Image
    ark_api_key: str = ""
    ark_base_url: str = "https://ark.cn-beijing.volces.com/api/v3"
    ark_image_model: str = "doubao-seedream-5-0-260128"
    ark_3d_model: str = "doubao-seed3d-2-0-260328"

    # Image provider: minimax | doubao
    image_provider: Literal["minimax", "doubao"] = "minimax"

    # 讯飞极速语音转写
    xfyun_app_id: str = ""
    xfyun_api_key: str = ""
    xfyun_api_secret: str = ""
    xfyun_language: str = "zh_cn"
    xfyun_accent: str = "mandarin"
    xfyun_domain: str = "pro_ost_ed"
    # xfyun 识别产品: ost（极速录音转写）| iat（语音听写流式，需单独开通）
    xfyun_asr_product: Literal["ost", "iat"] = "ost"
    # ASR 默认: browser | xfyun
    asr_provider: Literal["browser", "xfyun"] = "browser"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def deepseek_model(self) -> str:
        mapping = {
            "v4-pro": "deepseek-v4-pro",
            "flash": "deepseek-chat",
            "chat": "deepseek-chat",
            "auto": "deepseek-chat",
        }
        return mapping[self.deepseek_mode]

    def deepseek_extra_body(self) -> dict | None:
        if self.deepseek_mode == "v4-pro" and self.deepseek_thinking_enabled:
            return {"thinking": {"type": "enabled"}}
        return None


@lru_cache
def get_settings() -> Settings:
    return Settings()


def reload_settings() -> Settings:
    get_settings.cache_clear()
    return get_settings()
