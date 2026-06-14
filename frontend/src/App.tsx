import { useCallback, useEffect, useRef } from 'react'
import { ComicView } from './components/ComicView'
import { AssetManager } from './components/AssetManager'
import { CommandManual } from './components/CommandManual'
import { FabricCanvas } from './components/FabricCanvas'
import { GridView } from './components/GridView'
import { Model3DView } from './components/Model3DView'
import { VoicePanel } from './components/VoicePanel'
import type { FabricCanvasRef } from './engines/fabricEngine'
import { useVoicePipeline } from './hooks/useVoicePipeline'
import { useAppStore } from './stores/appStore'
import { useAssetStore } from './stores/assetStore'
import type { CanvasMode } from './types'
import './App.css'

const MODE_LABELS: Record<CanvasMode, string> = {
  free: '自由画布',
  ai: 'AI 创作',
  grid: '九宫格',
  '3d': '3D 创作',
  assets: '资产管理',
  comic: '漫画创作',
}

const MODULE_STRIP: Record<CanvasMode, string> = {
  free: 'draw',
  ai: 'ai',
  grid: 'grid',
  '3d': '3d',
  assets: 'grid',
  comic: 'comic',
}

export default function App() {
  const canvasRef = useRef<FabricCanvasRef | null>(null)
  const canvasMode = useAppStore((s) => s.canvasMode)
  const imageProvider = useAppStore((s) => s.imageProvider)
  const voiceStatus = useAppStore((s) => s.voiceStatus)
  const backendOnline = useAppStore((s) => s.backendOnline)
  const aiGenerating = useAppStore((s) => s.aiGenerating)
  const aiGeneratingMessage = useAppStore((s) => s.aiGeneratingMessage)

  const handleCanvasReady = useCallback((canvas: FabricCanvasRef | null) => {
    canvasRef.current = canvas
  }, [])

  const getCanvas = useCallback(() => canvasRef.current, [])
  useVoicePipeline(getCanvas)

  useEffect(() => {
    void useAssetStore.getState().loadFromStorage()
  }, [])

  const stripMod = MODULE_STRIP[canvasMode]
  const showCanvas = canvasMode === 'free' || canvasMode === 'ai'

  return (
    <div className="shell">
      <div className="frame">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden />
            <div>
              <h1 className="brand-title">VoiceCanvas</h1>
              <p className="brand-sub">纯语音 AI 绘图工作台</p>
            </div>
          </div>
          <div className="topbar-meta">
            <span className={`pill ${backendOnline ? 'pill-ok' : 'pill-warn'}`}>
              <span className={`dot ${backendOnline ? 'online' : 'offline'}`} />
              {backendOnline ? '服务在线' : '后端离线'}
            </span>
            <span className="pill pill-mode">{MODE_LABELS[canvasMode]}</span>
            {aiGenerating && (
              <span className="pill pill-live">AI 生图中</span>
            )}
            {voiceStatus === 'listening' && !aiGenerating && (
              <span className="pill pill-live">聆听中</span>
            )}
            {voiceStatus === 'awaiting_activation' && (
              <span className="pill pill-warn">语音初始化</span>
            )}
          </div>
        </header>

        {voiceStatus === 'awaiting_activation' && (
          <div className="voice-activation-banner" role="status">
            语音系统初始化中，请说<strong>开始聆听</strong>；不知道指令可说<strong>指令手册</strong>
          </div>
        )}

        <div className="content">
          <div className="workspace-split">
            <VoicePanel />
            <section className={`screen card card-${stripMod}`}>
              <div className="screen-head">
                <h2>{MODE_LABELS[canvasMode]}</h2>
                <span className="screen-meta">
                  {voiceStatus === 'listening'
                    ? '语音控制中'
                    : canvasMode === 'ai'
                      ? `AI生图 · ${imageProvider}`
                      : '矢量绘图'}
                </span>
                {canvasMode === 'ai' && (
                  <p className="ai-mode-hint ai-mode-hint-inline">
                    说出描述即可生图，例如「生成赛博朋克城市」；可说「保存图片」「下载图片」
                  </p>
                )}
              </div>
              <div className="canvas-area">
                <div className={`canvas-frame ${showCanvas ? '' : 'canvas-offscreen'}`}>
                  <FabricCanvas onReady={handleCanvasReady} />
                  {aiGenerating && (
                    <div className="canvas-loading-overlay" role="status" aria-live="polite">
                      <div className="canvas-loading-card">
                        <span className="canvas-loading-spinner" aria-hidden />
                        <p className="canvas-loading-title">AI 图片生成中</p>
                        <p className="canvas-loading-desc">{aiGeneratingMessage || '请稍候，正在调用生图服务…'}</p>
                      </div>
                    </div>
                  )}
                </div>
                {canvasMode === 'grid' && <GridView />}
                {canvasMode === 'comic' && <ComicView />}
                {canvasMode === '3d' && <Model3DView />}
                {canvasMode === 'assets' && <AssetManager />}
              </div>
            </section>
          </div>
        </div>
      </div>
      <CommandManual />
    </div>
  )
}
