from typing import Literal

import base64

import httpx

from app.config import Settings, get_settings
from app.schemas.image import ImageGenerateRequest, ImageGenerateResponse
from app.services.doubao_image import DoubaoImageService
from app.services.minimax_image import MinimaxImageService


async def _urls_to_base64(urls: list[str]) -> list[str]:
    """服务端拉取外链图片并转 base64，避免前端画布跨域污染无法导出。"""
    encoded: list[str] = []
    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
        for url in urls:
            response = await client.get(url)
            response.raise_for_status()
            encoded.append(base64.b64encode(response.content).decode())
    return encoded


class ImageService:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self.minimax = MinimaxImageService(self.settings)
        self.doubao = DoubaoImageService(self.settings)

    def _resolve_provider(
        self, provider: Literal["minimax", "doubao", "auto"]
    ) -> Literal["minimax", "doubao"]:
        if provider != "auto":
            return provider
        return self.settings.image_provider

    async def _generate_doubao_base64(self, request: ImageGenerateRequest) -> ImageGenerateResponse:
        images = await self.doubao.generate(
            prompt=request.prompt,
            size=request.size,
            reference_image_url=request.reference_image_url,
            reference_image_base64=request.reference_image_base64,
        )
        images_b64 = await _urls_to_base64(images)
        return ImageGenerateResponse(
            images=images_b64,
            format="base64",
            provider="doubao",
            prompt=request.prompt,
        )

    async def generate(self, request: ImageGenerateRequest) -> ImageGenerateResponse:
        provider = self._resolve_provider(request.provider)

        if provider == "minimax":
            try:
                images = await self.minimax.generate(
                    prompt=request.prompt,
                    aspect_ratio=request.aspect_ratio,
                    reference_image_url=request.reference_image_url,
                    reference_image_base64=request.reference_image_base64,
                )
                return ImageGenerateResponse(
                    images=images,
                    format="base64",
                    provider="minimax",
                    prompt=request.prompt,
                )
            except ValueError as exc:
                if self.settings.ark_api_key:
                    try:
                        return await self._generate_doubao_base64(request)
                    except Exception:
                        raise exc from None
                raise

        images = await self.doubao.generate(
            prompt=request.prompt,
            size=request.size,
            reference_image_url=request.reference_image_url,
            reference_image_base64=request.reference_image_base64,
        )
        images_b64 = await _urls_to_base64(images)
        return ImageGenerateResponse(
            images=images_b64,
            format="base64",
            provider="doubao",
            prompt=request.prompt,
        )
