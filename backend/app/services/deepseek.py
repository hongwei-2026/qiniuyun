"""
DeepSeek LLM 服务 - 意图解析与执行验证核心模块

职责：
1. 意图解析：将自然语言指令转换为结构化工具调用序列
2. 九宫格优化：专门优化九宫格模式的语音指令理解
3. 执行验证：检查工具执行结果是否满足用户需求
4. 漫画规划：漫画创作模式的专用规划器
"""

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
    """
    DeepSeek API 调用封装

    使用 OpenAI 兼容客户端调用 DeepSeek 模型
    支持多模式：Flash（快速）、V4 Pro（深度推理）、Auto（自动选择）
    """

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        # OpenAI 客户端懒加载
        self._client: OpenAI | None = None
        # 加载各类 Prompt 模板
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
        """懒加载 OpenAI 兼容客户端，指向 DeepSeek 服务"""
        if self._client is None:
            if not self.settings.deepseek_api_key:
                raise ValueError("DEEPSEEK_API_KEY 未配置")
            self._client = OpenAI(
                api_key=self.settings.deepseek_api_key,
                base_url=self.settings.deepseek_base_url,
            )
        return self._client

    def _resolve_mode(self, mode: str | None) -> str:
        """
        将用户友好的模式名映射到实际模型名
        - v4-pro → deepseek-v4-pro（深度推理模式）
        - flash/chat/auto → deepseek-chat（快速模式）
        """
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
        """返回模式标签用于调试和显示"""
        return mode or self.settings.deepseek_mode

    def _kwargs_for_model(self, model: str, mode: str | None) -> dict[str, Any]:
        """
        根据模型类型构建请求参数
        - V4 Pro 支持推理力度配置（reasoning_effort）
        - 所有模型使用低温度（0.1）确保工具调用的稳定性
        """
        kwargs: dict[str, Any] = {"temperature": 0.1}
        if model == "deepseek-v4-pro":
            kwargs["reasoning_effort"] = self.settings.deepseek_reasoning_effort
            extra = self.settings.deepseek_extra_body()
            if extra:
                kwargs["extra_body"] = extra
        return kwargs

    def _tool_choice_for_model(self, model: str) -> str:
        """
        选择工具调用策略
        - V4 Pro 思考模式不支持强制工具调用（required），使用 auto
        - 其他模型强制使用工具调用
        """
        # v4-pro thinking mode rejects tool_choice="required"
        return "auto" if model == "deepseek-v4-pro" else "required"

    def _context_payload(self, context: CanvasContext) -> dict[str, Any]:
        """
        构建发送给 LLM 的画布上下文信息
        包含：当前模式、缩放级别、选中格子、格子状态、最近指令等
        """
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
        """
        解析 LLM 返回的工具调用
        将 OpenAI 格式的 tool_calls 转换为项目内部的 ToolCall 结构
        """
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
        """
        画布控制操作的语音回复映射
        将工具调用转换为用户友好的自然语言回复
        """
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
        """
        从 LLM 响应中提取给用户的语音回复
        优先级：1. LLM 直接返回的内容 2. 根据工具类型生成的默认回复
        """
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
        """
        核心意图解析方法

        执行流程：
        1. 九宫格模式：先调用专门的优化器处理语音指令
        2. 根据当前模式选择对应的 Prompt（通用规划器 / 漫画规划器）
        3. 调用 LLM 生成工具调用序列
        4. 九宫格模式：注入优化后的生图提示词和格子位置参数
        5. 构建并返回解析结果

        Args:
            text: 用户语音转写文本
            context: 画布上下文（模式、选中状态、最近指令等）
            mode: LLM 模型模式（flash/v4-pro/auto）

        Returns:
            IntentParseResponse: 包含工具调用列表、语音回复、优化后的文本等
        """
        model = self._resolve_mode(mode)
        optimized_text = text
        image_prompt: str | None = None
        grid_intent: dict[str, Any] = {}

        # 九宫格模式：先运行专门的指令优化器
        if context.canvas_mode == "grid":
            grid_intent = await self._optimize_grid_speech(text, context, mode)
            optimized_text = str(grid_intent.get("optimized_text") or text).strip()
            image_prompt = grid_intent.get("image_prompt")

        # 构建请求 payload
        payload: dict[str, Any] = {
            "user_speech": text,
            "context": self._context_payload(context),
        }
        if grid_intent:
            payload["optimized_speech"] = optimized_text
            payload["image_prompt"] = image_prompt
            payload["grid_intent"] = grid_intent

        user_content = json.dumps(payload, ensure_ascii=False)
        # 根据画布模式选择不同的规划器 Prompt
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
        # 调用 LLM 进行意图解析
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
        # 处理无工具调用的情况（模型直接回复用户）
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
        # 九宫格模式：注入优化后的参数
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
        """
        执行验证 - 检查工具执行结果是否满足用户需求

        设计思路：
        - 复杂指令（如空间定位、多步操作）执行后可能存在偏差
        - 让 LLM 再次检查执行结果与原始需求的匹配度
        - 如果发现问题，生成修正工具调用序列

        验证流程：
        1. 将用户原始指令、上下文、计划工具、执行结果发送给 LLM
        2. LLM 使用专用验证 Prompt 判断执行是否正确
        3. 如果正确：返回 confirm_execution
        4. 如果需要修正：返回 correction_tools 供前端执行
        """
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
        # 调用验证工具集（confirm_execution / correction_execution）
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
        # 无工具调用表示验证通过
        if not tool_calls:
            return VerifyIntentResponse(ok=True, reply="已完成", model_used=self._mode_label(request.mode))

        fn = tool_calls[0].function
        name = fn.name if fn else ""
        try:
            args = json.loads(fn.arguments or "{}") if fn else {}
        except json.JSONDecodeError:
            args = {}

        # LLM 确认执行正确
        if name == "confirm_execution":
            return VerifyIntentResponse(
                ok=True,
                reply=str(args.get("reply", "已完成")),
                model_used=self._mode_label(request.mode),
            )

        # LLM 发现问题，返回修正工具调用
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
