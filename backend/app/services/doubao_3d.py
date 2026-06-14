import asyncio
import time
from typing import Any

import httpx

from app.config import Settings, get_settings
from app.schemas.model3d import Model3DCreateRequest, Model3DTaskResponse


class Doubao3DService:
    TERMINAL_STATUSES = {"succeeded", "success", "completed", "done", "failed", "cancelled", "canceled", "error"}

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    def _headers(self) -> dict[str, str]:
        if not self.settings.ark_api_key:
            raise ValueError("ARK_API_KEY 未配置")
        return {
            "Authorization": f"Bearer {self.settings.ark_api_key}",
            "Content-Type": "application/json",
        }

    def _build_text_prompt(self, request: Model3DCreateRequest) -> str:
        if request.prompt.strip():
            return request.prompt.strip()
        return f" --subdivisionlevel {request.subdivision_level} --fileformat {request.file_format}"

    def _resolve_image_url(self, request: Model3DCreateRequest) -> str:
        if request.image_url:
            return request.image_url
        if request.image_base64:
            b64 = request.image_base64
            if b64.startswith("data:"):
                return b64
            return f"data:image/jpeg;base64,{b64}"
        raise ValueError("需要提供 image_url 或 image_base64")

    def _tasks_url(self, task_id: str | None = None) -> str:
        base = self.settings.ark_base_url.rstrip("/")
        if task_id:
            return f"{base}/contents/generations/tasks/{task_id}"
        return f"{base}/contents/generations/tasks"

    async def create_task(self, request: Model3DCreateRequest) -> Model3DTaskResponse:
        image_url = self._resolve_image_url(request)
        payload = {
            "model": self.settings.ark_3d_model,
            "content": [
                {"type": "text", "text": self._build_text_prompt(request)},
                {"type": "image_url", "image_url": {"url": image_url}},
            ],
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                self._tasks_url(),
                headers=self._headers(),
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

        task_id = self._extract_task_id(data)
        if not task_id:
            raise ValueError(f"3D 任务创建失败，未返回 task_id: {data}")

        return Model3DTaskResponse(
            task_id=task_id,
            status=self._normalize_status(data),
            model_url=self._extract_model_url(data),
            file_format=request.file_format,
            message="3D 任务已创建",
            raw=data,
        )

    async def get_task(self, task_id: str) -> Model3DTaskResponse:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(
                self._tasks_url(task_id),
                headers=self._headers(),
            )
            response.raise_for_status()
            data = response.json()

        return Model3DTaskResponse(
            task_id=task_id,
            status=self._normalize_status(data),
            model_url=self._extract_model_url(data),
            file_format=self._extract_file_format(data),
            message=self._extract_message(data),
            raw=data,
        )

    async def delete_task(self, task_id: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.delete(
                self._tasks_url(task_id),
                headers=self._headers(),
            )
            response.raise_for_status()
            if response.content:
                return response.json()
            return {"task_id": task_id, "status": "deleted"}

    async def generate_and_wait(self, request: Model3DCreateRequest) -> Model3DTaskResponse:
        created = await self.create_task(request)
        if not request.wait:
            return created

        deadline = time.monotonic() + request.max_wait
        latest = created

        while time.monotonic() < deadline:
            latest = await self.get_task(created.task_id)
            status = latest.status.lower()
            if status in {"succeeded", "success", "completed", "done"}:
                latest.message = "3D 模型生成完成"
                return latest
            if status in {"failed", "cancelled", "canceled", "error"}:
                latest.message = latest.message or f"3D 任务失败: {status}"
                return latest
            await asyncio.sleep(request.poll_interval)

        latest.message = "3D 任务超时，请稍后查询任务状态"
        return latest

    def _extract_task_id(self, data: dict[str, Any]) -> str | None:
        for key in ("id", "task_id"):
            if data.get(key):
                return str(data[key])
        task = data.get("task")
        if isinstance(task, dict) and task.get("id"):
            return str(task["id"])
        return None

    def _normalize_status(self, data: dict[str, Any]) -> str:
        for key in ("status", "state", "task_status"):
            if data.get(key):
                return str(data[key]).lower()
        task = data.get("task")
        if isinstance(task, dict):
            for key in ("status", "state"):
                if task.get(key):
                    return str(task[key]).lower()
        return "pending"

    def _extract_model_url(self, data: dict[str, Any]) -> str | None:
        candidates: list[Any] = []

        def walk(obj: Any) -> None:
            if isinstance(obj, dict):
                for key, value in obj.items():
                    if key in {"url", "model_url", "file_url", "download_url"} and isinstance(value, str):
                        candidates.append(value)
                    else:
                        walk(value)
            elif isinstance(obj, list):
                for item in obj:
                    walk(item)

        walk(data)
        for url in candidates:
            if url.startswith("http") or url.endswith((".obj", ".glb", ".fbx", ".usdz")):
                return url
        return candidates[0] if candidates else None

    def _extract_file_format(self, data: dict[str, Any]) -> str:
        url = self._extract_model_url(data) or ""
        for ext in ("obj", "glb", "fbx", "usdz"):
            if f".{ext}" in url.lower():
                return ext
        return "obj"

    def _extract_message(self, data: dict[str, Any]) -> str:
        for key in ("message", "error", "fail_reason"):
            if data.get(key):
                return str(data[key])
        return ""
