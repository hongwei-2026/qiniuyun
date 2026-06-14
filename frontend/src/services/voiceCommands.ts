import { parseColor } from '../engines/fabricEngine'
import { parseCellCoordFromText, parseAllCellCoordsFromText } from '../engines/gridEngine'
import { parsePathTemplate } from '../engines/pathEngine'
import { parseSelectCommand } from '../engines/objectSelect'
import { compactVoiceText } from './voiceTextNormalize'
import {
  parseEpisodeNumbersFromText,
  parsePageNumbersFromText,
  parseProjectKeysFromText,
} from './chineseNumber'
import type { CanvasMode, DeepSeekMode, ImageProvider, VoiceMode } from '../types'

export type LocalCommand =
  | { type: 'stop_generation' }
  | { type: 'comic_quick'; action: string; args?: Record<string, unknown> }
  | { type: 'canvas'; action: string }
  | { type: 'draw'; args: Record<string, unknown> }
  | { type: 'draw_path'; args: Record<string, unknown> }
  | { type: 'select_object'; args: Record<string, unknown> }
  | { type: 'compose'; action: string; args?: Record<string, unknown> }
  | { type: 'save_canvas' }
  | { type: 'set_style'; args: Record<string, unknown> }
  | { type: 'transform'; args: Record<string, unknown> }
  | { type: 'layer'; action: string }
  | { type: 'delete_object' }
  | { type: 'duplicate' }
  | { type: 'export_tiles' }
  | { type: 'ai_quick'; action: string; args?: Record<string, unknown> }
  | { type: 'grid_quick'; action: string; args?: Record<string, unknown> }
  | { type: 'workflow_macro'; name: string }
  | { type: 'switch_mode'; mode: CanvasMode }
  | { type: 'set_deepseek'; mode: DeepSeekMode }
  | { type: 'set_image_provider'; provider: ImageProvider }
  | { type: 'set_voice_mode'; mode: VoiceMode }
  | { type: 'set_asr_provider'; provider: 'browser' | 'xfyun' }
  | { type: 'start_listening' }
  | { type: 'stop_listening' }
  | { type: 'open_manual' }
  | { type: 'close_manual' }
  | { type: 'utterance_start' }
  | { type: 'help' }

const CANVAS_PATTERNS: Record<string, RegExp> = {
  undo: /撤销|上一步/,
  redo: /重做|下一步/,
  clear: /清空(画布)?/,
  zoom_in: /放大|拉近|放大一点|画布放大/,
  zoom_out: /缩小|拉远|缩小一点|画布缩小/,
  fit: /适应窗口|全部显示|显示全图/,
  reset_view: /重置视图|回到中心/,
  pan_left: /画布.*向左|向左.*画布|画布左移|往左看|平移.*左|视图左移/,
  pan_right: /画布.*向右|向右.*画布|画布右移|往右看|平移.*右|视图右移/,
  pan_up: /画布.*向上|向上.*画布|画布上移|往上(看|移)|平移.*上|视图上移/,
  pan_down: /画布.*向下|向下.*画布|画布下移|往下(看|移)|平移.*下|视图下移/,
  expand_left: /向左扩图|左边扩展|画布向左扩展|左侧扩图/,
  expand_right: /向右扩图|右边扩展|画布向右扩展|右侧扩图/,
  expand_top: /向上扩图|上边扩展|画布向上扩展|顶部扩图/,
  expand_bottom: /向下扩图|下边扩展|画布向下扩展|底部扩图/,
  save: /保存(图片|画布|作品|图像)?|导出(图片|PNG|图像)|下载(图片|图像)?|另存为/i,
  delete: /删除(图形|对象|上一个)|删掉/,
  duplicate: /复制(图形|对象|上一个)|拷贝/,
  export_tiles: /导出(瓦片|瓦片集|tile)|导出九宫格/,
  show_grid: /显示网格|打开网格|辅助网格/,
  hide_grid: /隐藏网格|关闭网格/,
}

const COLOR_WORDS = '红|红色|蓝|蓝色|绿|绿色|黄|黄色|白|白色|黑|黑色|紫|紫色|橙|橙色|粉|粉色|青|青色'

/** 含空间关系、参照已有图形的口语描述 → 必须走 DeepSeek 理解上下文 */
export function isContextualVoiceCommand(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (/上面|下面|上方|下方|左边|右边|左侧|右侧|里面|旁边|之内|之上|叠加|位于|靠在|挨着|中间|中心|居中|内部|正中/.test(t)) {
    return true
  }
  if (/指向|对准|朝向|画布.*(角|边|右上|左上|右下|左下|中间)|右上|左上|右下|左下/.test(t)) return true
  if (/在.{0,16}(圆|圆形|矩形|方块|心|星|三角|椭圆)/.test(t)) return true
  if (/(那个|这个|选中).{0,8}(圆|矩形|方块|心|星)/.test(t)) return true
  if (/(红色|蓝色|绿色|黄色|黑色|白色|紫色|橙色|粉色|青色).{0,4}(圆|圆形|矩形|方块|心|星)/.test(t)) {
    return true
  }
  return false
}

/** 一句话里是否包含多条指令 */
export function isMultiCommand(text: string): boolean {
  if (/然后|接着|之后再?|并且|还有|同时|完成之后|最后|先.*再/.test(text)) return true
  if ((text.match(/画/g) || []).length >= 2) return true
  if ((text.match(/保存|撤销|删除|选中|放大|缩小|生成|切换|改成|改为/g) || []).length >= 2) {
    return true
  }
  return false
}

function matchManualCommand(raw: string, compact: string): LocalCommand | null {
  if (/关闭/.test(compact) && /手册/.test(compact)) return { type: 'close_manual' }
  const openHints = [
    /打开指令手册/,
    /打开手册/,
    /查看指令手册/,
    /显示指令手册/,
    /^指令手册$/,
    /打开.*指令.*手册/,
    /查看.*手册/,
    /查看指令/,
    /看指令/,
    /指令列表/,
    /有什么指令/,
    /有哪些指令/,
    /指令帮助/,
  ]
  if (openHints.some((re) => re.test(compact) || re.test(raw))) {
    return { type: 'open_manual' }
  }
  if (
    (compact.includes('打开') || compact.includes('查看') || compact.includes('显示')) &&
    compact.includes('手册')
  ) {
    return { type: 'open_manual' }
  }
  if (compact.includes('指令') && compact.includes('手册') && !compact.includes('关闭')) {
    return { type: 'open_manual' }
  }
  return null
}

/** 本地优先：UI 类指令，避免误走 LLM */
/** 语音识别引擎切换 */
export function matchAsrProviderCommand(text: string): LocalCommand | null {
  const t = text.trim()
  if (!t) return null
  if (/切换.*讯飞|讯飞识别|讯飞模式|用讯飞|高精度识别/.test(t)) {
    return { type: 'set_asr_provider', provider: 'xfyun' }
  }
  if (/切换.*浏览器|浏览器识别|浏览器模式|用浏览器|本地识别/.test(t)) {
    return { type: 'set_asr_provider', provider: 'browser' }
  }
  return null
}

/** 切换生图 AI（豆包/MiniMax），不改变画布模式 */
export function matchImageProviderCommand(text: string): LocalCommand | null {
  const t = text.trim()
  if (!t) return null
  if (/切换.*minimax|用.*minimax|改成.*minimax|改为.*minimax|换.*minimax/i.test(t)) {
    return { type: 'set_image_provider', provider: 'minimax' }
  }
  if (/切换.*豆包|用.*豆包|改成.*豆包|改为.*豆包|换.*豆包/i.test(t)) {
    return { type: 'set_image_provider', provider: 'doubao' }
  }
  return null
}

export function matchFuzzyUiCommand(text: string): LocalCommand | null {
  const asr = matchAsrProviderCommand(text)
  if (asr) return asr
  const raw = text.trim()
  if (!raw) return null
  const compact = compactVoiceText(raw)
  const manual = matchManualCommand(raw, compact)
  if (manual) return manual
  if (/打开画布|显示画布|显示自由画布/.test(compact) || /打开画布|显示画布/.test(raw)) {
    return { type: 'switch_mode', mode: 'free' }
  }
  return null
}

/** 矢量绘图指令（不走 AI）；多指令句、含空间参照的口语交给 DeepSeek */
export function matchDrawVoiceCommand(text: string): LocalCommand | null {
  const t = text.trim()
  if (!t || !/画|绘制|写.*文字/.test(t)) return null
  if (isMultiCommand(t)) return null
  if (isContextualVoiceCommand(t)) return null

  const drawArgs = parseDrawCommand(t)
  if (drawArgs) return { type: 'draw', args: drawArgs }

  const pathType = parsePathTemplate(t)
  if (pathType || /画.*(路径|曲线|折线)|手绘|涂鸦|画笔/.test(t)) {
    const colorMatch = t.match(new RegExp(COLOR_WORDS))
    return {
      type: 'draw_path',
      args: {
        pathType: pathType ?? 'brush_stroke',
        color: colorMatch?.[0],
        position: /左上|右上|左下|右下|中间|居中/.test(t) ? t : '中间',
      },
    }
  }
  return null
}

/** 可立即执行的 UI 指令（识别到片段即可触发，不必等断句） */
export function matchImmediateVoiceCommand(text: string): LocalCommand | null {
  const modeSwitch = matchCanvasModeSwitch(text)
  if (modeSwitch) return modeSwitch
  if (/像素|每个格|九宫格|不同角度|漫画|角色转身|多视角/.test(text)) return null
  const cmd = matchFuzzyUiCommand(text) ?? matchLocalVoiceCommand(text)
  if (!cmd) return null
  const immediate = new Set([
    'open_manual', 'close_manual', 'start_listening', 'stop_listening', 'stop_generation', 'help', 'utterance_start',
    'switch_mode', 'save_canvas', 'canvas', 'compose', 'set_asr_provider', 'set_image_provider',
  ])
  if (cmd.type === 'compose' && cmd.action === 'stick_figure') return null
  return immediate.has(cmd.type) ? cmd : null
}

function parseDrawCommand(text: string): Record<string, unknown> | null {
  const filled = /实心|填充/.test(text)
  const colorMatch = text.match(new RegExp(COLOR_WORDS))
  const color = colorMatch ? parseColor(colorMatch[0]) : undefined
  const strokeMatch = text.match(/线宽\s*(\d+)/)
  const strokeWidth = strokeMatch ? Number(strokeMatch[1]) : undefined
  const position = /左上|右上|左下|右下|中间|居中|中心|\d+[,，]\d+/.test(text) ? text : undefined

  const shapeMap: [RegExp, string][] = [
    [/画.*(五角星|星星|星形)/, 'star'],
    [/画.*(爱心|心形|心)/, 'heart'],
    [/画.*(直线|线段)/, 'line'],
    [/画.*(箭头)/, 'arrow'],
    [/画.*(矩形|方块)/, 'rect'],
    [/画.*(椭圆)/, 'ellipse'],
    [/画.*(三角)/, 'triangle'],
    [/画.*(多边|五边|六边)/, 'polygon'],
    [/写.*(文字|标题|文本)|写上/, 'text'],
    [/(画|绘制?).*(圆|圆形)/, 'circle'],
    [/^(画|绘制?)\s*圆/, 'circle'],
  ]
  for (const [re, shape] of shapeMap) {
    if (re.test(text)) {
      const args: Record<string, unknown> = { shape, fill: filled }
      if (color) args.color = color
      if (strokeWidth) args.strokeWidth = strokeWidth
      if (position) args.position = position
      const textMatch = text.match(/写(上|为)?[：:]?\s*(.+)/)
      if (shape === 'text' && textMatch) args.text = textMatch[2]
      const countMatch = text.match(/(\d+)\s*个/)
      if (countMatch) args.count = Number(countMatch[1])
      return args
    }
  }
  return null
}

/** 画布模式切换（任意模式下优先匹配） */
export function matchCanvasModeSwitch(text: string): LocalCommand | null {
  const t = text.trim()
  if (!t) return null
  if (/切换.*3d|切换到.*3d|三维模式|3d模式|改为.*3d/i.test(t)) {
    return { type: 'switch_mode', mode: '3d' }
  }
  if (/切换.*漫画|切换到.*漫画|漫画创作|漫画模式|进入漫画|改为.*漫画|改成.*漫画/.test(t)) {
    // 「切换到漫画二」= 切换项目，不是切换画布模式
    if (/(?:漫画|项目)\s*[一二三四五六七八九十两\d]|[一二三四五六七八九十两\d]\s*$/.test(t)) {
      return null
    }
    return { type: 'switch_mode', mode: 'comic' }
  }
  if (/打开资产管理|资产管理|资产页面|角色管理|剧本管理/.test(t)) {
    return { type: 'switch_mode', mode: 'assets' }
  }
  if (/切换.*九宫格|切换到.*九宫格|改为.*九宫格|改成.*九宫格|九宫格模式|进入九宫格|格阵模式/.test(t)) {
    return { type: 'switch_mode', mode: 'grid' }
  }
  if (/切换.*AI|切换到.*AI|改为.*AI|AI创作|AI模式|进入.*AI|开启.*AI|奇幻.*AI/i.test(t)) {
    return { type: 'switch_mode', mode: 'ai' }
  }
  if (/切换.*自由|切换到.*自由|改为.*自由|自由画布|自由模式/.test(t)) {
    return { type: 'switch_mode', mode: 'free' }
  }
  return null
}

/** 任意画布模式下都生效：视图、对象变换、样式、选中、模式切换等（不含矢量绘制/AI生图） */
export function matchUniversalVoiceCommand(text: string): LocalCommand | null {
  const t = text.trim()
  if (!t) return null

  const compact = compactVoiceText(t)
  const manual = matchManualCommand(t, compact)
  if (manual) return manual

  if (/打开画布|显示画布|显示自由画布/.test(compact) || /打开画布|显示画布/.test(t)) {
    return { type: 'switch_mode', mode: 'free' }
  }
  if (/帮助|怎么用|使用说明|指令帮助|有什么指令/.test(t)) return { type: 'help' }
  if (/开始聆听|启动语音|开始收听/.test(t)) return { type: 'start_listening' }
  if (/停止聆听|停止语音|暂停聆听/.test(t)) return { type: 'stop_listening' }
  if (/停止绘图|停止生图|停止生成|取消绘图|取消生图|别画了|停止画/.test(t)) {
    return { type: 'stop_generation' }
  }
  if (/切换到.*连续|连续模式|自动断句/.test(t)) return { type: 'set_voice_mode', mode: 'continuous' }
  if (/切换到.*按住|单次说话/.test(t)) return { type: 'set_voice_mode', mode: 'push_to_talk' }
  if (/^(开始说话|请听我说|听我说)$/.test(t)) return { type: 'utterance_start' }

  const asr = matchAsrProviderCommand(t)
  if (asr) return asr

  if (/切换.*自动|智能模式|自动模式/.test(t)) return { type: 'set_deepseek', mode: 'auto' }
  if (/切换.*v4|深度推理|pro模式/i.test(t)) return { type: 'set_deepseek', mode: 'v4-pro' }
  if (/切换.*flash|快速模式/i.test(t)) return { type: 'set_deepseek', mode: 'flash' }
  if (/切换.*chat|对话模式/.test(t)) return { type: 'set_deepseek', mode: 'chat' }
  const imgProvider = matchImageProviderCommand(t)
  if (imgProvider) return imgProvider

  const modeSwitch = matchCanvasModeSwitch(t)
  if (modeSwitch) return modeSwitch

  if (/新建九宫格|创建九宫格|初始化九宫格/.test(t)) {
    return { type: 'compose', action: 'grid_create' }
  }
  if (/切成九宫格|图片.*九宫格|切分九宫格|分割成九宫格/.test(t)) {
    return { type: 'compose', action: 'grid_split_canvas' }
  }

  if (/占满|铺满|填满|充满|全屏|占整个/.test(t) && /画布|图片|图|照片/.test(t)) {
    return { type: 'canvas', action: 'fit_image_cover' }
  }
  if (/适应画布|完整显示|显示全图/.test(t) && /图片|图|照片/.test(t)) {
    return { type: 'canvas', action: 'fit_image_contain' }
  }

  if (/重新生成|再生成一次|换一个/.test(t)) return { type: 'ai_quick', action: 'regenerate' }
  if (/生成变体|再来一张类似的/.test(t)) return { type: 'ai_quick', action: 'variation' }

  if (CANVAS_PATTERNS.save.test(t)) return { type: 'save_canvas' }
  if (CANVAS_PATTERNS.delete.test(t)) return { type: 'delete_object' }
  if (CANVAS_PATTERNS.duplicate.test(t)) return { type: 'duplicate' }
  if (CANVAS_PATTERNS.export_tiles.test(t)) return { type: 'export_tiles' }
  if (CANVAS_PATTERNS.show_grid.test(t)) return { type: 'compose', action: 'show_grid' }
  if (CANVAS_PATTERNS.hide_grid.test(t)) return { type: 'compose', action: 'hide_grid' }
  if (/地图初始化|执行地图初始化|初始化地图/.test(t)) return { type: 'workflow_macro', name: 'map_init' }

  const sel = parseSelectCommand(t)
  if (sel) return { type: 'select_object', args: sel }

  if (/流程图|画流程/.test(t)) return { type: 'compose', action: 'flowchart' }
  if (/火柴人/.test(t) && !/像素|九宫格|每个格|漫画|角色转身|不同角度/.test(t)) {
    return { type: 'compose', action: 'stick_figure' }
  }
  if (/居中|移到中心|放到中间/.test(t)) return { type: 'compose', action: 'snap_center' }
  if (/水平对齐|左右对齐/.test(t)) return { type: 'compose', action: 'align_center' }
  if (/等间距|均匀排列/.test(t)) return { type: 'compose', action: 'distribute' }

  if (/改成|改为|换成|设置为/.test(t) && new RegExp(COLOR_WORDS).test(t)) {
    const m = t.match(new RegExp(COLOR_WORDS))
    return { type: 'set_style', args: { color: m?.[0], target: 'last' } }
  }
  if (/线宽\s*\d+/.test(t)) {
    const m = t.match(/线宽\s*(\d+)/)
    return { type: 'set_style', args: { strokeWidth: Number(m?.[1]), target: 'last' } }
  }
  if (/实心|改成实心|填充/.test(t)) return { type: 'set_style', args: { fill: true, target: 'last' } }
  if (/空心|改成空心/.test(t)) return { type: 'set_style', args: { fill: false, hollow: true, target: 'last' } }

  const objectRef = /图片|图像|照片|这张图|这个图|对象|图形|形状/.test(t)
  if (objectRef && /放大|变大|大一点|再大|放大一点/.test(t)) {
    const factor = /两倍|2倍/.test(t) ? 2 : /三倍|3倍/.test(t) ? 3 : 1.5
    return { type: 'transform', args: { action: 'scale', factor, target: 'last' } }
  }
  if (objectRef && /缩小|变小|小一点|再小/.test(t)) {
    return { type: 'transform', args: { action: 'scale', factor: 0.67, target: 'last' } }
  }
  if (/放大一倍|变大/.test(t)) return { type: 'transform', args: { action: 'scale', factor: 1.5, target: 'last' } }
  if (/缩小一半|变小/.test(t)) return { type: 'transform', args: { action: 'scale', factor: 0.67, target: 'last' } }
  if (/向左移|往左移/.test(t)) return { type: 'transform', args: { action: 'move', dx: -40, dy: 0, target: 'last' } }
  if (/向右移|往右移/.test(t)) return { type: 'transform', args: { action: 'move', dx: 40, dy: 0, target: 'last' } }
  if (/向上移|往上移/.test(t)) return { type: 'transform', args: { action: 'move', dx: 0, dy: -40, target: 'last' } }
  if (/向下移|往下移/.test(t)) return { type: 'transform', args: { action: 'move', dx: 0, dy: 40, target: 'last' } }
  if (/旋转|转一下/.test(t)) return { type: 'transform', args: { action: 'rotate', degrees: 15, target: 'last' } }

  if (/置顶|最上层/.test(t)) return { type: 'layer', action: 'front' }
  if (/置底|最下层/.test(t)) return { type: 'layer', action: 'back' }

  if (/画布.*放大|放大画布|拉近/.test(t)) return { type: 'canvas', action: 'zoom_in' }
  if (/画布.*缩小|缩小画布|拉远/.test(t)) return { type: 'canvas', action: 'zoom_out' }
  if (CANVAS_PATTERNS.pan_left.test(t)) return { type: 'canvas', action: 'pan_left' }
  if (CANVAS_PATTERNS.pan_right.test(t)) return { type: 'canvas', action: 'pan_right' }
  if (CANVAS_PATTERNS.pan_up.test(t)) return { type: 'canvas', action: 'pan_up' }
  if (CANVAS_PATTERNS.pan_down.test(t)) return { type: 'canvas', action: 'pan_down' }
  const isGridExpandSpeech = /\d+\s*[,，.．·]\s*\d+/.test(t) && /扩图|扩一格|扩展/.test(t)
  const isGridContextSpeech = /格子|九宫格/.test(t) && /扩图|扩一格|扩展/.test(t)
  if (!isGridExpandSpeech && !isGridContextSpeech) {
    if (CANVAS_PATTERNS.expand_left.test(t)) return { type: 'canvas', action: 'expand_left' }
    if (CANVAS_PATTERNS.expand_right.test(t)) return { type: 'canvas', action: 'expand_right' }
    if (CANVAS_PATTERNS.expand_top.test(t)) return { type: 'canvas', action: 'expand_top' }
    if (CANVAS_PATTERNS.expand_bottom.test(t)) return { type: 'canvas', action: 'expand_bottom' }
  }
  if (!objectRef && !isGridExpandSpeech && !isGridContextSpeech) {
    for (const [action, pattern] of Object.entries(CANVAS_PATTERNS)) {
      if (['save', 'delete', 'duplicate', 'export_tiles', 'show_grid', 'hide_grid'].includes(action)) continue
      if (/^expand_/.test(action)) continue
      if (pattern.test(t)) return { type: 'canvas', action }
    }
  }

  return null
}

/** AI 模式下不应误触生图的控制类口语 */
export function isAiControlCommand(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return /九宫格|切换|改为|改成|模式|保存|下载|导出|放大|缩小|占满|铺满|填满|撤销|清空|自由|矢量|3d|三维|占整个|切分|新建|创建|重新生成|变体|适应|横版|竖版|方形|平移|扩图|扩展画布|左移|右移|上移|下移/.test(t)
}

const CN_NUM: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
}

function parseCellHintFromSpeech(text: string): string | undefined {
  const m = text.match(/第?([一二三四五六七八九十\d]+)格/)
  if (!m) return undefined
  const raw = m[1]
  const n = CN_NUM[raw] ?? Number(raw)
  if (!n || Number.isNaN(n)) return `第${raw}格`
  return `第${n}格`
}

function extractGridPrompt(text: string): string {
  const replace = text.match(/(?:换成|改成|改为|变成|替换为?)(.+)/)
  if (replace?.[1]) return replace[1].replace(/[。.!！?？]$/, '').trim()
  const expandDraw = text.match(/(?:扩(?:一|1)?格|扩图|扩展)(?:画|绘制|生成)?(.+)/)
  if (expandDraw?.[1]) return expandDraw[1].replace(/[。.!！?？]$/, '').trim()
  const draw = text.match(/(?:绘制|生成|来一张|画一张|画一幅|画一个|创作|画(?!面|布|像|质|廊|册|展|家|师|笔|板|纸|卷|框))(.+)/)
  if (draw?.[1]) return draw[1].replace(/[。.!！?？]$/, '').trim()
  const scene = text.match(/(?:之前)?(?:那个|这个)?(.+?(?:伤心的画面|女生|表情|样子|场景))/)
  if (scene?.[1]) return scene[1].replace(/[。.!！?？]$/, '').trim()
  return text
    .replace(/占满|铺满|整张|九宫格|格子|格|切换|模式|请|帮我|扩展|扩图|衔接|同风格|位置|的话|嗯/g, '')
    .replace(/向?(上|下|左|右)\s*(?:一)?格/g, '')
    .trim()
}

function hasExplicitDrawVerb(text: string): boolean {
  return /(?:绘制|生成|来一张|画一张|画一幅|画一个|创作)|画(?!面|布|像|质|廊|册|展|家|师|笔|板|纸|卷|框)/.test(text)
}

function hasGridPositionHint(text: string): boolean {
  return !!(
    parseCellCoordFromText(text)
    || parseCellHintFromSpeech(text)
    || /这格|当前格|选中格|第[一二三四五六七八九十\d]+格/.test(text)
    || /中间格|中心格/.test(text)
    || /向?(上|下|左|右)\s*(?:扩|扩展)?\s*(?:一|1)?\s*格/.test(text)
  )
}

function parseGridInheritFromSpeech(text: string): LocalCommand | null {
  if (!/继承|沿用|参考|同人物形象|同样的人物|那个形象/.test(text)) return null
  const coords = parseAllCellCoordsFromText(text)
  if (!coords.length) return null
  const inheritMatch = text.match(/继承\s*(-?\d+)\s*[,，.．·]\s*(-?\d+)/)
  const atMatch = text.match(/在\s*(-?\d+)\s*[,，.．·]\s*(-?\d+)/)
  const referenceCell = inheritMatch
    ? `${inheritMatch[1]},${inheritMatch[2]}`
    : coords[0]
  const targetCell = atMatch
    ? `${atMatch[1]},${atMatch[2]}`
    : coords.length >= 2
      ? coords[coords.length - 1]
      : coords[0]
  const prompt = extractGridPrompt(text) || 'same character portrait as reference cell'
  return {
    type: 'grid_quick',
    action: 'inpaint',
    args: {
      cell: targetCell,
      reference_cell: referenceCell,
      prompt,
      use_previous: true,
      inherit_from: referenceCell,
    },
  }
}

function parseGridInpaintFromSpeech(text: string): LocalCommand | null {
  if (!/换成|改成|改为|变成|替换|重绘|局部/.test(text)) return null
  const cell = parseCellCoordFromText(text)
  const hint = parseCellHintFromSpeech(text)
  const prompt = extractGridPrompt(text)
  if (!cell && !hint && !/这格|当前格|选中格/.test(text)) return null
  return {
    type: 'grid_quick',
    action: 'inpaint',
    args: {
      cell,
      hint,
      prompt: prompt || 'same style with requested changes',
      use_previous: /之前|那个女生|这个女生|伤心/.test(text),
    },
  }
}

function parseExpandDirection(text: string): 'up' | 'down' | 'left' | 'right' | null {
  const dirMap: Record<string, 'up' | 'down' | 'left' | 'right'> = {
    上: 'up', 下: 'down', 左: 'left', 右: 'right',
  }
  const patterns = [
    /向?(上|下|左|右)\s*(?:方|面|边|侧)?\s*(?:扩|扩展|加)?\s*(?:一|1)?\s*格/,
    /向?(上|下|左|右)\s*扩(?:一|1)?格/,
    /向?(上|下|左|右)\s*扩图/,
    /(上|下|左|右)\s*扩(?:一|1)?格/,
    /向?(上|下|左|右)\s*(?:一|1)?格/,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m) return dirMap[m[1]] ?? null
  }
  if (/向上|往上|朝上|上移/.test(text)) return 'up'
  if (/向下|往下|朝下|下移/.test(text)) return 'down'
  if (/向左|往左|左移/.test(text)) return 'left'
  if (/向右|往右|右移/.test(text)) return 'right'
  return null
}

function isRegionExpandSpeech(text: string): boolean {
  return /大九宫格|整个九宫格|整块|整片|整张|全图|全部格子|九宫格整体|整块九宫格|扩一(块|片|个大)|扩.*大.*九宫格|基于.*九宫格.*扩|九宫格.*向外/.test(
    text,
  )
}

function parseCharacterTurnaroundFromSpeech(text: string): LocalCommand | null {
  const explicit =
    /每个格|每一格|所有格|全部格|每个格子|对于每个格|九宫格.*(画|绘制|生成)/.test(text)
    && /像素|小人|角色|人物|sprite|character/.test(text)
    && /不同(面|角度|方向|视角)|多视角|四面|八方|转身|各角度|各个面|把.*面.*画|都画出来/.test(text)
  const loose =
    /画.*(像素|小人).*(不同|各|多|角度)/.test(text)
    || /给每个格.*画/.test(text)
    || /像素小人/.test(text) && /每个格|九宫格|不同角度/.test(text)
  if (!explicit && !loose) return null

  const subjectMatch = text.match(/(?:画|绘制|生成)(?:一个|一组)?\s*(.{0,16}?)(?:像素|小人|角色|人物)/)
  const subject = (subjectMatch?.[1] || 'pixel').trim()
  return {
    type: 'grid_quick',
    action: 'character_turnaround',
    args: {
      subject: `${subject} pixel character`,
      style: 'pixel art',
      filter: /空白|空格子/.test(text) ? 'empty' : 'all',
    },
  }
}

function parseGridExpandFromSpeech(text: string): LocalCommand | null {
  const hasExpandWord = /(扩展|扩图|扩一格|扩一|加一格|往外扩|新增一格|扩一块|扩一片)/.test(text)
  const direction = parseExpandDirection(text)
  if (!hasExpandWord && !direction) return null
  if (!direction) return null
  const fromCell = parseCellCoordFromText(text)
  const prompt = extractGridPrompt(text)
  const isCharacter = /像素|小人|角色|人物|不同面|多视角/.test(text)

  if (isRegionExpandSpeech(text) || !fromCell) {
    return {
      type: 'grid_quick',
      action: 'expand_region',
      args: {
        direction,
        prompt: prompt || undefined,
        fill_mode: isCharacter ? 'turnaround' : undefined,
        seamless: true,
      },
    }
  }

  return {
    type: 'grid_quick',
    action: 'expand',
    args: {
      from_cell: fromCell,
      direction,
      prompt: prompt || undefined,
      seamless: true,
      use_previous: /之前|那个女生|这个女生|伤心|同样/.test(text),
    },
  }
}

/** 九宫格模式：AI 绘格、扩格、批量、视口平移（不走矢量绘图） */
export function matchGridVoiceCommand(text: string): LocalCommand | null {
  const t = text.trim()
  if (!t) return null

  if (/地图初始化|执行地图初始化|初始化地图/.test(t)) {
    return { type: 'workflow_macro', name: 'map_init' }
  }
  if (/新建九宫格|创建九宫格|初始化九宫格/.test(t)) {
    return { type: 'compose', action: 'grid_create' }
  }
  if (/清空九宫格|清除九宫格|重置九宫格|清空(所有)?格子|清除(所有)?格子|清空格阵|九宫格.*清空|格子.*清空/.test(t)) {
    return { type: 'grid_quick', action: 'clear_grid' }
  }
  if (/导出(瓦片|瓦片集|tile)|导出九宫格/.test(t)) {
    return { type: 'export_tiles' }
  }

  // 多视角角色 / 整块扩图 优先于单格扩图
  const turnaroundCmd = parseCharacterTurnaroundFromSpeech(t)
  if (turnaroundCmd) return turnaroundCmd

  const expandCmd = parseGridExpandFromSpeech(t)
  if (expandCmd) return expandCmd

  // 九宫格视图平移（无需说「格子」前缀；排除扩图类指令）
  const maybeExpand = /(扩展|扩图|扩一格|扩一|加一格)|向?(上|下|左|右)\s*扩/.test(t)
  if (!maybeExpand) {
    // 视角移动：向右=看右侧内容，向左=看左侧内容
    if (/向上移动|上移|往上移动|往上移|向上移|视图向上|往上看/.test(t)) {
      return { type: 'grid_quick', action: 'pan', args: { dx: 0, dy: 200 } }
    }
    if (/向下移动|下移|往下移动|往下移|向下移|视图向下|往下看/.test(t)) {
      return { type: 'grid_quick', action: 'pan', args: { dx: 0, dy: -200 } }
    }
    if (/向左移动|左移|往左移动|往左移|视图向左|往左看/.test(t)) {
      return { type: 'grid_quick', action: 'pan', args: { dx: 200, dy: 0 } }
    }
    if (/向右移动|右移|往右移动|往右移|视图向右|往右看/.test(t)) {
      return { type: 'grid_quick', action: 'pan', args: { dx: -200, dy: 0 } }
    }
  }
  if (/格子|九宫格|视图/.test(t) && /向左|左移|往左/.test(t)) {
    return { type: 'grid_quick', action: 'pan', args: { dx: 160, dy: 0 } }
  }
  if (/格子|九宫格|视图/.test(t) && /向右|右移|往右/.test(t)) {
    return { type: 'grid_quick', action: 'pan', args: { dx: -160, dy: 0 } }
  }
  if (/格子|九宫格|视图/.test(t) && /向上|上移|往上/.test(t)) {
    return { type: 'grid_quick', action: 'pan', args: { dx: 0, dy: 160 } }
  }
  if (/格子|九宫格|视图/.test(t) && /向下|下移|往下/.test(t)) {
    return { type: 'grid_quick', action: 'pan', args: { dx: 0, dy: -160 } }
  }
  if (/重置.*视图|回到中心|视图复位/.test(t)) {
    return { type: 'grid_quick', action: 'reset_view' }
  }

  const inheritCmd = parseGridInheritFromSpeech(t)
  if (inheritCmd) return inheritCmd

  const inpaintCmd = parseGridInpaintFromSpeech(t)
  if (inpaintCmd) return inpaintCmd

  // 占满九宫格 / 未指定位置的生图
  if (
    (/占满|铺满|整张|全格|整个/.test(t) && /九宫格|格子|格/.test(t))
    || (/生成|来一张|画一张|画一个图|画一幅|创作/.test(t) && !hasGridPositionHint(t) && !/切换|模式|扩图|扩展/.test(t))
  ) {
    const prompt = extractGridPrompt(t) || 'fantasy landscape panoramic scene'
    return { type: 'grid_quick', action: 'fill_grid', args: { prompt } }
  }

  // 与周围衔接 / 同风格
  if (/衔接|接缝|连上|同款|同风格|风格一致/.test(t) && /格|周围|相邻|邻|四周/.test(t)) {
    const coord = parseCellCoordFromText(t)
    const cellHint = parseCellHintFromSpeech(t)
    const prompt = extractGridPrompt(t) || 'match surrounding tiles'
    return {
      type: 'grid_quick',
      action: 'seamless',
      args: {
        cell: coord,
        hint: cellHint,
        prompt,
        blend_neighbors: true,
      },
    }
  }
  if (/和?(左边|右边|上边|下边|左侧|右侧|上方|下方).*(衔接|同风格|连上)/.test(t)) {
    const dirMap: Record<string, string> = {
      左边: 'left', 左侧: 'left', 右边: 'right', 右侧: 'right',
      上边: 'up', 上方: 'up', 下边: 'down', 下方: 'down',
    }
    const dirKey = Object.keys(dirMap).find((k) => t.includes(k))
    const prompt = extractGridPrompt(t) || 'seamless continuation'
    return {
      type: 'grid_quick',
      action: 'seamless',
      args: {
        cell: parseCellCoordFromText(t),
        hint: parseCellHintFromSpeech(t),
        direction: dirKey ? dirMap[dirKey] : undefined,
        prompt,
        blend_neighbors: true,
      },
    }
  }

  if (/选中|选择/.test(t) && /格/.test(t)) {
    const hint = parseCellHintFromSpeech(t) ?? parseCellCoordFromText(t) ?? (/中间|中心/.test(t) ? '中间' : undefined)
    if (hint) return { type: 'grid_quick', action: 'select', args: { hint } }
  }
  const coordOnly = parseCellCoordFromText(t)
  if (coordOnly && /选中|选择/.test(t)) {
    return { type: 'grid_quick', action: 'select', args: { hint: coordOnly } }
  }
  if (/中间格|中心格/.test(t)) {
    return { type: 'grid_quick', action: 'select', args: { hint: '中间' } }
  }

  const cellHint = parseCellHintFromSpeech(t) || parseCellCoordFromText(t)
  if (cellHint && hasExplicitDrawVerb(t) && !/(扩展|扩图|扩一格|扩一)/.test(t)) {
    const prompt = extractGridPrompt(t)
    return {
      type: 'grid_quick',
      action: 'redraw',
      args: { hint: cellHint, prompt: prompt || undefined },
    }
  }
  if (/这格|当前格|选中格/.test(t) && hasExplicitDrawVerb(t)) {
    const prompt = extractGridPrompt(t) || 'game tile'
    return { type: 'grid_quick', action: 'redraw', args: { prompt } }
  }

  if (/批量|填满|所有空|空格/.test(t) && /格|生成|画/.test(t)) {
    return {
      type: 'grid_quick',
      action: 'batch',
      args: { prompt: extractGridPrompt(t) || 'terrain tile top-down' },
    }
  }
  if (/统一风格|风格一致|同步风格/.test(t)) {
    return { type: 'grid_quick', action: 'style_sync', args: { prompt: t } }
  }

  return null
}

export function isAiGenerateIntent(text: string): boolean {
  if (isAiControlCommand(text)) return false
  const cmd = matchAiModeCommand(text)
  return cmd?.type === 'ai_quick' && cmd.action === 'generate'
}

export function matchLocalVoiceCommand(text: string): LocalCommand | null {
  const t = text.trim()
  if (!t) return null

  const universal = matchUniversalVoiceCommand(t)
  if (universal) return universal

  // 矢量绘图优先于 AI；多指令句跳过本地，交给 DeepSeek
  if (!isMultiCommand(t)) {
    const vectorDraw = matchDrawVoiceCommand(t)
    if (vectorDraw) return vectorDraw
  }

  const pathType = parsePathTemplate(t)
  if (pathType || /画.*(路径|曲线|折线)|手绘|涂鸦|画笔/.test(t)) {
    const colorMatch = t.match(new RegExp(COLOR_WORDS))
    return {
      type: 'draw_path',
      args: {
        pathType: pathType ?? 'brush_stroke',
        color: colorMatch?.[0],
        position: /左上|右上|左下|右下|中间|居中/.test(t) ? t : '中间',
      },
    }
  }

  const rowMatch = t.match(/横(向|排).*?(\d+)\s*个(圆|圆形|方块|矩形)/)
  if (rowMatch) {
    return {
      type: 'compose',
      action: 'arrange_row',
      args: { count: Number(rowMatch[2]), shape: /圆/.test(rowMatch[3]) ? 'circle' : 'rect' },
    }
  }

  if (/像素风|水彩风|油画风|赛博朋克风/.test(t) && /生成|画/.test(t)) {
    const style = /像素/.test(t) ? 'pixel art' : /水彩/.test(t) ? 'watercolor' : /油画/.test(t) ? 'oil painting' : 'cyberpunk'
    const prompt = t.replace(/生成|画|一张|的/g, '').trim() || style
    return { type: 'ai_quick', action: 'style_generate', args: { style, prompt } }
  }
  if (/横版|竖版|方形/.test(t) && /生成/.test(t)) {
    const aspect = /横版/.test(t) ? '16:9' : /竖版/.test(t) ? '9:16' : '1:1'
    return { type: 'ai_quick', action: 'generate', args: { aspect, prompt: t } }
  }

  return null
}

/** AI 创作模式下的生图指令（优先于矢量 DeepSeek 管线） */
export function matchAiModeCommand(text: string): LocalCommand | null {
  const t = text.trim()
  if (!t) return null
  if (/切换到.*AI|AI创作|AI模式|进入.*AI|开启.*AI|奇幻.*AI/i.test(t)) {
    return { type: 'switch_mode', mode: 'ai' }
  }
  if (/重新生成|再生成一次|换一个/.test(t)) return { type: 'ai_quick', action: 'regenerate' }
  if (/生成变体|再来一张类似的/.test(t)) return { type: 'ai_quick', action: 'variation' }
  if (/像素风|水彩风|油画风|赛博朋克风/.test(t) && /生成|画/.test(t)) {
    const style = /像素/.test(t) ? 'pixel art' : /水彩/.test(t) ? 'watercolor' : /油画/.test(t) ? 'oil painting' : 'cyberpunk'
    const prompt = t.replace(/生成|画|一张|的/g, '').trim() || style
    return { type: 'ai_quick', action: 'style_generate', args: { style, prompt } }
  }
  if (/横版|竖版|方形/.test(t) && /生成/.test(t)) {
    const aspect = /横版/.test(t) ? '16:9' : /竖版/.test(t) ? '9:16' : '1:1'
    return { type: 'ai_quick', action: 'generate', args: { aspect, prompt: t } }
  }
  if (/生成|来一张|画一张|创作|风格|城市|风景|人物|场景|奇幻/.test(t)) {
    return { type: 'ai_quick', action: 'generate', args: { prompt: t } }
  }
  return null
}

function isComicStyleCommand(text: string): boolean {
  if (/切换|进入|改为|改成|模式/.test(text)) return false
  return (
    /(设定|设置|把).*(风格|画风)/.test(text)
    || /(风格|画风).*(设定|设为|改成|改为|是|为)/.test(text)
    || /漫画\s*(风格|画风)\s*(为|是)/.test(text)
    || /(风格|画风)\s*(为|是)/.test(text)
  )
}

function extractComicStyleText(text: string): string {
  return text
    .replace(/设定|设置|把|漫画|风格|画风|为|是|：|:|改成|改为|一下|请/g, '')
    .trim()
}

function isComicBackgroundCommand(text: string): boolean {
  if (/切换|进入|改为|改成|模式/.test(text)) return false
  return (
    /(设定|设置).*(故事背景|背景设定|世界观)/.test(text)
    || /(故事背景|世界观).*(设定|设为|是|为)/.test(text)
    || /故事背景\s*(为|是)/.test(text)
    || /世界观\s*(为|是)/.test(text)
  )
}

function extractComicBackgroundText(text: string): string {
  return text
    .replace(/设定|设置|故事背景|背景设定|世界观|为|是|：|:|一下|请/g, '')
    .trim()
}

/** 从「打开默认漫画」「切换到漫画二」等口语中提取项目名 */
function extractSwitchProjectName(text: string): string | null {
  let t = text.trim().replace(/[。.!！?？，,；;]+$/g, '')
  if (!/(切换|打开|进入)/.test(t) || /模式/.test(t)) return null

  t = t
    .replace(/^(?:请|帮我|给我)?(?:切换|打开|进入)(?:到|至|一下)?/u, '')
    .replace(/^项目/u, '')
    .replace(/(?:吧|呀|呢|啊)$/u, '')
    .trim()
  if (!t) return null
  if (/^漫画(?:创作|模式|工作台)$/u.test(t)) return null

  const numMatch = t.match(/^漫画\s*([一二三四五六七八九十两\d]{1,3})$/u)
  if (numMatch) return numMatch[1]

  return t
}

function parseEpisodeNumberFromText(text: string): number | null {
  const nums = parseEpisodeNumbersFromText(text)
  return nums[0] ?? null
}

/** 漫画模式语音：角色创建、剧本撰写、分集漫画生成 */
export function matchComicVoiceCommand(text: string): LocalCommand | null {
  const t = text.trim()
  if (!t) return null

  const epNum = parseEpisodeNumberFromText(t)

  if (
    /(关掉|关闭|收起|退出|取消)/.test(t)
    && /(弹窗|详情|窗口|对话框|面板|这个|详情页)/.test(t)
  ) {
    return { type: 'comic_quick', action: 'close_detail', args: {} }
  }
  if (/^(关掉|关闭|收起|退出)$/.test(t)) {
    return { type: 'comic_quick', action: 'close_detail', args: {} }
  }

  if (/(新建|创建|开始).*(漫画|项目|连载|新故事|新剧情)/.test(t) && !/角色|剧本/.test(t)) {
    const nameMatch = t.match(/(?:叫|名为|命名为|叫做)\s*([^\s，,。.]{1,16})/)
    return { type: 'comic_quick', action: 'new_project', args: { name: nameMatch?.[1] } }
  }

  if (/(切换|打开|进入)/.test(t) && !/模式/.test(t)) {
    const name = extractSwitchProjectName(t)
    if (name) {
      return { type: 'comic_quick', action: 'switch_project', args: { name } }
    }
  }

  if (/(删除|移除|去掉).*(漫画项目|项目|漫画)/.test(t) && !/(角色|剧本|页|张|分镜|图片|绘制|第\s*\d)/.test(t)) {
    const keys = parseProjectKeysFromText(t)
    if (keys.length > 1) {
      return { type: 'comic_quick', action: 'delete_projects', args: { names: keys } }
    }
    const nameMatch = t.match(/(?:项目|漫画)\s*([^\s，,。.]{1,16})/)
    if (keys.length === 1) {
      return { type: 'comic_quick', action: 'delete_project', args: { name: keys[0] } }
    }
    return { type: 'comic_quick', action: 'delete_project', args: { name: nameMatch?.[1] } }
  }

  if (/(删除|移除|去掉).*角色/.test(t)) {
    const nameMatch =
      t.match(/(?:删除|移除|去掉).*?角色\s*([^\s，,。.]{1,8})/)
      ?? t.match(/([^\s，,。.]{1,8})\s*(?:这个角色|的角色)/)
    return {
      type: 'comic_quick',
      action: 'delete_character',
      args: { name: nameMatch?.[1] },
    }
  }

  if (
    (/(删除|移除|去掉).*(剧本|剧情|分集)/.test(t) || /(删除|移除).*第.+集/.test(t))
    && epNum
    && !/(漫画|分镜|图片|绘制|页|张|图)/.test(t)
  ) {
    return { type: 'comic_quick', action: 'delete_episode', args: { episode_number: epNum } }
  }

  if (
    (/(删除|清除|去掉).*(漫画|分镜|图片|绘制)/.test(t) || /清除.*第.+集.*漫画/.test(t))
    && epNum
    && !/[页张图]/.test(t)
  ) {
    return { type: 'comic_quick', action: 'clear_episode_comic', args: { episode_number: epNum } }
  }

  if (/(删除|移除).*(页|张|图)/.test(t) && epNum) {
    const pages = parsePageNumbersFromText(t)
    if (pages.length) {
      return {
        type: 'comic_quick',
        action: 'delete_panels',
        args: { episode_number: epNum, page_numbers: pages },
      }
    }
  }

  if (/(看|查看|显示|打开|展示)/.test(t) && !/画|创建|新建|设计|生成|绘制/.test(t)) {
    if (/(故事背景|背景设定|世界观)/.test(t)) {
      return { type: 'comic_quick', action: 'view_story', args: {} }
    }
    if (/(角色|人物|立绘)/.test(t)) {
      const nameMatch =
        t.match(/(?:角色|人物|立绘)\s*([^\s，,。.]{1,10})/)
        ?? t.match(/([^\s，,。.]{1,10})\s*(?:的角色|的人设|的形象|的立绘)/)
      let name = nameMatch?.[1]?.trim()
      const generic = /^(全部|所有|全体|详情|信息|列表|角色|人物|立绘|的)$/
      if (name && generic.test(name)) name = undefined
      if (/(全部|所有|全体)/.test(t)) name = undefined
      return {
        type: 'comic_quick',
        action: 'view_character',
        args: name ? { name } : {},
      }
    }
    if (/(剧情|剧本|分集)/.test(t)) {
      return {
        type: 'comic_quick',
        action: 'view_episode',
        args: epNum ? { episode_number: epNum } : {},
      }
    }
  }

  if (isComicStyleCommand(t)) {
    const style = extractComicStyleText(t)
    return { type: 'comic_quick', action: 'set_style', args: { style: style || t } }
  }

  if (isComicBackgroundCommand(t)) {
    const background = extractComicBackgroundText(t)
    return { type: 'comic_quick', action: 'set_background', args: { background: background || t } }
  }

  if (/(重新生成|再生成|重做).*(漫画|分镜)/.test(t) && epNum && !/[页张图]/.test(t)) {
    return { type: 'comic_quick', action: 'regenerate_episode', args: { episode_number: epNum } }
  }

  if (
    (/(局部重绘|重绘|重新画|再画|重画)/.test(t) && /(漫画|分镜|页|张|图)/.test(t))
    || /(漫画|分镜).*(局部重绘|重绘|重画)/.test(t)
  ) {
    const pages = parsePageNumbersFromText(t)
    if (epNum && pages.length) {
      return {
        type: 'comic_quick',
        action: 'redraw_panels',
        args: { episode_number: epNum, page_numbers: pages },
      }
    }
  }

  if (/(生成|绘制|画).*(漫画|分镜)/.test(t)) {
    const epNums = parseEpisodeNumbersFromText(t)
    if (epNums.length > 1) {
      return { type: 'comic_quick', action: 'generate_episodes', args: { episode_numbers: epNums } }
    }
    if (epNum) {
      return { type: 'comic_quick', action: 'generate_episode', args: { episode_number: epNum } }
    }
  }

  if (/(重新生成|再生成|重做).*(剧本|剧情)/.test(t) && (epNum || /剧本|剧情/.test(t))) {
    const synopsis = t.replace(/重新生成|再生成|重做|第.+集|剧本|剧情/g, '').trim()
    return {
      type: 'comic_quick',
      action: 'regenerate_script',
      args: { episode_number: epNum ?? 1, synopsis },
    }
  }

  if (/(重新生成|再生成|重做).*角色/.test(t)) {
    const nameMatch = t.match(/角色\s*([^\s，,。.]{1,8})/)
    return {
      type: 'comic_quick',
      action: 'regenerate_character',
      args: { name: nameMatch?.[1], description: t },
    }
  }

  if (/(修改|改|调整|更新).*(剧本|剧情)/.test(t) && (epNum || /剧本|剧情/.test(t))) {
    const revision = t
      .replace(/修改|改|调整|更新|第.+集|剧本|剧情|故事/g, '')
      .trim()
    return {
      type: 'comic_quick',
      action: 'edit_script',
      args: { episode_number: epNum ?? 1, revision: revision || t },
    }
  }

  if (/导出.*pdf|下载.*pdf|pdf.*导出|导出.*漫画/i.test(t)) {
    return {
      type: 'comic_quick',
      action: 'export_pdf',
      args: { episode_number: epNum ?? undefined },
    }
  }

  if (/(写|创作|生成).*(剧本|剧情)/.test(t)) {
    const synopsis = t
      .replace(/写|创作|生成|第.+集|剧本|剧情|故事|关于/g, '')
      .replace(/^[\s,，。.ok]+|[\s,，。.]+$/gi, '')
      .trim()
    return {
      type: 'comic_quick',
      action: 'create_script',
      args: { episode_number: epNum ?? 1, synopsis },
    }
  }

  if (/创作\s*第\s*(\d+|[一二三四五六七八九十]+)\s*集/.test(t) && !/漫画|分镜/.test(t)) {
    const synopsis = t.replace(/创作|第.+集/g, '').trim()
    return {
      type: 'comic_quick',
      action: 'create_script',
      args: { episode_number: epNum ?? 1, synopsis },
    }
  }

  if (
    /创建角色|新建角色|设计角色|角色设定|角色立绘|生成.*角色|生成角色|画.*角色|画.*立绘/.test(t)
    && !/剧本|剧情|漫画|分镜|pdf/i.test(t)
  ) {
    const nameMatch =
      t.match(/(?:生成|创建|画).*?角色\s*([^\s，,。.女性男性]{1,8})/)
      ?? t.match(/(?:角色|立绘)\s*([^\s，,。.女性男性]{1,8})/)
    return {
      type: 'comic_quick',
      action: 'create_character',
      args: {
        description: t,
        name: nameMatch?.[1],
      },
    }
  }

  return null
}

export const WELCOME_MESSAGE =
  '欢迎使用 VoiceCanvas。可说「指令手册」查看全部语音指令。默认识别为讯飞极速转写，可说切换浏览器识别。'

export const HELP_MESSAGE =
  '说「指令手册」或「查看指令」可打开完整指令列表。' +
  '常用：画红色圆形、改蓝色、放大、撤销、保存；切换漫画创作、AI 创作、九宫格；' +
  '识别引擎：切换讯飞识别、切换浏览器识别。'
