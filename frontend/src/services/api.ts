import axios from 'axios'
import type {
  AppConfig,
  CanvasContext,
  DeepSeekMode,
  ExecutionResultItem,
  ImageProvider,
  IntentParseResponse,
  Model3DResponse,
  ToolCall,
  VerifyIntentResponse,
} from '../types'

const client = axios.create({ baseURL: '/' })

export async function fetchXfyunIatAuth(): Promise<{
  url: string
  app_id: string
  language: string
  accent: string
}> {
  const { data } = await client.get('/api/v1/voice/iat-auth')
  return data
}

export async function fetchConfig(): Promise<AppConfig> {
  const { data } = await client.get<AppConfig>('/api/v1/config/')
  return data
}

export async function verifyIntent(
  text: string,
  context: CanvasContext,
  plannedTools: ToolCall[],
  executionResults: ExecutionResultItem[],
  mode?: DeepSeekMode,
): Promise<VerifyIntentResponse> {
  const { model3d_status: _omit, ...apiContext } = context
  const { data } = await client.post<VerifyIntentResponse>('/api/v1/intent/verify', {
    text,
    context: apiContext,
    planned_tools: plannedTools,
    execution_results: executionResults,
    mode: mode === 'auto' ? undefined : mode,
  })
  return data
}

export async function parseIntent(
  text: string,
  context: CanvasContext,
  mode?: DeepSeekMode,
): Promise<IntentParseResponse> {
  const { model3d_status: _omit, ...apiContext } = context
  try {
    const { data } = await client.post<IntentParseResponse>('/api/v1/intent/parse', {
      text,
      context: apiContext,
      mode: mode === 'auto' ? undefined : mode,
    })
    return data
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const detail = err.response?.data?.detail
      if (typeof detail === 'string') throw new Error(detail)
      if (Array.isArray(detail)) {
        const msg = detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join('；')
        if (msg) throw new Error(msg)
      }
      if (err.response?.status === 502 || err.code === 'ERR_NETWORK') {
        throw new Error('后端未启动，请在 backend 目录运行 uvicorn app.main:app --reload --port 8000')
      }
      throw new Error('意图解析失败，请检查后端与 DEEPSEEK_API_KEY')
    }
    throw err
  }
}

export async function generateImage(params: {
  prompt: string
  aspect_ratio?: string
  provider: ImageProvider
  size?: string
  reference_image_base64?: string
}): Promise<{ images: string[]; format: 'base64' | 'url'; provider: string }> {
  try {
    const { data } = await client.post('/api/v1/image/generate', {
      ...params,
      provider: params.provider,
    })
    return data
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const detail = err.response?.data?.detail
      throw new Error(typeof detail === 'string' ? detail : '图片生成失败')
    }
    throw err
  }
}

export async function generateModel3D(params: {
  image_url?: string
  image_base64?: string
  prompt?: string
  file_format?: string
  subdivision_level?: string
  wait?: boolean
}): Promise<Model3DResponse> {
  const { data } = await client.post<Model3DResponse>('/api/v1/model3d/generate', {
    wait: true,
    ...params,
  })
  return data
}

export async function getModel3DTask(taskId: string): Promise<Model3DResponse> {
  const { data } = await client.get<Model3DResponse>(`/api/v1/model3d/tasks/${taskId}`)
  return data
}

export async function transcribeAudio(
  blob: Blob,
  filename = 'utterance.wav',
): Promise<{ text: string; provider: string }> {
  const form = new FormData()
  form.append('file', blob, filename)
  try {
    const { data } = await client.post('/api/v1/voice/transcribe', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 50000,
    })
    return data
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const detail = err.response?.data?.detail
      throw new Error(typeof detail === 'string' ? detail : '讯飞转写请求失败')
    }
    throw err
  }
}

export async function checkHealth(): Promise<boolean> {
  try {
    await client.get('/health')
    return true
  } catch {
    return false
  }
}

export async function generateComicCharacter(params: {
  description: string
  style?: string
  existing_name?: string
}): Promise<import('../types').ComicCharacterResponse> {
  const { data } = await client.post('/api/v1/comic/character', params)
  return data
}

export async function generateComicEpisodeScript(params: {
  episode_number: number
  synopsis?: string
  characters?: Array<{ name: string; description: string; personality: string }>
  previous_episodes?: Array<{ episode_number: number; title: string; synopsis: string; script: string }>
  style?: string
}): Promise<import('../types').ComicEpisodeResponse> {
  const { data } = await client.post('/api/v1/comic/episode-script', params)
  return data
}

export async function reviseComicEpisodeScript(params: {
  episode_number: number
  revision: string
  current_title: string
  current_synopsis: string
  current_script: string
  characters?: Array<{ name: string; description: string; personality: string }>
  previous_episodes?: Array<{ episode_number: number; title: string; synopsis: string }>
  style?: string
}): Promise<import('../types').ComicEpisodeResponse> {
  const { data } = await client.post('/api/v1/comic/episode-revise', params)
  return data
}
