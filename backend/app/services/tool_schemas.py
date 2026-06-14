"""OpenAI function-calling schemas for VoiceCanvas drawing tools."""

_GRID_VIEW_CONTROL = {
    "type": "function",
    "function": {
        "name": "canvas_control",
        "description": "九宫格视图平移/复位（禁止 expand_*，扩格必须用 grid_expand）",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": [
                        "zoom_in", "zoom_out", "fit_window", "reset_view",
                        "pan_left", "pan_right", "pan_up", "pan_down",
                    ],
                },
                "amount": {"type": "number", "description": "平移像素量，默认120"},
            },
            "required": ["action"],
        },
    },
}

_CANVAS_CONTROL = {
    "type": "function",
    "function": {
        "name": "canvas_control",
        "description": "画布视图控制：撤销、缩放、平移、扩展画布（扩图/outpaint 预留空白）",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": [
                        "undo", "redo", "clear", "zoom_in", "zoom_out",
                        "fit_window", "reset_view",
                        "pan_left", "pan_right", "pan_up", "pan_down",
                        "expand_left", "expand_right", "expand_top", "expand_bottom",
                    ],
                },
                "amount": {"type": "number", "description": "平移或扩展像素量，默认120"},
            },
            "required": ["action"],
        },
    },
}

_SWITCH_MODE = {
    "type": "function",
    "function": {
        "name": "switch_mode",
        "description": "切换创作模式",
        "parameters": {
            "type": "object",
            "properties": {
                "mode": {"type": "string", "enum": ["free", "ai", "grid", "3d"]},
            },
            "required": ["mode"],
        },
    },
}

_SAVE_CANVAS = {
    "type": "function",
    "function": {
        "name": "save_canvas",
        "description": "保存画布为 PNG",
        "parameters": {
            "type": "object",
            "properties": {"filename": {"type": "string"}},
        },
    },
}

DRAWING_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "draw_shape",
            "description": "在画布上绘制矢量图形。笑脸用 smiley；箭头用 arrow 并配合 pointTo；画布角落用 canvasAnchor+relativeTo=canvas。",
            "parameters": {
                "type": "object",
                "properties": {
                    "shape": {
                        "type": "string",
                        "enum": [
                            "circle", "rect", "ellipse", "triangle", "polygon",
                            "line", "arrow", "text", "star", "heart", "smiley",
                        ],
                    },
                    "color": {"type": "string", "description": "颜色中文或十六进制，如 红色、#ff4444"},
                    "fill": {"type": "boolean"},
                    "text": {"type": "string", "description": "shape=text 时的文字内容"},
                    "radius": {"type": "number"},
                    "size": {"type": "number"},
                    "length": {"type": "number", "description": "箭头长度"},
                    "strokeWidth": {"type": "number"},
                    "canvasAnchor": {
                        "type": "string",
                        "enum": [
                            "top_left", "top_right", "bottom_left", "bottom_right",
                            "center", "top", "bottom", "left", "right",
                        ],
                    },
                    "anchor": {
                        "type": "string",
                        "enum": ["above", "below", "left", "right", "center"],
                    },
                    "relativeTo": {"type": "string", "enum": ["canvas", "selected", "last"]},
                    "referenceType": {"type": "string", "description": "参照物类型，如 圆形、矩形"},
                    "referenceColor": {"type": "string", "description": "参照物颜色，如 红色"},
                    "targetType": {"type": "string", "description": "箭头/线指向的目标类型"},
                    "targetColor": {"type": "string", "description": "箭头/线指向的目标颜色"},
                    "x": {"type": "number"},
                    "y": {"type": "number"},
                },
                "required": ["shape"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "draw_path",
            "description": "绘制路径模板：波浪、螺旋、星形路径等",
            "parameters": {
                "type": "object",
                "properties": {
                    "pathType": {
                        "type": "string",
                        "enum": ["wave", "spiral", "star", "heart", "cloud", "zigzag", "brush_stroke"],
                    },
                    "color": {"type": "string"},
                    "strokeWidth": {"type": "number"},
                    "size": {"type": "number"},
                    "canvasAnchor": {"type": "string"},
                    "anchor": {"type": "string"},
                    "referenceType": {"type": "string"},
                    "referenceColor": {"type": "string"},
                    "relativeTo": {"type": "string"},
                },
                "required": ["pathType"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "select_object",
            "description": "按类型、颜色或序号选中画布对象",
            "parameters": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "ordinal": {"type": "string", "enum": ["第一", "第二", "第三", "最后"]},
                    "type": {"type": "string"},
                    "color": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_style",
            "description": "修改选中或最近对象的样式",
            "parameters": {
                "type": "object",
                "properties": {
                    "color": {"type": "string"},
                    "strokeWidth": {"type": "number"},
                    "fill": {"type": "boolean"},
                    "opacity": {"type": "number"},
                    "target": {"type": "string", "enum": ["last", "selected"]},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "object_transform",
            "description": "移动、缩放、旋转对象",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["move", "scale", "rotate", "flip_x", "flip_y"]},
                    "dx": {"type": "number"},
                    "dy": {"type": "number"},
                    "factor": {"type": "number"},
                    "degrees": {"type": "number"},
                    "target": {"type": "string"},
                },
                "required": ["action"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "save_canvas",
            "description": "保存画布为 PNG",
            "parameters": {
                "type": "object",
                "properties": {"filename": {"type": "string"}},
            },
        },
    },
    _CANVAS_CONTROL,
    {
        "type": "function",
        "function": {
            "name": "delete_object",
            "description": "删除对象",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    _SWITCH_MODE,
]

AI_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "ai_generate",
            "description": "AI 生图：根据文字描述生成图片并放入画布",
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "必须是优化后的专业英文绘画描述，禁止直接粘贴用户口语"},
                    "aspect_ratio": {"type": "string", "enum": ["1:1", "16:9", "9:16"]},
                    "size": {"type": "string"},
                },
                "required": ["prompt"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ai_inpaint",
            "description": "AI 局部重绘/扩图：以当前画布为参考重绘",
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "必须是优化后的专业英文绘画描述，禁止直接粘贴用户口语"},
                },
                "required": ["prompt"],
            },
        },
    },
    _CANVAS_CONTROL,
    _SAVE_CANVAS,
    _SWITCH_MODE,
]

GRID_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "grid_create",
            "description": "创建 NxM 九宫格瓦片地图（默认3x3）",
            "parameters": {
                "type": "object",
                "properties": {
                    "rows": {"type": "integer"},
                    "cols": {"type": "integer"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "grid_select",
            "description": "选中指定格子，hint 如 第一格、中间、右上",
            "parameters": {
                "type": "object",
                "properties": {
                    "cell": {"type": "string", "description": "格坐标如 0,0"},
                    "hint": {"type": "string"},
                    "position": {
                        "type": "object",
                        "properties": {"row": {"type": "integer"}, "col": {"type": "integer"}},
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "grid_fill",
            "description": "未指定格子时，生成一张大图切分占满整个九宫格",
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "必须是优化后的专业英文绘画描述，禁止直接粘贴用户口语"},
                },
                "required": ["prompt"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "grid_redraw",
            "description": "用 AI 重绘指定格子（九宫格默认绘画方式，非矢量）",
            "parameters": {
                "type": "object",
                "properties": {
                    "cell": {"type": "string"},
                    "prompt": {"type": "string", "description": "必须是优化后的专业英文绘画描述，禁止直接粘贴用户口语"},
                    "direction": {"type": "string", "enum": ["up", "down", "left", "right"]},
                    "seamless": {"type": "boolean", "description": "与周围邻格衔接"},
                    "seam_from": {"type": "string", "description": "扩格时锚点格坐标"},
                },
                "required": ["prompt"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "grid_inpaint",
            "description": "局部重绘指定格子，继承参考图画风/角色，只改描述内容。如「0,1换成女生伤心画面」",
            "parameters": {
                "type": "object",
                "properties": {
                    "cell": {"type": "string"},
                    "prompt": {"type": "string", "description": "必须是优化后的专业英文绘画描述，禁止直接粘贴用户口语"},
                    "use_previous": {"type": "boolean", "description": "使用之前生成的整图作参考"},
                },
                "required": ["prompt"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "grid_expand",
            "description": "从 from_cell 向指定方向扩展新格（不是重绘原格），可附带 prompt 立即 AI 绘制新格",
            "parameters": {
                "type": "object",
                "properties": {
                    "from_cell": {"type": "string", "description": "锚点格如 0,0"},
                    "direction": {"type": "string", "enum": ["up", "down", "left", "right"]},
                    "count": {"type": "integer"},
                    "prompt": {"type": "string", "description": "必须是优化后的专业英文绘画描述，禁止直接粘贴用户口语"},
                },
                "required": ["direction"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "grid_expand_region",
            "description": "整块九宫格扩图：在边界新增一整行或一整列（不是单格扩）。如「整个九宫格向上扩」「扩一个大九宫格」",
            "parameters": {
                "type": "object",
                "properties": {
                    "direction": {"type": "string", "enum": ["up", "down", "left", "right"]},
                    "prompt": {"type": "string", "description": "新扩展区域的绘画描述"},
                    "fill_mode": {"type": "string", "enum": ["turnaround", "seamless"], "description": "turnaround=多视角角色延续"},
                },
                "required": ["direction"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "character_turnaround",
            "description": "为每个格子绘制同一角色的不同视角（正面/背面/左右/斜角等），像素小人转身图集。如「给每个格子画像素小人不同角度」",
            "parameters": {
                "type": "object",
                "properties": {
                    "subject": {"type": "string", "description": "角色描述，如 pixel warrior"},
                    "style": {"type": "string", "description": "默认 pixel art"},
                    "filter": {"type": "string", "enum": ["all", "empty"]},
                    "reference_cell": {"type": "string", "description": "可选参考格"},
                },
                "required": ["subject"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "batch_grid",
            "description": "批量 AI 填充空白格子",
            "parameters": {
                "type": "object",
                "properties": {
                    "filter": {"type": "string", "enum": ["empty", "all"]},
                    "mode": {"type": "string", "enum": ["default", "character_turnaround"]},
                    "subject": {"type": "string"},
                    "prompt": {"type": "string", "description": "必须是优化后的专业英文绘画描述，禁止直接粘贴用户口语"},
                },
                "required": ["prompt"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "style_sync",
            "description": "以选中格为参考，统一其他格子 AI 风格",
            "parameters": {
                "type": "object",
                "properties": {
                    "reference_cell": {"type": "string"},
                    "prompt": {"type": "string", "description": "必须是优化后的专业英文绘画描述，禁止直接粘贴用户口语"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "export_tiles",
            "description": "导出九宫格瓦片集 PNG",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "workflow_macro",
            "description": "预置工作流，如 map_init 初始化3x3草地地图",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "enum": ["map_init"]},
                },
                "required": ["name"],
            },
        },
    },
    _GRID_VIEW_CONTROL,
    _SWITCH_MODE,
]


COMIC_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "comic_create_character",
            "description": "创建漫画角色：生成人设并绘制立绘",
            "parameters": {
                "type": "object",
                "properties": {
                    "description": {"type": "string", "description": "角色描述（外貌、性格、设定等，保留用户原话要点）"},
                    "name_hint": {"type": "string", "description": "角色名提示，如小美、小明"},
                },
                "required": ["description"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "comic_create_script",
            "description": "撰写指定集数漫画剧本",
            "parameters": {
                "type": "object",
                "properties": {
                    "episode_number": {"type": "integer", "description": "集数，默认1"},
                    "synopsis": {"type": "string", "description": "本集梗概或剧情要求"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "comic_generate_episode",
            "description": "根据已有剧本生成指定集漫画分镜图",
            "parameters": {
                "type": "object",
                "properties": {
                    "episode_number": {"type": "integer", "description": "集数，默认1"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "comic_generate_episodes",
            "description": "一次生成多集漫画（如第一集和第二集）",
            "parameters": {
                "type": "object",
                "properties": {
                    "episode_numbers": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "要绘制的集数列表，如 [1, 2]",
                    },
                },
                "required": ["episode_numbers"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "comic_edit_script",
            "description": "根据修改意见修订剧本",
            "parameters": {
                "type": "object",
                "properties": {
                    "episode_number": {"type": "integer"},
                    "revision": {"type": "string", "description": "修改意见"},
                },
                "required": ["revision"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "comic_regenerate_character",
            "description": "重新生成角色",
            "parameters": {
                "type": "object",
                "properties": {
                    "name_hint": {"type": "string"},
                    "description": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "comic_regenerate_script",
            "description": "重新生成剧本",
            "parameters": {
                "type": "object",
                "properties": {
                    "episode_number": {"type": "integer"},
                    "synopsis": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "comic_regenerate_episode",
            "description": "重新生成整集漫画分镜",
            "parameters": {
                "type": "object",
                "properties": {
                    "episode_number": {"type": "integer"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "comic_redraw_panels",
            "description": "局部重绘指定集数的若干页漫画，保持画风与角色一致。如「重绘第一集第1页和第5页」",
            "parameters": {
                "type": "object",
                "properties": {
                    "episode_number": {"type": "integer", "description": "集数"},
                    "page_numbers": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "要重绘的页码列表，如 [1, 5]",
                    },
                },
                "required": ["episode_number", "page_numbers"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "comic_set_style",
            "description": "设定漫画画风",
            "parameters": {
                "type": "object",
                "properties": {
                    "style": {"type": "string", "description": "画风描述，如日漫、赛博朋克漫画"},
                },
                "required": ["style"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "comic_set_background",
            "description": "设定故事背景/世界观",
            "parameters": {
                "type": "object",
                "properties": {
                    "background": {"type": "string", "description": "故事背景描述"},
                },
                "required": ["background"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "comic_view_characters",
            "description": "查看角色详情；name 为空则展示全部角色",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "角色名，可选"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "comic_view_episodes",
            "description": "查看剧情/剧本；episode_number 为空则展示全部集",
            "parameters": {
                "type": "object",
                "properties": {
                    "episode_number": {"type": "integer", "description": "集数，可选"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "comic_view_story",
            "description": "查看故事背景与风格设定",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "comic_export_pdf",
            "description": "导出漫画 PDF",
            "parameters": {
                "type": "object",
                "properties": {
                    "episode_number": {"type": "integer", "description": "指定集数，空则导出全部"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "comic_close_detail",
            "description": "关闭角色/剧情详情弹窗",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "comic_new_project",
            "description": "新建空白漫画项目",
            "parameters": {
                "type": "object",
                "properties": {"name": {"type": "string", "description": "项目名，可选"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "comic_switch_project",
            "description": "切换到指定漫画项目",
            "parameters": {
                "type": "object",
                "properties": {"name": {"type": "string", "description": "项目名"}},
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "comic_delete_project",
            "description": "删除漫画项目",
            "parameters": {
                "type": "object",
                "properties": {"name": {"type": "string", "description": "项目名，可选则删当前"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "comic_delete_character",
            "description": "删除指定角色",
            "parameters": {
                "type": "object",
                "properties": {"name": {"type": "string", "description": "角色名"}},
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "comic_delete_episode",
            "description": "删除指定集剧本与分镜",
            "parameters": {
                "type": "object",
                "properties": {"episode_number": {"type": "integer"}},
                "required": ["episode_number"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "comic_clear_episode_comic",
            "description": "清除指定集漫画图片，保留剧本",
            "parameters": {
                "type": "object",
                "properties": {"episode_number": {"type": "integer"}},
                "required": ["episode_number"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "comic_delete_panels",
            "description": "删除指定集的若干页分镜",
            "parameters": {
                "type": "object",
                "properties": {
                    "episode_number": {"type": "integer"},
                    "page_numbers": {"type": "array", "items": {"type": "integer"}},
                },
                "required": ["episode_number", "page_numbers"],
            },
        },
    },
    _SWITCH_MODE,
]


def get_tools_for_mode(canvas_mode: str) -> list[dict]:
    if canvas_mode == "grid":
        return GRID_TOOLS
    if canvas_mode == "ai":
        return AI_TOOLS
    if canvas_mode == "comic":
        return COMIC_TOOLS
    if canvas_mode == "assets":
        return [_SWITCH_MODE]
    return DRAWING_TOOLS


VERIFY_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "confirm_execution",
            "description": "执行结果符合用户意图，无需修正",
            "parameters": {
                "type": "object",
                "properties": {
                    "reply": {"type": "string", "description": "给用户的简短中文反馈"},
                },
                "required": ["reply"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "correct_execution",
            "description": "执行结果不符合意图，输出修正工具序列",
            "parameters": {
                "type": "object",
                "properties": {
                    "reply": {"type": "string"},
                    "reason": {"type": "string"},
                    "tools": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "arguments": {"type": "object"},
                            },
                            "required": ["name", "arguments"],
                        },
                    },
                },
                "required": ["reply", "tools"],
            },
        },
    },
]
