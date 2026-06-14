import type { FabricObject } from 'fabric'
import type { FabricCanvasRef } from './fabricEngine'
import { getDrawableObjects, getSelectedObject, selectObjectByHint } from './objectSelect'

const COLOR_WORDS = '红|红色|蓝|蓝色|绿|绿色|黄|黄色|白|白色|黑|黑色|紫|紫色|橙|橙色|粉|粉色|青|青色'

export type CanvasAnchor =
  | 'top_left'
  | 'top_right'
  | 'bottom_left'
  | 'bottom_right'
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'

export interface SpatialHint {
  type?: string
  color?: string
  anchor: string
}

export interface PlacementResult {
  cx: number
  cy: number
  size: number
  source: 'canvas' | 'object'
}

export function splitSpatialClauses(text: string): { placement: string; pointTo: string } {
  const t = text.trim()
  const pointMatch = t.match(/(?:指向|对准|对着|朝向|朝)(.+)/)
  const pointTo = pointMatch?.[1]?.trim() ?? ''
  const placement = pointMatch ? t.replace(pointMatch[0], '').trim() : t
  return { placement, pointTo }
}

export function parseCanvasAnchor(text: string): CanvasAnchor | null {
  const t = splitSpatialClauses(text).placement.trim()
  // 支持「在左上角画…」「画在左上角…」等口语，不仅限于句首「左上角」
  if (/在?\s*左上(?:角)?|画布.{0,6}(左上|左上角)|^左上(?:角)?/.test(t)) return 'top_left'
  if (/在?\s*右上(?:角)?|画布.{0,6}(右上|右上角)|^右上(?:角)?/.test(t)) return 'top_right'
  if (/在?\s*左下(?:角)?|画布.{0,6}(左下|左下角)|^左下(?:角)?/.test(t)) return 'bottom_left'
  if (/在?\s*右下(?:角)?|画布.{0,6}(右下|右下角)|^右下(?:角)?/.test(t)) return 'bottom_right'
  if (/在?\s*(?:中间|中心|居中|中央)|画布.{0,6}(中间|中心|居中|中央)/.test(t)) return 'center'
  if (/在?\s*(?:上方|顶部|上边)|画布.{0,6}(上方|顶部|上边)/.test(t)) return 'top'
  if (/在?\s*(?:下方|底部|下边)|画布.{0,6}(下方|底部|下边)/.test(t)) return 'bottom'
  if (/在?\s*(?:左侧|左边)|画布.{0,6}(左侧|左边)/.test(t)) return 'left'
  if (/在?\s*(?:右侧|右边)|画布.{0,6}(右侧|右边)/.test(t)) return 'right'
  return null
}

export function parseSpatialHint(text: string): SpatialHint {
  const t = splitSpatialClauses(text).placement.trim()
  const colorMatch = t.match(new RegExp(COLOR_WORDS))
  const typeMatch = t.match(/(圆形|圆|矩形|方块|心形|心|椭圆|星形|星|箭头)/)
  let anchor = 'center'
  if (/上面|上方|之上|顶部/.test(t)) anchor = 'above'
  else if (/下面|下方|之下|底部/.test(t)) anchor = 'below'
  else if (/左边|左侧/.test(t)) anchor = 'left'
  else if (/右边|右侧/.test(t)) anchor = 'right'
  else if (/中间|中心|居中|里面|内部|正中|当中/.test(t)) anchor = 'center'
  return { color: colorMatch?.[0], type: typeMatch?.[1], anchor }
}

export function parsePointToHint(text: string): SpatialHint {
  const raw = String(text ?? '').trim()
  const fromClause = splitSpatialClauses(raw).pointTo
  const src = fromClause || raw
  const colorMatch = src.match(new RegExp(COLOR_WORDS))
  const typeMatch = src.match(/(圆形|圆|矩形|方块|心形|心|椭圆|星形|星)/)
  return { color: colorMatch?.[0], type: typeMatch?.[1], anchor: 'center' }
}

export function hasCanvasSpatialReference(args: Record<string, unknown>): boolean {
  const pos = String(args.position ?? args.anchor ?? '')
  if (args.canvasAnchor || args.relativeTo === 'canvas') return true
  return !!parseCanvasAnchor(pos)
}

export function hasObjectSpatialReference(args: Record<string, unknown>): boolean {
  const pos = splitSpatialClauses(String(args.position ?? args.anchor ?? '')).placement
  if (args.referenceType || args.referenceColor) return true
  if (args.relativeTo === 'selected' || args.relativeTo === 'last') return true
  if (/在.{0,12}(圆|圆形|矩形|方块|心|星|椭圆)/.test(pos)) return true
  if (/(上面|下面|左边|右边|中间|中心|里面|内部|左侧|右侧|上方|下方)/.test(pos) && /(圆|矩形|方块|心|星|椭圆)/.test(pos)) {
    return true
  }
  const spatial = parseSpatialHint(pos)
  return !!(spatial.type || spatial.color)
}

export function hasSpatialReference(args: Record<string, unknown>): boolean {
  const pos = String(args.position ?? args.anchor ?? '')
  if (args.pointTo || args.targetType || args.targetColor || args.targetX != null) return true
  if (splitSpatialClauses(pos).pointTo) return true
  if (hasCanvasSpatialReference(args)) return true
  return hasObjectSpatialReference(args)
}

function getObjectCenter(ref: FabricObject): { x: number; y: number } {
  ref.setCoords?.()
  const withCenter = ref as FabricObject & { getCenterPoint?: () => { x: number; y: number } }
  if (typeof withCenter.getCenterPoint === 'function') {
    const c = withCenter.getCenterPoint()
    return { x: c.x, y: c.y }
  }
  const b = ref.getBoundingRect()
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
}

function getObjectSize(ref: FabricObject): number {
  const b = ref.getBoundingRect()
  return Math.min(b.width, b.height)
}

export function findReferenceObject(
  canvas: FabricCanvasRef,
  args: Record<string, unknown>,
): FabricObject | null {
  const refType = args.referenceType != null ? String(args.referenceType) : undefined
  const refColor = args.referenceColor != null ? String(args.referenceColor) : undefined
  const relativeTo = args.relativeTo != null ? String(args.relativeTo) : undefined

  let ref = getSelectedObject()

  if (refType || refColor) {
    const matched = selectObjectByHint(canvas, { type: refType, color: refColor })
    if (matched) ref = matched
  }

  if (!ref && (relativeTo === 'selected' || relativeTo === 'last')) {
    ref = getSelectedObject() ?? selectObjectByHint(canvas, { ordinal: '最后' })
  }

  if (!ref) {
    const objs = getDrawableObjects(canvas)
    if (objs.length === 1) ref = objs[0]
    else if (refType) {
      const typeOnly = selectObjectByHint(canvas, { type: refType })
      if (typeOnly) ref = typeOnly
    }
  }

  return ref
}

export function findTargetObject(
  canvas: FabricCanvasRef,
  args: Record<string, unknown>,
): FabricObject | null {
  const pointText = String(args.pointTo ?? args.point_to ?? args.target ?? '')
  const clause = splitSpatialClauses(String(args.position ?? '')).pointTo
  const hint = parsePointToHint(pointText || clause)
  return findReferenceObject(canvas, {
    referenceType: args.targetType ?? hint.type,
    referenceColor: args.targetColor ?? hint.color,
  })
}

export function resolveCanvasPlacement(
  canvas: FabricCanvasRef,
  anchor: CanvasAnchor,
  size = 48,
): PlacementResult {
  const w = canvas.getWidth()
  const h = canvas.getHeight()
  const mx = w * 0.12
  const my = h * 0.12
  switch (anchor) {
    case 'top_left':
      return { cx: mx, cy: my, size, source: 'canvas' }
    case 'top_right':
      return { cx: w - mx, cy: my, size, source: 'canvas' }
    case 'bottom_left':
      return { cx: mx, cy: h - my, size, source: 'canvas' }
    case 'bottom_right':
      return { cx: w - mx, cy: h - my, size, source: 'canvas' }
    case 'top':
      return { cx: w / 2, cy: my, size, source: 'canvas' }
    case 'bottom':
      return { cx: w / 2, cy: h - my, size, source: 'canvas' }
    case 'left':
      return { cx: mx, cy: h / 2, size, source: 'canvas' }
    case 'right':
      return { cx: w - mx, cy: h / 2, size, source: 'canvas' }
    default:
      return { cx: w / 2, cy: h / 2, size, source: 'canvas' }
  }
}

export function resolvePointTarget(
  canvas: FabricCanvasRef,
  args: Record<string, unknown>,
): { x: number; y: number } | null {
  if (args.targetX != null && args.targetY != null) {
    return { x: Number(args.targetX), y: Number(args.targetY) }
  }
  const target = findTargetObject(canvas, args)
  if (target) return getObjectCenter(target)
  return null
}

export function shortenTowardTarget(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  target?: FabricObject | null,
): { x: number; y: number } {
  if (!target) return { x: toX, y: toY }
  const center = getObjectCenter(target)
  const b = target.getBoundingRect()
  const radius = Math.max(b.width, b.height) / 2
  const dx = center.x - fromX
  const dy = center.y - fromY
  const dist = Math.hypot(dx, dy)
  if (dist <= radius) return center
  const stop = Math.max(radius * 0.15, dist - radius * 0.92)
  const ratio = stop / dist
  return { x: fromX + dx * ratio, y: fromY + dy * ratio }
}

export function resolvePlacement(
  canvas: FabricCanvasRef,
  args: Record<string, unknown>,
): PlacementResult | null {
  const posText = splitSpatialClauses(String(args.position ?? args.anchor ?? '')).placement
  const canvasAnchor = (args.canvasAnchor as CanvasAnchor | undefined) ?? parseCanvasAnchor(posText)

  if (canvasAnchor || args.relativeTo === 'canvas') {
    return resolveCanvasPlacement(canvas, canvasAnchor ?? 'center', Number(args.size ?? args.radius ?? 48))
  }

  if (!hasObjectSpatialReference(args)) return null

  const parsed = parseSpatialHint(posText)
  const relativeTo = args.relativeTo != null ? String(args.relativeTo) : ''
  const anchorRaw = String(args.anchor ?? parsed.anchor ?? '')

  const ref = findReferenceObject(canvas, {
    ...args,
    referenceType: args.referenceType ?? parsed.type,
    referenceColor: args.referenceColor ?? parsed.color,
  })
  if (!ref) return null

  const center = getObjectCenter(ref)
  const refSize = getObjectSize(ref)
  const size = Number(args.radius ?? args.size ?? Math.max(14, refSize * 0.4))

  const anchor = anchorRaw
    || parsed.anchor
    || (relativeTo === 'above' ? 'above' : relativeTo === 'below' ? 'below' : 'center')

  if (/上面|上方|above|top/i.test(anchor) || relativeTo === 'above') {
    return { cx: center.x, cy: center.y - refSize * 0.42 - size * 0.3, size, source: 'object' }
  }
  if (/下面|下方|below|bottom/i.test(anchor) || relativeTo === 'below') {
    return { cx: center.x, cy: center.y + refSize * 0.42 + size * 0.3, size, source: 'object' }
  }
  if (/左边|左侧|left/i.test(anchor)) {
    return { cx: center.x - refSize * 0.42 - size * 0.3, cy: center.y, size, source: 'object' }
  }
  if (/右边|右侧|right/i.test(anchor)) {
    return { cx: center.x + refSize * 0.42 + size * 0.3, cy: center.y, size, source: 'object' }
  }
  return { cx: center.x, cy: center.y, size, source: 'object' }
}
