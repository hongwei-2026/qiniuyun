from fastapi import APIRouter, HTTPException

from app.schemas.image import ImageGenerateRequest, ImageGenerateResponse
from app.services.image_service import ImageService

router = APIRouter(prefix="/api/v1/image", tags=["image"])


@router.post("/generate", response_model=ImageGenerateResponse)
async def generate_image(request: ImageGenerateRequest) -> ImageGenerateResponse:
    if not request.prompt.strip():
        raise HTTPException(status_code=400, detail="prompt 不能为空")
    try:
        service = ImageService()
        return await service.generate(request)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"图片生成失败: {e}") from e
