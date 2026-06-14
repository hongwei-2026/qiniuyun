import asyncio
import json
import time
import uuid
from typing import Any

import httpx

from app.config import Settings, get_settings
from app.services.xfyun_auth import build_auth_headers
from app.services.xfyun_upload import XfyunUploadService


class XfyunAsrService:
    OST_HOST = "ost-api.xfyun.cn"
    CREATE_PATH = "/v2/ost/pro_create"
    QUERY_PATH = "/v2/ost/query"

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self.uploader = XfyunUploadService(self.settings)

    def _check_config(self) -> None:
        if not all([
            self.settings.xfyun_app_id,
            self.settings.xfyun_api_key,
            self.settings.xfyun_api_secret,
        ]):
            raise ValueError("讯飞 ASR 未配置")

    def _create_body(self, audio_url: str, request_id: str | None = None, *, filename: str = "audio.wav") -> str:
        lower = filename.lower()
        if lower.endswith(".mp3"):
            encoding = "lame"
        elif lower.endswith(".pcm") or lower.endswith(".raw"):
            encoding = "raw"
        elif lower.endswith(".wav"):
            encoding = "wav"
        else:
            encoding = "raw"
        return json.dumps({
            "common": {"app_id": self.settings.xfyun_app_id},
            "business": {
                "request_id": request_id or str(uuid.uuid4()),
                "language": self.settings.xfyun_language,
                "accent": self.settings.xfyun_accent,
                "domain": self.settings.xfyun_domain,
            },
            "data": {
                "audio_src": "http",
                "audio_url": audio_url,
                "format": "audio/L16;rate=16000",
                "encoding": encoding,
            },
        }, ensure_ascii=False)

    def _query_body(self, task_id: str) -> str:
        return json.dumps({
            "common": {"app_id": self.settings.xfyun_app_id},
            "business": {"task_id": task_id},
        }, ensure_ascii=False)

    async def _post(self, path: str, body: str) -> dict[str, Any]:
        headers = build_auth_headers(
            host=self.OST_HOST,
            method="POST",
            path=path,
            body=body,
            api_key=self.settings.xfyun_api_key,
            api_secret=self.settings.xfyun_api_secret,
        )
        url = f"https://{self.OST_HOST}{path}"
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(url, content=body, headers=headers)
            if response.status_code >= 400:
                try:
                    detail = response.json()
                except Exception:
                    detail = response.text
                code = detail.get("code") if isinstance(detail, dict) else None
                msg = str(detail.get("message", "")) if isinstance(detail, dict) else ""
                if code in (20304, "20304") or "20304" in msg:
                    raise ValueError("未识别到有效语音，请靠近麦克风清晰说话后再试")
                if code in (11200, "11200") or "licc" in msg.lower():
                    raise ValueError(
                        "讯飞转写未授权：请在讯飞开放平台开通「极速录音转写大模型」并领取免费包"
                    )
                raise ValueError(f"讯飞 API 错误 ({response.status_code}): {detail}")
            return response.json()

    async def create_task(self, audio_url: str, *, filename: str = "audio.wav") -> str:
        data = await self._post(self.CREATE_PATH, self._create_body(audio_url, filename=filename))
        code = data.get("code")
        if code not in (0, "0", None):
            msg = data.get("message") or data.get("desc") or str(data)
            if "licc" in str(msg).lower() or code in (11200, "11200"):
                raise ValueError(
                    "讯飞转写未授权：请在讯飞控制台开通「极速录音转写大模型」服务并领取免费包"
                )
            raise ValueError(f"讯飞转写任务创建失败: {data}")
        task_id = data.get("data", {}).get("task_id")
        if not task_id:
            raise ValueError(f"讯飞转写任务创建失败: {data}")
        return str(task_id)

    async def query_task(self, task_id: str) -> dict[str, Any]:
        return await self._post(self.QUERY_PATH, self._query_body(task_id))

    def _extract_text(self, result: dict[str, Any]) -> str:
        parts: list[str] = []

        def append_word(w: str, wp: str = "n") -> None:
            if not w:
                return
            # 跳过分段标记
            if wp == "g":
                return
            parts.append(w)

        def parse_st(st: Any) -> None:
            if not isinstance(st, dict):
                return
            for rt in st.get("rt") or []:
                if not isinstance(rt, dict):
                    continue
                for ws in rt.get("ws") or []:
                    if not isinstance(ws, dict):
                        continue
                    for cw in ws.get("cw") or []:
                        if not isinstance(cw, dict):
                            continue
                        w = cw.get("w")
                        if isinstance(w, str):
                            append_word(w, str(cw.get("wp", "n")))

        def parse_json_1best(j1b: Any) -> None:
            if isinstance(j1b, str):
                try:
                    j1b = json.loads(j1b)
                except json.JSONDecodeError:
                    return
            if not isinstance(j1b, dict):
                return
            st = j1b.get("st")
            if isinstance(st, dict):
                parse_st(st)
            elif isinstance(st, list):
                for item in st:
                    parse_st(item)

        def parse_lattice(lattice: Any) -> None:
            if not isinstance(lattice, list):
                return
            for item in lattice:
                if isinstance(item, dict):
                    parse_json_1best(item.get("json_1best"))

        # 极速转写标准结构: data.result.lattice / lattice2
        data = result.get("data") if isinstance(result, dict) else None
        if isinstance(data, dict):
            res = data.get("result")
            if isinstance(res, dict):
                parse_lattice(res.get("lattice"))
                if not parts:
                    parse_lattice(res.get("lattice2"))

        # 兼容旧字段
        def walk(obj: Any) -> None:
            if isinstance(obj, dict):
                for key, val in obj.items():
                    if key in {"onebest", "text"} and isinstance(val, str) and val.strip():
                        parts.append(val.strip())
                    else:
                        walk(val)
            elif isinstance(obj, list):
                for item in obj:
                    walk(item)

        if not parts:
            walk(result)

        return "".join(parts)

    async def transcribe_bytes(
        self,
        audio_bytes: bytes,
        filename: str = "audio.wav",
        poll_interval: float = 2.0,
        max_wait: float = 120.0,
    ) -> str:
        self._check_config()
        audio_url = await self.uploader.upload_audio(audio_bytes, filename)

        task_id = await self.create_task(audio_url, filename=filename)
        deadline = time.monotonic() + max_wait

        while time.monotonic() < deadline:
            result = await self.query_task(task_id)
            task_data = result.get("data", {})
            status = str(task_data.get("task_status", ""))
            # 1/2 处理中，其他为结束态
            if status not in {"1", "2"}:
                text = self._extract_text(result)
                if text.strip():
                    return text.strip()
                raise ValueError("未识别到有效语音，请靠近麦克风清晰说话后再试")
            await asyncio.sleep(poll_interval)

        raise TimeoutError("讯飞转写超时，请稍后重试")
