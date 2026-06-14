/**
 * VoiceCanvas 应用主组件
 *
 * 整体架构：
 * - 左侧：VoicePanel 语音面板（实时转录、指令历史、快捷按钮）
 * - 中间：工作区（根据 canvasMode 切换不同视图）
 *   - free/ai 模式：FabricCanvas 矢量画布
 *   - grid 模式：GridView 九宫格素材管理
 *   - comic 模式：ComicView 漫画创作工作台
 *   - 3d 模式：Model3DView 3D 模型预览
 *   - assets 模式：AssetManager 漫画资源管理
 * - 顶部：状态栏（服务状态、当前模式、语音状态等）
 */

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

// 画布模式到用户友好名称的映射
const MODE_LABELS: Record<CanvasMode, string> = {
  free: '自由画布',
  ai: 'AI 创作',
  grid: '九宫格',
  '3d': '3D 创作',
  assets: '资产管理',
  comic: '漫画创作',
}

// 画布模式到 CSS 模块类名的映射（用于不同模式的视觉样式区分）
const MODULE_STRIP: Record<CanvasMode, string> = {
  free: 'draw',
  ai: 'ai',
  grid: 'grid',
  '3d': '3d',
  assets: 'grid',
  comic: 'comic',
}

export default function App() {
  // Canvas 引用，用于在语音管道中执行画布操作
  const canvasRef = useRef<FabricCanvasRef | null>(null)

  // 从全局状态读取各项配置
  const canvasMode = useAppStore((s) => s.canvasMode)
  const imageProvider = useAppStore((s) => s.imageProvider)
  const voiceStatus = useAppStore((s) => s.voiceStatus)
  const voiceEnabled = useAppStore((s) => s.voiceEnabled)
  const backendOnline = useAppStore((s) => s.backendOnline)
  const aiGenerating = useAppStore((s) => s.aiGenerating)
  const aiGeneratingMessage = useAppStore((s) => s.aiGeneratingMessage)

  // Canvas 准备就绪回调
  const handleCanvasReady = useCallback((canvas: FabricCanvasRef | null) => {
    canvasRef.current = canvas
  }, [])

  // 获取 Canvas 引用的回调，传递给语音管道
  const getCanvas = useCallback(() => canvasRef.current, [])

  // 初始化语音处理管道（核心：语音识别→意图解析→工具执行）
  useVoicePipeline(getCanvas)

  // 应用启动时从 IndexedDB 加载漫画资产
  useEffect(() => {
    void useAssetStore.getState().loadFromStorage()
  }, [])

  // 决定是否显示 Fabric.js 画布（自由画布和 AI 模式需要）
  const stripMod = MODULE_STRIP[canvasMode]
  const showCanvas = canvasMode === 'free' || canvasMode === 'ai'

  return (
    <div className="shell">
      <div className="frame">
        {/* 顶部状态栏 */}
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden />
            <div>
              <h1 className="brand-title">VoiceCanvas</h1>
              <p className="brand-sub">纯语音 AI 绘图工作台</p>
            </div>
          </div>
          <div className="topbar-meta">
            {/* 后端服务在线状态 */}
            <span className={`pill ${backendOnline ? 'pill-ok' : 'pill-warn'}`}>
              <span className={`dot ${backendOnline ? 'online' : 'offline'}`} />
              {backendOnline ? '服务在线' : '后端离线'}
            </span>
            {/* 当前画布模式 */}
            <span className="pill pill-mode">{MODE_LABELS[canvasMode]}</span>
            {/* AI 生成中状态 */}
            {aiGenerating && (
              <span className="pill pill-live">AI 生图中</span>
            )}
            {/* 语音聆听状态 */}
            {voiceEnabled && voiceStatus === 'listening' && !aiGenerating && (
              <span className="pill pill-live">聆听中</span>
            )}
            {!voiceEnabled && (
              <span className="pill pill-warn">语音已关闭</span>
            )}
            {voiceStatus === 'awaiting_activation' && (
              <span className="pill pill-warn">语音初始化</span>
            )}
          </div>
        </header>

        {/* 语音系统初始化提示横幅 */}
        {voiceStatus === 'awaiting_activation' && (
          <div className="voice-activation-banner" role="status">
            语音系统初始化中，请说<strong>开始聆听</strong>；不知道指令可说<strong>指令手册</strong>
          </div>
        )}

        <div className="content">
          <div className="workspace-split">
            {/* 左侧语音面板 */}
            <VoicePanel />
            {/* 右侧工作区（根据模式切换） */}
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
                {/* AI 模式的使用提示 */}
                {canvasMode === 'ai' && (
                  <p className="ai-mode-hint ai-mode-hint-inline">
                    说出描述即可生图，例如「生成赛博朋克城市」；可说「保存图片」「下载图片」
                  </p>
                )}
              </div>
              <div className="canvas-area">
                {/* Fabric.js 画布（自由画布/AI 模式使用） */}
                <div className={`canvas-frame ${showCanvas ? '' : 'canvas-offscreen'}`}>
                  <FabricCanvas onReady={handleCanvasReady} />
                  {/* AI 生成时的加载遮罩 */}
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
                {/* 根据模式切换不同的工作视图 */}
                {canvasMode === 'grid' && <GridView />}
                {canvasMode === 'comic' && <ComicView />}
                {canvasMode === '3d' && <Model3DView />}
                {canvasMode === 'assets' && <AssetManager />}
              </div>
            </section>
          </div>
        </div>
      </div>
      {/* 指令手册弹窗（全局） */}
      <CommandManual />
    </div>
  )
}
