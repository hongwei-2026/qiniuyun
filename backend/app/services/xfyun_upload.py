import hashlib
import hmac
import uuid

import httpx

from app.config import Settings, get_settings
from app.services.xfyun_auth import build_auth_headers_for_bytes, http_date


def _build_multipart_body(
    *,
    app_id: str,
    request_id: str,
    filename: str,
    audio_bytes: bytes,
) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    mime = "application/octet-stream" if filename.endswith((".pcm", ".raw")) else (
        "audio/wav" if filename.endswith(".wav") else "application/octet-stream"
    )
    chunks: list[bytes] = []

    def add_field(name: str, value: str) -> None:
        chunks.append(f"--{boundary}\r\n".encode())
        chunks.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        chunks.append(value.encode())
        chunks.append(b"\r\n")

    def add_file(name: str, fname: str, content: bytes, content_type: str) -> None:
        chunks.append(f"--{boundary}\r\n".encode())
        chunks.append(
            f'Content-Disposition: form-data; name="{name}"; filename="{fname}"\r\n'.encode(),
        )
        chunks.append(f"Content-Type: {content_type}\r\n\r\n".encode())
        chunks.append(content)
        chunks.append(b"\r\n")

    add_file("data", filename, audio_bytes, mime)
    add_field("app_id", app_id)
    add_field("request_id", request_id)
    chunks.append(f"--{boundary}--\r\n".encode())

    body = b"".join(chunks)
    content_type = f"multipart/form-data; boundary={boundary}"
    return body, content_type


class XfyunUploadService:
    UPLOAD_HOST = "upload-ost-api.xfyun.cn"
    UPLOAD_PATH = "/file/upload"

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    def _check_config(self) -> None:
        if not all([
            self.settings.xfyun_app_id,
            self.settings.xfyun_api_key,
            self.settings.xfyun_api_secret,
        ]):
            raise ValueError("讯飞 ASR 未配置：请设置 XFYUN_APP_ID / XFYUN_API_KEY / XFYUN_API_SECRET")

    async def upload_audio(self, audio_bytes: bytes, filename: str = "audio.wav") -> str:
        self._check_config()
        request_id = str(uuid.uuid4())
        body, content_type = _build_multipart_body(
            app_id=self.settings.xfyun_app_id,
            request_id=request_id,
            filename=filename,
            audio_bytes=audio_bytes,
        )
        date = http_date()
        headers = build_auth_headers_for_bytes(
            host=self.UPLOAD_HOST,
            method="POST",
            path=self.UPLOAD_PATH,
            body=body,
            api_key=self.settings.xfyun_api_key,
            api_secret=self.settings.xfyun_api_secret,
            content_type=content_type,
            date=date,
        )
        url = f"https://{self.UPLOAD_HOST}{self.UPLOAD_PATH}"
        async with httpx.AsyncClient(timeout=120.0) as client:
            request = client.build_request("POST", url, content=body, headers=headers)
            response = await client.send(request)
            response.raise_for_status()
            data = response.json()

        code = data.get("code")
        if code not in (0, "0"):
            raise ValueError(f"讯飞上传失败: {data}")

        file_url = data.get("data", {}).get("url")
        if not file_url:
            raise ValueError(f"讯飞上传未返回文件 URL: {data}")
        return str(file_url)
