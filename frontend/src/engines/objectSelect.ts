import { Canvas, FabricObject, Rect } from 'fabric'

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

const COLOR_HINT_HEX: Record<string, string> = {
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

const HEX_TO_ZH: Record<string, string> = {
  '#ff4444': '红', '#4488ff': '蓝', '#44cc66': '绿', '#ffcc00': '黄',
  '#ffffff': '白', '#222222': '黑', '#aa44ff': '紫', '#ff8844': '橙',
  '#ff88cc': '粉', '#44dddd': '青', '#4fc3f7': '青',
}

function normalizeHex(color: unknown): string {
  if (typeof color !== 'string') return ''
  const c = color.trim().toLowerCase()
  if (c.startsWith('#')) return c.length === 4 ? c : c.slice(0, 7)
  return c
}

function objectColorHex(obj: FabricObject): string {
  const fill = normalizeHex(obj.fill)
  const stroke = normalizeHex(obj.stroke)
  if (fill && fill !== 'transparent') return fill
  return stroke
}

function objectColorLabel(obj: FabricObject): string {
  const hex = objectColorHex(obj)
  return HEX_TO_ZH[hex] ?? ''
}

function colorsRoughlyMatch(a: string, b: string): boolean {
  if (!a || !b) return false
  return a.toLowerCase() === b.toLowerCase()
}

function matchObjectColor(obj: FabricObject, colorHint: string): boolean {
  const target = COLOR_HINT_HEX[colorHint] ?? (colorHint.startsWith('#') ? colorHint : '')
  if (!target) return false
  const actual = objectColorHex(obj)
  return colorsRoughlyMatch(actual, target)
}

let selectedObject: FabricObject | null = null
let selectionHighlight: FabricObject | null = null

export function getDrawableObjects(canvas: Canvas): FabricObject[] {
  return canvas.getObjects().filter((o) => {
    const name = (o as { name?: string }).name
    return name !== 'selection-overlay' && name !== 'guide-grid' && name !== 'selection-highlight'
  })
}

export function getSelectedObject() {
  return selectedObject
}

export function clearSelectedObject(canvas: Canvas) {
  selectedObject = null
  clearSelectionHighlight(canvas)
}

export function clearSelectionHighlight(canvas: Canvas) {
  if (selectionHighlight) {
    canvas.remove(selectionHighlight)
    selectionHighlight = null
  }
}

export function selectObjectByIndex(canvas: Canvas, index: number): FabricObject | null {
  const objs = getDrawableObjects(canvas)
  const obj = objs[index - 1] ?? null
  if (obj) {
    selectedObject = obj
    updateHighlight(canvas, obj)
  }
  return obj
}

export function selectObjectByHint(
  canvas: Canvas,
  hint: {
    index?: number
    ordinal?: string
    type?: string
    color?: string
    last?: boolean
  },
): FabricObject | null {
  let objs = getDrawableObjects(canvas)

  if (hint.type) {
    const typeMap: Record<string, string[]> = {
      圆: ['circle', 'ellipse'],
      圆形: ['circle', 'ellipse'],
      矩形: ['rect'],
      方块: ['rect'],
      线: ['line', 'polyline', 'path'],
      线条: ['line', 'polyline', 'path'],
      文字: ['i-text', 'text'],
      图片: ['image'],
      心: ['path', 'group'],
      心形: ['path', 'group'],
      星: ['path', 'polygon', 'group'],
      星形: ['path', 'polygon', 'group'],
    }
    const types = typeMap[hint.type] ?? [hint.type]
    objs = objs.filter((o) => types.includes(o.type ?? ''))
  }

  if (hint.color) {
    const matched = objs.filter((o) => matchObjectColor(o, hint.color!))
    if (matched.length) objs = matched
  }

  if (!objs.length) objs = getDrawableObjects(canvas)

  let obj: FabricObject | null = null

  if (hint.index != null && hint.index > 0) {
    obj = objs[hint.index - 1] ?? null
  } else if (hint.ordinal) {
    const o = hint.ordinal
    if (/最后|上一个/.test(o)) obj = objs[objs.length - 1] ?? null
    else if (/第一|第1|首个/.test(o)) obj = objs[0] ?? null
    else if (/第二|第2/.test(o)) obj = objs[1] ?? null
    else if (/第三|第3/.test(o)) obj = objs[2] ?? null
    else {
      const m = o.match(/第(\d+)/)
      if (m) obj = objs[Number(m[1]) - 1] ?? null
    }
  } else if (hint.last) {
    obj = objs[objs.length - 1] ?? null
  }

  if (obj) {
    selectedObject = obj
    updateHighlight(canvas, obj)
  }
  return obj
}

function updateHighlight(canvas: Canvas, obj: FabricObject) {
  clearSelectionHighlight(canvas)
  const b = obj.getBoundingRect()
  selectionHighlight = new Rect({
    left: b.left - 4,
    top: b.top - 4,
    width: b.width + 8,
    height: b.height + 8,
    fill: 'transparent',
    stroke: '#ffde00',
    strokeWidth: 2,
    strokeDashArray: [6, 4],
    selectable: false,
    evented: false,
    name: 'selection-highlight',
  })
  canvas.add(selectionHighlight)
  canvas.requestRenderAll()
}

export function listObjectsForContext(canvas: Canvas): string {
  const objs = getDrawableObjects(canvas)
  if (!objs.length) return '空画布'
  return objs
    .map((o, i) => {
      const color = objectColorLabel(o)
      const label = TYPE_ZH[o.type ?? ''] ?? o.type ?? '图形'
      o.setCoords?.()
      const withCenter = o as FabricObject & { getCenterPoint?: () => { x: number; y: number } }
      const center = typeof withCenter.getCenterPoint === 'function'
        ? withCenter.getCenterPoint()
        : (() => {
            const b = o.getBoundingRect()
            return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }
          })()
      const base = color ? `#${i + 1}${label}(${color})` : `#${i + 1}${label}`
      return `${base}@${center.x},${center.y}`
    })
    .join(', ')
}

export function parseSelectCommand(text: string): {
  index?: number
  ordinal?: string
  type?: string
} | null {
  if (!/选中|选择/.test(text)) return null
  const typeMatch = text.match(/(圆形?|矩形|方块|线条?|文字|图片)/)
  if (/最后|上一个/.test(text)) return { ordinal: '最后', type: typeMatch?.[1] }
  if (/第一|第1/.test(text)) return { ordinal: '第一', type: typeMatch?.[1] }
  if (/第二|第2/.test(text)) return { ordinal: '第二', type: typeMatch?.[1] }
  if (/第三|第3/.test(text)) return { ordinal: '第三', type: typeMatch?.[1] }
  const m = text.match(/第\s*(\d+)\s*个/)
  if (m) return { index: Number(m[1]), type: typeMatch?.[1] }
  if (typeMatch) return { type: typeMatch[1] }
  return { ordinal: '最后' }
}
