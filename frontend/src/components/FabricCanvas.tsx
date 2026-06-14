import { useEffect, useRef } from 'react'
import { initCanvas, resizeCanvas, type FabricCanvasRef } from '../engines/fabricEngine'

interface Props {
  onReady: (canvas: FabricCanvasRef | null) => void
}

export function FabricCanvas({ onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<FabricCanvasRef | null>(null)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return

    const { clientWidth, clientHeight } = containerRef.current
    const w = Math.max(clientWidth, 400)
    const h = Math.min(Math.max(clientHeight, 400), 520)
    const canvas = initCanvas(canvasRef.current, w, h)
    fabricRef.current = canvas
    onReadyRef.current(canvas)

    const observer = new ResizeObserver(() => {
      if (!containerRef.current || !fabricRef.current) return
      resizeCanvas(
        fabricRef.current,
        containerRef.current.clientWidth,
        Math.min(Math.max(containerRef.current.clientHeight, 400), 520),
      )
    })
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      canvas.dispose()
      fabricRef.current = null
      onReadyRef.current(null)
    }
  }, [])

  useEffect(() => {
    const onResize = () => {
      if (!containerRef.current || !fabricRef.current) return
      resizeCanvas(
        fabricRef.current,
        containerRef.current.clientWidth,
        Math.min(Math.max(containerRef.current.clientHeight, 400), 520),
      )
    }
    document.addEventListener('voicecanvas:resize-canvas', onResize)
    return () => document.removeEventListener('voicecanvas:resize-canvas', onResize)
  }, [])

  return (
    <div ref={containerRef} className="canvas-container">
      <canvas ref={canvasRef} />
    </div>
  )
}
