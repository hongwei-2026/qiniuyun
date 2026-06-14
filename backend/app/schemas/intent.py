from typing import Any, Literal

from pydantic import BaseModel, Field


class Point2D(BaseModel):
    x: float
    y: float


class BBox(BaseModel):
    left: float
    top: float
    width: float
    height: float


class SceneObject(BaseModel):
    id: str
    type: str
    label: str = ""
    color: str | None = None
    center: Point2D
    bbox: BBox
    radius: float | None = None
    selected: bool = False


class SceneCanvas(BaseModel):
    width: float
    height: float


class SceneGraph(BaseModel):
    canvas: SceneCanvas = Field(default_factory=lambda: SceneCanvas(width=800, height=600))
    objects: list[SceneObject] = Field(default_factory=list)


class CanvasContext(BaseModel):
    canvas_mode: Literal["free", "ai", "grid", "3d", "comic", "assets"] = "free"
    zoom: float = 1.0
    selected_cell: str | None = None
    grid_cells: list[str] = Field(default_factory=list)
    scene_graph: SceneGraph | None = None
    objects_summary: str = ""
    recent_commands: list[str] = Field(default_factory=list)


class IntentParseRequest(BaseModel):
    text: str
    context: CanvasContext = Field(default_factory=CanvasContext)
    mode: Literal["v4-pro", "flash", "chat", "auto"] | None = None
    auto_mode: bool = True


class ToolCall(BaseModel):
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class IntentParseResponse(BaseModel):
    optimized_text: str
    image_prompt: str | None = None
    track: Literal["system", "ai"] = "ai"
    intent: str = "unknown"
    tools: list[ToolCall] = Field(default_factory=list)
    reply: str = ""
    model_used: str = ""
    raw_model_output: str | None = None


class ExecutionResultItem(BaseModel):
    tool: str
    success: bool = True
    message: str = ""
    object_id: str | None = None
    center: Point2D | None = None
    bbox: BBox | None = None


class VerifyIntentRequest(BaseModel):
    text: str
    context: CanvasContext = Field(default_factory=CanvasContext)
    planned_tools: list[ToolCall] = Field(default_factory=list)
    execution_results: list[ExecutionResultItem] = Field(default_factory=list)
    mode: Literal["v4-pro", "flash", "chat", "auto"] | None = None


class VerifyIntentResponse(BaseModel):
    ok: bool = True
    reply: str = "已完成"
    correction_tools: list[ToolCall] = Field(default_factory=list)
    reason: str | None = None
    model_used: str = ""
