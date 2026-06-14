from typing import Literal

from pydantic import BaseModel, Field


class Model3DCreateRequest(BaseModel):
    image_url: str | None = None
    image_base64: str | None = None
    prompt: str = ""
    file_format: Literal["obj", "glb", "fbx", "usdz"] = "obj"
    subdivision_level: Literal["low", "medium", "high"] = "high"
    wait: bool = True
    poll_interval: float = 3.0
    max_wait: float = 300.0


class Model3DTaskResponse(BaseModel):
    task_id: str
    status: str
    model_url: str | None = None
    file_format: str = "obj"
    message: str = ""
    raw: dict | None = None


class Model3DStatusRequest(BaseModel):
    task_id: str
