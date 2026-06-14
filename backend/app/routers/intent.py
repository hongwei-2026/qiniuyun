from fastapi import APIRouter, HTTPException

from app.schemas.intent import (
    IntentParseRequest,
    IntentParseResponse,
    VerifyIntentRequest,
    VerifyIntentResponse,
)
from app.services.deepseek import DeepSeekService

router = APIRouter(prefix="/api/v1/intent", tags=["intent"])


@router.post("/parse", response_model=IntentParseResponse)
async def parse_intent(request: IntentParseRequest) -> IntentParseResponse:
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="文本不能为空")
    try:
        service = DeepSeekService()
        return await service.parse_intent(
            text=request.text.strip(),
            context=request.context,
            mode=request.mode,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"意图解析失败: {e}") from e


@router.post("/verify", response_model=VerifyIntentResponse)
async def verify_intent(request: VerifyIntentRequest) -> VerifyIntentResponse:
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="文本不能为空")
    try:
        service = DeepSeekService()
        return await service.verify_execution(request)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"执行验收失败: {e}") from e
