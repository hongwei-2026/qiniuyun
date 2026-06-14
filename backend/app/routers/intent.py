"""
意图解析路由 - 将自然语言转换为结构化工具调用

核心流程：
1. 用户语音 → ASR 转写为文本
2. 文本 → DeepSeek LLM → 工具调用序列
3. 工具调用 → 前端执行器 → 画布操作
4. 执行结果 → 验证器 → 修正补充
"""

from fastapi import APIRouter, HTTPException

from app.schemas.intent import (
    IntentParseRequest,
    IntentParseResponse,
    VerifyIntentRequest,
    VerifyIntentResponse,
)
from app.services.deepseek import DeepSeekService

# 创建路由实例，前缀为 /api/v1/intent
router = APIRouter(prefix="/api/v1/intent", tags=["intent"])


@router.post("/parse", response_model=IntentParseResponse)
async def parse_intent(request: IntentParseRequest) -> IntentParseResponse:
    """
    解析用户语音意图，生成工具调用序列

    请求参数：
    - text: 用户语音转写文本
    - context: 画布上下文（当前模式、选中对象、最近指令等）
    - mode: LLM 模式（flash 快速 / v4-pro 深度推理）

    返回内容：
    - tools: 待执行的工具调用列表
    - reply: 给用户的语音回复
    - optimized_text: 优化后的指令文本
    - image_prompt: 九宫格/漫画模式的生图提示词
    """
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
        # 用户输入错误（如空文本、格式错误）返回 400
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        # 服务端错误返回 500
        raise HTTPException(status_code=500, detail=f"意图解析失败: {e}") from e


@router.post("/verify", response_model=VerifyIntentResponse)
async def verify_intent(request: VerifyIntentRequest) -> VerifyIntentResponse:
    """
    验证工具执行结果，必要时生成修正指令

    用途：复杂指令执行后，让 LLM 检查是否满足用户需求
    例如：用户说"画一个红色圆形在左上角"，执行后验证位置是否正确
    """
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="文本不能为空")
    try:
        service = DeepSeekService()
        return await service.verify_execution(request)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"执行验收失败: {e}") from e
