import base64
import logging

import httpx

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)

MAX_PROMPT_LEN = 1500


class MinimaxImageService:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    def _extract_images(self, data: dict) -> list[str]:
        block = data.get("data") or {}
        if not isinstance(block, dict):
            return []
        images = block.get("image_base64") or []
        if images:
            return [img for img in images if isinstance(img, str) and img.strip()]
        return []

    def _failure_detail(self, data: dict) -> str:
        meta = data.get("metadata") or {}
        failed = meta.get("failed_count")
        success = meta.get("success_count")
        if failed not in (None, "0", 0):
            return f"生成失败 {failed} 张（成功 {success or 0} 张）"
        base = data.get("base_resp") or {}
        msg = base.get("status_msg")
        if msg and base.get("status_code") not in (None, 0):
            return str(msg)
        return "接口未返回图片数据"

    async def _download_url_images(self, urls: list[str]) -> list[str]:
        encoded: list[str] = []
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            for url in urls:
                if not url:
                    continue
                response = await client.get(url)
                response.raise_for_status()
                encoded.append(base64.b64encode(response.content).decode())
        return encoded

    async def _request(self, payload: dict) -> dict:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                self.settings.minimax_image_url,
                headers={"Authorization": f"Bearer {self.settings.minimax_api_key}"},
                json=payload,
            )
            response.raise_for_status()
            return response.json()

    async def generate(
        self,
        prompt: str,
        aspect_ratio: str = "1:1",
        reference_image_url: str | None = None,
        reference_image_base64: str | None = None,
    ) -> list[str]:
        if not self.settings.minimax_api_key:
            raise ValueError("MINIMAX_API_KEY 未配置")

        prompt = prompt.strip()[:MAX_PROMPT_LEN]
        if not prompt:
            raise ValueError("prompt 不能为空")

        payload: dict = {
            "model": self.settings.minimax_image_model,
            "prompt": prompt,
            "aspect_ratio": aspect_ratio,
            "response_format": "base64",
            "n": 1,
        }

        if reference_image_url or reference_image_base64:
            ref = reference_image_url
            if reference_image_base64 and not ref:
                raw = reference_image_base64.strip()
                if raw.startswith("data:"):
                    ref = raw
                else:
                    ref = f"data:image/jpeg;base64,{raw}"
            payload["subject_reference"] = [
                {"type": "character", "image_file": ref}
            ]
            payload["prompt"] = (
                f"{prompt}. Keep the exact same art style, character appearance "
                "and illustration quality as the reference image."
            )[:MAX_PROMPT_LEN]

        last_data: dict | None = None
        for attempt in range(2):
            body = dict(payload)
            if attempt == 1:
                body["prompt_optimizer"] = True

            data = await self._request(body)
            last_data = data

            base_resp = data.get("base_resp") or {}
            if base_resp.get("status_code") not in (None, 0):
                raise ValueError(
                    base_resp.get("status_msg")
                    or f"MiniMax 错误码 {base_resp.get('status_code')}"
                )

            images = self._extract_images(data)
            if images:
                return images

            block = data.get("data") or {}
            urls = block.get("image_urls") if isinstance(block, dict) else None
            if urls:
                downloaded = await self._download_url_images(urls)
                if downloaded:
                    return downloaded

            logger.warning(
                "MiniMax empty image response (attempt %s): %s",
                attempt + 1,
                data,
            )

        detail = self._failure_detail(last_data or {})
        raise ValueError(f"MiniMax 未返回图片: {detail}")
