export type CanvasMode = 'free' | 'ai' | 'grid' | '3d' | 'assets' | 'comic'
export type VoiceMode = 'continuous' | 'push_to_talk'
export type DeepSeekMode = 'v4-pro' | 'flash' | 'chat' | 'auto'
export type ImageProvider = 'minimax' | 'doubao'
export type AsrProvider = 'browser' | 'xfyun'
export type VoiceStatus =
  | 'idle'
  | 'awaiting_activation'
  | 'listening'
  | 'transcribing'
  | 'optimizing'
  | 'executing'
  | 'speaking'

export interface ToolCall {
  name: string
  arguments: Record<string, unknown>
}

export interface Point2D {
  x: number
  y: number
}

export interface BBox {
  left: number
  top: number
  width: number
  height: number
}

export interface SceneObject {
  id: string
  type: string
  label: string
  color?: string
  center: Point2D
  bbox: BBox
  radius?: number
  selected?: boolean
}

export interface SceneGraph {
  canvas: { width: number; height: number }
  objects: SceneObject[]
}

export interface CanvasContext {
  canvas_mode: CanvasMode
  zoom: number
  selected_cell: string | null
  grid_cells: string[]
  scene_graph?: SceneGraph
  objects_summary: string
  recent_commands: string[]
  model3d_status?: string | null
}

export interface ExecutionResultItem {
  tool: string
  success: boolean
  message: string
  object_id?: string
  center?: Point2D
  bbox?: BBox
}

export interface IntentParseResponse {
  optimized_text: string
  image_prompt?: string | null
  track: 'system' | 'ai'
  intent: string
  tools: ToolCall[]
  reply: string
  model_used?: string
}

export interface VerifyIntentResponse {
  ok: boolean
  reply: string
  correction_tools: ToolCall[]
  reason?: string
  model_used?: string
}

export interface GridCell {
  id: string
  row: number
  col: number
  imageData?: string
  prompt?: string
  status: 'empty' | 'filled' | 'generating' | 'error'
}

export interface Model3DState {
  taskId: string | null
  status: string
  modelUrl: string | null
  fileFormat: string
  message: string
  loading: boolean
}

export interface AppConfig {
  deepseek: {
    configured: boolean
    default_mode: DeepSeekMode
    modes: { id: DeepSeekMode; label: string; model: string }[]
  }
  image: {
    default_provider: ImageProvider
    providers: { id: ImageProvider; label: string; configured: boolean }[]
  }
  model3d?: {
    configured: boolean
    provider: string
    model: string
  }
  asr?: {
    default_provider: AsrProvider
    xfyun_product?: 'ost' | 'iat'
    providers: { id: AsrProvider; label: string; configured: boolean }[]
  }
}

export interface Model3DResponse {
  task_id: string
  status: string
  model_url: string | null
  file_format: string
  message: string
}

export interface ComicProjectSettings {
  visualStyle: string
  storyBackground: string
}

export interface ComicDetailState {
  kind: 'character' | 'episode' | 'story' | 'characters_all' | 'episodes_all'
  characterId?: string
  episodeId?: string
}

export interface CharacterAsset {
  id: string
  name: string
  description: string
  personality: string
  catchphrase?: string
  sampleDialogues?: string[]
  style: string
  imageData?: string
  imagePrompt?: string
  createdAt: number
}

export interface EpisodeAsset {
  id: string
  episodeNumber: number
  title: string
  synopsis: string
  script: string
  style: string
  characterIds: string[]
  panels?: ComicPanel[]
  layoutStartRow?: number
  layoutRows?: number
  createdAt: number
}

export interface ComicPanel {
  index: number
  caption: string
  scene: string
  dialogue: string
  characters: string[]
  isTitlePage: boolean
  cellId?: string
  pageNumber?: number
  layout?: 'title_spread' | 'half' | 'full'
  imageData?: string
  status?: 'empty' | 'filled' | 'generating' | 'error'
}

export interface ComicCharacterResponse {
  name: string
  description: string
  personality: string
  catchphrase?: string
  sample_dialogues?: string[]
  style: string
  image_prompt: string
}

export interface ComicEpisodeResponse {
  title: string
  synopsis: string
  script: string
  panels: Array<{
    index: number
    caption: string
    scene: string
    dialogue: string
    characters: string[]
    is_title_page: boolean
  }>
}
