import type { GridCell } from '../types'

export function cellId(row: number, col: number): string {
  return `${row},${col}`
}

export function parseCellId(id: string): { row: number; col: number } {
  const [row, col] = id.split(',').map(Number)
  return { row, col }
}

export function createGrid(rows: number, cols: number, _cellSize = 200): Record<string, GridCell> {
  const cells: Record<string, GridCell> = {}
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = cellId(r, c)
      cells[id] = { id, row: r, col: c, status: 'empty' }
    }
  }
  return cells
}

export function splitImageToGrid(
  imageDataUrl: string,
  rows: number,
  cols: number,
): Promise<Record<string, GridCell>> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const cellW = Math.floor(img.width / cols)
      const cellH = Math.floor(img.height / rows)
      const cells: Record<string, GridCell> = {}
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const canvas = document.createElement('canvas')
          canvas.width = cellW
          canvas.height = cellH
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(img, c * cellW, r * cellH, cellW, cellH, 0, 0, cellW, cellH)
          const id = cellId(r, c)
          cells[id] = { id, row: r, col: c, imageData: canvas.toDataURL('image/png'), status: 'filled' }
        }
      }
      resolve(cells)
    }
    img.onerror = reject
    img.src = imageDataUrl
  })
}

export function expandCell(
  cells: Record<string, GridCell>,
  fromCellId: string,
  direction: 'up' | 'down' | 'left' | 'right',
  count = 1,
): Record<string, GridCell> {
  const { row, col } = parseCellId(fromCellId)
  const delta = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] }[direction]
  const next = { ...cells }
  for (let i = 1; i <= count; i++) {
    const id = cellId(row + delta[0] * i, col + delta[1] * i)
    if (!next[id]) next[id] = { id, row: row + delta[0] * i, col: col + delta[1] * i, status: 'empty' }
  }
  return next
}

/** 整块九宫格扩图：在边界新增与当前格阵同尺寸的完整一块（3×3 向上扩则再增 9 格） */
export function expandGridRegion(
  cells: Record<string, GridCell>,
  direction: 'up' | 'down' | 'left' | 'right',
): { cells: Record<string, GridCell>; newCellIds: string[] } {
  const bounds = getGridBounds(cells)
  const { rows, cols } = getGridDimensions(cells)
  const next = { ...cells }
  const newCellIds: string[] = []
  const { minRow, maxRow, minCol, maxCol } = bounds

  const add = (row: number, col: number) => {
    const id = cellId(row, col)
    if (!next[id]) {
      next[id] = { id, row, col, status: 'empty' }
      newCellIds.push(id)
    }
  }

  if (direction === 'up') {
    for (let r = minRow - rows; r < minRow; r++) {
      for (let c = minCol; c <= maxCol; c++) add(r, c)
    }
  } else if (direction === 'down') {
    for (let r = maxRow + 1; r <= maxRow + rows; r++) {
      for (let c = minCol; c <= maxCol; c++) add(r, c)
    }
  } else if (direction === 'left') {
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol - cols; c < minCol; c++) add(r, c)
    }
  } else if (direction === 'right') {
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = maxCol + 1; c <= maxCol + cols; c++) add(r, c)
    }
  }

  return { cells: next, newCellIds }
}

export function clearGridCells(cells: Record<string, GridCell>): Record<string, GridCell> {
  const next: Record<string, GridCell> = {}
  for (const cell of Object.values(cells)) {
    next[cell.id] = { id: cell.id, row: cell.row, col: cell.col, status: 'empty' }
  }
  return next
}

function getCellIdsBounds(cellIds: string[], cells: Record<string, GridCell>) {
  const coords = cellIds.map((id) => {
    const cell = cells[id]
    return cell ? { row: cell.row, col: cell.col } : parseCellId(id)
  })
  return {
    minRow: Math.min(...coords.map((c) => c.row)),
    maxRow: Math.max(...coords.map((c) => c.row)),
    minCol: Math.min(...coords.map((c) => c.col)),
    maxCol: Math.max(...coords.map((c) => c.col)),
  }
}

export function splitImageToCellBlock(
  imageDataUrl: string,
  minRow: number,
  minCol: number,
  rows: number,
  cols: number,
): Promise<Record<string, GridCell>> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const cellW = Math.floor(img.width / cols)
      const cellH = Math.floor(img.height / rows)
      const block: Record<string, GridCell> = {}
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const canvas = document.createElement('canvas')
          canvas.width = cellW
          canvas.height = cellH
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(img, c * cellW, r * cellH, cellW, cellH, 0, 0, cellW, cellH)
          const id = cellId(minRow + r, minCol + c)
          block[id] = {
            id,
            row: minRow + r,
            col: minCol + c,
            imageData: canvas.toDataURL('image/png'),
            status: 'filled',
          }
        }
      }
      resolve(block)
    }
    img.onerror = reject
    img.src = imageDataUrl
  })
}

/** 为扩图新增的整块格子生成一张完整大图并切分填入 */
export async function fillNewCellsWithUnifiedImage(
  allCells: Record<string, GridCell>,
  newCellIds: string[],
  prompt: string,
  provider: 'minimax' | 'doubao',
  generateImageFn: (opts: {
    prompt: string
    aspect_ratio: string
    provider: 'minimax' | 'doubao'
    reference_image_base64?: string
  }) => Promise<{ images: string[]; format: string }>,
  direction?: 'up' | 'down' | 'left' | 'right',
  referenceBase64?: string,
): Promise<Record<string, GridCell>> {
  if (!newCellIds.length) return allCells
  const bounds = getCellIdsBounds(newCellIds, allCells)
  const rows = bounds.maxRow - bounds.minRow + 1
  const cols = bounds.maxCol - bounds.minCol + 1
  const aspect = rows === cols ? '1:1' : cols > rows ? '16:9' : '9:16'
  const seamHint = direction
    ? `seamless extension ${direction} from existing scene, matching adjacent tiles, continue same art style`
    : 'seamless tile composition'
  const fullPrompt = `${prompt}, unified panoramic scene covering entire ${rows}x${cols} tile block, ${seamHint}, high detail`
  const result = await generateImageFn({
    prompt: fullPrompt,
    aspect_ratio: aspect,
    provider,
    reference_image_base64: referenceBase64,
  })
  if (!result.images[0]) return allCells
  const dataUrl = result.format === 'base64'
    ? `data:image/jpeg;base64,${result.images[0]}`
    : result.images[0]
  const filled = await splitImageToCellBlock(dataUrl, bounds.minRow, bounds.minCol, rows, cols)
  const next = { ...allCells }
  for (const id of newCellIds) {
    if (filled[id]) next[id] = { ...filled[id], prompt }
  }
  return next
}

/** 取扩图方向上与旧格相邻的参考图 */
export function getExpansionEdgeReference(
  existingCells: Record<string, GridCell>,
  newCellIds: string[],
  direction: 'up' | 'down' | 'left' | 'right',
): string | undefined {
  const inverse = { up: 'down', down: 'up', left: 'right', right: 'left' } as const
  for (const newId of newCellIds) {
    const ref = getNeighborReference(existingCells, newId, inverse[direction])
    if (ref) return ref
  }
  const filled = getFilledGridCells(existingCells)
  if (filled[0]?.imageData) {
    return filled[0].imageData.includes(',')
      ? filled[0].imageData.split(',')[1]
      : filled[0].imageData
  }
  return undefined
}

export function listNewEdgeCells(
  before: Record<string, GridCell>,
  after: Record<string, GridCell>,
): string[] {
  return Object.keys(after).filter((id) => !before[id])
}

const CHARACTER_VIEW_ANGLES = [
  { key: 'front', label: '正面', prompt: 'front view facing camera, full body centered' },
  { key: 'back', label: '背面', prompt: 'back view facing away, full body centered' },
  { key: 'left', label: '左侧', prompt: 'left side profile view, full body' },
  { key: 'right', label: '右侧', prompt: 'right side profile view, full body' },
  { key: 'front_left', label: '左前', prompt: 'three-quarter front-left view, full body' },
  { key: 'front_right', label: '右前', prompt: 'three-quarter front-right view, full body' },
  { key: 'back_left', label: '左后', prompt: 'three-quarter back-left view, full body' },
  { key: 'back_right', label: '右后', prompt: 'three-quarter back-right view, full body' },
  { key: 'top', label: '俯视', prompt: 'top-down overhead view, full body' },
] as const

export function buildCharacterTurnaroundPlan(
  cells: Record<string, GridCell>,
  subject: string,
  style = 'pixel art',
): Array<{ cellId: string; prompt: string; view: string; label: string }> {
  const sorted = Object.values(cells).sort((a, b) => a.row - b.row || a.col - b.col)
  const base = `${style} ${subject}, same character design, consistent outfit and colors, game sprite sheet tile, clean pixel outlines, simple background`
  return sorted.map((cell, i) => {
    const view = CHARACTER_VIEW_ANGLES[i % CHARACTER_VIEW_ANGLES.length]
    return {
      cellId: cell.id,
      view: view.key,
      label: view.label,
      prompt: `${base}, ${view.prompt}, high quality pixel art character`,
    }
  })
}

export function buildTurnaroundPlanForCells(
  cellIds: string[],
  _cells: Record<string, GridCell>,
  subject: string,
  style = 'pixel art',
  startIndex = 0,
): Array<{ cellId: string; prompt: string; view: string; label: string }> {
  const base = `${style} ${subject}, same character design, consistent outfit and colors, game sprite sheet tile, clean pixel outlines`
  return cellIds.map((id, i) => {
    const view = CHARACTER_VIEW_ANGLES[(startIndex + i) % CHARACTER_VIEW_ANGLES.length]
    return {
      cellId: id,
      view: view.key,
      label: view.label,
      prompt: `${base}, ${view.prompt}, high quality pixel art character`,
    }
  })
}

export function moveCell(cells: Record<string, GridCell>, fromId: string, toId: string) {
  const next = { ...cells }
  const from = next[fromId]
  const to = next[toId]
  if (!from) return cells
  next[toId] = { ...from, id: toId, row: parseCellId(toId).row, col: parseCellId(toId).col }
  next[fromId] = to
    ? { ...to, id: fromId, row: parseCellId(fromId).row, col: parseCellId(fromId).col }
    : { id: fromId, row: parseCellId(fromId).row, col: parseCellId(fromId).col, status: 'empty' }
  return next
}

export function extractBase64FromDataUrl(dataUrl: string): string {
  return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
}

export async function resizeDataUrlToJpegBase64(dataUrl: string, maxDim = 768): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height, 1))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)
      resolve(extractBase64FromDataUrl(canvas.toDataURL('image/jpeg', 0.88)))
    }
    img.onerror = () => reject(new Error('参考图加载失败'))
    img.src = dataUrl
  })
}

export function getFilledGridCells(cells: Record<string, GridCell>): GridCell[] {
  return Object.values(cells).filter((c) => c.imageData)
}

/** 获取画风参考：优先指定格 → 邻格 → 任意已填格 → 上次 AI 整图 */
export function getGridStyleReference(
  cells: Record<string, GridCell>,
  opts: {
    targetCell?: string
    preferCell?: string
    lastAiImage?: string
    usePrevious?: boolean
  } = {},
): string | undefined {
  const pick = (id?: string) => {
    if (!id) return undefined
    const img = cells[id]?.imageData
    return img ? extractBase64FromDataUrl(img) : undefined
  }
  if (opts.usePrevious && opts.lastAiImage) {
    return extractBase64FromDataUrl(opts.lastAiImage)
  }
  const prefer = pick(opts.preferCell)
  if (prefer) return prefer
  const target = pick(opts.targetCell)
  if (target) return target
  const filled = getFilledGridCells(cells)
  if (filled.length) {
    return extractBase64FromDataUrl(filled[0].imageData!)
  }
  if (opts.lastAiImage) return extractBase64FromDataUrl(opts.lastAiImage)
  return undefined
}

export function parseCellCoordFromText(text: string): string | undefined {
  const patterns = [
    /(-?\d+)\s*[,，.．·]\s*(-?\d+)\s*(?:位置|格)?/g,
    /(?:在|从)\s*(-?\d+)\s*[,，.．·]\s*(-?\d+)\s*(?:位置|格)?/g,
    /位置\s*(-?\d+)\s*[,，.．·]\s*(-?\d+)/g,
    /(?:^|[^\d-])(-?\d+)\s*[,，.．·]\s*(-?\d+)(?:\s*格)?/g,
  ]
  let last: string | undefined
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      last = `${m[1]},${m[2]}`
    }
  }
  return last
}

/** 解析句中所有格子坐标（用于继承/参考格） */
export function parseAllCellCoordsFromText(text: string): string[] {
  const re = /(-?\d+)\s*[,，.．·]\s*(-?\d+)/g
  const found: string[] = []
  for (const m of text.matchAll(re)) {
    const id = `${m[1]},${m[2]}`
    if (!found.includes(id)) found.push(id)
  }
  return found
}

export function resolveCellHint(cells: Record<string, GridCell>, hint: string): string | null {
  const coord = parseCellCoordFromText(hint)
  if (coord) return coord

  const sorted = Object.keys(cells).map((id) => ({ id, ...parseCellId(id) }))
    .sort((a, b) => a.row - b.row || a.col - b.col)
  if (!sorted.length) return null

  const cnNum: Record<string, number> = {
    一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  }
  const ordinalMatch = hint.match(/第?([一二三四五六七八九十\d]+)/)
  if (ordinalMatch) {
    const raw = ordinalMatch[1]
    const n = cnNum[raw] ?? Number(raw)
    if (n >= 1 && n <= sorted.length) return sorted[n - 1]?.id ?? null
  }
  if (/第一|1/.test(hint)) return sorted[0]?.id ?? null
  if (/中间|中/.test(hint)) return sorted[Math.floor(sorted.length / 2)]?.id ?? null
  if (/右上/.test(hint)) {
    const minRow = Math.min(...sorted.map((s) => s.row))
    const maxCol = Math.max(...sorted.map((s) => s.col))
    return sorted.find((s) => s.row === minRow && s.col === maxCol)?.id ?? null
  }
  return sorted[0]?.id ?? null
}

export function getGridBounds(cells: Record<string, GridCell>) {
  const coords = Object.values(cells).map((c) => ({ row: c.row, col: c.col }))
  if (!coords.length) return { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 }
  return {
    minRow: Math.min(...coords.map((c) => c.row)),
    maxRow: Math.max(...coords.map((c) => c.row)),
    minCol: Math.min(...coords.map((c) => c.col)),
    maxCol: Math.max(...coords.map((c) => c.col)),
  }
}

/** 限制平移范围，避免滚飞后找不到格子 */
export function clampGridPan(
  panX: number,
  panY: number,
  cells: Record<string, GridCell>,
  cellSize: number,
  viewportW: number,
  viewportH: number,
): { x: number; y: number } {
  if (!Object.keys(cells).length || viewportW <= 0 || viewportH <= 0) {
    return { x: 0, y: 0 }
  }
  const bounds = getGridBounds(cells)
  const boardW = (bounds.maxCol - bounds.minCol + 1) * cellSize
  const boardH = (bounds.maxRow - bounds.minRow + 1) * cellSize
  const overscroll = 32
  const maxPanX = Math.max(overscroll, (boardW - viewportW) / 2 + cellSize)
  const maxPanY = Math.max(overscroll, (boardH - viewportH) / 2 + cellSize)
  return {
    x: Math.min(maxPanX, Math.max(-maxPanX, panX)),
    y: Math.min(maxPanY, Math.max(-maxPanY, panY)),
  }
}

/** 将指定格子居中到视口 */
export function panToCenterCell(
  cellIdStr: string,
  cells: Record<string, GridCell>,
  cellSize: number,
): { x: number; y: number } {
  if (!cells[cellIdStr]) return { x: 0, y: 0 }
  const bounds = getGridBounds(cells)
  const { row, col } = parseCellId(cellIdStr)
  const boardW = (bounds.maxCol - bounds.minCol + 1) * cellSize
  const boardH = (bounds.maxRow - bounds.minRow + 1) * cellSize
  const cellCenterX = (col - bounds.minCol + 0.5) * cellSize - boardW / 2
  const cellCenterY = (row - bounds.minRow + 0.5) * cellSize - boardH / 2
  return { x: -cellCenterX, y: -cellCenterY }
}

/** 扩格时：以锚点格（from）的图片作为接缝参考 */
export function getExpandAnchorReference(
  cells: Record<string, GridCell>,
  fromCellId: string,
): string | undefined {
  const cell = cells[fromCellId]
  if (!cell?.imageData) return undefined
  return cell.imageData.includes(',') ? cell.imageData.split(',')[1] : cell.imageData
}

/** 多邻格衔接：优先取指定方向邻格，否则取任意已填充邻格 */
export function getSeamReference(
  cells: Record<string, GridCell>,
  cellIdStr: string,
  preferDirection?: 'up' | 'down' | 'left' | 'right',
): string | undefined {
  if (preferDirection) {
    const inverse: Record<string, 'up' | 'down' | 'left' | 'right'> = {
      up: 'down', down: 'up', left: 'right', right: 'left',
    }
    const ref = getNeighborReference(cells, cellIdStr, inverse[preferDirection])
    if (ref) return ref
  }
  return getAdjacentReferenceImage(cells, cellIdStr)
}

export function getGridDimensions(cells: Record<string, GridCell>) {
  const bounds = getGridBounds(cells)
  return {
    rows: bounds.maxRow - bounds.minRow + 1,
    cols: bounds.maxCol - bounds.minCol + 1,
    bounds,
  }
}

/** 生成一张大图并切分填满当前九宫格 */
export async function fillGridWithUnifiedImage(
  cells: Record<string, GridCell>,
  prompt: string,
  provider: 'minimax' | 'doubao',
  generateImageFn: (opts: {
    prompt: string
    aspect_ratio: string
    provider: 'minimax' | 'doubao'
  }) => Promise<{ images: string[]; format: string }>,
): Promise<Record<string, GridCell>> {
  const { rows, cols } = getGridDimensions(cells)
  const aspect = rows === cols ? '1:1' : cols > rows ? '16:9' : '9:16'
  const fullPrompt = `${prompt}, unified panoramic scene covering entire area, seamless composition, high detail`
  const result = await generateImageFn({ prompt: fullPrompt, aspect_ratio: aspect, provider })
  if (!result.images[0]) return cells
  const dataUrl = result.format === 'base64'
    ? `data:image/jpeg;base64,${result.images[0]}`
    : result.images[0]
  return splitImageToGrid(dataUrl, rows, cols)
}

export function getNeighborReference(
  cells: Record<string, GridCell>,
  cellIdStr: string,
  direction: 'up' | 'down' | 'left' | 'right',
): string | undefined {
  const { row, col } = parseCellId(cellIdStr)
  const delta = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] }[direction]
  const neighbor = cells[cellId(row + delta[0], col + delta[1])]
  if (!neighbor?.imageData) return undefined
  return neighbor.imageData.includes(',') ? neighbor.imageData.split(',')[1] : neighbor.imageData
}

/** 取相邻已填充格的第一张图作风格/接缝参考（扩图、重绘用） */
export function getAdjacentReferenceImage(
  cells: Record<string, GridCell>,
  cellIdStr: string,
): string | undefined {
  for (const dir of ['left', 'right', 'up', 'down'] as const) {
    const ref = getNeighborReference(cells, cellIdStr, dir)
    if (ref) return ref
  }
  return undefined
}

export async function renderGridSpritesheet(
  cells: Record<string, GridCell>,
  cellSize: number,
): Promise<string> {
  const bounds = getGridBounds(cells)
  const rows = bounds.maxRow - bounds.minRow + 1
  const cols = bounds.maxCol - bounds.minCol + 1
  const canvas = document.createElement('canvas')
  canvas.width = cols * cellSize
  canvas.height = rows * cellSize
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#e8e0d4'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  await Promise.all(
    Object.values(cells).map(
      (cell) =>
        new Promise<void>((resolve) => {
          const x = (cell.col - bounds.minCol) * cellSize
          const y = (cell.row - bounds.minRow) * cellSize
          if (!cell.imageData) {
            resolve()
            return
          }
          const img = new Image()
          img.crossOrigin = 'anonymous'
          img.onload = () => {
            ctx.drawImage(img, x, y, cellSize, cellSize)
            resolve()
          }
          img.onerror = () => resolve()
          img.src = cell.imageData
        }),
    ),
  )

  return canvas.toDataURL('image/png')
}

export async function downloadGridImage(
  cells: Record<string, GridCell>,
  cellSize: number,
  filename = 'voicecanvas-grid.png',
): Promise<boolean> {
  if (!Object.keys(cells).length) return false
  const dataUrl = await renderGridSpritesheet(cells, cellSize)
  const link = document.createElement('a')
  link.download = filename
  link.href = dataUrl
  link.click()
  return true
}

export async function exportTilesSpritesheet(
  cells: Record<string, GridCell>,
  cellSize: number,
): Promise<string> {
  const dataUrl = await renderGridSpritesheet(cells, cellSize)
  const link = document.createElement('a')
  link.download = 'voicecanvas-tiles.png'
  link.href = dataUrl
  link.click()
  return dataUrl
}
