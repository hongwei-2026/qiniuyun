import struct
import wave
from io import BytesIO


def resample_wav_to_16k_mono(audio_bytes: bytes) -> bytes:
    """将浏览器录制的 wav 重采样为讯飞要求的 16kHz 单声道 PCM wav。"""
    with wave.open(BytesIO(audio_bytes), "rb") as src:
        channels = src.getnchannels()
        sample_width = src.getsampwidth()
        sample_rate = src.getframerate()
        frames = src.readframes(src.getnframes())

    if sample_width != 2:
        raise ValueError("仅支持 16-bit wav")

    count = len(frames) // 2
    samples = struct.unpack(f"<{count}h", frames)
    if channels > 1:
        merged = []
        for i in range(0, len(samples), channels):
            merged.append(sum(samples[i:i + channels]) // channels)
        samples = merged

    target_rate = 16000
    if sample_rate != target_rate and samples:
        ratio = sample_rate / target_rate
        new_len = max(1, int(len(samples) / ratio))
        resampled = []
        for i in range(new_len):
            pos = i * ratio
            idx = int(pos)
            frac = pos - idx
            a = samples[min(idx, len(samples) - 1)]
            b = samples[min(idx + 1, len(samples) - 1)]
            resampled.append(int(a + (b - a) * frac))
        samples = resampled

    out = BytesIO()
    with wave.open(out, "wb") as dst:
        dst.setnchannels(1)
        dst.setsampwidth(2)
        dst.setframerate(target_rate)
        dst.writeframes(struct.pack(f"<{len(samples)}h", *samples))
    return out.getvalue()


def wav_bytes_to_pcm(audio_bytes: bytes) -> bytes:
    """去掉 wav 头，返回 16-bit little-endian PCM。"""
    with wave.open(BytesIO(audio_bytes), "rb") as src:
        if src.getsampwidth() != 2:
            raise ValueError("仅支持 16-bit wav")
        return src.readframes(src.getnframes())
