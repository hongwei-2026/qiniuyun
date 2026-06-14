import { create } from 'zustand'
import { panToCenterCell } from '../engines/gridEngine'
import type {
  AsrProvider,
  CanvasMode,
  ComicDetailState,
  DeepSeekMode,
  GridCell,
  ImageProvider,
  Model3DState,
  VoiceMode,
  VoiceStatus,
} from '../types'

interface AppStore {
  canvasMode: CanvasMode
  voiceMode: VoiceMode
  voiceStatus: VoiceStatus
  deepseekMode: DeepSeekMode
  deepseekModeTouched: boolean
  imageProvider: ImageProvider
  asrProvider: AsrProvider
  asrProviderTouched: boolean
  transcript: string
  lastReply: string
  recentCommands: string[]
  gridCells: Record<string, GridCell>
  selectedCellId: string | null
  cellSize: number
  backendOnline: boolean
  model3d: Model3DState
  lastAiPrompt: string
  lastAiAspect: string
  lastAiImageDataUrl: string
  aiGenerating: boolean
  aiGeneratingMessage: string
  commandManualOpen: boolean
  gridPanX: number
  gridPanY: number
  comicDetail: ComicDetailState | null
  setCommandManualOpen: (open: boolean) => void
  setAiGenerating: (loading: boolean, message?: string) => void
  setCanvasMode: (mode: CanvasMode) => void
  setVoiceMode: (mode: VoiceMode) => void
  setVoiceStatus: (status: VoiceStatus) => void
  setDeepseekMode: (mode: DeepSeekMode, fromUser?: boolean) => void
  setImageProvider: (provider: ImageProvider) => void
  setAsrProvider: (provider: AsrProvider, fromUser?: boolean) => void
  setTranscript: (text: string) => void
  setLastReply: (text: string) => void
  addCommand: (cmd: string) => void
  setGridCells: (cells: Record<string, GridCell>) => void
  upsertCell: (cell: GridCell) => void
  setSelectedCellId: (id: string | null) => void
  panGridView: (dx: number, dy: number) => void
  setGridPan: (x: number, y: number) => void
  resetGridView: () => void
  focusGridCell: (cellId: string) => void
  setBackendOnline: (online: boolean) => void
  setModel3d: (patch: Partial<Model3DState>) => void
  setLastAiPrompt: (prompt: string, aspect?: string) => void
  setLastAiImageDataUrl: (dataUrl: string) => void
  setComicDetail: (detail: ComicDetailState | null) => void
}

const defaultModel3d: Model3DState = {
  taskId: null,
  status: 'idle',
  modelUrl: null,
  fileFormat: 'obj',
  message: '',
  loading: false,
}

export const useAppStore = create<AppStore>((set) => ({
  canvasMode: 'free',
  voiceMode: 'continuous',
  voiceStatus: 'idle',
  deepseekMode: 'auto',
  deepseekModeTouched: false,
  imageProvider: 'minimax',
  asrProvider: 'xfyun',
  asrProviderTouched: false,
  transcript: '',
  lastReply: '',
  recentCommands: [],
  gridCells: {},
  selectedCellId: null,
  cellSize: 200,
  gridPanX: 0,
  gridPanY: 0,
  backendOnline: false,
  model3d: defaultModel3d,
  lastAiPrompt: '',
  lastAiAspect: '1:1',
  lastAiImageDataUrl: '',
  aiGenerating: false,
  aiGeneratingMessage: '',
  commandManualOpen: false,
  comicDetail: null,
  setCanvasMode: (canvasMode) => set({ canvasMode }),
  setVoiceMode: (voiceMode) => set({ voiceMode }),
  setVoiceStatus: (voiceStatus) => set({ voiceStatus }),
  setDeepseekMode: (deepseekMode, fromUser = false) =>
    set((s) => ({
      deepseekMode,
      deepseekModeTouched: fromUser ? true : s.deepseekModeTouched,
    })),
  setImageProvider: (imageProvider) => set({ imageProvider }),
  setAsrProvider: (asrProvider, fromUser = false) =>
    set((s) => ({
      asrProvider,
      asrProviderTouched: fromUser ? true : s.asrProviderTouched,
    })),
  setTranscript: (transcript) => set({ transcript }),
  setLastReply: (lastReply) => set({ lastReply }),
  addCommand: (cmd) =>
    set((s) => ({ recentCommands: [...s.recentCommands.slice(-9), cmd] })),
  setGridCells: (gridCells) => set({ gridCells }),
  upsertCell: (cell) =>
    set((s) => ({ gridCells: { ...s.gridCells, [cell.id]: cell } })),
  setSelectedCellId: (selectedCellId) => set({ selectedCellId }),
  panGridView: (dx, dy) =>
    set((s) => ({ gridPanX: s.gridPanX + dx, gridPanY: s.gridPanY + dy })),
  setGridPan: (x, y) => set({ gridPanX: x, gridPanY: y }),
  resetGridView: () => set({ gridPanX: 0, gridPanY: 0 }),
  focusGridCell: (cellId) =>
    set((s) => {
      const pan = panToCenterCell(cellId, s.gridCells, s.cellSize)
      return { gridPanX: pan.x, gridPanY: pan.y, selectedCellId: cellId }
    }),
  setBackendOnline: (backendOnline) => set({ backendOnline }),
  setModel3d: (patch) =>
    set((s) => ({ model3d: { ...s.model3d, ...patch } })),
  setLastAiPrompt: (lastAiPrompt, aspect) =>
    set((s) => ({
      lastAiPrompt,
      lastAiAspect: aspect ?? s.lastAiAspect,
    })),
  setLastAiImageDataUrl: (lastAiImageDataUrl) => set({ lastAiImageDataUrl }),
  setAiGenerating: (aiGenerating, message = '') =>
    set({ aiGenerating, aiGeneratingMessage: message }),
  setCommandManualOpen: (commandManualOpen) => set({ commandManualOpen }),
  setComicDetail: (comicDetail) => set({ comicDetail }),
}))
