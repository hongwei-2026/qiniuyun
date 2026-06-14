import { Path, Polyline } from 'fabric'
import { parseColor } from './fabricEngine'

export type PathTemplate =
  | 'wave'
  | 'spiral'
  | 'star'
  | 'heart'
  | 'cloud'
  | 'zigzag'
  | 'brush_stroke'

export function buildPathTemplate(
  template: PathTemplate,
  cx: number,
  cy: number,
  size: number,
  color: string,
  strokeWidth: number,
) {
  switch (template) {
    case 'wave':
      return buildWave(cx, cy, size * 2, size * 0.25, 3, color, strokeWidth)
    case 'spiral':
      return buildSpiral(cx, cy, size, color, strokeWidth)
    case 'star':
      return buildStar(cx, cy, size, 5, color, strokeWidth)
    case 'heart':
      return buildHeart(cx, cy, size, color, strokeWidth)
    case 'cloud':
      return buildCloud(cx, cy, size, color, strokeWidth)
    case 'zigzag':
      return buildZigzag(cx, cy, size * 2, size * 0.4, 6, color, strokeWidth)
    case 'brush_stroke':
      return buildBrushStroke(cx, cy, size * 2, color, strokeWidth)
    default:
      return buildWave(cx, cy, size * 2, size * 0.25, 2, color, strokeWidth)
  }
}

function buildWave(
  cx: number, cy: number, width: number, amp: number, periods: number,
  color: string, strokeWidth: number,
) {
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i <= 64; i++) {
    const t = i / 64
    pts.push({
      x: cx - width / 2 + t * width,
      y: cy + Math.sin(t * Math.PI * 2 * periods) * amp,
    })
  }
  return new Polyline(pts, {
    fill: '',
    stroke: color,
    strokeWidth,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
  })
}

function buildSpiral(cx: number, cy: number, size: number, color: string, strokeWidth: number) {
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i <= 120; i++) {
    const t = i / 12
    const r = (t / 10) * size
    pts.push({ x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r })
  }
  return new Polyline(pts, { fill: '', stroke: color, strokeWidth, strokeLineCap: 'round' })
}

function buildStar(cx: number, cy: number, r: number, points: number, color: string, strokeWidth: number) {
  const verts: { x: number; y: number }[] = []
  for (let i = 0; i < points * 2; i++) {
    const rad = (Math.PI / points) * i - Math.PI / 2
    const dist = i % 2 === 0 ? r : r * 0.45
    verts.push({ x: cx + Math.cos(rad) * dist, y: cy + Math.sin(rad) * dist })
  }
  return new Polyline(verts, {
    fill: '',
    stroke: color,
    strokeWidth,
    strokeLineJoin: 'round',
  })
}

function buildHeart(cx: number, cy: number, size: number, color: string, strokeWidth: number) {
  const s = size / 50
  const d = `M ${cx} ${cy + 15 * s}
    C ${cx} ${cy - 10 * s}, ${cx - 45 * s} ${cy - 35 * s}, ${cx - 45 * s} ${cy - 5 * s}
    C ${cx - 45 * s} ${cy + 25 * s}, ${cx} ${cy + 45 * s}, ${cx} ${cy + 60 * s}
    C ${cx} ${cy + 45 * s}, ${cx + 45 * s} ${cy + 25 * s}, ${cx + 45 * s} ${cy - 5 * s}
    C ${cx + 45 * s} ${cy - 35 * s}, ${cx} ${cy - 10 * s}, ${cx} ${cy + 15 * s} Z`
  return new Path(d, { fill: color, stroke: color, strokeWidth, strokeLineJoin: 'round' })
}

function buildCloud(cx: number, cy: number, size: number, color: string, strokeWidth: number) {
  const s = size / 60
  const d = `M ${cx - 50 * s} ${cy + 10 * s}
    Q ${cx - 55 * s} ${cy - 25 * s}, ${cx - 20 * s} ${cy - 30 * s}
    Q ${cx - 5 * s} ${cy - 55 * s}, ${cx + 25 * s} ${cy - 35 * s}
    Q ${cx + 55 * s} ${cy - 40 * s}, ${cx + 50 * s} ${cy - 5 * s}
    Q ${cx + 70 * s} ${cy + 15 * s}, ${cx + 30 * s} ${cy + 20 * s}
    H ${cx - 45 * s} Z`
  return new Path(d, { fill: 'transparent', stroke: color, strokeWidth })
}

function buildZigzag(
  cx: number, cy: number, width: number, amp: number, segments: number,
  color: string, strokeWidth: number,
) {
  const pts: { x: number; y: number }[] = []
  const step = width / segments
  for (let i = 0; i <= segments; i++) {
    pts.push({
      x: cx - width / 2 + i * step,
      y: cy + (i % 2 === 0 ? -amp : amp),
    })
  }
  return new Polyline(pts, { fill: '', stroke: color, strokeWidth, strokeLineCap: 'round' })
}

function buildBrushStroke(cx: number, cy: number, width: number, color: string, strokeWidth: number) {
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i <= 40; i++) {
    const t = i / 40
    const x = cx - width / 2 + t * width
    const y = cy + Math.sin(t * 8) * 8 + Math.cos(t * 5) * 5
    pts.push({ x, y })
  }
  return new Polyline(pts, {
    fill: '',
    stroke: color,
    strokeWidth: strokeWidth * 2,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
  })
}

/** 语音折线：[[dx,dy],...] 相对移动序列 */
export function buildPolylineFromMoves(
  startX: number,
  startY: number,
  moves: [number, number][],
  color: string,
  strokeWidth: number,
) {
  const pts = [{ x: startX, y: startY }]
  let x = startX
  let y = startY
  for (const [dx, dy] of moves) {
    x += dx
    y += dy
    pts.push({ x, y })
  }
  return new Polyline(pts, {
    fill: '',
    stroke: color,
    strokeWidth,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
  })
}

export function parsePathTemplate(text: string): PathTemplate | null {
  if (/波浪|海浪|波纹/.test(text)) return 'wave'
  if (/螺旋/.test(text)) return 'spiral'
  if (/五角星|星星|星形/.test(text)) return 'star'
  if (/爱心|心形|心/.test(text)) return 'heart'
  if (/云朵|云彩/.test(text)) return 'cloud'
  if (/锯齿|折线|闪电/.test(text)) return 'zigzag'
  if (/笔触|手绘|毛笔|自由.*线|涂鸦/.test(text)) return 'brush_stroke'
  return null
}

export function parsePosition(text: string, canvasW: number, canvasH: number) {
  const mx = canvasW * 0.12
  const my = canvasH * 0.12
  if (/左上/.test(text)) return { x: mx, y: my }
  if (/右上/.test(text)) return { x: canvasW - mx, y: my }
  if (/左下/.test(text)) return { x: mx, y: canvasH - my }
  if (/右下/.test(text)) return { x: canvasW - mx, y: canvasH - my }
  if (/上方|顶部|上边/.test(text)) return { x: canvasW / 2, y: my }
  if (/下方|底部|下边/.test(text)) return { x: canvasW / 2, y: canvasH - my }
  if (/左侧|左边/.test(text)) return { x: mx, y: canvasH / 2 }
  if (/右侧|右边/.test(text)) return { x: canvasW - mx, y: canvasH / 2 }
  if (/中间|居中|中心/.test(text)) return { x: canvasW / 2, y: canvasH / 2 }
  const coord = text.match(/[坐标位置]*\(?\s*(\d+)\s*[,，]\s*(\d+)\s*\)?/)
  if (coord) return { x: Number(coord[1]), y: Number(coord[2]) }
  return { x: canvasW / 2, y: canvasH / 2 }
}

export function parseColorFromText(text: string) {
  return parseColor(text)
}
