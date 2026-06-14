import { useCallback, useEffect, useRef, useState } from 'react'
import { clampGridPan, getGridBounds } from '../engines/gridEngine'
import { useAppStore } from '../stores/appStore'

export function GridView() {
  const cells = useAppStore((s) => s.gridCells)
  const selectedCellId = useAppStore((s) => s.selectedCellId)
  const cellSize = useAppStore((s) => s.cellSize)
  const panX = useAppStore((s) => s.gridPanX)
  const panY = useAppStore((s) => s.gridPanY)
  const setGridPan = useAppStore((s) => s.setGridPan)
  const resetGridView = useAppStore((s) => s.resetGridView)

  const viewportRef = useRef<HTMLDivElement>(null)
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 })

  const bounds = getGridBounds(cells)
  const rows = bounds.maxRow - bounds.minRow + 1
  const cols = bounds.maxCol - bounds.minCol + 1

  const clamped = clampGridPan(panX, panY, cells, cellSize, viewportSize.w, viewportSize.h)

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const update = () => setViewportSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (clamped.x !== panX || clamped.y !== panY) {
      setGridPan(clamped.x, clamped.y)
    }
  }, [clamped.x, clamped.y, panX, panY, setGridPan])

  const applyPan = useCallback(
    (dx: number, dy: number) => {
      const next = clampGridPan(
        panX + dx,
        panY + dy,
        cells,
        cellSize,
        viewportSize.w,
        viewportSize.h,
      )
      setGridPan(next.x, next.y)
    },
    [panX, panY, cells, cellSize, viewportSize.w, viewportSize.h, setGridPan],
  )

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const step = Math.min(120, Math.max(28, Math.abs(e.deltaY || e.deltaX) * 0.4))
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // 触控板横向滑动：视角跟随手指方向
        applyPan(-e.deltaX * 0.35, 0)
      } else if (e.shiftKey) {
        applyPan(e.deltaY > 0 ? -step : step, 0)
      } else {
        applyPan(0, e.deltaY > 0 ? -step : step)
      }
    },
    [applyPan],
  )

  const onDoubleClick = useCallback(() => {
    resetGridView()
  }, [resetGridView])

  return (
    <div className="grid-view">
      <div className="grid-view-toolbar">
        <button type="button" className="grid-view-reset" onClick={resetGridView}>
          回到中心
        </button>
        <span className="grid-view-pan-hint">滚轮上下 · 触控板左右滑 · 双击复位</span>
      </div>
      <div ref={viewportRef} className="grid-viewport" onWheel={onWheel} onDoubleClick={onDoubleClick}>
        <div
          className="grid-board-wrap"
          style={{ transform: `translate(${clamped.x}px, ${clamped.y}px)` }}
        >
          <div
            className="grid-board"
            style={{
              gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
              gridTemplateRows: `repeat(${rows}, ${cellSize}px)`,
            }}
          >
            {Object.values(cells)
              .sort((a, b) => a.row - b.row || a.col - b.col)
              .map((cell) => (
                <div
                  key={cell.id}
                  className={`grid-cell ${selectedCellId === cell.id ? 'selected' : ''} status-${cell.status}`}
                  style={{
                    gridRow: cell.row - bounds.minRow + 1,
                    gridColumn: cell.col - bounds.minCol + 1,
                  }}
                  onClick={() => useAppStore.getState().setSelectedCellId(cell.id)}
                >
                  {cell.imageData ? (
                    <img src={cell.imageData} alt={`cell ${cell.id}`} />
                  ) : (
                    <span className="cell-label">{cell.id}</span>
                  )}
                  {cell.status === 'generating' && <div className="cell-loading">生成中</div>}
                </div>
              ))}
          </div>
        </div>
      </div>
      <div className="grid-view-hint">
        「每个格子画像素小人不同角度」角色转身 · 「整个九宫格向上扩」整块扩图 · 「停止绘图」中断 · 说「回到中心」复位
      </div>
    </div>
  )
}
