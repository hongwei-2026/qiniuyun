import {
  Canvas,
  Circle,
  Ellipse,
  FabricImage,
  FabricObject,
  Group,
  IText,
  Line,
  Path,
  Polygon,
  Rect,
  Triangle,
} from 'fabric'
import {
  buildPathTemplate,
  buildPolylineFromMoves,
  parsePosition,
  type PathTemplate,
} from './pathEngine'
import {
  findTargetObject,
  hasObjectSpatialReference,
  parseCanvasAnchor,
  parsePointToHint,
  parseSpatialHint,
  resolveCanvasPlacement,
  resolvePlacement,
  resolvePointTarget,
  shortenTowardTarget,
  splitSpatialClauses,
  type CanvasAnchor,
} from './spatialEngine'
import { useAppStore } from '../stores/appStore'
import {
  clearSelectedObject,
  getDrawableObjects,
  getSelectedObject,
  listObjectsForContext,
  selectObjectByHint,
} from './objectSelect'

export type FabricCanvasRef = Canvas

const historyStack: string[] = []
let historyIndex = -1
let lastDrawnObject: FabricObject | null = null

const COLOR_MAP: Record<string, string> = {
  红: '#ff4444', 红色: '#ff4444',
  蓝: '#4488ff', 蓝色: '#4488ff',
  绿: '#44cc66', 绿色: '#44cc66',
  黄: '#ffcc00', 黄色: '#ffcc00',
  白: '#ffffff', 白色: '#ffffff',
  黑: '#222222', 黑色: '#222222',
  紫: '#aa44ff', 紫色: '#aa44ff',
  橙: '#ff8844', 橙色: '#ff8844',
  粉: '#ff88cc', 粉色: '#ff88cc',
  青: '#44dddd', 青色: '#44dddd',
}

const SHAPE_ALIASES: Record<string, string> = {
  圆: 'circle', 圆形: 'circle', circle: 'circle',
  矩形: 'rect', 方块: 'rect', rect: 'rect',
  椭圆: 'ellipse', ellipse: 'ellipse',
  三角: 'triangle', 三角形: 'triangle', triangle: 'triangle',
  星: 'star', 星形: 'star', 五角星: 'star', star: 'star',
  爱心: 'heart', 心形: 'heart', heart: 'heart',
  线: 'line', 直线: 'line', line: 'line',
  箭头: 'arrow', arrow: 'arrow',
  文字: 'text', 文本: 'text', text: 'text',
  多边: 'polygon', 多边形: 'polygon', polygon: 'polygon',
  笑脸: 'smiley', smiley: 'smiley', face: 'smiley', 表情: 'smiley',
}

export function normalizeDrawArgs(args: Record<string, unknown>): Record<string, unknown> {
  const rawShape = String(args.shape ?? 'circle').trim()
  let shape = SHAPE_ALIASES[rawShape] ?? SHAPE_ALIASES[rawShape.replace(/形$/, '')] ?? 'circle'
  const fullPos = String(args.position ?? args.anchor ?? '')
  const { placement, pointTo } = splitSpatialClauses(fullPos)
  if (/笑脸|表情|smiley|face/i.test(rawShape) || /笑脸|表情/.test(placement)) shape = 'smiley'
  if (/树|松树|圣诞树/i.test(rawShape) || /树|松树/.test(placement)) shape = 'triangle'

  const canvasAnchor = parseCanvasAnchor(placement)
  const spatial = parseSpatialHint(placement)
  const pointHint = parsePointToHint(String(args.pointTo ?? pointTo))

  const next: Record<string, unknown> = {
    ...args,
    shape,
    color: args.color ? parseColor(String(args.color)) : args.color,
  }

  if (pointTo || args.pointTo || args.targetType || args.targetColor) {
    next.targetType = next.targetType ?? pointHint.type
    next.targetColor = next.targetColor ?? pointHint.color
    if (pointTo) next.pointTo = pointTo
  }

  if (canvasAnchor) {
    next.canvasAnchor = canvasAnchor
    next.relativeTo = 'canvas'
  } else if (hasObjectSpatialReference({ ...next, position: placement })) {
    next.anchor = next.anchor ?? spatial.anchor
    next.referenceType = next.referenceType ?? spatial.type
    next.referenceColor = next.referenceColor ?? spatial.color
    if (!next.relativeTo) next.relativeTo = 'selected'
  }

  if (shape === 'rect' && (/正方|方块/.test(rawShape) || /正方|方块/.test(placement))) {
    next.square = true
  }

  return next
}

function buildArrowShape(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  strokeWidth: number,
): Group {
  const line = new Line([x1, y1, x2, y2], {
    stroke: color,
    strokeWidth,
    strokeLineCap: 'round',
  })
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const headLen = Math.max(14, strokeWidth * 5)
  const spread = Math.PI / 7
  const head = new Polygon(
    [
      { x: x2, y: y2 },
      { x: x2 - headLen * Math.cos(angle - spread), y: y2 - headLen * Math.sin(angle - spread) },
      { x: x2 - headLen * Math.cos(angle + spread), y: y2 - headLen * Math.sin(angle + spread) },
    ],
    { fill: color, stroke: color, strokeWidth: 1 },
  )
  return new Group([line, head])
}

export function parseColor(input?: string): string {
  if (!input) return '#4fc3f7'
  const t = input.trim()
  if (t.startsWith('#')) return t
  for (const [k, v] of Object.entries(COLOR_MAP)) {
    if (t.includes(k)) return v
  }
  return '#4fc3f7'
}

function saveState(canvas: Canvas) {
  const json = JSON.stringify(canvas.toJSON())
  historyStack.splice(historyIndex + 1)
  historyStack.push(json)
  historyIndex = historyStack.length - 1
}

function trackObject(obj: FabricObject) {
  lastDrawnObject = obj
  ;(obj as FabricObject & { vcId?: string }).vcId = `obj_${Date.now()}`
}

function getTargetObject(canvas: Canvas, hint?: string): FabricObject | null {
  const sel = getSelectedObject()
  if (sel) return sel
  const objs = getDrawableObjects(canvas)
  if (!objs.length) return null
  if (hint && /最后|上一个/.test(hint)) return objs[objs.length - 1]
  return lastDrawnObject ?? objs[objs.length - 1]
}

export function drawPath(canvas: Canvas, args: Record<string, unknown>) {
  const color = parseColor(String(args.color ?? ''))
  const strokeWidth = Number(args.strokeWidth ?? 3)
  const placement = resolvePlacement(canvas, args)
  const point = placement
    ? { x: placement.cx, y: placement.cy }
    : parsePosition(String(args.position ?? '中间'), canvas.getWidth(), canvas.getHeight())
  const size = placement?.size ?? Number(args.size ?? 60)
  const template = String(args.pathType ?? args.template ?? 'wave') as PathTemplate

  let obj: FabricObject
  if (args.moves && Array.isArray(args.moves)) {
    const moves = args.moves as [number, number][]
    obj = buildPolylineFromMoves(point.x, point.y, moves, color, strokeWidth)
  } else {
    obj = buildPathTemplate(template, point.x, point.y, size, color, strokeWidth)
  }
  canvas.add(obj)
  trackObject(obj)
  saveState(canvas)
  canvas.requestRenderAll()
}

export function getLastDrawnObject(): FabricObject | null {
  return lastDrawnObject
}

export { selectObjectByHint, listObjectsForContext }

export function initCanvas(el: HTMLCanvasElement, width: number, height: number): Canvas {
  const canvas = new Canvas(el, {
    width,
    height,
    backgroundColor: '#ffffff',
    selection: false,
  })
  saveState(canvas)
  return canvas
}

export function resizeCanvas(canvas: Canvas, width: number, height: number) {
  canvas.setDimensions({ width, height })
  canvas.requestRenderAll()
}

export function undo(canvas: Canvas): boolean {
  if (historyIndex <= 0) return false
  historyIndex -= 1
  canvas.loadFromJSON(historyStack[historyIndex]).then(() => canvas.requestRenderAll())
  return true
}

export function redo(canvas: Canvas): boolean {
  if (historyIndex >= historyStack.length - 1) return false
  historyIndex += 1
  canvas.loadFromJSON(historyStack[historyIndex]).then(() => canvas.requestRenderAll())
  return true
}

export function clearCanvas(canvas: Canvas) {
  canvas.clear()
  canvas.backgroundColor = '#ffffff'
  lastDrawnObject = null
  saveState(canvas)
  canvas.requestRenderAll()
}

export function zoomCanvas(canvas: Canvas, factor: number) {
  canvas.setZoom(Math.min(Math.max(canvas.getZoom() * factor, 0.2), 5))
  canvas.requestRenderAll()
}

export function zoomTo(canvas: Canvas, value: number) {
  canvas.setZoom(Math.min(Math.max(value, 0.2), 5))
  canvas.requestRenderAll()
}

export function panCanvas(canvas: Canvas, dx: number, dy: number) {
  const vpt = [...(canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0])] as [number, number, number, number, number, number]
  vpt[4] += dx
  vpt[5] += dy
  canvas.setViewportTransform(vpt)
  canvas.requestRenderAll()
}

/** 扩展画布尺寸，用于扩图/外绘预留空白区域 */
export function expandCanvasSize(
  canvas: Canvas,
  direction: 'left' | 'right' | 'top' | 'bottom',
  amount = 240,
): boolean {
  const w = canvas.getWidth()
  const h = canvas.getHeight()
  const shiftX = direction === 'left' ? amount : 0
  const shiftY = direction === 'top' ? amount : 0
  const newW = direction === 'left' || direction === 'right' ? w + amount : w
  const newH = direction === 'top' || direction === 'bottom' ? h + amount : h
  canvas.getObjects().forEach((obj) => {
    obj.set({
      left: (obj.left ?? 0) + shiftX,
      top: (obj.top ?? 0) + shiftY,
    })
    obj.setCoords()
  })
  canvas.setDimensions({ width: newW, height: newH })
  if (shiftX || shiftY) {
    panCanvas(canvas, shiftX, shiftY)
  }
  saveState(canvas)
  canvas.requestRenderAll()
  return true
}

export function fitWindow(canvas: Canvas) {
  canvas.setZoom(1)
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
  canvas.requestRenderAll()
}

function getLastFabricImage(canvas: Canvas): FabricImage | null {
  const objs = getDrawableObjects(canvas)
  for (let i = objs.length - 1; i >= 0; i--) {
    if (objs[i] instanceof FabricImage) return objs[i] as FabricImage
  }
  return null
}

/** 将画布上最后一张图片缩放至铺满（cover）或完整显示（contain） */
export function fitImageToCanvas(canvas: Canvas, mode: 'cover' | 'contain' = 'contain'): boolean {
  const obj = getLastFabricImage(canvas)
  if (!obj) return false
  const cw = canvas.getWidth()
  const ch = canvas.getHeight()
  const baseW = obj.width ?? 1
  const baseH = obj.height ?? 1
  const scale = mode === 'cover'
    ? Math.max(cw / baseW, ch / baseH)
    : Math.min(cw / baseW, ch / baseH)
  obj.set({
    scaleX: scale,
    scaleY: scale,
    left: (cw - baseW * scale) / 2,
    top: (ch - baseH * scale) / 2,
    originX: 'left',
    originY: 'top',
  })
  obj.setCoords()
  canvas.requestRenderAll()
  saveState(canvas)
  return true
}

export function getObjectsSummary(canvas: Canvas): string {
  return listObjectsForContext(canvas)
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement('a')
  link.download = filename
  link.href = dataUrl
  link.click()
}

function normalizeImageDataUrl(src: string, format: 'base64' | 'url'): string {
  if (format === 'base64') {
    return src.startsWith('data:') ? src : `data:image/jpeg;base64,${src}`
  }
  return src
}

function saveLastFabricImage(canvas: Canvas, filename: string): boolean {
  const objs = getDrawableObjects(canvas)
  for (let i = objs.length - 1; i >= 0; i--) {
    const obj = objs[i]
    if (!(obj instanceof FabricImage)) continue
    const el = obj.getElement() as HTMLImageElement | undefined
    const src = el?.currentSrc || el?.src
    if (src?.startsWith('data:')) {
      downloadDataUrl(src, filename)
      return true
    }
  }
  return false
}

export function saveCanvasAsPng(canvas: Canvas, filename = 'voicecanvas.png'): boolean {
  try {
    downloadDataUrl(canvas.toDataURL({ format: 'png', multiplier: 1 }), filename)
    return true
  } catch {
    const fallback = useAppStore.getState().lastAiImageDataUrl
    if (fallback) {
      downloadDataUrl(fallback, filename)
      return true
    }
    if (saveLastFabricImage(canvas, filename)) return true
    return false
  }
}

export function setObjectStyle(canvas: Canvas, args: Record<string, unknown>) {
  const obj = getTargetObject(canvas, String(args.target ?? ''))
  if (!obj) return false

  if (args.color) {
    const c = parseColor(String(args.color))
    if (obj.fill && obj.fill !== 'transparent') obj.set('fill', c)
    obj.set('stroke', c)
  }
  if (args.strokeWidth != null) obj.set('strokeWidth', Number(args.strokeWidth))
  if (args.opacity != null) obj.set('opacity', Number(args.opacity))
  if (args.fill === true || args.fill === 'solid' || args.solid === true) {
    obj.set('fill', parseColor(String(args.color ?? '#4fc3f7')))
  }
  if (args.fill === false || args.fill === 'none' || args.hollow === true) {
    obj.set('fill', 'transparent')
  }
  canvas.requestRenderAll()
  saveState(canvas)
  return true
}

export function transformObject(canvas: Canvas, args: Record<string, unknown>) {
  const obj = getTargetObject(canvas, String(args.target ?? ''))
  if (!obj) return false

  const action = String(args.action ?? 'scale')
  if (action === 'move') {
    obj.set({
      left: (obj.left ?? 0) + Number(args.dx ?? 0),
      top: (obj.top ?? 0) + Number(args.dy ?? 0),
    })
  } else if (action === 'scale') {
    const factor = Number(args.factor ?? 1.2)
    obj.scale((obj.scaleX ?? 1) * factor)
  } else if (action === 'rotate') {
    obj.rotate((obj.angle ?? 0) + Number(args.degrees ?? 15))
  } else if (action === 'flip_x') {
    obj.set('flipX', !obj.flipX)
  } else if (action === 'flip_y') {
    obj.set('flipY', !obj.flipY)
  }
  canvas.requestRenderAll()
  saveState(canvas)
  return true
}

export function layerControl(canvas: Canvas, action: string) {
  const obj = getTargetObject(canvas)
  if (!obj) return false
  if (action === 'front' || action === 'bring_to_front') canvas.bringObjectToFront(obj)
  else if (action === 'back' || action === 'send_to_back') canvas.sendObjectToBack(obj)
  else if (action === 'forward') canvas.bringObjectForward(obj)
  else if (action === 'backward') canvas.sendObjectBackwards(obj)
  canvas.requestRenderAll()
  saveState(canvas)
  return true
}

export function deleteLastObject(canvas: Canvas) {
  const obj = getTargetObject(canvas)
  if (!obj) return false
  if (getSelectedObject() === obj) clearSelectedObject(canvas)
  canvas.remove(obj)
  lastDrawnObject = null
  saveState(canvas)
  canvas.requestRenderAll()
  return true
}

export function duplicateLastObject(canvas: Canvas) {
  const obj = getTargetObject(canvas)
  if (!obj) return false
  obj.clone().then((cloned) => {
    cloned.set({ left: (obj.left ?? 0) + 20, top: (obj.top ?? 0) + 20 })
    canvas.add(cloned)
    trackObject(cloned)
    saveState(canvas)
    canvas.requestRenderAll()
  })
  return true
}

function buildSmileyFace(cx: number, cy: number, radius: number, color: string): Group {
  const face = new Circle({
    radius,
    fill: color,
    stroke: '#222222',
    strokeWidth: 2,
    originX: 'center',
    originY: 'center',
    left: cx,
    top: cy,
  })
  const eyeR = Math.max(3, radius * 0.1)
  const eyeY = cy - radius * 0.22
  const eyeOffset = radius * 0.32
  const eye1 = new Circle({
    radius: eyeR,
    fill: '#222222',
    originX: 'center',
    originY: 'center',
    left: cx - eyeOffset,
    top: eyeY,
  })
  const eye2 = new Circle({
    radius: eyeR,
    fill: '#222222',
    originX: 'center',
    originY: 'center',
    left: cx + eyeOffset,
    top: eyeY,
  })
  const mouth = new Path(
    `M ${cx - radius * 0.34} ${cy + radius * 0.12}
     Q ${cx} ${cy + radius * 0.52} ${cx + radius * 0.34} ${cy + radius * 0.12}`,
    { fill: '', stroke: '#222222', strokeWidth: Math.max(2, radius * 0.08), strokeLineCap: 'round' },
  )
  return new Group([face, eye1, eye2, mouth], {
    originX: 'center',
    originY: 'center',
    left: cx,
    top: cy,
  })
}

export function drawShape(canvas: Canvas, args: Record<string, unknown>): void {
  const norm = normalizeDrawArgs(args)
  const color = parseColor(String(norm.color ?? ''))
  const strokeWidth = Number(norm.strokeWidth ?? 2)
  const filled = norm.fill === true || norm.fill === 'solid' || norm.solid === true
  const placement = resolvePlacement(canvas, norm)
  const canvasAnchor = parseCanvasAnchor(String(norm.position ?? ''))
  const canvasPlacement = (!placement && (canvasAnchor || norm.relativeTo === 'canvas'))
    ? resolveCanvasPlacement(canvas, (norm.canvasAnchor as CanvasAnchor) ?? canvasAnchor ?? 'center', Number(norm.size ?? 48))
    : null
  const resolved = placement ?? canvasPlacement
  const cx = resolved?.cx
    ?? Number(norm.x ?? (norm.position
      ? parsePosition(String(norm.position), canvas.getWidth(), canvas.getHeight()).x
      : canvas.getWidth() / 2))
  const cy = resolved?.cy
    ?? Number(norm.y ?? (norm.position
      ? parsePosition(String(norm.position), canvas.getWidth(), canvas.getHeight()).y
      : canvas.getHeight() / 2))
  const defaultRadius = resolved?.size ?? Number(norm.radius ?? 50)
  const shape = String(norm.shape ?? 'circle')
  let obj: FabricObject

  switch (shape) {
    case 'line': {
      const target = resolvePointTarget(canvas, norm)
      if (target) {
        obj = new Line([cx, cy, target.x, target.y], { stroke: color, strokeWidth })
      } else {
        obj = new Line([cx - 80, cy, cx + 80, cy], { stroke: color, strokeWidth })
      }
      break
    }
    case 'arrow': {
      const target = resolvePointTarget(canvas, norm)
      const targetObj = findTargetObject(canvas, norm)
      if (target) {
        const tip = shortenTowardTarget(cx, cy, target.x, target.y, targetObj)
        obj = buildArrowShape(cx, cy, tip.x, tip.y, color, strokeWidth)
      } else {
        const len = Number(norm.length ?? 120)
        obj = buildArrowShape(cx, cy, cx + len, cy, color, strokeWidth)
      }
      break
    }
    case 'rect': {
      const size = Number(norm.size ?? args.size ?? 60)
      const square = norm.square === true || args.square === true
      const w = Number(args.width ?? size)
      const h = Number(args.height ?? (square ? w : Math.round(w * 0.75)))
      obj = new Rect({
        left: cx - w / 2,
        top: cy - h / 2,
        width: w,
        height: h,
        fill: filled ? color : 'transparent',
        stroke: color,
        strokeWidth,
      })
      break
    }
    case 'ellipse':
      obj = new Ellipse({
        left: cx - Number(args.rx ?? 70),
        top: cy - Number(args.ry ?? 45),
        rx: Number(args.rx ?? 70),
        ry: Number(args.ry ?? 45),
        fill: filled ? color : 'transparent',
        stroke: color,
        strokeWidth,
      })
      break
    case 'triangle': {
      const triSize = Number(norm.size ?? args.size ?? defaultRadius)
      obj = new Triangle({
        left: cx - triSize / 2,
        top: cy - triSize / 2,
        width: triSize,
        height: triSize,
        fill: filled ? color : 'transparent',
        stroke: color,
        strokeWidth,
      })
      break
    }
    case 'polygon':
      obj = new Polygon(
        [
          { x: cx, y: cy - 50 },
          { x: cx + 50, y: cy + 40 },
          { x: cx - 50, y: cy + 40 },
        ],
        { fill: filled ? color : 'transparent', stroke: color, strokeWidth },
      )
      break
    case 'star':
      obj = buildPathTemplate('star', cx, cy, defaultRadius, color, strokeWidth)
      break
    case 'heart': {
      const heartSize = defaultRadius
      obj = buildPathTemplate('heart', cx, cy - heartSize * 0.12, heartSize, color, strokeWidth)
      break
    }
    case 'smiley':
      obj = buildSmileyFace(cx, cy, defaultRadius, color)
      break
    case 'text':
      obj = new IText(String(args.text ?? 'VoiceCanvas'), {
        left: cx - 60, top: cy - 20, fill: color, fontSize: Number(args.fontSize ?? 24),
      })
      break
    default:
      obj = new Circle({
        radius: defaultRadius,
        fill: filled || norm.color ? color : 'transparent',
        stroke: color,
        strokeWidth,
        originX: 'center',
        originY: 'center',
        left: cx,
        top: cy,
      })
  }

  canvas.add(obj)
  trackObject(obj)
  saveState(canvas)
  canvas.requestRenderAll()
}

export async function addImageFromSource(
  canvas: Canvas,
  src: string,
  format: 'base64' | 'url',
  fit: 'cover' | 'contain' = 'contain',
): Promise<void> {
  const imageSrc = normalizeImageDataUrl(src, format)
  const img = await FabricImage.fromURL(imageSrc, { crossOrigin: 'anonymous' })
  canvas.add(img)
  trackObject(img)
  fitImageToCanvas(canvas, fit)
  saveState(canvas)
  canvas.requestRenderAll()
  useAppStore.getState().setLastAiImageDataUrl(imageSrc)
}

export function getCanvasDataUrl(canvas: Canvas): string {
  return canvas.toDataURL({ format: 'png', multiplier: 1 })
}

export function selectRegion(canvas: Canvas, region: string) {
  const w = canvas.getWidth()
  const h = canvas.getHeight()
  const regions: Record<string, [number, number, number, number]> = {
    top: [0, 0, w, h / 3],
    bottom: [0, (h * 2) / 3, w, h / 3],
    left: [0, 0, w / 3, h],
    right: [(w * 2) / 3, 0, w / 3, h],
    center: [w / 4, h / 4, w / 2, h / 2],
    third_top: [0, 0, w, h / 3],
    third_bottom: [0, (h * 2) / 3, w, h / 3],
    all: [0, 0, w, h],
  }
  const rect = regions[region] ?? regions.center
  const overlay = new Rect({
    left: rect[0], top: rect[1], width: rect[2], height: rect[3],
    fill: 'rgba(79, 195, 247, 0.15)', stroke: '#4fc3f7', strokeWidth: 2,
    selectable: false, evented: false, name: 'selection-overlay',
  })
  canvas.getObjects()
    .filter((o) => (o as { name?: string }).name === 'selection-overlay')
    .forEach((o) => canvas.remove(o))
  canvas.add(overlay)
  canvas.requestRenderAll()
}
