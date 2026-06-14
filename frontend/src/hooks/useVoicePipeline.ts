import { useCallback, useEffect, useRef } from 'react'
import { parseIntent, verifyIntent, fetchConfig, checkHealth } from '../services/api'
import { XfyunMicPipeline } from '../services/xfyunIat'
import { XfyunOstPipeline } from '../services/xfyunOst'
import { createRecognition, getBrowserSpeechUnavailableReason, isEdgeBrowser, isSpeechRecognitionSupported, safeRecognitionStart } from '../services/speechRecognition'
import { speak, ensureMicrophoneAccess } from '../services/systemVoice'
import { normalizeVoiceText } from '../services/voiceTextNormalize'
import {
  isActionableTranscript,
  isConfidentSpeechResult,
  isDrawFragmentOnly,
  isDuplicateUtterance,
  isMeaningfulTranscript,
} from '../services/transcriptFilter'
import {
  HELP_MESSAGE,
  matchFuzzyUiCommand,
  matchAiModeCommand,
  matchImmediateVoiceCommand,
  matchLocalVoiceCommand,
  matchUniversalVoiceCommand,
  matchGridVoiceCommand,
  matchComicVoiceCommand,
  matchCanvasModeSwitch,
  matchImageProviderCommand,
  isAiControlCommand,
  WELCOME_MESSAGE,
  type LocalCommand,
} from '../services/voiceCommands'
import {
  isComplexCommand,
  isSystemOnlyCommand,
  resolveDeepSeekMode,
} from '../services/voiceRoute'
import { useAppStore } from '../stores/appStore'
import {
  buildCanvasContext,
  executeLocalAiQuick,
  executeLocalCompose,
  executeLocalDraw,
  executeLocalGridQuick,
  executeLocalComicQuick,
  executeComicIntentTools,
  executeLocalExportTiles,
  executeLocalLayer,
  executeLocalPath,
  executeLocalSelect,
  executeLocalStyle,
  executeLocalTransform,
  executeTools,
  executeWorkflowMacro,
  handleSystemCommand,
  summarizeToolResults,
} from '../engines/toolExecutor'
import { saveCanvasAsPng, fitImageToCanvas } from '../engines/fabricEngine'
import { cancelGeneration } from '../services/generationControl'
import {
  computeAdaptiveSilenceMs,
  createUtteranceTimingState,
  isShortUtterance,
  markUtteranceChunk,
  resetUtteranceTiming,
  looksLikeCompleteCommand,
  PAUSE_GAP_MS,
} from '../services/utteranceTiming'
import { createGrid, downloadGridImage } from '../engines/gridEngine'
import { exportComicPdf } from '../engines/comicEngine'
import type { FabricCanvasRef } from '../engines/fabricEngine'
import type { IntentParseResponse, ToolCall } from '../types'

const DEDUP_MS = 6000
const UTTERANCE_MERGE_MS = 9000
const SPEAK_DEDUP_MS = 4500
const TTS_ECHO_COOLDOWN_MS = 1800
const MAX_PROCESS_BURST = 8
const PROCESS_BURST_WINDOW_MS = 12000
const VOICE_STUCK_RECOVER_MS = 12000
const PROCESSING_STUCK_RECOVER_MS = 25000

type ScheduleProcessOptions = {
  isFinal?: boolean
  speechEnded?: boolean
  /** 跳过频控与部分去重（如即时指令） */
  manual?: boolean
}

type ProcessTextOptions = {
  manual?: boolean
}

const COMIC_AI_ACTIONS = new Set([
  'create_character',
  'create_script',
  'generate_episode',
  'generate_episodes',
  'edit_script',
  'regenerate_character',
  'regenerate_script',
  'regenerate_episode',
  'redraw_panels',
])
const COMIC_FAST_ACTIONS = new Set([
  'export_pdf',
  'set_style',
  'set_background',
  'view_character',
  'view_episode',
  'view_story',
  'close_detail',
  'new_project',
  'switch_project',
  'delete_project',
  'delete_projects',
  'delete_character',
  'delete_episode',
  'clear_episode_comic',
  'delete_panels',
])
const GRID_FAST_ACTIONS = new Set(['pan', 'reset_view', 'select', 'clear_grid'])
const GRID_AI_ACTIONS = new Set([
  'expand',
  'expand_region',
  'redraw',
  'inpaint',
  'fill_grid',
  'seamless',
  'batch',
  'style_sync',
  'character_turnaround',
])

function isComicAiCommand(cmd: LocalCommand): boolean {
  return cmd.type === 'comic_quick' && COMIC_AI_ACTIONS.has(cmd.action)
}

function isComicFastCommand(cmd: LocalCommand): boolean {
  return cmd.type === 'comic_quick' && COMIC_FAST_ACTIONS.has(cmd.action)
}

function isGridFastCommand(cmd: LocalCommand): boolean {
  return cmd.type === 'grid_quick' && GRID_FAST_ACTIONS.has(cmd.action)
}

function isGridAiCommand(cmd: LocalCommand): boolean {
  return cmd.type === 'grid_quick' && GRID_AI_ACTIONS.has(cmd.action)
}

function enrichGridLocalCmd(cmd: LocalCommand, intent: IntentParseResponse): LocalCommand {
  if (cmd.type !== 'grid_quick') return cmd
  const args = { ...(cmd.args ?? {}) }
  const gridTool = (intent.tools ?? []).find(
    (t: ToolCall) =>
      t.name.startsWith('grid_')
      || t.name === 'batch_grid'
      || t.name === 'style_sync'
      || t.name === 'character_turnaround',
  )
  if (gridTool?.arguments) {
    Object.assign(args, gridTool.arguments)
  }
  if (intent.image_prompt?.trim()) {
    args.prompt = intent.image_prompt.trim()
  }
  return { ...cmd, args }
}

export function useVoicePipeline(getCanvas: () => FabricCanvasRef | null) {
  const recognitionRef = useRef<ReturnType<typeof createRecognition>>(null)
  const recorderRef = useRef<XfyunMicPipeline | XfyunOstPipeline | null>(null)
  const silenceTimerRef = useRef<number | null>(null)
  const lastProcessedRef = useRef({ text: '', at: 0 })
  const processingRef = useRef(false)
  const shouldResumeRef = useRef(false)
  const utteranceModeRef = useRef(false)
  const welcomedRef = useRef(false)
  const xfyunProductRef = useRef<'ost' | 'iat'>('ost')
  const startContinuousRef = useRef<() => void>(() => {})
  const resumeListeningRef = useRef<() => void>(() => {})
  const browserRestartTimerRef = useRef<number | null>(null)
  const browserIntentionalPauseRef = useRef(false)
  const browserRestartAttemptsRef = useRef(0)
  const attachBrowserRecognitionRef = useRef<(() => void) | null>(null)
  const ttsCooldownUntilRef = useRef(0)
  const lastSpeakRef = useRef({ text: '', at: 0 })
  const speakingActiveRef = useRef(false)
  const processBurstRef = useRef({ count: 0, windowStart: 0 })
  const voiceStuckSinceRef = useRef(0)
  const processingStuckSinceRef = useRef(0)
  const utteranceBufferRef = useRef({ text: '', updatedAt: 0 })
  const utteranceTimingRef = useRef(createUtteranceTimingState())

  const shouldAcceptTranscript = useCallback((manual = false) => {
    if (manual) return true
    const s = useAppStore.getState()
    if (!s.voiceEnabled) return false
    if (Date.now() < ttsCooldownUntilRef.current) return false
    if (['speaking', 'executing', 'optimizing'].includes(s.voiceStatus)) {
      return false
    }
    return true
  }, [])

  const getPendingUtteranceText = useCallback(() => {
    const buf = utteranceBufferRef.current.text.trim()
    const fallback = normalizeVoiceText(useAppStore.getState().transcript).trim()
    return buf || fallback
  }, [])

  const shouldKeepBrowserListening = useCallback(() => {
    const s = useAppStore.getState()
    if (!s.voiceEnabled) return false
    if (s.asrProvider !== 'browser') return false
    if (s.voiceMode !== 'continuous' && !utteranceModeRef.current) return false
    return !['speaking', 'executing', 'optimizing', 'awaiting_activation'].includes(s.voiceStatus)
  }, [])

  const clearBrowserRestartTimer = useCallback(() => {
    if (browserRestartTimerRef.current) {
      window.clearTimeout(browserRestartTimerRef.current)
      browserRestartTimerRef.current = null
    }
  }, [])

  const scheduleBrowserReconnect = useCallback((delayMs = 280) => {
    if (browserIntentionalPauseRef.current || !shouldKeepBrowserListening()) return
    clearBrowserRestartTimer()
    browserRestartTimerRef.current = window.setTimeout(() => {
      browserRestartTimerRef.current = null
      attachBrowserRecognitionRef.current?.()
    }, delayMs)
  }, [clearBrowserRestartTimer, shouldKeepBrowserListening])

  const stopListening = useCallback(() => {
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    clearBrowserRestartTimer()
    browserIntentionalPauseRef.current = false
    browserRestartAttemptsRef.current = 0
    recognitionRef.current?.stop()
    recognitionRef.current = null
    recorderRef.current?.stop()
    recorderRef.current = null
    if (useAppStore.getState().voiceStatus === 'listening') {
      useAppStore.getState().setVoiceStatus('idle')
    }
  }, [clearBrowserRestartTimer])

  const pauseListening = useCallback(() => {
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    if (useAppStore.getState().asrProvider === 'browser') {
      browserIntentionalPauseRef.current = true
      clearBrowserRestartTimer()
    }
    if (recorderRef.current?.isActive()) {
      recorderRef.current.pause()
    } else {
      recognitionRef.current?.stop()
      recognitionRef.current = null
    }
    if (useAppStore.getState().voiceStatus === 'listening') {
      useAppStore.getState().setVoiceStatus('idle')
    }
  }, [])

  const resumeListening = useCallback(async (force = false) => {
    const store = useAppStore.getState()
    if (!force && store.voiceStatus === 'speaking') return
    if (!force && ['executing', 'optimizing'].includes(store.voiceStatus)) return

    lastProcessedRef.current = { text: '', at: 0 }

    if (store.asrProvider === 'xfyun' && recorderRef.current?.isActive()) {
      recorderRef.current.resume()
      store.setVoiceStatus('listening')
      return
    }

    await startContinuousRef.current()
  }, [])

  /** 指令执行后确保麦克风恢复（防止 pause 后卡住不再识别） */
  const ensureListeningActive = useCallback(() => {
    const store = useAppStore.getState()
    if (!store.voiceEnabled) return
    if (processingRef.current) return

    if (store.voiceStatus === 'speaking' && !speakingActiveRef.current) {
      store.setVoiceStatus('listening')
    }
    if (['executing', 'optimizing'].includes(store.voiceStatus)) {
      store.setVoiceStatus('listening')
    }

    if (Date.now() < ttsCooldownUntilRef.current) return
    if (store.voiceMode !== 'continuous' && !utteranceModeRef.current) return
    if (store.voiceStatus === 'speaking') return

    if (store.asrProvider === 'xfyun') {
      const pipe = recorderRef.current
      if (pipe && 'resetIfStuck' in pipe) {
        (pipe as XfyunOstPipeline).resetIfStuck()
      }
      if (!pipe?.isActive()) {
        void startContinuousRef.current()
        return
      }
      if (pipe.isPaused() || (!pipe.isConnected() && !pipe.isConnecting())) {
        pipe.resume()
      }
      if ('resumeAudioContext' in pipe) {
        void (pipe as XfyunMicPipeline).resumeAudioContext()
      }
      store.setVoiceStatus('listening')
      return
    }

    if (store.asrProvider === 'browser') {
      browserIntentionalPauseRef.current = false
      if (!recognitionRef.current) {
        attachBrowserRecognitionRef.current?.()
      } else {
        scheduleBrowserReconnect(120)
      }
      store.setVoiceStatus('listening')
      return
    }

    if (!recognitionRef.current && store.voiceStatus !== 'listening') {
      void startContinuousRef.current()
    }
  }, [])

  const pauseListeningForWork = useCallback(() => {
    pauseListening()
    recorderRef.current?.pause()
  }, [pauseListening])

  const registerProcessBurst = useCallback(() => {
    const now = Date.now()
    const burst = processBurstRef.current
    if (!burst.windowStart || now - burst.windowStart > PROCESS_BURST_WINDOW_MS) {
      burst.windowStart = now
      burst.count = 1
      return false
    }
    burst.count += 1
    if (burst.count > MAX_PROCESS_BURST) {
      const store = useAppStore.getState()
      store.setLastReply('指令较快，请稍候再说')
      return true
    }
    return false
  }, [])

  const speakAndMaybeResume = useCallback((message: string, resume = true) => {
    const store = useAppStore.getState()
    const now = Date.now()
    const trimmed = message.trim()
    if (
      trimmed
      && (speakingActiveRef.current || (trimmed === lastSpeakRef.current.text && now - lastSpeakRef.current.at < SPEAK_DEDUP_MS))
    ) {
      if (resume && store.voiceEnabled && store.voiceMode === 'continuous') {
        window.setTimeout(() => { ensureListeningActive() }, TTS_ECHO_COOLDOWN_MS)
      }
      return
    }
    lastSpeakRef.current = { text: trimmed, at: now }
    speakingActiveRef.current = true

    pauseListening()
    recorderRef.current?.pause()
    store.setLastReply(message)
    store.setVoiceStatus('speaking')
    shouldResumeRef.current = resume && store.voiceEnabled && store.voiceMode === 'continuous' && !utteranceModeRef.current

    let done = false
    const finish = () => {
      if (done) return
      done = true
      speakingActiveRef.current = false
      ttsCooldownUntilRef.current = Date.now() + TTS_ECHO_COOLDOWN_MS
      const s = useAppStore.getState()
      if (shouldResumeRef.current) {
        shouldResumeRef.current = false
        s.setVoiceStatus('listening')
        window.setTimeout(() => { ensureListeningActive() }, TTS_ECHO_COOLDOWN_MS)
      } else {
        s.setVoiceStatus('idle')
      }
    }

    const fallbackMs = Math.min(12000, Math.max(3000, message.length * 180))
    const timer = window.setTimeout(finish, fallbackMs)
    speak(message, () => {
      window.clearTimeout(timer)
      finish()
    })
  }, [pauseListening, ensureListeningActive, scheduleBrowserReconnect])

  const handleLocalCommand = useCallback(
    (cmd: LocalCommand): boolean => {
      const store = useAppStore.getState()
      const canvas = getCanvas()

      switch (cmd.type) {
        case 'help':
          speakAndMaybeResume(HELP_MESSAGE, true)
          return true
        case 'open_manual': {
          if (store.canvasMode === 'grid' || store.canvasMode === '3d' || store.canvasMode === 'comic') {
            store.setCanvasMode('free')
          }
          store.setCommandManualOpen(true)
          store.setLastReply('已打开指令手册')
          return true
        }
        case 'close_manual':
          store.setCommandManualOpen(false)
          store.setLastReply('已关闭指令手册')
          return true
        case 'stop_generation': {
          cancelGeneration()
          store.setAiGenerating(false)
          speakAndMaybeResume('已停止绘图', true)
          return true
        }
        case 'stop_listening':
          store.setVoiceEnabled(false)
          browserIntentionalPauseRef.current = true
          stopListening()
          speakAndMaybeResume('已停止聆听', false)
          return true
        case 'start_listening':
          store.setVoiceEnabled(true)
          stopListening()
          window.setTimeout(() => { void startContinuousRef.current() }, 100)
          speakAndMaybeResume('已开始聆听，请说话', true)
          return true
        case 'set_voice_mode':
          store.setVoiceMode(cmd.mode)
          speakAndMaybeResume(cmd.mode === 'continuous' ? '已切换连续聆听' : '已切换单次说话，请说开始说话', true)
          return true
        case 'set_deepseek':
          store.setDeepseekMode(cmd.mode, true)
          {
            const labels: Record<string, string> = {
              'v4-pro': 'V4 Pro 深度推理',
              flash: 'Flash 快速',
              chat: 'Chat 对话',
              auto: '自动（常规 Flash / 复杂 Pro）',
            }
            speakAndMaybeResume(`已切换 DeepSeek ${labels[cmd.mode] ?? cmd.mode}`, true)
          }
          return true
        case 'set_image_provider':
          store.setImageProvider(cmd.provider)
          speakAndMaybeResume(
            `已切换${cmd.provider === 'minimax' ? 'MiniMax' : '豆包'}生图，当前仍在${{ free: '自由画布', ai: 'AI创作', grid: '九宫格', '3d': '3D创作', assets: '资产管理', comic: '漫画创作' }[store.canvasMode]}模式`,
            true,
          )
          return true
        case 'set_asr_provider':
          stopListening()
          store.setAsrProvider(cmd.provider, true)
          window.setTimeout(() => { void startContinuousRef.current() }, 150)
          speakAndMaybeResume(
            cmd.provider === 'xfyun'
              ? '已切换讯飞识别，请说话'
              : '已切换浏览器识别，请用 Chrome 打开 localhost 并说话',
            true,
          )
          return true
        case 'switch_mode': {
          store.setAiGenerating(false)
          store.setCanvasMode(cmd.mode)
          const labels = { free: '自由画布', ai: 'AI创作', grid: '九宫格', '3d': '3D创作', assets: '资产管理', comic: '漫画创作' }
          if (cmd.mode === 'grid' && Object.keys(store.gridCells).length === 0) {
            store.setGridCells(createGrid(3, 3))
          }
          const extra = cmd.mode === 'ai'
            ? '，说出描述即可生图，例如「生成赛博朋克城市」'
            : cmd.mode === 'grid'
              ? '，可说「画一张赛博城市」占满九宫格，或「0,0向上扩图画森林」'
              : cmd.mode === 'comic'
                ? '，可说「画角色立绘小明」「创作第一集剧本」「生成第一集漫画」'
                : ''
          speakAndMaybeResume(`已切换到${labels[cmd.mode]}${extra}`, true)
          return true
        }
        case 'save_canvas': {
          const filename = /下载/.test(store.transcript) ? 'voicecanvas-download.png' : 'voicecanvas.png'
          if (store.canvasMode === 'comic') {
            void exportComicPdf()
              .then((msg) => speakAndMaybeResume(msg, true))
              .catch((err) =>
                speakAndMaybeResume(err instanceof Error ? err.message : '导出失败', true),
              )
              .finally(() => ensureListeningActive())
            return true
          }
          if (store.canvasMode === 'grid' && Object.keys(store.gridCells).length > 0) {
            void downloadGridImage(store.gridCells, store.cellSize, filename)
              .then((ok) =>
                speakAndMaybeResume(
                  ok
                    ? (/下载/.test(store.transcript) ? '九宫格图片已下载' : '九宫格图片已保存')
                    : '保存失败，格子中没有可导出的图片',
                  true,
                ),
              )
              .catch((err) =>
                speakAndMaybeResume(err instanceof Error ? err.message : '保存失败', true),
              )
              .finally(() => ensureListeningActive())
            return true
          }
          if (canvas) {
            const ok = saveCanvasAsPng(canvas, filename)
            speakAndMaybeResume(
              ok
                ? (/下载/.test(store.transcript) ? '图片已下载' : '图片已保存')
                : '保存失败，请重新生成图片后再试',
              true,
            )
          } else {
            speakAndMaybeResume('画布未就绪，无法保存', true)
          }
          return true
        }
        case 'draw': {
          const runDraw = () => {
            const c = getCanvas()
            if (c) {
              executeLocalDraw(c, cmd.args)
              speakAndMaybeResume('已绘制', true)
            } else {
              speakAndMaybeResume('画布未就绪，请稍后再试', true)
            }
          }
          runDraw()
          return true
        }
        case 'draw_path': {
          const c = getCanvas()
          if (c) {
            executeLocalPath(c, cmd.args)
            speakAndMaybeResume('路径已绘制', true)
          } else {
            speakAndMaybeResume('画布未就绪，请稍后再试', true)
          }
          return true
        }
        case 'select_object':
          if (canvas && executeLocalSelect(canvas, cmd.args)) {
            speakAndMaybeResume('已选中对象', true)
          } else speakAndMaybeResume('未找到目标对象', true)
          return true
        case 'compose':
          if (store.canvasMode === 'grid' && cmd.action === 'stick_figure') {
            speakAndMaybeResume('九宫格模式请说「每个格子画像素小人不同角度」', true)
            return true
          }
          if (canvas && executeLocalCompose(canvas, cmd.action, cmd.args)) {
            const labels: Record<string, string> = {
              flowchart: '流程图已绘制',
              stick_figure: '火柴人已绘制',
              snap_center: '已居中',
              align_center: '已对齐',
              distribute: '已等间距排列',
              arrange_row: '横排图形已绘制',
              show_grid: '已显示辅助网格',
              hide_grid: '已隐藏辅助网格',
              grid_create: '九宫格已创建',
              grid_split_canvas: '正在把图片切成九宫格',
            }
            speakAndMaybeResume(labels[cmd.action] ?? '已完成', true)
          } else speakAndMaybeResume('无法执行该组合操作', true)
          return true
        case 'grid_quick':
          if (useAppStore.getState().aiGenerating) {
            speakAndMaybeResume('图片正在生成中，请稍候', true)
            return true
          }
          void executeLocalGridQuick(cmd.action, cmd.args, (msg) => store.setLastReply(msg))
            .then((msg) => speakAndMaybeResume(msg ?? '无法执行该九宫格操作', true))
            .catch((err) => {
              speakAndMaybeResume(err instanceof Error ? err.message : '九宫格操作失败', true)
            })
            .finally(() => ensureListeningActive())
          return true
        case 'comic_quick':
          if (useAppStore.getState().aiGenerating) {
            speakAndMaybeResume('图片正在生成中，请稍候', true)
            return true
          }
          void executeLocalComicQuick(cmd.action, cmd.args, (msg) => store.setLastReply(msg))
            .then((msg) => speakAndMaybeResume(msg ?? '漫画操作失败', true))
            .catch((err) => {
              speakAndMaybeResume(err instanceof Error ? err.message : '漫画操作失败', true)
            })
            .finally(() => ensureListeningActive())
          return true
        case 'ai_quick':
          if (useAppStore.getState().aiGenerating) {
            speakAndMaybeResume('图片正在生成中，请稍候', true)
            return true
          }
          if (canvas) {
            void executeLocalAiQuick(canvas, cmd.action, cmd.args)
              .then((msg) => speakAndMaybeResume(msg ?? 'AI 生成失败', true))
              .catch((err) => {
                speakAndMaybeResume(err instanceof Error ? err.message : 'AI 生成失败', true)
              })
              .finally(() => ensureListeningActive())
          } else {
            speakAndMaybeResume('画布未就绪', true)
          }
          return true
        case 'set_style':
          if (canvas && executeLocalStyle(canvas, cmd.args)) speakAndMaybeResume('样式已更新', true)
          else speakAndMaybeResume('没有可修改对象', true)
          return true
        case 'transform':
          if (canvas && executeLocalTransform(canvas, cmd.args)) {
            const action = String(cmd.args.action ?? '')
            const labels: Record<string, string> = {
              scale: /缩小|变小/.test(store.transcript) ? '已缩小' : '已放大',
              move: '已移动',
              rotate: '已旋转',
            }
            speakAndMaybeResume(labels[action] ?? '变换完成', true)
          } else speakAndMaybeResume('没有可变换对象', true)
          return true
        case 'layer':
          if (canvas && executeLocalLayer(canvas, cmd.action)) speakAndMaybeResume('图层已调整', true)
          else speakAndMaybeResume('没有可调整对象', true)
          return true
        case 'delete_object':
          speakAndMaybeResume(handleSystemCommand('delete', canvas) ?? '没有对象', true)
          return true
        case 'duplicate':
          speakAndMaybeResume(handleSystemCommand('duplicate', canvas) ?? '没有对象', true)
          return true
        case 'export_tiles':
          void executeLocalExportTiles()
            .then(() => speakAndMaybeResume('瓦片集已导出', true))
            .catch((err) => speakAndMaybeResume(err instanceof Error ? err.message : '导出失败', true))
            .finally(() => ensureListeningActive())
          return true
        case 'workflow_macro':
          void executeWorkflowMacro(cmd.name)
            .then(() => speakAndMaybeResume('工作流执行完成', true))
            .catch((err) => speakAndMaybeResume(err instanceof Error ? err.message : '工作流失败', true))
            .finally(() => ensureListeningActive())
          return true
        case 'canvas': {
          const gridExpandMap: Record<string, string> = {
            expand_top: 'up',
            expand_bottom: 'down',
            expand_left: 'left',
            expand_right: 'right',
          }
          const gridPanMap: Record<string, [number, number]> = {
            pan_left: [200, 0],
            pan_right: [-200, 0],
            pan_up: [0, 200],
            pan_down: [0, -200],
          }
          if (store.canvasMode === 'grid') {
            if (cmd.action === 'clear') {
              void executeLocalGridQuick('clear_grid', {}, (msg) => store.setLastReply(msg))
                .then((msg) => speakAndMaybeResume(msg ?? '九宫格已清空', true))
                .catch((err) =>
                  speakAndMaybeResume(err instanceof Error ? err.message : '清空失败', true),
                )
                .finally(() => ensureListeningActive())
              return true
            }
            if (gridExpandMap[cmd.action]) {
              void executeLocalGridQuick(
                'expand_region',
                { direction: gridExpandMap[cmd.action], seamless: true },
                (msg) => store.setLastReply(msg),
              )
                .then((msg) => speakAndMaybeResume(msg ?? '扩格失败', true))
                .catch((err) =>
                  speakAndMaybeResume(err instanceof Error ? err.message : '扩格失败', true),
                )
                .finally(() => ensureListeningActive())
              return true
            }
            if (gridPanMap[cmd.action]) {
              const [dx, dy] = gridPanMap[cmd.action]
              store.panGridView(dx, dy)
              speakAndMaybeResume('九宫格视图已移动', true)
              return true
            }
            if (cmd.action === 'reset_view' || cmd.action === 'fit') {
              store.resetGridView()
              speakAndMaybeResume('九宫格视图已复位', true)
              return true
            }
          }
          const reply = handleSystemCommand(cmd.action, canvas)
          if (cmd.action === 'fit_image_cover' && canvas && fitImageToCanvas(canvas, 'cover')) {
            speakAndMaybeResume('图片已铺满画布', true)
            return true
          }
          if (cmd.action === 'fit_image_contain' && canvas && fitImageToCanvas(canvas, 'contain')) {
            speakAndMaybeResume('图片已适应画布', true)
            return true
          }
          speakAndMaybeResume(reply ?? '已执行', true)
          return true
        }
        default:
          return false
      }
    },
    [getCanvas, pauseListening, speakAndMaybeResume, stopListening, ensureListeningActive],
  )

  const runDeepSeekPipeline = useCallback(
    async (text: string) => {
      const store = useAppStore.getState()
      const canvas = getCanvas()
      const mode = resolveDeepSeekMode(text, store.deepseekMode)
      const modeLabel = mode === 'v4-pro' ? 'Pro' : 'Flash'

      store.setVoiceStatus('optimizing')
      store.setLastReply(`DeepSeek ${modeLabel} 正在理解您的指令…`)
      try {
        const context = buildCanvasContext(canvas)
        const intent = await parseIntent(text, context, mode)
        if (intent.optimized_text?.trim()) {
          store.setTranscript(intent.optimized_text)
        }

        store.setVoiceStatus('executing')
        let results = await executeTools(intent.tools, {
          canvas,
          onStep: (msg) => store.setLastReply(msg),
        })

        const shouldVerify =
          mode === 'v4-pro' || (store.deepseekMode === 'auto' && isComplexCommand(text))
        let verify: {
          ok: boolean
          reply: string
          correction_tools: typeof intent.tools
          reason: string | null
        } = { ok: true, reply: intent.reply || '已完成', correction_tools: [], reason: null }

        if (shouldVerify) {
          store.setVoiceStatus('optimizing')
          store.setLastReply('正在验收绘制结果…')
          const verifyResult = await verifyIntent(
            text,
            buildCanvasContext(getCanvas()),
            intent.tools,
            results,
            'v4-pro',
          )
          verify = {
            ok: verifyResult.ok,
            reply: verifyResult.reply,
            correction_tools: verifyResult.correction_tools ?? [],
            reason: verifyResult.reason ?? null,
          }
        }

        const correctionTools = (verify.correction_tools ?? []).slice(0, 8)
        if (correctionTools.length) {
          store.setVoiceStatus('executing')
          store.setLastReply(verify.reason ? `正在修正：${verify.reason}` : '正在修正位置…')
          const fixResults = await executeTools(correctionTools, {
            canvas: getCanvas(),
            onStep: (msg) => store.setLastReply(msg),
          })
          results = [...results, ...fixResults]
        }

        utteranceModeRef.current = false
        const stepCount = intent.tools.length + correctionTools.length
        let reply = summarizeToolResults(results, verify.reply || intent.reply || '已完成')
        if (stepCount > 1 && !reply.includes('步')) {
          reply = `${reply}，共完成${stepCount}步`
        }
        speakAndMaybeResume(reply, true)
      } catch (err) {
        utteranceModeRef.current = false
        speakAndMaybeResume(err instanceof Error ? err.message : '处理失败', true)
      } finally {
        ensureListeningActive()
      }
    },
    [getCanvas, speakAndMaybeResume, ensureListeningActive],
  )

  const runGridAiPipeline = useCallback(
    async (text: string, localHint?: LocalCommand) => {
      const store = useAppStore.getState()
      const canvas = getCanvas()
      const mode = resolveDeepSeekMode(text, store.deepseekMode)
      const modeLabel = mode === 'v4-pro' ? 'Pro' : 'Flash'

      store.setVoiceStatus('optimizing')
      store.setLastReply(`DeepSeek ${modeLabel} 正在优化生图描述…`)
      let intent: Awaited<ReturnType<typeof parseIntent>> | null = null
      try {
        const context = buildCanvasContext(canvas)
        intent = await parseIntent(text, context, mode)
        if (intent.optimized_text?.trim()) {
          store.setTranscript(intent.optimized_text)
        }
        if (intent.image_prompt?.trim()) {
          store.setLastReply(`描述已优化，准备生图…`)
        }

        const gridTools = (intent.tools ?? []).filter(
          (t) =>
            t.name.startsWith('grid_')
            || t.name === 'batch_grid'
            || t.name === 'style_sync'
            || t.name === 'character_turnaround',
        )
        if (gridTools.length) {
          store.setVoiceStatus('executing')
          await executeTools(gridTools, {
            canvas,
            onStep: (msg) => store.setLastReply(msg),
          })
          speakAndMaybeResume(intent.reply || '已完成', true)
          return
        }

        const matched = matchGridVoiceCommand(intent.optimized_text?.trim() || text) ?? localHint
        if (matched?.type === 'grid_quick' && GRID_AI_ACTIONS.has(matched.action)) {
          const localCmd = enrichGridLocalCmd(matched, intent)
          if (localCmd.type !== 'grid_quick') {
            speakAndMaybeResume(intent.reply || '未能理解该九宫格指令', true)
            return
          }
          store.setVoiceStatus('executing')
          const msg = await executeLocalGridQuick(localCmd.action, localCmd.args, (m) =>
            store.setLastReply(m),
          )
          speakAndMaybeResume(msg ?? '已完成', true)
          return
        }

        speakAndMaybeResume(intent.reply || '未能理解该九宫格指令', true)
      } catch (err) {
        if (localHint?.type === 'grid_quick' && GRID_AI_ACTIONS.has(localHint.action)) {
          store.setVoiceStatus('executing')
          const msg = await executeLocalGridQuick(localHint.action, localHint.args, (m) =>
            store.setLastReply(m),
          )
          speakAndMaybeResume(msg ?? '已完成', true)
          return
        }
        speakAndMaybeResume(err instanceof Error ? err.message : '处理失败', true)
      } finally {
        ensureListeningActive()
      }
    },
    [getCanvas, speakAndMaybeResume, ensureListeningActive],
  )

  const runComicAiPipeline = useCallback(
    async (text: string) => {
      const store = useAppStore.getState()
      const canvas = getCanvas()

      const local = matchComicVoiceCommand(text)
      if (local && isComicFastCommand(local) && handleLocalCommand(local)) {
        return
      }
      if (local && isComicAiCommand(local)) {
        await handleLocalCommand(local)
        return
      }

      const mode = resolveDeepSeekMode(text, store.deepseekMode)
      const modeLabel = mode === 'v4-pro' ? 'Pro' : 'Flash'

      store.setVoiceStatus('optimizing')
      store.setLastReply(`DeepSeek ${modeLabel} 正在理解漫画指令…`)
      try {
        const context = buildCanvasContext(canvas)
        const intent = await parseIntent(text, context, mode)
        if (intent.optimized_text?.trim()) {
          store.setTranscript(intent.optimized_text)
        }

        const comicTools = (intent.tools ?? []).filter((t) => t.name.startsWith('comic_'))
        if (!comicTools.length) {
          speakAndMaybeResume(intent.reply || '未能理解该漫画指令', true)
          return
        }

        store.setVoiceStatus('executing')
        const msg = await executeComicIntentTools(comicTools, (m) => store.setLastReply(m))
        speakAndMaybeResume(msg || intent.reply || '已完成', true)
      } catch (err) {
        speakAndMaybeResume(err instanceof Error ? err.message : '漫画指令处理失败', true)
      } finally {
        ensureListeningActive()
      }
    },
    [getCanvas, speakAndMaybeResume, ensureListeningActive, handleLocalCommand],
  )

  const processText = useCallback(
    async (rawText: string, opts?: ProcessTextOptions) => {
      const text = normalizeVoiceText(rawText)
      if (!text.trim() || !isMeaningfulTranscript(text)) return

      const immediate = matchImmediateVoiceCommand(text)
      if (immediate?.type === 'utterance_start') {
        utteranceModeRef.current = true
        void resumeListening()
        speakAndMaybeResume('请说指令', false)
        return
      }
      if (immediate && handleLocalCommand(immediate)) {
        utteranceModeRef.current = false
        return
      }

      if (!isActionableTranscript(text)) return
      if (!opts?.manual && isDrawFragmentOnly(text)) return
      if (!shouldAcceptTranscript(opts?.manual)) return

      if (!opts?.manual) {
        const last = lastProcessedRef.current
        if (isDuplicateUtterance(text, last.text, last.at, DEDUP_MS)) return
        if (registerProcessBurst()) return
      }

      lastProcessedRef.current = { text, at: Date.now() }

      if (processingRef.current) {
        if (opts?.manual) {
          useAppStore.getState().setLastReply('上一条指令仍在执行，请稍候')
        } else {
          useAppStore.getState().setTranscript(text)
        }
        return
      }

      processingRef.current = true
      pauseListeningForWork()

      const store = useAppStore.getState()
      store.addCommand(text)
      store.setTranscript(text)

      try {
      const providerSwitch = matchImageProviderCommand(text)
      if (providerSwitch && handleLocalCommand(providerSwitch)) {
        utteranceModeRef.current = false
        return
      }

      // 漫画模式：项目切换/删除等优先于画布模式切换
      if (useAppStore.getState().canvasMode === 'comic') {
        const comicEarly = matchComicVoiceCommand(text)
        if (comicEarly) {
          if (isComicFastCommand(comicEarly) && handleLocalCommand(comicEarly)) {
            utteranceModeRef.current = false
            return
          }
          if (isComicAiCommand(comicEarly) && handleLocalCommand(comicEarly)) {
            utteranceModeRef.current = false
            return
          }
        }
      }

      const modeSwitch = matchCanvasModeSwitch(text)
      if (modeSwitch && handleLocalCommand(modeSwitch)) {
        utteranceModeRef.current = false
        return
      }

      // 漫画模式：角色/剧本/分镜优先
      if (store.canvasMode === 'comic') {
        const comicCmd = matchComicVoiceCommand(text)
        if (comicCmd) {
          if (isComicFastCommand(comicCmd) && handleLocalCommand(comicCmd)) {
            utteranceModeRef.current = false
            return
          }
          if (isComicAiCommand(comicCmd) && handleLocalCommand(comicCmd)) {
            utteranceModeRef.current = false
            return
          }
        }
      }

      // 九宫格模式：扩格/绘格/占满优先于通用画布指令（避免「向上扩图」误走画布 expand）
      if (store.canvasMode === 'grid') {
        const gridEarly = matchGridVoiceCommand(text)
        if (gridEarly) {
          if (isGridFastCommand(gridEarly) && handleLocalCommand(gridEarly)) {
            utteranceModeRef.current = false
            return
          }
          if (isGridAiCommand(gridEarly)) {
            await runGridAiPipeline(text, gridEarly)
            utteranceModeRef.current = false
            return
          }
        }
      }

      const comicEarly = matchComicVoiceCommand(text)
      if (comicEarly) {
        if (isComicFastCommand(comicEarly) && handleLocalCommand(comicEarly)) {
          utteranceModeRef.current = false
          return
        }
        if (isComicAiCommand(comicEarly) && handleLocalCommand(comicEarly)) {
          utteranceModeRef.current = false
          return
        }
      }

      const universal = matchUniversalVoiceCommand(text)
      if (universal) {
        if (useAppStore.getState().aiGenerating) {
          useAppStore.getState().setAiGenerating(false)
        }
        if (handleLocalCommand(universal)) {
          utteranceModeRef.current = false
          return
        }
      }

      if (isSystemOnlyCommand(text)) {
        const providerOnly = matchImageProviderCommand(text)
        if (providerOnly && handleLocalCommand(providerOnly)) {
          utteranceModeRef.current = false
          return
        }
        const local = matchLocalVoiceCommand(text) ?? matchFuzzyUiCommand(text)
        if (local && handleLocalCommand(local)) {
          utteranceModeRef.current = false
          return
        }
      }

      if (store.canvasMode === 'grid') {
        const gridCmd = matchGridVoiceCommand(text)
        if (gridCmd) {
          if (isGridFastCommand(gridCmd) && handleLocalCommand(gridCmd)) {
            utteranceModeRef.current = false
            return
          }
          if (isGridAiCommand(gridCmd)) {
            await runGridAiPipeline(text, gridCmd)
            utteranceModeRef.current = false
            return
          }
        }
        await runDeepSeekPipeline(text)
        utteranceModeRef.current = false
        return
      }

      if (store.canvasMode === 'comic') {
        await runComicAiPipeline(text)
        utteranceModeRef.current = false
        return
      }

      if (store.canvasMode === 'ai') {
        const aiCmd = matchAiModeCommand(text)
        if (aiCmd && handleLocalCommand(aiCmd)) {
          utteranceModeRef.current = false
          return
        }
        if (!isAiControlCommand(text) && !/画|绘制|圆|矩形|箭头|路径/.test(text) && text.length >= 2) {
          const generated = handleLocalCommand({
            type: 'ai_quick',
            action: 'generate',
            args: { prompt: text },
          })
          if (generated) {
            utteranceModeRef.current = false
            return
          }
        }
      } else {
        const aiSwitch = matchAiModeCommand(text)
        if (aiSwitch?.type === 'switch_mode' && aiSwitch.mode === 'ai' && handleLocalCommand(aiSwitch)) {
          utteranceModeRef.current = false
          return
        }
      }

      await runDeepSeekPipeline(text)
      utteranceModeRef.current = false
      } finally {
        processingRef.current = false
        ensureListeningActive()
        window.setTimeout(() => { ensureListeningActive() }, TTS_ECHO_COOLDOWN_MS)
      }
    },
    [
      handleLocalCommand,
      runDeepSeekPipeline,
      runGridAiPipeline,
      runComicAiPipeline,
      speakAndMaybeResume,
      shouldAcceptTranscript,
      registerProcessBurst,
      pauseListeningForWork,
      ensureListeningActive,
      resumeListening,
    ],
  )

  const mergeUtteranceText = useCallback((incoming: string) => {
    const norm = normalizeVoiceText(incoming).trim()
    if (!norm) return ''
    const buf = utteranceBufferRef.current
    const now = Date.now()
    const gap = buf.updatedAt ? now - buf.updatedAt : 0
    if (buf.text && gap > PAUSE_GAP_MS && isShortUtterance(norm)) {
      resetUtteranceTiming(utteranceTimingRef.current)
      buf.text = norm
      buf.updatedAt = now
      return buf.text
    }
    if (buf.text && now - buf.updatedAt < UTTERANCE_MERGE_MS) {
      if (norm.includes(buf.text)) {
        buf.text = norm
      } else if (buf.text.includes(norm)) {
        // keep longer buffer
      } else {
        buf.text = `${buf.text}，${norm}`
      }
    } else {
      buf.text = norm
    }
    buf.updatedAt = now
    return buf.text
  }, [])

  const clearUtteranceBuffer = useCallback(() => {
    utteranceBufferRef.current = { text: '', updatedAt: 0 }
    resetUtteranceTiming(utteranceTimingRef.current)
  }, [])

  const scheduleProcess = useCallback(
    (text: string, opts?: ScheduleProcessOptions) => {
      const store = useAppStore.getState()
      if (store.voiceMode !== 'continuous' && !utteranceModeRef.current) return
      if (!text.trim() || !isMeaningfulTranscript(text)) return
      if (!isActionableTranscript(text)) return
      if (!shouldAcceptTranscript(opts?.manual)) return

      markUtteranceChunk(utteranceTimingRef.current)
      const combined = mergeUtteranceText(text)
      store.setTranscript(combined)

      if (opts?.manual) {
        if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current)
        const now = Date.now()
        const last = lastProcessedRef.current
        if (combined === last.text && now - last.at < DEDUP_MS) return
        clearUtteranceBuffer()
        void processText(combined, { manual: true })
        return
      }

      // 浏览器识别：等 final 结果或短延迟自动执行
      if (store.asrProvider === 'browser' && !opts?.isFinal && !opts?.speechEnded) {
        return
      }

      const timing = utteranceTimingRef.current
      const delayMs = opts?.isFinal || opts?.speechEnded
        ? Math.min(500, computeAdaptiveSilenceMs(combined, {
          hadMidPause: timing.hadMidPause,
          isFinal: true,
          speechEnded: opts?.speechEnded ?? false,
        }))
        : computeAdaptiveSilenceMs(combined, {
          hadMidPause: timing.hadMidPause,
          isFinal: opts?.isFinal ?? false,
          speechEnded: opts?.speechEnded ?? false,
        })

      if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = window.setTimeout(() => {
        const last = lastProcessedRef.current
        if (isDuplicateUtterance(combined, last.text, last.at, DEDUP_MS)) return
        clearUtteranceBuffer()
        void processText(combined)
      }, delayMs)
    },
    [processText, mergeUtteranceText, clearUtteranceBuffer, shouldAcceptTranscript],
  )

  const scheduleSpeechEnd = useCallback(() => {
    const text = getPendingUtteranceText()
    if (!text || !isMeaningfulTranscript(text)) return
    if (isDrawFragmentOnly(text)) return
    const last = lastProcessedRef.current
    if (isDuplicateUtterance(text, last.text, last.at, DEDUP_MS)) return
    scheduleProcess(text, { speechEnded: true })
  }, [scheduleProcess, getPendingUtteranceText])

  const handleInterimText = useCallback(
    (rawText: string) => {
      if (!isMeaningfulTranscript(rawText)) return
      const store = useAppStore.getState()
      const text = normalizeVoiceText(rawText)
      const combined = mergeUtteranceText(text)
      store.setTranscript(combined || rawText)

      const quick = matchImmediateVoiceCommand(text)
      if (quick) {
        if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current)
        clearUtteranceBuffer()
        void processText(text, { manual: true })
        return
      }

      // 只累积文本，等转写完成或断句后自动执行
      if (!shouldAcceptTranscript()) return
    },
    [processText, shouldAcceptTranscript, mergeUtteranceText, clearUtteranceBuffer],
  )

  const handleXfyunError = useCallback((message: string, product: 'iat' | 'ost') => {
    const store = useAppStore.getState()
    if (store.voiceStatus === 'speaking') return
    const isAuthError = /licc|未授权|无权限|10005|11200|11201/i.test(message)
    if (isAuthError && product === 'iat') {
      recorderRef.current?.stop()
      recorderRef.current = null
      xfyunProductRef.current = 'ost'
      store.setLastReply(`${message}。你的账号未开通流式听写，已自动改用极速录音转写`)
      store.setVoiceStatus('idle')
      if (store.voiceMode === 'continuous') {
        window.setTimeout(() => { void startContinuousRef.current() }, 600)
      }
      return
    }
    if (isAuthError) {
      recorderRef.current?.stop()
      recorderRef.current = null
      store.setAsrProvider('browser')
      store.setLastReply(`${message}。已自动切换为浏览器识别，可说「切换讯飞识别」重试`)
      store.setVoiceStatus('idle')
      if (store.voiceMode === 'continuous') {
        window.setTimeout(() => { void startContinuousRef.current() }, 600)
      }
      return
    }
    store.setLastReply(message)
  }, [])

  const startXfyunIat = useCallback(async () => {
    const store = useAppStore.getState()

    if (recorderRef.current?.isActive()) {
      const pipe = recorderRef.current
      if (!pipe.isConnected() && !pipe.isConnecting()) {
        pipe.resume()
      }
      store.setVoiceStatus('listening')
      return
    }

    recorderRef.current?.stop()
    recorderRef.current = null
    recognitionRef.current?.stop()
    recognitionRef.current = null
    store.setVoiceStatus('listening')

    try {
      const product = xfyunProductRef.current
      if (product === 'iat') {
        const session = new XfyunMicPipeline()
        recorderRef.current = session
        await session.start(
          (text) => handleInterimText(text),
          (text) => scheduleProcess(normalizeVoiceText(text), { isFinal: true }),
          (message) => handleXfyunError(message, product),
        )
      } else {
        const session = new XfyunOstPipeline()
        recorderRef.current = session
        await session.start(
          (text) => handleInterimText(text),
          () => scheduleSpeechEnd(),
          (message) => handleXfyunError(message, product),
        )
      }
    } catch (err) {
      recorderRef.current = null
      const msg = err instanceof Error ? err.message : '讯飞识别启动失败'
      if (/licc|未授权|无权限|10005|11200|11201/i.test(msg)) {
        store.setAsrProvider('browser')
        store.setLastReply(`${msg}。已自动切换为浏览器识别`)
        if (store.voiceMode === 'continuous') {
          window.setTimeout(() => { void startContinuousRef.current() }, 600)
        }
      } else {
        store.setLastReply(msg)
      }
      store.setVoiceStatus('idle')
    }
  }, [handleInterimText, scheduleProcess, scheduleSpeechEnd, handleXfyunError])

  const attachBrowserRecognition = useCallback(() => {
    const store = useAppStore.getState()
    if (!shouldKeepBrowserListening()) return

    browserIntentionalPauseRef.current = false

    if (recognitionRef.current) {
      const started = safeRecognitionStart(recognitionRef.current)
      if (started === 'started' || started === 'already') {
        browserRestartAttemptsRef.current = 0
        store.setVoiceStatus('listening')
        return
      }
      try { recognitionRef.current.abort() } catch { /* ignore */ }
      recognitionRef.current = null
    }

    const recognition = createRecognition(
      (text, isFinal, confidence) => {
        browserRestartAttemptsRef.current = 0
        if (!text) return
        if (!isConfidentSpeechResult(confidence, isFinal)) return
        store.setTranscript(text)
        const normalized = normalizeVoiceText(text)
        if (isFinal) {
          if (looksLikeCompleteCommand(normalized)) {
            scheduleProcess(normalized, { isFinal: true })
          }
        } else {
          handleInterimText(text)
        }
      },
      (error) => {
        if (error === 'aborted' || browserIntentionalPauseRef.current) return
        const hints: Record<string, string> = {
          'not-allowed': '麦克风权限被拒绝，请允许麦克风后说开始聆听',
          network: '浏览器识别需要网络，请检查连接或说切换讯飞识别',
          'audio-capture': '无法访问麦克风',
          'service-not-allowed': '浏览器禁止语音识别，请用 localhost 访问或切换讯飞识别',
        }
        if (error === 'no-speech') {
          scheduleBrowserReconnect(isEdgeBrowser() ? 450 : 300)
          return
        }
        const hint = hints[error] ?? (error.includes('需要') ? error : `语音识别错误: ${error}`)
        if (hint) store.setLastReply(hint)
        scheduleBrowserReconnect(800)
      },
      () => {
        if (browserIntentionalPauseRef.current || !shouldKeepBrowserListening()) return
        recognitionRef.current = null
        scheduleBrowserReconnect(isEdgeBrowser() ? 380 : 220)
      },
    )
    if (!recognition) return

    recognitionRef.current = recognition
    const started = safeRecognitionStart(recognition)
    if (started === 'started' || started === 'already') {
      browserRestartAttemptsRef.current = 0
      store.setVoiceStatus('listening')
      return
    }

    recognitionRef.current = null
    browserRestartAttemptsRef.current += 1
    const backoff = Math.min(4000, 400 + browserRestartAttemptsRef.current * 350)
    if (browserRestartAttemptsRef.current % 5 === 0) {
      store.setLastReply('浏览器识别会话已断开，正在自动重连…')
    }
    scheduleBrowserReconnect(backoff)
  }, [handleInterimText, scheduleBrowserReconnect, scheduleProcess, shouldKeepBrowserListening])

  attachBrowserRecognitionRef.current = attachBrowserRecognition

  const startContinuous = useCallback(async () => {
    const store = useAppStore.getState()
    if (!store.voiceEnabled) return
    if (['speaking', 'executing', 'optimizing'].includes(store.voiceStatus)) return

    const micError = await ensureMicrophoneAccess()
    if (micError) {
      store.setLastReply(micError)
      store.setVoiceStatus('awaiting_activation')
      return
    }

    // 识别引擎与管道不一致时先清理，确保切换生效
    if (store.asrProvider === 'xfyun') {
      recognitionRef.current?.abort()
      recognitionRef.current = null
      if (recorderRef.current?.isActive()) {
        const pipe = recorderRef.current
        if ('resumeAudioContext' in pipe) {
          void (pipe as XfyunMicPipeline).resumeAudioContext()
        }
        if (!pipe.isConnected() && !pipe.isConnecting()) {
          pipe.resume()
        }
        store.setVoiceStatus('listening')
        return
      }
      await startXfyunIat()
      return
    }

    recorderRef.current?.stop()
    recorderRef.current = null

    const unavailable = getBrowserSpeechUnavailableReason()
    if (unavailable) {
      store.setLastReply(unavailable)
      store.setVoiceStatus('idle')
      return
    }

    if (!isSpeechRecognitionSupported()) {
      store.setLastReply('浏览器识别不可用，请说切换讯飞识别')
      return
    }

    attachBrowserRecognition()
  }, [startXfyunIat, attachBrowserRecognition])

  const bootstrapVoice = useCallback(async () => {
    const store = useAppStore.getState()
    if (!store.voiceEnabled) return false

    try {
      const online = await checkHealth()
      store.setBackendOnline(online)
      if (online) {
        const config = await fetchConfig()
        if (!store.deepseekModeTouched) {
          store.setDeepseekMode(config.deepseek.default_mode)
        }
        // 按后端配置选择识别引擎，不再因「有密钥」就强制讯飞
        if (config.asr?.xfyun_product === 'iat' || config.asr?.xfyun_product === 'ost') {
          xfyunProductRef.current = config.asr.xfyun_product
        }
        if (!store.asrProviderTouched && config.asr?.default_provider) {
          store.setAsrProvider(config.asr.default_provider)
        }
      }
    } catch {
      /* 离线沿用默认 */
    }

    const micError = await ensureMicrophoneAccess()
    if (micError) {
      store.setVoiceStatus('awaiting_activation')
      store.setLastReply('语音系统初始化中，请说开始聆听')
      return false
    }

    if (!welcomedRef.current) {
      welcomedRef.current = true
      speak(WELCOME_MESSAGE, () => {
        window.setTimeout(() => { void startContinuous() }, 400)
      })
      window.setTimeout(() => {
        if (useAppStore.getState().voiceStatus !== 'listening') {
          void startContinuous()
        }
      }, 3000)
    } else {
      void startContinuous()
    }
    return true
  }, [startContinuous])

  useEffect(() => {
    startContinuousRef.current = () => { void startContinuous() }
    resumeListeningRef.current = () => { void resumeListening(true) }

    const onResume = () => { void resumeListening() }
    document.addEventListener('voicecanvas:resume', onResume)

    const activate = () => {
      const pipe = recorderRef.current
      if (pipe && 'resumeAudioContext' in pipe) {
        void (pipe as XfyunMicPipeline).resumeAudioContext()
      }
      if (useAppStore.getState().voiceStatus !== 'awaiting_activation') return
      void bootstrapVoice()
    }

    const onRestartListening = () => {
      useAppStore.getState().setVoiceEnabled(true)
      stopListening()
      window.setTimeout(() => { void startContinuous() }, 120)
    }

    const onVoiceToggleKey = (e: KeyboardEvent) => {
      if (e.key !== 'q' && e.key !== 'Q') return
      if (e.repeat) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return

      e.preventDefault()
      e.stopPropagation()

      const store = useAppStore.getState()

      if (store.voiceEnabled) {
        processBurstRef.current = { count: 0, windowStart: 0 }
        store.setVoiceEnabled(false)
        browserIntentionalPauseRef.current = true
        stopListening()
        store.setLastReply('语音已关闭，按 Q 开启')
        store.setVoiceStatus('idle')
        return
      }

      processBurstRef.current = { count: 0, windowStart: 0 }
      store.setVoiceEnabled(true)
      browserIntentionalPauseRef.current = false
      store.setLastReply('语音已开启，请说话')
      void bootstrapVoice()
    }

    const onAsrSwitch = (ev: Event) => {
      const provider = (ev as CustomEvent<{ provider: 'browser' | 'xfyun' }>).detail?.provider
      if (provider !== 'browser' && provider !== 'xfyun') return
      useAppStore.getState().setAsrProvider(provider, true)
      stopListening()
      window.setTimeout(() => { void startContinuous() }, 120)
      useAppStore.getState().setLastReply(
        provider === 'xfyun' ? '已切换讯飞识别' : '已切换浏览器识别',
      )
    }

    document.addEventListener('voicecanvas:restart-listening', onRestartListening)
    document.addEventListener('voicecanvas:asr-switch', onAsrSwitch)
    document.addEventListener('pointerdown', activate)
    document.addEventListener('keydown', activate)
    document.addEventListener('keydown', onVoiceToggleKey, true)

    const timer = window.setTimeout(() => {
      if (useAppStore.getState().voiceEnabled) void bootstrapVoice()
    }, 400)

    const watchdog = window.setInterval(() => {
      const s = useAppStore.getState()
      const now = Date.now()

      if (processingRef.current) {
        if (!processingStuckSinceRef.current) processingStuckSinceRef.current = now
        else if (now - processingStuckSinceRef.current > PROCESSING_STUCK_RECOVER_MS) {
          processingRef.current = false
          processingStuckSinceRef.current = 0
          speakingActiveRef.current = false
          ttsCooldownUntilRef.current = 0
          s.setLastReply('指令执行超时，已恢复聆听')
          s.setVoiceStatus('listening')
          ensureListeningActive()
        }
      } else {
        processingStuckSinceRef.current = 0
      }

      if (['speaking', 'executing', 'optimizing', 'transcribing'].includes(s.voiceStatus)) {
        if (!voiceStuckSinceRef.current) voiceStuckSinceRef.current = now
        else if (now - voiceStuckSinceRef.current > VOICE_STUCK_RECOVER_MS) {
          voiceStuckSinceRef.current = 0
          speakingActiveRef.current = false
          ttsCooldownUntilRef.current = 0
          processingRef.current = false
          s.setLastReply('语音状态卡住，已恢复聆听')
          s.setVoiceStatus('listening')
          ensureListeningActive()
        }
      } else {
        voiceStuckSinceRef.current = 0
      }

      if (!s.voiceEnabled) return
      if (s.voiceMode !== 'continuous') return
      if (s.voiceStatus === 'awaiting_activation') return
      if (['speaking', 'executing', 'optimizing', 'transcribing'].includes(s.voiceStatus)) return

      if (s.asrProvider === 'xfyun') {
        const pipe = recorderRef.current
        if (pipe && 'resetIfStuck' in pipe) {
          (pipe as XfyunOstPipeline).resetIfStuck()
        }
        if (!pipe?.isActive()) {
          void resumeListening(true)
        } else if (pipe.isPaused() || (!pipe.isConnected() && !pipe.isConnecting())) {
          pipe.resume()
          s.setVoiceStatus('listening')
        }
      } else if (
        s.asrProvider === 'browser'
        && (s.voiceStatus === 'idle' || (s.voiceStatus === 'listening' && !recognitionRef.current))
        && !browserRestartTimerRef.current
      ) {
        attachBrowserRecognitionRef.current?.()
      } else if (s.voiceStatus === 'idle' || (s.voiceStatus === 'listening' && !recognitionRef.current)) {
        void startContinuous()
      }
    }, 2000)

    const activationRetry = window.setInterval(() => {
      if (!useAppStore.getState().voiceEnabled) return
      if (useAppStore.getState().voiceStatus === 'awaiting_activation') {
        void bootstrapVoice()
      }
    }, 3000)

    return () => {
      window.clearTimeout(timer)
      window.clearInterval(watchdog)
      window.clearInterval(activationRetry)
      document.removeEventListener('voicecanvas:resume', onResume)
      document.removeEventListener('pointerdown', activate)
      document.removeEventListener('keydown', activate)
      document.removeEventListener('keydown', onVoiceToggleKey, true)
      document.removeEventListener('voicecanvas:restart-listening', onRestartListening)
      document.removeEventListener('voicecanvas:asr-switch', onAsrSwitch)
      stopListening()
    }
  }, [bootstrapVoice, resumeListening, startContinuous, stopListening])

  return { processText, startContinuous, stopListening, bootstrapVoice, isSupported: isSpeechRecognitionSupported() }
}
