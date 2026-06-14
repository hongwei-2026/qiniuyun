import json
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.schemas.comic import (
    CharacterGenerateRequest,
    CharacterGenerateResponse,
    EpisodeReviseRequest,
    EpisodeScriptRequest,
    EpisodeScriptResponse,
)
from app.services.deepseek import DeepSeekService

router = APIRouter(prefix="/api/v1/comic", tags=["comic"])

_character_prompt = (Path(__file__).parent.parent / "prompts" / "comic_character.txt").read_text(
    encoding="utf-8"
)
_episode_prompt = (Path(__file__).parent.parent / "prompts" / "comic_episode.txt").read_text(
    encoding="utf-8"
)
_revise_prompt = (Path(__file__).parent.parent / "prompts" / "comic_episode_revise.txt").read_text(
    encoding="utf-8"
)


def _parse_json_content(raw: str) -> dict:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail=f"AI 返回格式错误: {exc}") from exc


def _normalize_panels(raw_panels: list) -> list:
    from app.schemas.comic import ComicPanel

    panels: list[ComicPanel] = []
    for i, item in enumerate(raw_panels):
        if not isinstance(item, dict):
            continue
        chars = item.get("characters") or []
        panels.append(
            ComicPanel(
                index=int(item.get("index") or i + 1),
                caption=str(item.get("caption") or ""),
                scene=str(item.get("scene") or ""),
                dialogue=str(item.get("dialogue") or ""),
                characters=[str(c) for c in chars if c is not None],
                is_title_page=bool(item.get("is_title_page", i == 0)),
            )
        )
    return panels


@router.post("/character", response_model=CharacterGenerateResponse)
async def generate_character(body: CharacterGenerateRequest):
    service = DeepSeekService()
    user_msg = f"角色描述：{body.description}\n画风：{body.style}"
    if body.existing_name:
        user_msg += f"\n指定角色名：{body.existing_name}"
    try:
        resp = service.client.chat.completions.create(
            model=service._resolve_mode("flash"),
            messages=[
                {"role": "system", "content": _character_prompt},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.4,
        )
        content = resp.choices[0].message.content or "{}"
        data = _parse_json_content(content)
        return CharacterGenerateResponse(
            name=str(data.get("name") or body.existing_name or "角色"),
            description=str(data.get("description") or body.description),
            personality=str(data.get("personality") or ""),
            catchphrase=str(data.get("catchphrase") or ""),
            sample_dialogues=[
                str(line).strip()
                for line in (data.get("sample_dialogues") or [])
                if str(line).strip()
            ],
            style=str(data.get("style") or body.style),
            image_prompt=str(data.get("image_prompt") or body.description),
        )
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"角色生成失败: {exc}") from exc


@router.post("/episode-script", response_model=EpisodeScriptResponse)
async def generate_episode_script(body: EpisodeScriptRequest):
    service = DeepSeekService()
    chars_text = "\n".join(
        f"- {c.name}: {c.description} | 性格: {c.personality}"
        for c in body.characters
    )
    prev_text = "\n".join(
        f"第{e.episode_number}集《{e.title}》: {e.synopsis}\n{e.script[:400]}"
        for e in body.previous_episodes
    )
    user_msg = (
        f"第 {body.episode_number} 集\n"
        f"用户梗概：{body.synopsis or '请根据角色和前情自动构思'}\n"
        f"画风：{body.style}\n"
        f"角色设定：\n{chars_text or '（暂无，请自创）'}\n"
        f"前几集剧情：\n{prev_text or '（第一集，无前情）'}"
    )
    try:
        resp = service.client.chat.completions.create(
            model=service._resolve_mode("flash"),
            messages=[
                {"role": "system", "content": _episode_prompt},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.5,
        )
        content = resp.choices[0].message.content or "{}"
        data = _parse_json_content(content)
        panels = _normalize_panels(data.get("panels") or [])
        return EpisodeScriptResponse(
            title=str(data.get("title") or f"第{body.episode_number}集"),
            synopsis=str(data.get("synopsis") or body.synopsis),
            script=str(data.get("script") or ""),
            panels=panels,
        )
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"剧本生成失败: {exc}") from exc


@router.post("/episode-revise", response_model=EpisodeScriptResponse)
async def revise_episode_script(body: EpisodeReviseRequest):
    service = DeepSeekService()
    chars_text = "\n".join(
        f"- {c.name}: {c.description} | 性格: {c.personality}"
        for c in body.characters
    )
    prev_text = "\n".join(
        f"第{e.episode_number}集《{e.title}》: {e.synopsis}"
        for e in body.previous_episodes
    )
    user_msg = (
        f"第 {body.episode_number} 集修订\n"
        f"用户修改意见：{body.revision}\n"
        f"当前标题：{body.current_title}\n"
        f"当前梗概：{body.current_synopsis}\n"
        f"当前剧本：\n{body.current_script}\n"
        f"角色设定：\n{chars_text}\n"
        f"前几集：\n{prev_text or '（无）'}"
    )
    try:
        resp = service.client.chat.completions.create(
            model=service._resolve_mode("flash"),
            messages=[
                {"role": "system", "content": _revise_prompt},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.45,
        )
        content = resp.choices[0].message.content or "{}"
        data = _parse_json_content(content)
        panels = _normalize_panels(data.get("panels") or [])
        return EpisodeScriptResponse(
            title=str(data.get("title") or body.current_title),
            synopsis=str(data.get("synopsis") or body.current_synopsis),
            script=str(data.get("script") or body.current_script),
            panels=panels,
        )
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"剧本修订失败: {exc}") from exc
