import json
from pathlib import Path
from typing import Any

from openai import OpenAI

from app.config import Settings, get_settings
from app.schemas.intent import (
    CanvasContext,
    IntentParseResponse,
    ToolCall,
    VerifyIntentRequest,
    VerifyIntentResponse,
)
from app.services.tool_schemas import DRAWING_TOOLS, VERIFY_TOOLS, get_tools_for_mode


class DeepSeekService:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self._client: OpenAI | None = None
        self._planner_prompt = (
            Path(__file__).parent.parent / "prompts" / "planner_system.txt"
        ).read_text(encoding="utf-8")
        self._grid_optimize_prompt = (
            Path(__file__).parent.parent / "prompts" / "grid_optimize.txt"
        ).read_text(encoding="utf-8")
        self._verifier_prompt = (
            Path(__file__).parent.parent / "prompts" / "verifier_system.txt"
        ).read_text(encoding="utf-8")
        self._comic_planner_prompt = (
            Path(__file__).parent.parent / "prompts" / "comic_planner_system.txt"
        ).read_text(encoding="utf-8")

    @property
    def client(self) -> OpenAI:
        if self._client is None:
            if not self.settings.deepseek_api_key:
                raise ValueError("DEEPSEEK_API_KEY 未配置")
            self._client = OpenAI(
                api_key=self.settings.deepseek_api_key,
                base_url=self.settings.deepseek_base_url,
            )
        return self._client

    def _resolve_mode(self, mode: str | None) -> str:
        if mode:
            mapping = {
                "v4-pro": "deepseek-v4-pro",
                "flash": "deepseek-chat",
                "chat": "deepseek-chat",
                "auto": "deepseek-chat",
            }
            return mapping.get(mode, self.settings.deepseek_model)
        return self.settings.deepseek_model

    def _mode_label(self, mode: str | None) -> str:
        return mode or self.settings.deepseek_mode

    def _kwargs_for_model(self, model: str, mode: str | None) -> dict[str, Any]:
        kwargs: dict[str, Any] = {"temperature": 0.1}
        if model == "deepseek-v4-pro":
            kwargs["reasoning_effort"] = self.settings.deepseek_reasoning_effort
            extra = self.settings.deepseek_extra_body()
            if extra:
                kwargs["extra_body"] = extra
        return kwargs

    def _tool_choice_for_model(self, model: str) -> str:
        # v4-pro thinking mode rejects tool_choice="required"
        return "auto" if model == "deepseek-v4-pro" else "required"

    def _context_payload(self, context: CanvasContext) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "canvas_mode": context.canvas_mode,
            "zoom": context.zoom,
            "selected_cell": context.selected_cell,
            "grid_cells": context.grid_cells,
            "recent_commands": context.recent_commands[-5:],
        }
        if context.scene_graph:
            payload["scene_graph"] = context.scene_graph.model_dump()
        if context.objects_summary:
            payload["objects_summary"] = context.objects_summary
        return payload

    def _parse_tool_calls(self, message: Any) -> list[ToolCall]:
        tools: list[ToolCall] = []
        tool_calls = getattr(message, "tool_calls", None) or []
        for call in tool_calls:
            fn = call.function
            if not fn or not fn.name:
                continue
            raw_args = fn.arguments or "{}"
            try:
                args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
            except json.JSONDecodeError:
                args = {}
            if not isinstance(args, dict):
                args = {}
            tools.append(ToolCall(name=fn.name, arguments=args))
        return tools

    def _canvas_control_reply(self, tool: ToolCall) -> str:
        action = str((tool.arguments or {}).get("action") or "")
        labels = {
            "zoom_in": "已放大",
            "zoom_out": "已缩小",
            "fit_window": "已适应窗口",
            "reset_view": "视图已复位",
            "clear": "画布已清空",
            "pan_left": "画布已左移",
            "pan_right": "画布已右移",
            "pan_up": "画布已上移",
            "pan_down": "画布已下移",
        }
        return labels.get(action, "已完成")

    def _extract_reply(self, message: Any, tools: list[ToolCall]) -> str:
        content = (getattr(message, "content", None) or "").strip()
        if content:
            return content
        if not tools:
            return "好的"
        labels = {
            "draw_shape": "已绘制",
            "draw_path": "已绘制路径",
            "select_object": "已选中",
            "save_canvas": "已保存",
            "set_style": "样式已更新",
            "object_transform": "变换完成",
            "canvas_control": self._canvas_control_reply(tools[0]),
            "delete_object": "已删除",
            "grid_redraw": "格子已重绘",
            "grid_expand": "格子已扩展",
            "ai_generate": "AI 图片已生成",
            "batch_grid": "批量绘制完成",
        }
        if len(tools) == 1:
            return labels.get(tools[0].name, "已完成")
        return f"已完成{len(tools)}步操作"

    def _parse_json_content(self, content: str) -> dict[str, Any]:
        text = content.strip()
        if text.startswith("```"):
            text = text.split("```", 2)[1]
            if text.startswith("json"):
                text = text[4:]
        try:
            data = json.loads(text)
            return data if isinstance(data, dict) else {}
        except json.JSONDecodeError:
            return {}

    async def _optimize_grid_speech(
        self, text: str, context: CanvasContext, mode: str | None = None
    ) -> dict[str, Any]:
        model = self._resolve_mode(mode)
        user_content = json.dumps(
            {
                "user_speech": text,
                "selected_cell": context.selected_cell,
                "grid_cells": context.grid_cells,
                "recent_commands": context.recent_commands[-3:],
            },
            ensure_ascii=False,
        )
        messages = [
            {"role": "system", "content": self._grid_optimize_prompt},
            {"role": "user", "content": user_content},
        ]
        kwargs = self._kwargs_for_model(model, mode)
        response = self.client.chat.completions.create(
            model=model,
            messages=messages,
            stream=False,
            **kwargs,
        )
        message = response.choices[0].message
        content = (getattr(message, "content", None) or "").strip()
        data = self._parse_json_content(content)
        if not data:
            return {"optimized_text": text, "image_prompt": None, "action": "none"}
        optimized = str(data.get("optimized_text") or text).strip()
        image_prompt = data.get("image_prompt")
        if image_prompt is not None:
            image_prompt = str(image_prompt).strip() or None
        return {
            "optimized_text": optimized,
            "image_prompt": image_prompt,
            "action": str(data.get("action") or "none"),
            "from_cell": data.get("from_cell"),
            "direction": data.get("direction"),
            "cell": data.get("cell"),
        }

    def _inject_grid_image_prompt(
        self, tools: list[ToolCall], image_prompt: str | None
    ) -> list[ToolCall]:
        if not image_prompt:
            return tools
        paint_tools = {
            "grid_redraw",
            "grid_expand",
            "grid_expand_region",
            "grid_inpaint",
            "grid_fill",
            "batch_grid",
            "style_sync",
            "character_turnaround",
        }
        for tool in tools:
            if tool.name not in paint_tools:
                continue
            current = str(tool.arguments.get("prompt") or "").strip()
            if not current or len(current) < 24 or current == tool.arguments.get("raw_speech"):
                tool.arguments["prompt"] = image_prompt
        return tools

    def _inject_grid_intent_args(
        self,
        tools: list[ToolCall],
        grid_intent: dict[str, Any],
        image_prompt: str | None = None,
    ) -> list[ToolCall]:
        if not tools or not grid_intent:
            return tools
        action = str(grid_intent.get("action") or "")
        for tool in tools:
            if tool.name == "grid_expand":
                if grid_intent.get("from_cell") and not tool.arguments.get("from_cell"):
                    tool.arguments["from_cell"] = grid_intent["from_cell"]
                if grid_intent.get("direction") and not tool.arguments.get("direction"):
                    tool.arguments["direction"] = grid_intent["direction"]
            if tool.name in ("grid_redraw", "grid_inpaint") and grid_intent.get("cell"):
                if not tool.arguments.get("cell"):
                    tool.arguments["cell"] = grid_intent["cell"]
        if action == "expand" and any(t.name == "grid_redraw" for t in tools):
            # 扩图误走 redraw 时，纠正为 expand
            redraw = next(t for t in tools if t.name == "grid_redraw")
            tools = [
                ToolCall(
                    name="grid_expand",
                    arguments={
                        "from_cell": grid_intent.get("from_cell") or redraw.arguments.get("cell"),
                        "direction": grid_intent.get("direction") or "up",
                        "prompt": redraw.arguments.get("prompt") or grid_intent.get("image_prompt"),
                        "seamless": True,
                    },
                )
            ]
        expand_map = {
            "expand_top": "up",
            "expand_bottom": "down",
            "expand_left": "left",
            "expand_right": "right",
        }
        remapped: list[ToolCall] = []
        for tool in tools:
            if tool.name == "canvas_control":
                act = str(tool.arguments.get("action") or "")
                if act in expand_map:
                    target = "grid_expand_region" if action == "expand_region" else "grid_expand"
                    remapped.append(
                        ToolCall(
                            name=target,
                            arguments={
                                "from_cell": grid_intent.get("from_cell") or tool.arguments.get("from_cell"),
                                "direction": expand_map[act],
                                "prompt": image_prompt or tool.arguments.get("prompt"),
                                "count": tool.arguments.get("count", 1),
                                "fill_mode": "turnaround" if action == "character_turnaround" else None,
                            },
                        )
                    )
                    continue
            remapped.append(tool)
        return remapped

    async def parse_intent(
        self, text: str, context: CanvasContext, mode: str | None = None
    ) -> IntentParseResponse:
        model = self._resolve_mode(mode)
        optimized_text = text
        image_prompt: str | None = None
        grid_intent: dict[str, Any] = {}

        if context.canvas_mode == "grid":
            grid_intent = await self._optimize_grid_speech(text, context, mode)
            optimized_text = str(grid_intent.get("optimized_text") or text).strip()
            image_prompt = grid_intent.get("image_prompt")

        payload: dict[str, Any] = {
            "user_speech": text,
            "context": self._context_payload(context),
        }
        if grid_intent:
            payload["optimized_speech"] = optimized_text
            payload["image_prompt"] = image_prompt
            payload["grid_intent"] = grid_intent

        user_content = json.dumps(payload, ensure_ascii=False)
        planner_prompt = (
            self._comic_planner_prompt
            if context.canvas_mode == "comic"
            else self._planner_prompt
        )
        messages = [
            {"role": "system", "content": planner_prompt},
            {"role": "user", "content": user_content},
        ]
        kwargs = self._kwargs_for_model(model, mode)
        tools = get_tools_for_mode(context.canvas_mode)
        response = self.client.chat.completions.create(
            model=model,
            messages=messages,
            tools=tools,
            tool_choice=self._tool_choice_for_model(model),
            stream=False,
            **kwargs,
        )
        message = response.choices[0].message
        parsed_tools = self._parse_tool_calls(message)
        if not parsed_tools:
            content = (getattr(message, "content", None) or "").strip()
            if content:
                raw = message.model_dump_json() if hasattr(message, "model_dump_json") else str(message)
                return IntentParseResponse(
                    optimized_text=optimized_text,
                    image_prompt=image_prompt,
                    track="system",
                    intent="control",
                    tools=[],
                    reply=content,
                    model_used=self._mode_label(mode),
                    raw_model_output=raw,
                )
            raise ValueError("模型未返回工具调用，请换个说法或检查 DEEPSEEK_API_KEY")
        parsed_tools = self._inject_grid_intent_args(parsed_tools, grid_intent, image_prompt)
        parsed_tools = self._inject_grid_image_prompt(parsed_tools, image_prompt)
        raw = message.model_dump_json() if hasattr(message, "model_dump_json") else str(message)
        return IntentParseResponse(
            optimized_text=optimized_text,
            image_prompt=image_prompt,
            track="system",
            intent="draw" if any(t.name.startswith("draw") for t in parsed_tools) else "control",
            tools=parsed_tools,
            reply=self._extract_reply(message, parsed_tools),
            model_used=self._mode_label(mode),
            raw_model_output=raw,
        )

    async def verify_execution(self, request: VerifyIntentRequest) -> VerifyIntentResponse:
        model = self._resolve_mode(request.mode or "v4-pro")
        user_content = json.dumps(
            {
                "user_speech": request.text,
                "context": self._context_payload(request.context),
                "planned_tools": [t.model_dump() for t in request.planned_tools],
                "execution_results": [r.model_dump() for r in request.execution_results],
            },
            ensure_ascii=False,
        )
        messages = [
            {"role": "system", "content": self._verifier_prompt},
            {"role": "user", "content": user_content},
        ]
        kwargs = self._kwargs_for_model(model, request.mode)
        response = self.client.chat.completions.create(
            model=model,
            messages=messages,
            tools=VERIFY_TOOLS,
            tool_choice=self._tool_choice_for_model(model),
            stream=False,
            **kwargs,
        )
        message = response.choices[0].message
        tool_calls = getattr(message, "tool_calls", None) or []
        if not tool_calls:
            return VerifyIntentResponse(ok=True, reply="已完成", model_used=self._mode_label(request.mode))

        fn = tool_calls[0].function
        name = fn.name if fn else ""
        try:
            args = json.loads(fn.arguments or "{}") if fn else {}
        except json.JSONDecodeError:
            args = {}

        if name == "confirm_execution":
            return VerifyIntentResponse(
                ok=True,
                reply=str(args.get("reply", "已完成")),
                model_used=self._mode_label(request.mode),
            )

        correction_tools = [
            ToolCall(name=t["name"], arguments=t.get("arguments", {}))
            for t in args.get("tools", [])
            if isinstance(t, dict) and "name" in t
        ]
        return VerifyIntentResponse(
            ok=len(correction_tools) == 0,
            reply=str(args.get("reply", "已修正")),
            correction_tools=correction_tools,
            reason=str(args.get("reason", "")),
            model_used=self._mode_label(request.mode),
        )
