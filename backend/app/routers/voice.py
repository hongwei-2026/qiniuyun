from fastapi import APIRouter, File, HTTPException, UploadFile

from app.config import get_settings
from app.services.audio_convert import resample_wav_to_16k_mono, wav_bytes_to_pcm
from app.services.xfyun_asr import XfyunAsrService
from app.services.xfyun_iat_auth import build_iat_ws_url

router = APIRouter(prefix="/api/v1/voice", tags=["voice"])


@router.get("/iat-auth")
async def get_iat_auth():
    settings = get_settings()
    if not settings.xfyun_app_id:
        raise HTTPException(status_code=400, detail="讯飞 ASR 未配置")
    try:
        auth = build_iat_ws_url(settings)
        return {"provider": "xfyun_iat", **auth}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    settings = get_settings()
    if not settings.xfyun_app_id:
        raise HTTPException(status_code=400, detail="讯飞 ASR 未配置")

    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="音频文件为空")

    filename = file.filename or "audio.wav"
    if filename.endswith(".wav") or audio_bytes[:4] == b"RIFF":
        try:
            audio_bytes = resample_wav_to_16k_mono(audio_bytes)
            audio_bytes = wav_bytes_to_pcm(audio_bytes)
            filename = "utterance.pcm"
        except Exception:
            pass

    try:
        service = XfyunAsrService()
        text = await service.transcribe_bytes(
            audio_bytes,
            filename=filename,
        )
        return {"text": text, "provider": "xfyun"}
    except TimeoutError as e:
        raise HTTPException(status_code=504, detail=str(e)) from e
    except ValueError as e:
        msg = str(e)
        if "未识别到有效语音" in msg or "20304" in msg:
            return {"text": "", "provider": "xfyun"}
        raise HTTPException(status_code=400, detail=msg) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"讯飞转写失败: {e}") from e
