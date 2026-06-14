import type { FabricObject } from 'fabric'
import type { FabricCanvasRef } from './fabricEngine'
import { getDrawableObjects, getSelectedObject } from './objectSelect'
import type { BBox, Point2D, SceneGraph, SceneObject } from '../types'

const TYPE_ZH: Record<string, string> = {
  circle: '圆形',
  rect: '矩形',
  ellipse: '椭圆',
  triangle: '三角',
  line: '线条',
  polyline: '折线',
  path: '路径',
  'i-text': '文字',
  text: '文字',
  image: '图片',
  group: '组合',
  polygon: '多边形',
}

const HEX_TO_ZH: Record<string, string> = {
  '#ff4444': '红',
  '#4488ff': '蓝',
  '#44cc66': '绿',
  '#ffcc00': '黄',
  '#ffffff': '白',
  '#222222': '黑',
  '#aa44ff': '紫',
  '#ff8844': '橙',
  '#ff88cc': '粉',
  '#44dddd': '青',
}

function objectColorHex(obj: FabricObject): string {
  const fill = typeof obj.fill === 'string' ? obj.fill.trim().toLowerCase() : ''
  const stroke = typeof obj.stroke === 'string' ? obj.stroke.trim().toLowerCase() : ''
  if (fill && fill !== 'transparent') return fill
  return stroke
}

function objectColorLabel(obj: FabricObject): string | undefined {
  const hex = objectColorHex(obj)
  return HEX_TO_ZH[hex]
}

function getCenter(obj: FabricObject): Point2D {
  obj.setCoords?.()
  const withCenter = obj as FabricObject & { getCenterPoint?: () => { x: number; y: number } }
  if (typeof withCenter.getCenterPoint === 'function') {
    const c = withCenter.getCenterPoint()
    return { x: Math.round(c.x), y: Math.round(c.y) }
  }
  const b = obj.getBoundingRect()
  return {
    x: Math.round(b.left + b.width / 2),
    y: Math.round(b.top + b.height / 2),
  }
}

function getBBox(obj: FabricObject): BBox {
  const b = obj.getBoundingRect()
  return {
    left: Math.round(b.left),
    top: Math.round(b.top),
    width: Math.round(b.width),
    height: Math.round(b.height),
  }
}

function getRadius(obj: FabricObject): number | undefined {
  if (obj.type === 'circle') {
    const c = obj as FabricObject & { radius?: number }
    return Math.round((c.radius ?? 0) * (obj.scaleX ?? 1))
  }
  const b = obj.getBoundingRect()
  return Math.round(Math.min(b.width, b.height) / 2)
}

export function serializeSceneObject(obj: FabricObject, index: number): SceneObject {
  const vcId = (obj as FabricObject & { vcId?: string }).vcId ?? `obj_${index + 1}`
  const selected = getSelectedObject() === obj
  return {
    id: vcId,
    type: obj.type ?? 'object',
    label: TYPE_ZH[obj.type ?? ''] ?? obj.type ?? '图形',
    color: objectColorLabel(obj),
    center: getCenter(obj),
    bbox: getBBox(obj),
    radius: getRadius(obj),
    selected,
  }
}

export function snapshotObject(obj: FabricObject | null, toolName: string, message: string) {
  if (!obj) {
    return { tool: toolName, success: false, message }
  }
  const vcId = (obj as FabricObject & { vcId?: string }).vcId
  return {
    tool: toolName,
    success: true,
    message,
    object_id: vcId,
    center: getCenter(obj),
    bbox: getBBox(obj),
  }
}

export function buildSceneGraph(canvas: FabricCanvasRef | null): SceneGraph {
  if (!canvas) {
    return { canvas: { width: 800, height: 600 }, objects: [] }
  }
  const objs = getDrawableObjects(canvas)
  return {
    canvas: { width: canvas.getWidth(), height: canvas.getHeight() },
    objects: objs.map((o, i) => serializeSceneObject(o, i)),
  }
}

export function buildObjectsSummary(scene: SceneGraph): string {
  if (!scene.objects.length) return '空画布'
  return scene.objects
    .map((o, i) => {
      const color = o.color ? `(${o.color})` : ''
      return `#${i + 1}${o.label}${color}@${o.center.x},${o.center.y}`
    })
    .join(', ')
}
