from openai import OpenAI

from app.config import Settings, get_settings


def _normalize_ref_data_uri(reference_image_base64: str | None) -> str | None:
    if not reference_image_base64:
        return None
    raw = reference_image_base64.strip()
    if raw.startswith("data:"):
        return raw
    return f"data:image/jpeg;base64,{raw}"


class DoubaoImageService:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self._client: OpenAI | None = None

    @property
    def client(self) -> OpenAI:
        if self._client is None:
            if not self.settings.ark_api_key:
                raise ValueError("ARK_API_KEY 未配置")
            self._client = OpenAI(
                api_key=self.settings.ark_api_key,
                base_url=self.settings.ark_base_url,
            )
        return self._client

    async def generate(
        self,
        prompt: str,
        size: str = "2K",
        reference_image_url: str | None = None,
        reference_image_base64: str | None = None,
    ) -> list[str]:
        ref_uri = reference_image_url
        if not ref_uri and reference_image_base64:
            ref_uri = _normalize_ref_data_uri(reference_image_base64)

        extra_body: dict = {"watermark": True}
        if ref_uri:
            # Seedream 图生图：以参考图保持画风/角色一致
            extra_body["image"] = ref_uri
            prompt = (
                f"{prompt}. Keep the same art style, character design and visual quality "
                "as the reference image. Seamless continuation."
            )

        kwargs: dict = {
            "model": self.settings.ark_image_model,
            "prompt": prompt,
            "size": size,
            "response_format": "url",
            "extra_body": extra_body,
        }

        response = self.client.images.generate(**kwargs)
        urls = [item.url for item in response.data if item.url]
        if not urls:
            raise ValueError("豆包未返回图片 URL")
        return urls
