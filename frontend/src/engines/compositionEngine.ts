import { Canvas, Circle, FabricObject, Group, Line, Rect } from 'fabric'
import { parseColor } from './fabricEngine'
import { getDrawableObjects, getSelectedObject } from './objectSelect'

export function alignObjects(canvas: Canvas, direction: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') {
  const objs = getSelectedTargets(canvas)
  if (!objs.length) return false
  const bounds = unionBounds(objs)
  objs.forEach((o) => {
    const w = (o.width ?? 0) * (o.scaleX ?? 1)
    const h = (o.height ?? 0) * (o.scaleY ?? 1)
    if (direction === 'left') o.set('left', bounds.left)
    if (direction === 'right') o.set('left', bounds.left + bounds.width - w)
    if (direction === 'center') o.set('left', bounds.left + bounds.width / 2 - w / 2)
    if (direction === 'top') o.set('top', bounds.top)
    if (direction === 'bottom') o.set('top', bounds.top + bounds.height - h)
    if (direction === 'middle') o.set('top', bounds.top + bounds.height / 2 - h / 2)
  })
  canvas.requestRenderAll()
  return true
}

export function distributeHorizontally(canvas: Canvas, spacing = 24) {
  const objs = getSelectedTargets(canvas).sort((a, b) => (a.left ?? 0) - (b.left ?? 0))
  if (objs.length < 2) return false
  let x = objs[0].left ?? 0
  objs.forEach((o) => {
    o.set('left', x)
    x += (o.width ?? 0) * (o.scaleX ?? 1) + spacing
  })
  canvas.requestRenderAll()
  return true
}

export function snapSelectedToCenter(canvas: Canvas) {
  const objs = getDrawableObjects(canvas)
  const obj = getSelectedObject() ?? (objs.length ? objs[objs.length - 1] : null)
  if (!obj) return false
  const w = (obj.width ?? 0) * (obj.scaleX ?? 1)
  const h = (obj.height ?? 0) * (obj.scaleY ?? 1)
  obj.set({
    left: canvas.getWidth() / 2 - w / 2,
    top: canvas.getHeight() / 2 - h / 2,
  })
  canvas.requestRenderAll()
  return true
}

export function drawFlowchart(canvas: Canvas, color = '#2d2d2d') {
  const c = parseColor(color)
  const cx = canvas.getWidth() / 2
  const y0 = canvas.getHeight() * 0.2
  const gap = 100
  const items = [
    new Rect({ left: cx - 60, top: y0, width: 120, height: 50, fill: '#fffdf9', stroke: c, strokeWidth: 2 }),
    new Rect({ left: cx - 60, top: y0 + gap, width: 120, height: 50, fill: '#fffdf9', stroke: c, strokeWidth: 2 }),
    new Rect({ left: cx - 60, top: y0 + gap * 2, width: 120, height: 50, fill: '#fffdf9', stroke: c, strokeWidth: 2 }),
    new Line([cx, y0 + 50, cx, y0 + gap - 10], { stroke: c, strokeWidth: 2 }),
    new Line([cx, y0 + gap + 50, cx, y0 + gap * 2 - 10], { stroke: c, strokeWidth: 2 }),
  ]
  items.forEach((o) => canvas.add(o))
  canvas.requestRenderAll()
  return true
}

export function drawStickFigure(canvas: Canvas, cx: number, cy: number, color: string) {
  const c = parseColor(color)
  const head = new Circle({ left: cx - 18, top: cy - 58, radius: 18, fill: 'transparent', stroke: c, strokeWidth: 2 })
  const body = new Line([cx, cy - 40, cx, cy + 20], { stroke: c, strokeWidth: 3 })
  const arms = new Line([cx - 35, cy - 15, cx + 35, cy - 15], { stroke: c, strokeWidth: 3 })
  const legL = new Line([cx, cy + 20, cx - 25, cy + 65], { stroke: c, strokeWidth: 3 })
  const legR = new Line([cx, cy + 20, cx + 25, cy + 65], { stroke: c, strokeWidth: 3 })
  canvas.add(new Group([head, body, arms, legL, legR]))
  canvas.requestRenderAll()
}

export function arrangeRow(canvas: Canvas, count: number, shape: string, color: string) {
  const c = parseColor(color)
  const gap = 90
  const startX = canvas.getWidth() / 2 - ((count - 1) * gap) / 2
  const y = canvas.getHeight() / 2
  for (let i = 0; i < count; i++) {
    const x = startX + i * gap
    if (shape === 'circle') {
      canvas.add(new Circle({ left: x - 25, top: y - 25, radius: 25, fill: 'transparent', stroke: c, strokeWidth: 2 }))
    } else {
      canvas.add(new Rect({ left: x - 30, top: y - 25, width: 60, height: 50, fill: 'transparent', stroke: c, strokeWidth: 2 }))
    }
  }
  canvas.requestRenderAll()
}

export function toggleGuideGrid(canvas: Canvas, show: boolean) {
  canvas.getObjects().filter((o) => (o as { name?: string }).name === 'guide-grid').forEach((o) => canvas.remove(o))
  if (!show) {
    canvas.requestRenderAll()
    return
  }
  const w = canvas.getWidth()
  const h = canvas.getHeight()
  const step = 50
  for (let x = step; x < w; x += step) {
    canvas.add(new Line([x, 0, x, h], { stroke: 'rgba(26,26,26,0.08)', strokeWidth: 1, selectable: false, evented: false, name: 'guide-grid' }))
  }
  for (let y = step; y < h; y += step) {
    canvas.add(new Line([0, y, w, y], { stroke: 'rgba(26,26,26,0.08)', strokeWidth: 1, selectable: false, evented: false, name: 'guide-grid' }))
  }
  canvas.requestRenderAll()
}

function getSelectedTargets(canvas: Canvas): FabricObject[] {
  const sel = getSelectedObject()
  if (sel) return [sel]
  const all = getDrawableObjects(canvas)
  return all.length >= 2 ? all.slice(-3) : all.length ? [all[all.length - 1]] : []
}

function unionBounds(objs: FabricObject[]) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  objs.forEach((o) => {
    const l = o.left ?? 0, t = o.top ?? 0
    const w = (o.width ?? 0) * (o.scaleX ?? 1), h = (o.height ?? 0) * (o.scaleY ?? 1)
    left = Math.min(left, l); top = Math.min(top, t)
    right = Math.max(right, l + w); bottom = Math.max(bottom, t + h)
  })
  return { left, top, width: right - left, height: bottom - top }
}
