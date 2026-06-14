import { generateImage, generateModel3D, getModel3DTask } from '../services/api'
import { beginGeneration, throwIfCancelled } from '../services/generationControl'
import type { LocalCommand } from '../services/voiceCommands'
import { useAppStore } from '../stores/appStore'
import type { ToolCall, ExecutionResultItem } from '../types'
import {
  addImageFromSource,
  clearCanvas,
  deleteLastObject,
  drawPath,
  drawShape,
  duplicateLastObject,
  fitImageToCanvas,
  fitWindow,
  expandCanvasSize,
  getCanvasDataUrl,
  getLastDrawnObject,
  layerControl,
  panCanvas,
  redo,
  saveCanvasAsPng,
  selectObjectByHint,
  selectRegion,
  setObjectStyle,
  transformObject,
  type FabricCanvasRef,
  undo,
  zoomCanvas,
  zoomTo,
} from './fabricEngine'
import {
  createCharacterAsset,
  createEpisodeScript,
  generateComicEpisode,
  generateComicEpisodes,
  reviseEpisodeScript,
  exportComicPdf,
  regenerateCharacterAsset,
  regenerateEpisodeScript,
  regenerateComicEpisode,
  redrawComicPanels,
  createNewComicProject,
  switchComicProject,
  deleteComicProject,
  deleteComicProjects,
  deleteCharacterByName,
  deleteEpisodeByNumber,
  clearEpisodeComicImages,
  deleteEpisodePages,
  closeComicDetail,
  setComicVisualStyle,
  setComicStoryBackground,
  showCharacterDetail,
  showEpisodeDetail,
  showStoryBackground,
} from './comicEngine'
import {
  alignObjects,
  arrangeRow,
  distributeHorizontally,
  drawFlowchart,
  drawStickFigure,
  snapSelectedToCenter,
  toggleGuideGrid,
} from './compositionEngine'
import {
  parseCanvasAnchor,
  parsePointToHint,
  parseSpatialHint,
  splitSpatialClauses,
} from './spatialEngine'
import { buildObjectsSummary, buildSceneGraph, snapshotObject } from './sceneGraph'
import {
  cellId,
  clearGridCells,
  createGrid,
  downloadGridImage,
  expandCell,
  expandGridRegion,
  exportTilesSpritesheet,
  fillGridWithUnifiedImage,
  fillNewCellsWithUnifiedImage,
  getExpansionEdgeReference,
  getFilledGridCells,
  buildCharacterTurnaroundPlan,
  buildTurnaroundPlanForCells,
  getAdjacentReferenceImage,
  getExpandAnchorReference,
  getGridStyleReference,
  getSeamReference,
  moveCell,
  resizeDataUrlToJpegBase64,
  extractBase64FromDataUrl,
  parseCellId,
  resolveCellHint,
  splitImageToGrid,
} from './gridEngine'

export interface ExecutorContext {
  canvas: FabricCanvasRef | null
  onStep?: (msg: string) => void
}

const MODE_LABELS: Record<string, string> = {
  free: '自由画布',
  ai: 'AI 创作',
  grid: '九宫格',
  '3d': '3D 创作',
}

function prepareDrawCanvas(canvas: FabricCanvasRef | null): FabricCanvasRef | null {
  return canvas
}

export function refreshCanvasSize(canvas: FabricCanvasRef): void {
  canvas.requestRenderAll()
}

const TOOL_LABELS: Record<string, string> = {
  draw_shape: '绘制图形', draw_path: '绘制路径', select_object: '选中对象',
  align_objects: '对齐对象', distribute_objects: '分布对象', draw_template: '绘制模板',
  toggle_guide_grid: '辅助网格', snap_center: '居中对象', ai_generate: 'AI生图',
  ai_regenerate: '重新生成', ai_variation: '生成变体', grid_create: '创建九宫格',
  grid_split: '切分九宫格', grid_redraw: '格级重绘', ai_generate_3d: '生成3D模型',
  export_tiles: '导出瓦片集', style_sync: '风格统一', workflow_macro: '工作流',
  save_canvas: '保存画布', set_style: '修改样式', object_transform: '变换对象',
}

async function runAiGenerate(
  canvas: FabricCanvasRef,
  args: Record<string, unknown>,
  provider: 'minimax' | 'doubao',
  onStep?: (msg: string) => void,
): Promise<boolean> {
  const store = useAppStore.getState()
  if (store.aiGenerating) {
    onStep?.('已有图片正在生成，请稍候')
    return false
  }
  const label = provider === 'minimax' ? 'MiniMax' : '豆包'
  const prompt = String(args.prompt ?? '').trim()
  const imageFit: 'cover' | 'contain' =
    args.image_fit === 'cover' || /占满|铺满|填满|全屏/.test(prompt) ? 'cover' : 'contain'
  const loadingMsg = `正在使用 ${label} 生成图片，请稍候…`
  onStep?.(loadingMsg)
  store.setAiGenerating(true, loadingMsg)
  store.setLastReply(loadingMsg)
  store.setVoiceStatus('executing')
  try {
    const result = await generateImage({
      prompt: prompt || '风景',
      aspect_ratio: String(args.aspect_ratio ?? '1:1'),
      provider: (args.provider as 'minimax' | 'doubao') || provider,
      size: String(args.size ?? '2K'),
      reference_image_base64: args.reference_image_base64 as string | undefined,
    })
    if (result.images[0]) {
      await addImageFromSource(canvas, result.images[0], result.format, imageFit)
      store.setLastAiPrompt(prompt || '风景', String(args.aspect_ratio ?? '1:1'))
      return true
    }
    return false
  } finally {
    store.setAiGenerating(false)
    if (store.voiceStatus === 'executing') {
      store.setVoiceStatus('idle')
    }
  }
}

async function prepareReferenceBase64(
  rawRef: string | undefined,
): Promise<string | undefined> {
  if (!rawRef) return undefined
  try {
    const dataUrl = rawRef.startsWith('data:') ? rawRef : `data:image/jpeg;base64,${rawRef}`
    return await resizeDataUrlToJpegBase64(dataUrl, 768)
  } catch {
    return rawRef.includes(',') ? rawRef.split(',')[1] : rawRef
  }
}

async function runGridRedraw(
  cellIdStr: string,
  args: Record<string, unknown>,
  provider: 'minimax' | 'doubao',
  referenceBase64?: string,
) {
  const store = useAppStore.getState()
  const direction = args.direction as 'up' | 'down' | 'left' | 'right' | undefined
  const seamless = Boolean(args.seamless ?? args.blend_neighbors ?? args.inpaint)
  const seamFrom = args.seam_from ? String(args.seam_from) : undefined
  const usePrevious = Boolean(args.use_previous ?? /之前|那个|这个女生|同一张/.test(String(args.prompt ?? '')))

  let rawRef = referenceBase64
  if (!rawRef && seamFrom) rawRef = getExpandAnchorReference(store.gridCells, seamFrom)
  if (!rawRef && seamless) rawRef = getSeamReference(store.gridCells, cellIdStr, direction)
  if (!rawRef) {
    rawRef = getGridStyleReference(store.gridCells, {
      targetCell: cellIdStr,
      preferCell: seamFrom,
      lastAiImage: store.lastAiImageDataUrl,
      usePrevious,
    })
  }
  if (!rawRef) rawRef = getAdjacentReferenceImage(store.gridCells, cellIdStr)

  const ref = await prepareReferenceBase64(rawRef)
  const effectiveProvider: 'minimax' | 'doubao' = ref ? 'minimax' : provider

  const rawPrompt = String(args.prompt ?? '').trim() || 'game terrain tile top-down'
  const prompt = ref
    ? `${rawPrompt}, same art style and character as reference, seamless tile, high quality illustration`
    : rawPrompt

  store.upsertCell({
    ...store.gridCells[cellIdStr],
    id: cellIdStr,
    row: parseCellId(cellIdStr).row,
    col: parseCellId(cellIdStr).col,
    status: 'generating',
  })

  try {
    const result = await generateImage({
      prompt,
      aspect_ratio: '1:1',
      provider: effectiveProvider,
      reference_image_base64: ref,
    })
    if (result.images[0]) {
      const src = result.format === 'base64'
        ? `data:image/jpeg;base64,${result.images[0]}`
        : result.images[0]
      store.upsertCell({
        ...store.gridCells[cellIdStr],
        id: cellIdStr,
        row: parseCellId(cellIdStr).row,
        col: parseCellId(cellIdStr).col,
        imageData: src,
        prompt: rawPrompt,
        status: 'filled',
      })
      store.setLastAiImageDataUrl(src)
    } else {
      store.upsertCell({
        ...store.gridCells[cellIdStr],
        id: cellIdStr,
        row: parseCellId(cellIdStr).row,
        col: parseCellId(cellIdStr).col,
        status: 'empty',
      })
    }
  } catch (err) {
    store.upsertCell({
      ...store.gridCells[cellIdStr],
      id: cellIdStr,
      row: parseCellId(cellIdStr).row,
      col: parseCellId(cellIdStr).col,
      status: store.gridCells[cellIdStr]?.imageData ? 'filled' : 'empty',
    })
    throw err
  }
}

/** 局部重绘：以参考图保持角色/画风，只改指定内容 */
async function runGridInpaint(
  cellIdStr: string,
  args: Record<string, unknown>,
  _provider: 'minimax' | 'doubao',
) {
  const store = useAppStore.getState()
  const usePrevious = Boolean(args.use_previous ?? /之前|那个|这个女生|伤心|同一张/.test(String(args.prompt ?? '')))
  const preferCell = args.reference_cell
    ? String(args.reference_cell)
    : args.inherit_from
      ? String(args.inherit_from)
      : undefined

  let rawRef = getGridStyleReference(store.gridCells, {
    targetCell: cellIdStr,
    preferCell,
    lastAiImage: store.lastAiImageDataUrl,
    usePrevious: usePrevious || !store.gridCells[cellIdStr]?.imageData,
  })
  if (!rawRef && store.gridCells[cellIdStr]?.imageData) {
    rawRef = extractBase64FromDataUrl(store.gridCells[cellIdStr].imageData!)
  }
  const ref = await prepareReferenceBase64(rawRef)
  if (!ref) {
    throw new Error('没有可参考的图片，请先生成或占满九宫格后再局部重绘')
  }

  const rawPrompt = String(args.prompt ?? '').trim() || 'same scene with subtle variation'
  const prompt = `Based on reference image, modify this tile: ${rawPrompt}. Keep identical art style, character face, colors and illustration quality. Only change what is requested.`

  store.upsertCell({
    ...store.gridCells[cellIdStr],
    id: cellIdStr,
    row: parseCellId(cellIdStr).row,
    col: parseCellId(cellIdStr).col,
    status: 'generating',
  })

  try {
    const result = await generateImage({
      prompt,
      aspect_ratio: '1:1',
      provider: 'minimax',
      reference_image_base64: ref,
    })
    if (!result.images[0]) throw new Error('AI 未返回图片')
    const src = result.format === 'base64'
      ? `data:image/jpeg;base64,${result.images[0]}`
      : result.images[0]
    store.upsertCell({
      ...store.gridCells[cellIdStr],
      id: cellIdStr,
      row: parseCellId(cellIdStr).row,
      col: parseCellId(cellIdStr).col,
      imageData: src,
      prompt: rawPrompt,
      status: 'filled',
    })
    store.setLastAiImageDataUrl(src)
  } catch (err) {
    store.upsertCell({
      ...store.gridCells[cellIdStr],
      id: cellIdStr,
      row: parseCellId(cellIdStr).row,
      col: parseCellId(cellIdStr).col,
      status: store.gridCells[cellIdStr]?.imageData ? 'filled' : 'empty',
    })
    throw err
  }
}

async function runCharacterTurnaround(
  args: Record<string, unknown>,
  onStep?: (msg: string) => void,
): Promise<string> {
  const store = useAppStore.getState()
  if (!Object.keys(store.gridCells).length) {
    store.setGridCells(createGrid(3, 3, store.cellSize))
  }
  const rawSubject = String(args.subject ?? args.prompt ?? 'pixel character').trim()
  const style = String(args.style ?? (/像素/.test(rawSubject) ? 'pixel art' : 'pixel art'))
  const subject = rawSubject.replace(/像素|小人|角色|人物|每个格|所有格|不同面|不同角度/g, '').trim() || 'pixel hero'
  const filter = String(args.filter ?? 'all')
  const allPlan = buildCharacterTurnaroundPlan(store.gridCells, subject, style)
  const plan = filter === 'empty'
    ? allPlan.filter((p) => !store.gridCells[p.cellId]?.imageData)
    : allPlan
  if (!plan.length) return '没有需要绘制的格子'

  store.setAiGenerating(true, '正在绘制多视角角色…')
  const token = beginGeneration()
  let anchorRef: string | undefined
  const anchorCell = String(args.reference_cell ?? plan[0].cellId)
  try {
    for (const [idx, item] of plan.entries()) {
      throwIfCancelled(token)
      onStep?.(`正在绘制${item.label}视角 ${item.cellId}（${idx + 1}/${plan.length}）`)
      const ref = anchorRef ?? (store.gridCells[anchorCell]?.imageData
        ? extractBase64FromDataUrl(store.gridCells[anchorCell].imageData!)
        : undefined)
      await runGridRedraw(item.cellId, { prompt: item.prompt }, store.imageProvider, ref)
      if (!anchorRef) {
        const firstId = plan[0].cellId
        const img = store.gridCells[firstId]?.imageData
        if (img) anchorRef = extractBase64FromDataUrl(img)
      }
    }
    return `已为 ${plan.length} 个格子绘制多视角${style}角色`
  } catch (err) {
    if (err instanceof Error && err.message === 'GENERATION_CANCELLED') {
      return '角色绘制已停止'
    }
    throw err
  } finally {
    store.setAiGenerating(false)
  }
}

async function runExpandGridRegion(
  args: Record<string, unknown>,
  onStep?: (msg: string) => void,
): Promise<string> {
  const store = useAppStore.getState()
  if (!Object.keys(store.gridCells).length) {
    store.setGridCells(createGrid(3, 3, store.cellSize))
  }
  const direction = String(args.direction ?? 'up') as 'up' | 'down' | 'left' | 'right'
  const before = store.gridCells
  const { cells, newCellIds } = expandGridRegion(before, direction)
  store.setGridCells(cells)
  if (!newCellIds.length) return '该方向没有可扩展的新格'

  const focusId = newCellIds[Math.floor(newCellIds.length / 2)]
  store.focusGridCell(focusId)

  const mode = String(args.fill_mode ?? '')
  const rawPrompt = String(args.prompt ?? '').trim()
  const isCharacter = mode === 'turnaround' || /像素|小人|角色|人物|多视角|不同面|不同角度/.test(rawPrompt)

  if (isCharacter) {
    onStep?.(`新扩展了 ${newCellIds.length} 格，正在绘制延续的多视角角色…`)
    const subject = rawPrompt.replace(/像素|小人|角色|人物|多视角/g, '').trim() || 'pixel character'
    const existingCount = Object.keys(before).length
    const plan = buildTurnaroundPlanForCells(newCellIds, cells, subject, 'pixel art', existingCount)
    store.setAiGenerating(true, '正在扩展区域并绘制角色…')
    let anchorRef: string | undefined
    const filled = getFilledGridCells(before)
    if (filled.length) anchorRef = extractBase64FromDataUrl(filled[0].imageData!)
    try {
      for (const [idx, item] of plan.entries()) {
        onStep?.(`扩展格 ${item.cellId}：${item.label}视角（${idx + 1}/${plan.length}）`)
        await runGridRedraw(item.cellId, { prompt: item.prompt }, store.imageProvider, anchorRef)
      }
      return `已向${direction}扩展 ${newCellIds.length} 格并完成多视角角色绘制`
    } finally {
      store.setAiGenerating(false)
    }
  }

  if (rawPrompt) {
    store.setAiGenerating(true, '正在扩展区域并绘制…')
    const token = beginGeneration()
    try {
      onStep?.(`新扩展了 ${newCellIds.length} 格，正在生成完整画面…`)
      const edgeRef = getExpansionEdgeReference(before, newCellIds, direction)
      const merged = await fillNewCellsWithUnifiedImage(
        cells,
        newCellIds,
        rawPrompt,
        store.imageProvider,
        (opts) => generateImage({ ...opts, size: '2K' }),
        direction,
        edgeRef,
      )
      throwIfCancelled(token)
      store.setGridCells(merged)
      return `已向${direction}扩展 ${newCellIds.length} 格并完成整图绘制`
    } catch (err) {
      if (err instanceof Error && err.message === 'GENERATION_CANCELLED') {
        return '扩图绘制已停止'
      }
      throw err
    } finally {
      store.setAiGenerating(false)
    }
  }

  const filled = getFilledGridCells(before)
  if (filled.length > 0) {
    store.setAiGenerating(true, '正在衔接扩展区域…')
    const token = beginGeneration()
    const extendPrompt = filled[0].prompt || 'continue the same panoramic scene seamlessly'
    try {
      onStep?.(`新扩展了 ${newCellIds.length} 格，正在衔接已有画面…`)
      const edgeRef = getExpansionEdgeReference(before, newCellIds, direction)
      const merged = await fillNewCellsWithUnifiedImage(
        cells,
        newCellIds,
        extendPrompt,
        store.imageProvider,
        (opts) => generateImage({ ...opts, size: '2K' }),
        direction,
        edgeRef,
      )
      throwIfCancelled(token)
      store.setGridCells(merged)
      return `已向${direction}扩展 ${newCellIds.length} 格并衔接已有画面`
    } catch (err) {
      if (err instanceof Error && err.message === 'GENERATION_CANCELLED') {
        return '扩图绘制已停止'
      }
      throw err
    } finally {
      store.setAiGenerating(false)
    }
  }

  return `已向${direction}扩展 ${newCellIds.length} 格（${newCellIds.join('、')}）`
}

const CANVAS_CONTROL_LABELS: Record<string, string> = {
  zoom_in: '已放大',
  zoom_out: '已缩小',
  zoom_to: '缩放已调整',
  fit_window: '已适应窗口',
  reset_view: '视图已复位',
  clear: '画布已清空',
  pan_left: '画布已左移',
  pan_right: '画布已右移',
  pan_up: '画布已上移',
  pan_down: '画布已下移',
  expand_left: '画布已向左扩展',
  expand_right: '画布已向右扩展',
  expand_top: '画布已向上扩展',
  expand_bottom: '画布已向下扩展',
}

const GENERIC_CANVAS_REPLY = '画布已更新'

/** 从工具执行结果生成语音反馈，避免重复「画布已更新」 */
export function summarizeToolResults(
  results: ExecutionResultItem[],
  fallback: string,
): string {
  const messages = results
    .filter((r) => r.success && r.message?.trim())
    .map((r) => r.message!.trim())
    .filter((m) => m !== GENERIC_CANVAS_REPLY)

  const unique = [...new Set(messages)]
  if (unique.length === 1) return unique[0]
  if (unique.length > 1) {
    return `${unique[unique.length - 1]}，共完成 ${unique.length} 步`
  }

  const fb = fallback.trim()
  if (fb && fb !== GENERIC_CANVAS_REPLY) return fb
  return results.some((r) => r.success) ? '已完成' : '未能执行该操作'
}

export async function executeTools(
  tools: ToolCall[],
  ctx: ExecutorContext,
): Promise<ExecutionResultItem[]> {
  const results: ExecutionResultItem[] = []
  const store = useAppStore.getState()
  const { canvas, onStep } = ctx
  const normalized = tools.map((t) => ({
    name: normalizeToolName(t.name),
    arguments: normalizeToolArgs(t.name, t.arguments ?? {}),
  }))
  const total = normalized.length

  for (let i = 0; i < total; i++) {
    const tool = normalized[i]
    const args = tool.arguments ?? {}
    const stepLabel = TOOL_LABELS[tool.name] ?? tool.name
    const stepMsg = total > 1 ? `第${i + 1}步，共${total}步：${stepLabel}` : stepLabel
    onStep?.(stepMsg)

    switch (tool.name) {
      case 'draw_shape': {
        const c = prepareDrawCanvas(canvas)
        if (c) {
          drawShape(c, args)
          const msg = '已绘制图形'
          results.push(snapshotObject(getLastDrawnObject(), tool.name, msg))
        } else results.push({ tool: tool.name, success: false, message: '画布未就绪' })
        break
      }

      case 'draw_path': {
        const c = prepareDrawCanvas(canvas)
        if (c) {
          drawPath(c, args)
          const msg = '已绘制路径'
          results.push(snapshotObject(getLastDrawnObject(), tool.name, msg))
        } else results.push({ tool: tool.name, success: false, message: '画布未就绪' })
        break
      }

      case 'select_object': {
        if (!canvas) break
        const obj = selectObjectByHint(canvas, {
          index: args.index != null ? Number(args.index) : undefined,
          ordinal: args.ordinal ? String(args.ordinal) : undefined,
          type: args.type ? String(args.type) : undefined,
          color: args.color ? String(args.color) : undefined,
        })
        const msg = obj ? `已选中第${args.index ?? args.ordinal ?? ''}个对象` : '未找到目标对象'
        results.push(snapshotObject(obj, tool.name, msg))
        break
      }

      case 'align_objects': {
        if (!canvas) break
        const dir = String(args.direction ?? 'center') as 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
        const ok = alignObjects(canvas, dir)
        results.push({ tool: tool.name, success: ok, message: ok ? '对象已对齐' : '没有可对齐的对象' })
        break
      }

      case 'distribute_objects': {
        const ok = !!(canvas && distributeHorizontally(canvas, Number(args.spacing ?? 24)))
        results.push({ tool: tool.name, success: ok, message: ok ? '对象已等间距排列' : '至少需要两个对象' })
        break
      }

      case 'snap_center': {
        const ok = !!(canvas && snapSelectedToCenter(canvas))
        results.push({ tool: tool.name, success: ok, message: ok ? '已移到画布中心' : '没有可居中的对象' })
        break
      }

      case 'draw_template': {
        if (!canvas) break
        const name = String(args.template ?? args.name ?? 'flowchart')
        if (name === 'flowchart') drawFlowchart(canvas, String(args.color ?? '#2d2d2d'))
        else if (name === 'stick_figure') {
          drawStickFigure(canvas, canvas.getWidth() / 2, canvas.getHeight() / 2, String(args.color ?? '#2d2d2d'))
        } else if (name === 'arrange_row') {
          arrangeRow(canvas, Number(args.count ?? 3), String(args.shape ?? 'circle'), String(args.color ?? '#2d2d2d'))
        } else if (name === 'smiley' || name === 'smiley_face' || name === 'face') {
          drawShape(canvas, { shape: 'smiley', color: args.color, ...args })
        }
        results.push(snapshotObject(getLastDrawnObject(), tool.name, '模板已绘制'))
        break
      }

      case 'toggle_guide_grid':
        if (canvas) toggleGuideGrid(canvas, args.show !== false)
        results.push({ tool: tool.name, success: true, message: args.show === false ? '已隐藏辅助网格' : '已显示辅助网格' })
        break

      case 'ai_regenerate': {
        const prompt = String(args.prompt ?? store.lastAiPrompt)
        if (!prompt) {
          results.push({ tool: tool.name, success: false, message: '还没有可重新生成的图片' })
          break
        }
        if (canvas) {
          const ok = await runAiGenerate(canvas, { prompt, aspect_ratio: store.lastAiAspect }, store.imageProvider, onStep)
          results.push({
            tool: tool.name,
            success: ok,
            message: ok ? '已重新生成' : '重新生成失败',
            ...(ok ? {} : {}),
          })
        }
        break
      }

      case 'ai_variation': {
        const base = String(args.prompt ?? store.lastAiPrompt)
        if (!base) {
          results.push({ tool: tool.name, success: false, message: '还没有可生成变体的图片' })
          break
        }
        const prompt = `${base}, variation, similar composition, different details`
        if (canvas) {
          const ok = await runAiGenerate(canvas, { prompt, aspect_ratio: store.lastAiAspect }, store.imageProvider, onStep)
          results.push({ tool: tool.name, success: ok, message: ok ? '已生成变体' : '生成变体失败' })
        }
        break
      }

      case 'save_canvas': {
        const filename = String(args.filename ?? 'voicecanvas.png')
        if (store.canvasMode === 'grid' && Object.keys(store.gridCells).length) {
          const ok = await downloadGridImage(store.gridCells, store.cellSize, filename)
          results.push({ tool: tool.name, success: ok, message: ok ? '九宫格已保存为PNG' : '保存失败' })
        } else if (canvas) {
          const ok = saveCanvasAsPng(canvas, filename)
          results.push({ tool: tool.name, success: ok, message: ok ? '画布已保存为PNG' : '保存失败' })
        }
        break
      }

      case 'set_style':
      case 'object_style': {
        const ok = !!(canvas && setObjectStyle(canvas, args))
        results.push({ tool: tool.name, success: ok, message: ok ? '样式已更新' : '没有可修改的对象' })
        break
      }

      case 'object_transform': {
        const ok = !!(canvas && transformObject(canvas, args))
        results.push({ tool: tool.name, success: ok, message: ok ? '变换已完成' : '没有可变换的对象' })
        break
      }

      case 'layer_control':
        if (canvas) layerControl(canvas, String(args.action ?? 'front'))
        results.push({ tool: tool.name, success: true, message: '图层已调整' })
        break

      case 'delete_object': {
        const ok = !!(canvas && deleteLastObject(canvas))
        results.push({ tool: tool.name, success: ok, message: ok ? '已删除对象' : '没有对象' })
        break
      }

      case 'duplicate_object': {
        const ok = !!(canvas && duplicateLastObject(canvas))
        results.push({ tool: tool.name, success: ok, message: ok ? '已复制对象' : '没有对象' })
        break
      }

      case 'canvas_control': {
        const action = String(args.action ?? '')
        const panStep = Number(args.amount ?? 120)
        const expandToGrid: Record<string, string> = {
          expand_top: 'up',
          expand_bottom: 'down',
          expand_left: 'left',
          expand_right: 'right',
        }
        if (store.canvasMode === 'grid') {
          if (expandToGrid[action]) {
            const direction = expandToGrid[action] as 'up' | 'down' | 'left' | 'right'
            const from = String(args.from_cell ?? store.selectedCellId ?? '0,0')
            store.setGridCells(expandCell(store.gridCells, from, direction, Number(args.count ?? 1)))
            const newRow =
              parseCellId(from).row +
              ({ up: -1, down: 1, left: 0, right: 0 }[direction] * Number(args.count ?? 1))
            const newCol =
              parseCellId(from).col +
              ({ up: 0, down: 0, left: -1, right: 1 }[direction] * Number(args.count ?? 1))
            const newId = cellId(newRow, newCol)
            store.focusGridCell(newId)
            if (args.prompt) {
              onStep?.(`正在从 ${from} 向${direction}扩展并绘制 ${newId}`)
              await runGridRedraw(
                newId,
                { ...args, direction, seam_from: from, seamless: true },
                store.imageProvider,
              )
            }
            results.push({
              tool: 'grid_expand',
              success: true,
              message: args.prompt
                ? `已从 ${from} 向${direction}扩展至 ${newId} 并完成绘制`
                : `已从 ${from} 向${direction}扩展至 ${newId}`,
            })
            break
          }
          if (action === 'pan_left') store.panGridView(panStep, 0)
          else if (action === 'pan_right') store.panGridView(-panStep, 0)
          else if (action === 'pan_up') store.panGridView(0, panStep)
          else if (action === 'pan_down') store.panGridView(0, -panStep)
          else if (action === 'reset_view' || action === 'fit_window') store.resetGridView()
          else if (canvas) {
            if (action === 'zoom_in') zoomCanvas(canvas, 1.2)
            else if (action === 'zoom_out') zoomCanvas(canvas, 0.8)
          }
          results.push({ tool: tool.name, success: true, message: '九宫格视图已更新' })
          break
        }
        if (!canvas) break
        let applied = false
        if (action === 'zoom_in') { zoomCanvas(canvas, 1.2); applied = true }
        else if (action === 'zoom_out') { zoomCanvas(canvas, 0.8); applied = true }
        else if (action === 'zoom_to') { zoomTo(canvas, Number(args.value ?? 1)); applied = true }
        else if (action === 'fit_window' || action === 'reset_view') { fitWindow(canvas); applied = true }
        else if (action === 'clear') { clearCanvas(canvas); applied = true }
        else if (action === 'pan_left') { panCanvas(canvas, -panStep, 0); applied = true }
        else if (action === 'pan_right') { panCanvas(canvas, panStep, 0); applied = true }
        else if (action === 'pan_up') { panCanvas(canvas, 0, -panStep); applied = true }
        else if (action === 'pan_down') { panCanvas(canvas, 0, panStep); applied = true }
        else if (action === 'expand_left') { expandCanvasSize(canvas, 'left', panStep * 2); applied = true }
        else if (action === 'expand_right') { expandCanvasSize(canvas, 'right', panStep * 2); applied = true }
        else if (action === 'expand_top') { expandCanvasSize(canvas, 'top', panStep * 2); applied = true }
        else if (action === 'expand_bottom') { expandCanvasSize(canvas, 'bottom', panStep * 2); applied = true }
        if (applied) {
          results.push({
            tool: tool.name,
            success: true,
            message: CANVAS_CONTROL_LABELS[action] ?? GENERIC_CANVAS_REPLY,
          })
        } else {
          results.push({ tool: tool.name, success: false, message: '未识别的画布操作' })
        }
        break
      }

      case 'history':
        if (!canvas) break
        if (args.action === 'redo') redo(canvas)
        else undo(canvas)
        results.push({ tool: tool.name, success: true, message: args.action === 'redo' ? '已重做' : '已撤销' })
        break

      case 'select_region':
        if (canvas) selectRegion(canvas, String(args.region ?? 'center'))
        results.push({ tool: tool.name, success: true, message: '已框选区域' })
        break

      case 'switch_mode': {
        const mode = String(args.mode ?? 'free')
        const allowed = new Set(['free', 'ai', 'grid', '3d'])
        const nextMode = allowed.has(mode) ? mode : 'free'
        store.setCanvasMode(nextMode as 'free' | 'ai' | 'grid' | '3d')
        results.push({ tool: tool.name, success: true, message: `已切换到${MODE_LABELS[nextMode] ?? nextMode}模式` })
        break
      }

      case 'open_command_manual':
      case 'open_manual': {
        if (store.canvasMode === 'grid' || store.canvasMode === '3d') {
          store.setCanvasMode('free')
        }
        store.setCommandManualOpen(true)
        results.push({ tool: tool.name, success: true, message: '已打开指令手册' })
        break
      }

      case 'close_command_manual':
      case 'close_manual': {
        store.setCommandManualOpen(false)
        results.push({ tool: tool.name, success: true, message: '已关闭指令手册' })
        break
      }

      case 'set_deepseek_mode': {
        const mode = String(args.mode ?? 'chat') as 'v4-pro' | 'flash' | 'chat' | 'auto'
        if (['v4-pro', 'flash', 'chat', 'auto'].includes(mode)) {
          store.setDeepseekMode(mode, true)
          results.push({ tool: tool.name, success: true, message:`已切换到 DeepSeek ${mode}` })
        }
        break
      }

      case 'set_image_provider': {
        const provider = String(args.provider ?? 'minimax') as 'minimax' | 'doubao'
        if (provider === 'minimax' || provider === 'doubao') {
          store.setImageProvider(provider)
          results.push({ tool: tool.name, success: true, message:`已切换到${provider === 'minimax' ? 'MiniMax' : '豆包'}生图` })
        }
        break
      }

      case 'set_voice_mode':
        store.setVoiceMode(String(args.mode) === 'push_to_talk' ? 'push_to_talk' : 'continuous')
        results.push({ tool: tool.name, success: true, message:'语音模式已切换' })
        break

      case 'ai_generate':
        if (canvas) {
          const ok = await runAiGenerate(canvas, args, store.imageProvider, onStep)
          results.push({
            tool: tool.name,
            success: ok,
            message: ok ? 'AI 图片已生成' : 'AI 生成失败',
          })
        }
        break

      case 'ai_inpaint':
        if (canvas) {
          onStep?.('正在重绘选中区域')
          const ref = getCanvasDataUrl(canvas).split(',')[1]
          const ok = await runAiGenerate(canvas, { ...args, reference_image_base64: ref }, store.imageProvider, onStep)
          results.push({ tool: tool.name, success: ok, message: ok ? '区域重绘完成' : '区域重绘失败' })
        }
        break

      case 'grid_create': {
        const rows = Number(args.rows ?? 3)
        const cols = Number(args.cols ?? 3)
        store.setGridCells(createGrid(rows, cols, store.cellSize))
        store.setCanvasMode('grid')
        results.push({ tool: tool.name, success: true, message:`已创建 ${rows}x${cols} 九宫格` })
        break
      }

      case 'grid_split': {
        if (!canvas) break
        const rows = Number(args.rows ?? 3)
        const cols = Number(args.cols ?? 3)
        const cells = await splitImageToGrid(getCanvasDataUrl(canvas), rows, cols)
        store.setGridCells(cells)
        store.setCanvasMode('grid')
        results.push({ tool: tool.name, success: true, message:'已将图片切成九宫格' })
        break
      }

      case 'grid_select': {
        let target: string | null = null
        if (args.position && typeof args.position === 'object') {
          const pos = args.position as { row: number; col: number }
          target = cellId(pos.row, pos.col)
        } else if (args.hint) {
          target = resolveCellHint(store.gridCells, String(args.hint))
        } else if (args.cell) target = String(args.cell)
        if (target) store.setSelectedCellId(target)
        results.push({ tool: tool.name, success: true, message:target ? `已选中格子 ${target}` : '未找到目标格子' })
        break
      }

      case 'grid_redraw':
      case 'grid_optimize': {
        const cell = String(args.cell ?? store.selectedCellId ?? '0,0')
        onStep?.(`正在重绘格子 ${cell}`)
        if (args.inpaint) {
          await runGridInpaint(cell, args, store.imageProvider)
        } else {
          await runGridRedraw(cell, args, store.imageProvider)
        }
        results.push({ tool: tool.name, success: true, message:`格子 ${cell} 重绘完成` })
        break
      }

      case 'grid_inpaint': {
        const cell = String(args.cell ?? store.selectedCellId ?? '0,0')
        onStep?.(`正在局部重绘格子 ${cell}`)
        await runGridInpaint(cell, args, store.imageProvider)
        results.push({ tool: tool.name, success: true, message:`格子 ${cell} 局部重绘完成` })
        break
      }

      case 'grid_expand': {
        const from = String(args.from_cell ?? store.selectedCellId ?? '0,0')
        const direction = String(args.direction ?? 'up') as 'up' | 'down' | 'left' | 'right'
        const count = Number(args.count ?? 1)
        store.setGridCells(expandCell(store.gridCells, from, direction, count))
        const newRow = parseCellId(from).row + ({ up: -1, down: 1, left: 0, right: 0 }[direction] * count)
        const newCol = parseCellId(from).col + ({ up: 0, down: 0, left: -1, right: 1 }[direction] * count)
        const newId = cellId(newRow, newCol)
        store.focusGridCell(newId)
        if (args.prompt) {
          onStep?.(`正在扩展并绘制格子 ${newId}`)
          await runGridRedraw(newId, {
            ...args,
            direction,
            seam_from: from,
            seamless: true,
          }, store.imageProvider)
        }
        results.push({ tool: tool.name, success: true, message:`已向${direction}从 ${from} 扩展至 ${newId}` })
        break
      }

      case 'grid_expand_region': {
        const msg = await runExpandGridRegion(args, onStep)
        results.push({ tool: tool.name, success: true, message: msg })
        break
      }

      case 'character_turnaround': {
        const msg = await runCharacterTurnaround(args, onStep)
        results.push({ tool: tool.name, success: true, message: msg })
        break
      }

      case 'grid_fill': {
        onStep?.('正在生成占满九宫格的大图')
        store.setAiGenerating(true, '正在生成整格画面…')
        try {
          const cells = await fillGridWithUnifiedImage(
            store.gridCells,
            String(args.prompt ?? 'fantasy landscape'),
            store.imageProvider,
            (opts) => generateImage({ ...opts, size: '2K' }),
          )
          store.setGridCells(cells)
          results.push({ tool: tool.name, success: true, message: '已生成占满九宫格的画面' })
        } finally {
          store.setAiGenerating(false)
        }
        break
      }

      case 'grid_move': {
        const from = String(args.from_cell ?? store.selectedCellId ?? '0,0')
        const to = String(args.to_cell ?? '0,1')
        store.setGridCells(moveCell(store.gridCells, from, to))
        store.setSelectedCellId(to)
        results.push({ tool: tool.name, success: true, message:`已将 ${from} 移动到 ${to}` })
        break
      }

      case 'batch_grid': {
        if (args.mode === 'character_turnaround' || args.character_turnaround) {
          const msg = await runCharacterTurnaround(args, onStep)
          results.push({ tool: tool.name, success: true, message: msg })
          break
        }
        const filter = String(args.filter ?? 'empty')
        const targets = Object.values(store.gridCells).filter((c) => filter === 'all' || c.status === 'empty')
        for (const [idx, cell] of targets.entries()) {
          onStep?.(`批量处理 ${idx + 1}/${targets.length}`)
          await runGridRedraw(cell.id, args, store.imageProvider)
        }
        results.push({ tool: tool.name, success: true, message:`已批量处理 ${targets.length} 个格子` })
        break
      }

      case 'style_sync': {
        const refCell = String(args.reference_cell ?? store.selectedCellId ?? '')
        const ref = store.gridCells[refCell]?.imageData?.split(',')[1]
        const targets = Object.keys(store.gridCells).filter((id) => id !== refCell)
        for (const id of targets) {
          await runGridRedraw(id, { prompt: String(args.prompt ?? 'same style as reference tile') }, store.imageProvider, ref)
        }
        results.push({ tool: tool.name, success: true, message:`已统一 ${targets.length} 个格子风格` })
        break
      }

      case 'export_tiles':
        await exportTilesSpritesheet(store.gridCells, store.cellSize)
        results.push({ tool: tool.name, success: true, message:'瓦片集已导出' })
        break

      case 'workflow_macro': {
        const name = String(args.name ?? 'map_init')
        if (name === 'map_init') {
          const cells = createGrid(3, 3, store.cellSize)
          store.setGridCells(cells)
          store.setCanvasMode('grid')
          const empties = Object.values(cells).filter((c) => c.status === 'empty')
          for (const cell of empties) {
            await runGridRedraw(cell.id, { prompt: 'grass terrain game tile top-down' }, store.imageProvider)
          }
          results.push({ tool: tool.name, success: true, message:'地图初始化完成：3x3草地瓦片' })
        } else {
          results.push({ tool: tool.name, success: true, message:`未知工作流: ${name}` })
        }
        break
      }

      case 'ai_generate_3d': {
        store.setCanvasMode('3d')
        store.setModel3d({ loading: true, status: 'creating', message: '正在创建 3D 任务…' })
        onStep?.('正在生成3D模型，请稍候')
        let imageUrl = args.image_url ? String(args.image_url) : undefined
        let imageBase64: string | undefined
        if (!imageUrl && canvas) imageBase64 = getCanvasDataUrl(canvas).split(',')[1]
        else if (!imageUrl && store.selectedCellId) imageUrl = store.gridCells[store.selectedCellId]?.imageData

        const result = await generateModel3D({
          image_url: imageUrl,
          image_base64: imageBase64,
          prompt: args.prompt ? String(args.prompt) : undefined,
          file_format: String(args.file_format ?? 'obj'),
          subdivision_level: String(args.subdivision_level ?? 'high'),
        })
        store.setModel3d({
          taskId: result.task_id, status: result.status, modelUrl: result.model_url,
          fileFormat: result.file_format, message: result.message, loading: false,
        })
        results.push({ tool: tool.name, success: true, message:result.message || '3D 模型任务已提交' })
        break
      }

      case 'model3d_status': {
        const taskId = String(args.task_id ?? store.model3d.taskId ?? '')
        if (!taskId) {
          results.push({ tool: tool.name, success: false, message: '没有可查询的 3D 任务' })
          break
        }
        const result = await getModel3DTask(taskId)
        store.setModel3d({
          taskId: result.task_id, status: result.status, modelUrl: result.model_url,
          fileFormat: result.file_format, message: result.message, loading: false,
        })
        results.push({ tool: tool.name, success: true, message:result.message || `3D 任务状态：${result.status}` })
        break
      }

      default:
        results.push({ tool: tool.name, success: true, message:`暂不支持工具: ${tool.name}` })
    }
  }

  return results
}

function normalizeToolName(name: string): string {
  const key = name.trim().toLowerCase().replace(/-/g, '_')
  const aliases: Record<string, string> = {
    draw: 'draw_shape',
    draw_circle: 'draw_shape',
    draw_rect: 'draw_shape',
    draw_line: 'draw_shape',
    generate: 'ai_generate',
    generate_image: 'ai_generate',
    image_generate: 'ai_generate',
    undo: 'history',
    redo: 'history',
    zoom: 'canvas_control',
    clear_canvas: 'canvas_control',
    align: 'align_objects',
    distribute: 'distribute_objects',
    select: 'select_object',
    delete: 'delete_object',
    duplicate: 'duplicate_object',
    transform: 'object_transform',
    style: 'set_style',
    grid: 'grid_create',
    open_manual: 'open_command_manual',
    close_manual: 'close_command_manual',
  }
  return aliases[key] ?? key
}

function spatialAnchorIsCenter(anchor: string): boolean {
  return /中间|中心|居中|里面|内部|center|middle|inside/i.test(anchor)
}

function normalizeToolArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const n = normalizeToolName(name)
  if (n === 'history' && !args.action) {
    if (/redo|重做/.test(name)) return { ...args, action: 'redo' }
    return { ...args, action: 'undo' }
  }
  if (n === 'canvas_control' && !args.action) {
    if (/zoom_in|放大/.test(name)) return { ...args, action: 'zoom_in' }
    if (/zoom_out|缩小/.test(name)) return { ...args, action: 'zoom_out' }
    if (/clear|清空/.test(name)) return { ...args, action: 'clear' }
  }

  let next = { ...args }
  if (n === 'draw_shape') {
    const rawShape = String(args.shape ?? '')
    const pos = String(args.position ?? '')
    const { placement, pointTo } = splitSpatialClauses(pos)
    if (/笑脸|表情|smiley|face/i.test(rawShape) || /笑脸|表情/.test(placement)) {
      next.shape = 'smiley'
    }
    const canvasAnchor = parseCanvasAnchor(placement)
    if (canvasAnchor) {
      next.canvasAnchor = canvasAnchor
      next.relativeTo = 'canvas'
    } else if (/圆|矩形|方块|心|星|椭圆/.test(placement) || /上面|下面|中间|里面|左侧|右侧|上方|下方/.test(placement)) {
      const spatial = parseSpatialHint(placement)
      next = {
        ...next,
        anchor: next.anchor ?? spatial.anchor,
        referenceType: next.referenceType ?? spatial.type,
        referenceColor: next.referenceColor ?? spatial.color,
        relativeTo: next.relativeTo ?? 'selected',
      }
    }
    if (pointTo || args.pointTo) {
      const pt = parsePointToHint(String(args.pointTo ?? pointTo))
      next.targetType = next.targetType ?? pt.type
      next.targetColor = next.targetColor ?? pt.color
      if (pointTo) next.pointTo = pointTo
    }
    if ((next.anchor === 'center' || spatialAnchorIsCenter(String(next.anchor ?? ''))) && !next.relativeTo && !next.canvasAnchor) {
      next.relativeTo = 'selected'
    }
    if (!next.shape) {
      if (/箭/.test(rawShape) || /箭/.test(placement)) next.shape = 'arrow'
      if (/圆/.test(name)) next.shape = 'circle'
      if (/矩|方/.test(name)) next.shape = 'rect'
    }
    return next
  }

  if (n === 'draw_shape' && !args.shape) {
    if (/圆/.test(name)) return { ...args, shape: 'circle' }
    if (/矩|方/.test(name)) return { ...args, shape: 'rect' }
  }
  return args
}

/** 本地执行单条指令（不播报），用于多指令兜底 */
export function executeLocalCommandSilent(cmd: LocalCommand, canvas: FabricCanvasRef | null): boolean {
  const store = useAppStore.getState()
  switch (cmd.type) {
    case 'draw':
      if (!canvas) return false
      executeLocalDraw(canvas, cmd.args)
      return true
    case 'draw_path':
      if (!canvas) return false
      executeLocalPath(canvas, cmd.args)
      return true
    case 'select_object':
      return !!canvas && executeLocalSelect(canvas, cmd.args)
    case 'compose':
      return !!canvas && executeLocalCompose(canvas, cmd.action, cmd.args)
    case 'save_canvas':
      if (canvas) saveCanvasAsPng(canvas)
      return true
    case 'set_style':
      return !!canvas && executeLocalStyle(canvas, cmd.args)
    case 'transform':
      return !!canvas && executeLocalTransform(canvas, cmd.args)
    case 'layer':
      return !!canvas && executeLocalLayer(canvas, cmd.action)
    case 'delete_object':
      return !!canvas && !!deleteLastObject(canvas)
    case 'duplicate':
      return !!canvas && !!duplicateLastObject(canvas)
    case 'switch_mode':
      store.setCanvasMode(cmd.mode)
      return true
    case 'open_manual':
      store.setCommandManualOpen(true)
      return true
    case 'close_manual':
      store.setCommandManualOpen(false)
      return true
    case 'canvas': {
      if (!canvas) return false
      return !!handleSystemCommand(cmd.action, canvas)
    }
    default:
      return false
  }
}

export function buildCanvasContext(canvas: FabricCanvasRef | null) {
  const store = useAppStore.getState()
  const scene = buildSceneGraph(canvas)
  return {
    canvas_mode: store.canvasMode,
    zoom: canvas?.getZoom() ?? 1,
    selected_cell: store.selectedCellId,
    grid_cells: Object.keys(store.gridCells),
    scene_graph: scene,
    objects_summary: buildObjectsSummary(scene),
    recent_commands: store.recentCommands,
    model3d_status: store.model3d.status,
  }
}

export function handleSystemCommand(cmd: string, canvas: FabricCanvasRef | null): string | null {
  if (!canvas) return null
  switch (cmd) {
    case 'undo': undo(canvas); return '已撤销'
    case 'redo': redo(canvas); return '已重做'
    case 'clear': clearCanvas(canvas); return '画布已清空'
    case 'zoom_in': zoomCanvas(canvas, 1.2); return '已放大'
    case 'zoom_out': zoomCanvas(canvas, 0.8); return '已缩小'
    case 'pan_left': panCanvas(canvas, -120, 0); return '画布已向左移动'
    case 'pan_right': panCanvas(canvas, 120, 0); return '画布已向右移动'
    case 'pan_up': panCanvas(canvas, 0, -120); return '画布已向上移动'
    case 'pan_down': panCanvas(canvas, 0, 120); return '画布已向下移动'
    case 'expand_left': expandCanvasSize(canvas, 'left'); return '画布已向左扩展'
    case 'expand_right': expandCanvasSize(canvas, 'right'); return '画布已向右扩展'
    case 'expand_top': expandCanvasSize(canvas, 'top'); return '画布已向上扩展'
    case 'expand_bottom': expandCanvasSize(canvas, 'bottom'); return '画布已向下扩展'
    case 'fit':
    case 'reset_view': fitWindow(canvas); return '视图已重置'
    case 'fit_image_cover': return fitImageToCanvas(canvas, 'cover') ? '图片已铺满画布' : '没有可调整的图片'
    case 'fit_image_contain': return fitImageToCanvas(canvas, 'contain') ? '图片已适应画布' : '没有可调整的图片'
    case 'save': return saveCanvasAsPng(canvas) ? '图片已保存' : '保存失败，请重新生成后再试'
    case 'delete': return deleteLastObject(canvas) ? '已删除' : '没有对象'
    case 'duplicate': return duplicateLastObject(canvas) ? '已复制' : '没有对象'
    default: return null
  }
}

export function executeLocalDraw(canvas: FabricCanvasRef, args: Record<string, unknown>) {
  const c = prepareDrawCanvas(canvas)
  if (c) {
    drawShape(c, args)
    c.requestRenderAll()
  }
}

export function executeLocalPath(canvas: FabricCanvasRef, args: Record<string, unknown>) {
  const c = prepareDrawCanvas(canvas)
  if (c) drawPath(c, args)
}

export function executeLocalSelect(canvas: FabricCanvasRef, args: Record<string, unknown>) {
  return !!selectObjectByHint(canvas, {
    index: args.index != null ? Number(args.index) : undefined,
    ordinal: args.ordinal ? String(args.ordinal) : undefined,
    type: args.type ? String(args.type) : undefined,
  })
}

export function executeLocalCompose(canvas: FabricCanvasRef, action: string, args?: Record<string, unknown>) {
  const store = useAppStore.getState()
  switch (action) {
    case 'grid_create': {
      const rows = Number(args?.rows ?? 3)
      const cols = Number(args?.cols ?? 3)
      store.setGridCells(createGrid(rows, cols))
      store.setCanvasMode('grid')
      return true
    }
    case 'grid_split_canvas': {
      const dataUrl = store.lastAiImageDataUrl || getCanvasDataUrl(canvas)
      void splitImageToGrid(dataUrl, 3, 3).then((cells) => {
        store.setGridCells(cells)
        store.setCanvasMode('grid')
      })
      return true
    }
    case 'flowchart': return drawFlowchart(canvas, String(args?.color ?? '#2d2d2d'))
    case 'stick_figure':
      drawStickFigure(canvas, canvas.getWidth() / 2, canvas.getHeight() / 2, String(args?.color ?? '#2d2d2d'))
      return true
    case 'snap_center': return snapSelectedToCenter(canvas)
    case 'align_center': return alignObjects(canvas, 'center')
    case 'distribute': return distributeHorizontally(canvas, Number(args?.spacing ?? 24))
    case 'arrange_row':
      arrangeRow(canvas, Number(args?.count ?? 3), String(args?.shape ?? 'circle'), String(args?.color ?? '#2d2d2d'))
      return true
    case 'show_grid': toggleGuideGrid(canvas, true); return true
    case 'hide_grid': toggleGuideGrid(canvas, false); return true
    default: return false
  }
}

export function executeLocalStyle(canvas: FabricCanvasRef, args: Record<string, unknown>) {
  return setObjectStyle(canvas, args)
}

export function executeLocalTransform(canvas: FabricCanvasRef, args: Record<string, unknown>) {
  return transformObject(canvas, args)
}

export function executeLocalLayer(canvas: FabricCanvasRef, action: string) {
  return layerControl(canvas, action)
}

export async function executeLocalAiQuick(
  canvas: FabricCanvasRef,
  action: string,
  args?: Record<string, unknown>,
) {
  const store = useAppStore.getState()
  if (action === 'regenerate') {
    if (!store.lastAiPrompt) return '还没有可重新生成的图片'
    const ok = await runAiGenerate(canvas, { prompt: store.lastAiPrompt, aspect_ratio: store.lastAiAspect }, store.imageProvider)
    return ok ? '已重新生成' : '重新生成失败，请稍后再试'
  }
  if (action === 'variation') {
    if (!store.lastAiPrompt) return '还没有可生成变体的图片'
    const prompt = `${store.lastAiPrompt}, variation, similar composition`
    const ok = await runAiGenerate(canvas, { prompt, aspect_ratio: store.lastAiAspect }, store.imageProvider)
    return ok ? '已生成变体' : '生成变体失败，请稍后再试'
  }
  if (action === 'style_generate') {
    const style = String(args?.style ?? '')
    const prompt = `${args?.prompt ?? ''}, ${style} style`.trim()
    const ok = await runAiGenerate(canvas, { prompt, aspect_ratio: store.lastAiAspect }, store.imageProvider)
    return ok ? '风格图片已生成' : '风格图片生成失败'
  }
  if (action === 'generate') {
    const rawPrompt = String(args?.prompt ?? '')
    const aspect = /横版|16比9|16:9/.test(rawPrompt)
      ? '16:9'
      : /竖版|9比16|9:16/.test(rawPrompt)
        ? '9:16'
        : String(args?.aspect ?? '1:1')
    const prompt = rawPrompt.replace(/横版|竖版|方形|生成|占满|铺满/g, '').trim() || '风景'
    const ok = await runAiGenerate(canvas, { prompt, aspect_ratio: aspect }, store.imageProvider)
    return ok ? 'AI 图片已生成' : 'AI 生成失败，请稍后再试'
  }
  return null
}

export async function executeLocalExportTiles() {
  const store = useAppStore.getState()
  await exportTilesSpritesheet(store.gridCells, store.cellSize)
}

export async function executeLocalGridQuick(
  action: string,
  args?: Record<string, unknown>,
  onStep?: (msg: string) => void,
): Promise<string | null> {
  const store = useAppStore.getState()
  switch (action) {
    case 'pan': {
      store.panGridView(Number(args?.dx ?? 0), Number(args?.dy ?? 0))
      return '九宫格视图已移动'
    }
    case 'reset_view': {
      store.resetGridView()
      return '九宫格视图已复位'
    }
    case 'clear_grid': {
      if (!Object.keys(store.gridCells).length) {
        store.setGridCells(createGrid(3, 3, store.cellSize))
      }
      store.setGridCells(clearGridCells(store.gridCells))
      store.setSelectedCellId(null)
      return '九宫格已清空'
    }
    case 'select': {
      const target = resolveCellHint(store.gridCells, String(args?.hint ?? ''))
      if (target) {
        store.setSelectedCellId(target)
        return `已选中格子 ${target}`
      }
      return '未找到目标格子'
    }
    case 'redraw': {
      if (!Object.keys(store.gridCells).length) {
        store.setGridCells(createGrid(3, 3, store.cellSize))
      }
      let cell = args?.cell ? String(args.cell) : store.selectedCellId ?? '0,0'
      if (args?.hint) {
        const hinted = resolveCellHint(store.gridCells, String(args.hint))
        if (hinted) cell = hinted
      }
      if (!store.gridCells[cell]) {
        store.setGridCells({
          ...store.gridCells,
          [cell]: { id: cell, row: parseCellId(cell).row, col: parseCellId(cell).col, status: 'empty' },
        })
      }
      onStep?.(`正在 AI 绘制格子 ${cell}`)
      store.setAiGenerating(true, `正在绘制格子 ${cell}…`)
      try {
        await runGridRedraw(cell, { prompt: args?.prompt }, store.imageProvider)
        store.setSelectedCellId(cell)
        return `格子 ${cell} 已用 AI 绘制完成`
      } finally {
        store.setAiGenerating(false)
      }
    }
    case 'expand': {
      if (!Object.keys(store.gridCells).length) {
        store.setGridCells(createGrid(3, 3, store.cellSize))
      }
      const from = String(args?.from_cell ?? store.selectedCellId ?? '0,0')
      const direction = String(args?.direction ?? 'up') as 'up' | 'down' | 'left' | 'right'
      const count = Number(args?.count ?? 1)
      if (!store.gridCells[from]) {
        const { row, col } = parseCellId(from)
        store.setGridCells({
          ...store.gridCells,
          [from]: { id: from, row, col, status: 'empty' },
        })
      }
      store.setGridCells(expandCell(store.gridCells, from, direction, count))
      const newRow = parseCellId(from).row + ({ up: -1, down: 1, left: 0, right: 0 }[direction] * count)
      const newCol = parseCellId(from).col + ({ up: 0, down: 0, left: -1, right: 1 }[direction] * count)
      const newId = cellId(newRow, newCol)
      store.focusGridCell(newId)
      if (args?.prompt) {
        onStep?.(`正在从 ${from} 向${direction}扩展并绘制格子 ${newId}`)
        store.setAiGenerating(true, `正在扩展格子 ${newId}…`)
        try {
          await runGridRedraw(newId, {
            prompt: args.prompt,
            direction,
            seam_from: from,
            seamless: true,
            use_previous: args.use_previous,
          }, store.imageProvider)
          return `已从 ${from} 向${direction}扩展至 ${newId} 并完成绘制`
        } catch (err) {
          return err instanceof Error ? err.message : '扩图绘制失败'
        } finally {
          store.setAiGenerating(false)
        }
      }
      return `已从 ${from} 向${direction}扩展 ${count} 格，新格 ${newId}`
    }
    case 'inpaint': {
      if (!Object.keys(store.gridCells).length) {
        store.setGridCells(createGrid(3, 3, store.cellSize))
      }
      let cell = args?.cell ? String(args.cell) : store.selectedCellId ?? '0,0'
      if (args?.hint) {
        const hinted = resolveCellHint(store.gridCells, String(args.hint))
        if (hinted) cell = hinted
      }
      if (!store.gridCells[cell]) {
        const { row, col } = parseCellId(cell)
        store.setGridCells({
          ...store.gridCells,
          [cell]: { id: cell, row, col, status: 'empty' },
        })
      }
      onStep?.(`正在局部重绘格子 ${cell}`)
      store.setAiGenerating(true, `正在局部重绘 ${cell}…`)
      try {
        await runGridInpaint(cell, args ?? {}, store.imageProvider)
        store.setSelectedCellId(cell)
        return `格子 ${cell} 已局部重绘，画风已继承参考图`
      } catch (err) {
        return err instanceof Error ? err.message : '局部重绘失败'
      } finally {
        store.setAiGenerating(false)
      }
    }
    case 'fill_grid': {
      if (!Object.keys(store.gridCells).length) {
        store.setGridCells(createGrid(3, 3, store.cellSize))
      }
      onStep?.('正在生成占满九宫格的画面')
      store.setAiGenerating(true, '正在生成整格画面…')
      try {
        const cells = await fillGridWithUnifiedImage(
          store.gridCells,
          String(args?.prompt ?? 'fantasy landscape'),
          store.imageProvider,
          (opts) => generateImage({ ...opts, size: '2K' }),
        )
        store.setGridCells(cells)
        store.setLastAiImageDataUrl(
          Object.values(cells).find((c) => c.imageData)?.imageData ?? '',
        )
        return '已生成占满九宫格的画面'
      } finally {
        store.setAiGenerating(false)
      }
    }
    case 'seamless': {
      if (!Object.keys(store.gridCells).length) {
        store.setGridCells(createGrid(3, 3, store.cellSize))
      }
      let cell = store.selectedCellId ?? '0,0'
      if (args?.cell) cell = String(args.cell)
      else if (args?.hint) {
        const hinted = resolveCellHint(store.gridCells, String(args.hint))
        if (hinted) cell = hinted
      }
      if (!store.gridCells[cell]) {
        const { row, col } = parseCellId(cell)
        store.setGridCells({
          ...store.gridCells,
          [cell]: { id: cell, row, col, status: 'empty' },
        })
      }
      onStep?.(`正在与周围衔接绘制格子 ${cell}`)
      store.setAiGenerating(true, `正在衔接绘制 ${cell}…`)
      try {
        await runGridRedraw(cell, {
          prompt: args?.prompt,
          direction: args?.direction,
          seamless: true,
          blend_neighbors: true,
        }, store.imageProvider)
        store.setSelectedCellId(cell)
        return `格子 ${cell} 已与周围衔接绘制完成`
      } finally {
        store.setAiGenerating(false)
      }
    }
    case 'batch': {
      if (args?.mode === 'character_turnaround' || args?.character_turnaround) {
        return runCharacterTurnaround(args ?? {}, onStep)
      }
      const targets = Object.values(store.gridCells).filter((c) => c.status === 'empty')
      if (!targets.length) return '没有空白格子需要填充'
      store.setAiGenerating(true, '正在批量绘制…')
      try {
        for (const [idx, cell] of targets.entries()) {
          onStep?.(`批量绘制 ${idx + 1}/${targets.length}`)
          await runGridRedraw(cell.id, { prompt: args?.prompt }, store.imageProvider)
        }
        return `已批量绘制 ${targets.length} 个格子`
      } finally {
        store.setAiGenerating(false)
      }
    }
    case 'character_turnaround':
      return runCharacterTurnaround(args ?? {}, onStep)
    case 'expand_region':
      return runExpandGridRegion(args ?? {}, onStep)
    case 'style_sync': {
      const refCell = store.selectedCellId ?? Object.keys(store.gridCells)[0]
      if (!refCell) return '没有可参考的格子'
      const ref = store.gridCells[refCell]?.imageData?.split(',')[1]
      if (!ref) return '请先绘制参考格再统一风格'
      const targets = Object.keys(store.gridCells).filter((id) => id !== refCell)
      store.setAiGenerating(true, '正在统一风格…')
      try {
        for (const id of targets) {
          await runGridRedraw(id, { prompt: String(args?.prompt ?? 'same style as reference tile') }, store.imageProvider, ref)
        }
        return `已统一 ${targets.length} 个格子风格`
      } finally {
        store.setAiGenerating(false)
      }
    }
    default:
      return null
  }
}

export async function executeLocalComicQuick(
  action: string,
  args?: Record<string, unknown>,
  onStep?: (msg: string) => void,
): Promise<string | null> {
  switch (action) {
    case 'create_character':
      return createCharacterAsset(
        String(args?.description ?? '原创漫画角色'),
        args?.name ? String(args.name) : undefined,
        onStep,
      )
    case 'create_script':
      return createEpisodeScript(
        Number(args?.episode_number ?? 1),
        String(args?.synopsis ?? ''),
        onStep,
      )
    case 'generate_episode':
      return generateComicEpisode(Number(args?.episode_number ?? 1), onStep)
    case 'generate_episodes':
      return generateComicEpisodes(
        Array.isArray(args?.episode_numbers)
          ? (args.episode_numbers as number[]).map(Number)
          : [],
        onStep,
      )
    case 'edit_script':
      return reviseEpisodeScript(
        Number(args?.episode_number ?? 1),
        String(args?.revision ?? ''),
        onStep,
      )
    case 'regenerate_character':
      return regenerateCharacterAsset(
        args?.name ? String(args.name) : undefined,
        String(args?.description ?? '原创漫画角色'),
        onStep,
      )
    case 'regenerate_script':
      return regenerateEpisodeScript(
        Number(args?.episode_number ?? 1),
        String(args?.synopsis ?? ''),
        onStep,
      )
    case 'regenerate_episode':
      return regenerateComicEpisode(Number(args?.episode_number ?? 1), onStep)
    case 'redraw_panels':
      return redrawComicPanels(
        Number(args?.episode_number ?? 1),
        Array.isArray(args?.page_numbers)
          ? (args.page_numbers as number[]).map(Number)
          : [],
        onStep,
      )
    case 'export_pdf':
      return exportComicPdf(args?.episode_number != null ? Number(args.episode_number) : undefined)
    case 'set_style':
      return setComicVisualStyle(String(args?.style ?? ''))
    case 'set_background':
      return setComicStoryBackground(String(args?.background ?? ''))
    case 'view_character':
      return showCharacterDetail(args?.name ? String(args.name) : undefined)
    case 'view_episode':
      return showEpisodeDetail(
        args?.episode_number != null ? Number(args.episode_number) : undefined,
      )
    case 'view_story':
      return showStoryBackground()
    case 'close_detail':
      return closeComicDetail()
    case 'new_project':
      return createNewComicProject(args?.name ? String(args.name) : undefined)
    case 'switch_project':
      return switchComicProject(String(args?.name ?? ''))
    case 'delete_project':
      return deleteComicProject(args?.name ? String(args.name) : undefined)
    case 'delete_projects':
      return deleteComicProjects(
        Array.isArray(args?.names) ? (args.names as string[]).map(String) : [],
      )
    case 'delete_character':
      return deleteCharacterByName(args?.name ? String(args.name) : undefined)
    case 'delete_episode':
      return deleteEpisodeByNumber(Number(args?.episode_number ?? 1))
    case 'clear_episode_comic':
      return clearEpisodeComicImages(Number(args?.episode_number ?? 1))
    case 'delete_panels':
      return deleteEpisodePages(
        Number(args?.episode_number ?? 1),
        Array.isArray(args?.page_numbers) ? (args.page_numbers as number[]).map(Number) : [],
      )
    default:
      return null
  }
}

export function mapComicIntentTool(
  tool: ToolCall,
): { action: string; args?: Record<string, unknown> } | null {
  const a = tool.arguments ?? {}
  switch (tool.name) {
    case 'comic_create_character':
      return {
        action: 'create_character',
        args: { description: String(a.description ?? ''), name: a.name_hint ? String(a.name_hint) : undefined },
      }
    case 'comic_create_script':
      return {
        action: 'create_script',
        args: { episode_number: Number(a.episode_number ?? 1), synopsis: String(a.synopsis ?? '') },
      }
    case 'comic_generate_episode':
      return { action: 'generate_episode', args: { episode_number: Number(a.episode_number ?? 1) } }
    case 'comic_generate_episodes':
      return {
        action: 'generate_episodes',
        args: {
          episode_numbers: Array.isArray(a.episode_numbers)
            ? a.episode_numbers.map((n: unknown) => Number(n))
            : [],
        },
      }
    case 'comic_edit_script':
      return {
        action: 'edit_script',
        args: { episode_number: Number(a.episode_number ?? 1), revision: String(a.revision ?? '') },
      }
    case 'comic_regenerate_character':
      return {
        action: 'regenerate_character',
        args: {
          name: a.name_hint ? String(a.name_hint) : undefined,
          description: String(a.description ?? '原创漫画角色'),
        },
      }
    case 'comic_regenerate_script':
      return {
        action: 'regenerate_script',
        args: { episode_number: Number(a.episode_number ?? 1), synopsis: String(a.synopsis ?? '') },
      }
    case 'comic_regenerate_episode':
      return { action: 'regenerate_episode', args: { episode_number: Number(a.episode_number ?? 1) } }
    case 'comic_redraw_panels':
      return {
        action: 'redraw_panels',
        args: {
          episode_number: Number(a.episode_number ?? 1),
          page_numbers: Array.isArray(a.page_numbers)
            ? a.page_numbers.map((n: unknown) => Number(n))
            : [],
        },
      }
    case 'comic_set_style':
      return { action: 'set_style', args: { style: String(a.style ?? '') } }
    case 'comic_set_background':
      return { action: 'set_background', args: { background: String(a.background ?? '') } }
    case 'comic_view_characters':
      return { action: 'view_character', args: a.name ? { name: String(a.name) } : {} }
    case 'comic_view_episodes':
      return {
        action: 'view_episode',
        args: a.episode_number != null ? { episode_number: Number(a.episode_number) } : {},
      }
    case 'comic_view_story':
      return { action: 'view_story', args: {} }
    case 'comic_export_pdf':
      return {
        action: 'export_pdf',
        args: a.episode_number != null ? { episode_number: Number(a.episode_number) } : {},
      }
    case 'comic_close_detail':
      return { action: 'close_detail', args: {} }
    case 'comic_new_project':
      return { action: 'new_project', args: { name: a.name ? String(a.name) : undefined } }
    case 'comic_switch_project':
      return { action: 'switch_project', args: { name: String(a.name ?? '') } }
    case 'comic_delete_project':
      return { action: 'delete_project', args: { name: a.name ? String(a.name) : undefined } }
    case 'comic_delete_character':
      return { action: 'delete_character', args: { name: a.name ? String(a.name) : undefined } }
    case 'comic_delete_episode':
      return { action: 'delete_episode', args: { episode_number: Number(a.episode_number ?? 1) } }
    case 'comic_clear_episode_comic':
      return { action: 'clear_episode_comic', args: { episode_number: Number(a.episode_number ?? 1) } }
    case 'comic_delete_panels':
      return {
        action: 'delete_panels',
        args: {
          episode_number: Number(a.episode_number ?? 1),
          page_numbers: Array.isArray(a.page_numbers)
            ? a.page_numbers.map((n: unknown) => Number(n))
            : [],
        },
      }
    default:
      return null
  }
}

export async function executeComicIntentTools(
  tools: ToolCall[],
  onStep?: (msg: string) => void,
): Promise<string> {
  let lastMsg = ''
  for (const tool of tools) {
    if (!tool.name.startsWith('comic_')) continue
    const mapped = mapComicIntentTool(tool)
    if (!mapped) continue
    const msg = await executeLocalComicQuick(mapped.action, mapped.args, onStep)
    if (msg) lastMsg = msg
  }
  return lastMsg
}

export async function executeWorkflowMacro(name: string) {
  await executeTools([{ name: 'workflow_macro', arguments: { name } }], { canvas: null })
}
