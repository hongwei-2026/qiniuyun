from typing import Literal

from pydantic import BaseModel, Field


class ImageGenerateRequest(BaseModel):
    prompt: str
    aspect_ratio: str = "1:1"
    provider: Literal["minimax", "doubao", "auto"] = "auto"
    size: str = "2K"
    reference_image_url: str | None = None
    reference_image_base64: str | None = None


class ImageGenerateResponse(BaseModel):
    images: list[str] = Field(description="base64 encoded images or URLs")
    format: Literal["base64", "url"] = "base64"
    provider: str
    prompt: str
