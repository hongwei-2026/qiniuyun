import base64
import hashlib
import hmac
from urllib.parse import quote

from app.config import Settings, get_settings
from app.services.xfyun_auth import http_date


def build_iat_ws_url(settings: Settings | None = None) -> dict[str, str]:
    cfg = settings or get_settings()
    if not all([cfg.xfyun_app_id, cfg.xfyun_api_key, cfg.xfyun_api_secret]):
        raise ValueError("讯飞 ASR 未配置")

    host = "iat-api.xfyun.cn"
    path = "/v2/iat"
    date = http_date()
    signature_origin = f"host: {host}\ndate: {date}\nGET {path} HTTP/1.1"
    signature = base64.b64encode(
        hmac.new(
            cfg.xfyun_api_secret.encode("utf-8"),
            signature_origin.encode("utf-8"),
            digestmod=hashlib.sha256,
        ).digest(),
    ).decode("utf-8")
    authorization_origin = (
        f'api_key="{cfg.xfyun_api_key}", algorithm="hmac-sha256", '
        f'headers="host date request-line", signature="{signature}"'
    )
    authorization = base64.b64encode(authorization_origin.encode("utf-8")).decode("utf-8")
    url = (
        f"wss://{host}{path}?authorization={quote(authorization)}"
        f"&date={quote(date)}&host={quote(host)}"
    )
    return {
        "url": url,
        "app_id": cfg.xfyun_app_id,
        "language": cfg.xfyun_language,
        "accent": cfg.xfyun_accent,
    }
