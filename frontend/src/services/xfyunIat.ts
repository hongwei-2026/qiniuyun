import { fetchXfyunIatAuth } from './api'

type IatResult = {
  ws?: { cw?: { w?: string }[] }[]
  pgs?: string
  rg?: number[]
  sn?: number
}

const TARGET_SAMPLE_RATE = 16000
/** 每帧约 200ms @16kHz，讯飞推荐 40ms~200ms 一包 */
const CHUNK_SAMPLES_16K = 3200

export function isMeaningfulTranscript(text: string): boolean {
  const compact = text.replace(/[\s。，！？、.!?；;：:'"「」【】()（）,]/g, '')
  return compact.length >= 2
}

function extractWords(result: IatResult): string {
  return (result.ws ?? [])
    .map((w) => (w.cw ?? []).map((c) => c.w ?? '').join(''))
    .join('')
}

function downsampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (Math.abs(inputRate - TARGET_SAMPLE_RATE) < 1) return input
  const ratio = inputRate / TARGET_SAMPLE_RATE
  const outLen = Math.max(1, Math.floor(input.length / ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const idx = Math.floor(pos)
    const frac = pos - idx
    const s0 = input[idx] ?? 0
    const s1 = input[Math.min(idx + 1, input.length - 1)] ?? s0
    out[i] = s0 + (s1 - s0) * frac
  }
  return out
}

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

let workletModuleLoaded = false

function formatXfyunError(code: number | string | undefined, message: string): string {
  const msg = (message || '').trim()
  const lower = msg.toLowerCase()
  if (code === 10005 || code === 11201 || lower.includes('licc')) {
    return '讯飞听写未授权(licc)：当前账号未开通「语音听写·流式版」。若已开通极速录音转写，请将 XFYUN_ASR_PRODUCT 设为 ost'
  }
  if (code === 11200 || code === '11200' || lower.includes('no license')) {
    return '讯飞听写无权限：请检查是否开通服务或免费额度已用完'
  }
  if (code === 10165 || lower.includes('invalid handle')) {
    return '讯飞连接异常(invalid handle)，正在重连…'
  }
  return msg || `讯飞识别错误 ${code ?? ''}`.trim()
}

function isFatalXfyunAuthError(code: number | string | undefined, message: string): boolean {
  const lower = (message || '').toLowerCase()
  return code === 10005 || code === 11200 || code === '11200' || lower.includes('licc') || lower.includes('no license')
}

/**
 * 讯飞流式听写：麦克风流常驻，音频重采样到 16kHz 后发送。
 */
export class XfyunMicPipeline {
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private worklet: AudioWorkletNode | null = null
  private audioReady = false
  private pcmQueue = new Float32Array(0)
  private ws: WebSocket | null = null
  private segments: string[] = []
  private frameStatus = 0
  private paused = false
  private destroyed = false
  private rotating = false
  private rotateTimer: number | null = null
  private connectGen = 0
  private connectTask: Promise<void> | null = null
  private appId = ''
  private business: Record<string, unknown> = {}
  private onInterim: ((text: string) => void) | null = null
  private onFinal: ((text: string) => void) | null = null
  private onError: ((message: string) => void) | null = null
  private authFailed = false

  isActive(): boolean {
    return !this.destroyed && !!this.stream && this.audioReady
  }

  isConnected(): boolean {
    return !this.destroyed && this.ws?.readyState === WebSocket.OPEN
  }

  isConnecting(): boolean {
    return !this.destroyed && (!!this.connectTask || this.rotating)
  }

  isPaused(): boolean {
    return this.paused
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    if (this.destroyed) return
    this.paused = false
    this.segments = []
    this.frameStatus = 0
    void this.context?.resume()
    if (!this.isConnected() && !this.isConnecting() && !this.authFailed) {
      void this.connectWebSocket()
    }
  }

  async resumeAudioContext(): Promise<boolean> {
    if (!this.context) return false
    if (this.context.state === 'suspended') {
      await this.context.resume()
    }
    return this.context.state === 'running'
  }

  async start(
    onInterim: (text: string) => void,
    onFinal: (text: string) => void,
    onError: (message: string) => void,
  ): Promise<void> {
    this.destroyed = false
    this.paused = false
    this.authFailed = false
    this.onInterim = onInterim
    this.onFinal = onFinal
    this.onError = onError

    if (!this.stream || !this.stream.active) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          // 关闭浏览器音频处理，避免 PCM 失真导致讯飞只识别出标点
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
    }

    await this.setupAudioCapture()

    if (this.context?.state === 'suspended') {
      await this.context.resume()
    }

    await this.connectWebSocket()
  }

  private async setupAudioCapture(): Promise<void> {
    if (this.audioReady && this.context && this.source) return

    this.teardownAudioNodes()
    // 使用系统默认采样率，发送前重采样到 16kHz（浏览器常忽略 sampleRate:16000）
    this.context = new AudioContext()
    this.source = this.context.createMediaStreamSource(this.stream!)

    if (!workletModuleLoaded) {
      await this.context.audioWorklet.addModule('/xfyun-pcm-processor.js')
      workletModuleLoaded = true
    }

    this.worklet = new AudioWorkletNode(this.context, 'xfyun-pcm-processor')
    this.worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
      this.enqueuePcm(event.data)
    }

    const silent = this.context.createGain()
    silent.gain.value = 0
    this.source.connect(this.worklet)
    this.worklet.connect(silent)
    silent.connect(this.context.destination)
    this.pcmQueue = new Float32Array(0)
    this.audioReady = true
  }

  private teardownAudioNodes(): void {
    this.worklet?.port.close()
    this.worklet?.disconnect()
    this.source?.disconnect()
    this.worklet = null
    this.source = null
    this.pcmQueue = new Float32Array(0)
    this.audioReady = false
  }

  private enqueuePcm(samples: Float32Array): void {
    if (this.paused || this.destroyed) return
    const rate = this.context?.sampleRate ?? 48000
    const resampled = downsampleTo16k(samples, rate)

    const merged = new Float32Array(this.pcmQueue.length + resampled.length)
    merged.set(this.pcmQueue)
    merged.set(resampled, this.pcmQueue.length)
    this.pcmQueue = merged

    while (this.pcmQueue.length >= CHUNK_SAMPLES_16K) {
      const chunk = this.pcmQueue.slice(0, CHUNK_SAMPLES_16K)
      this.pcmQueue = this.pcmQueue.slice(CHUNK_SAMPLES_16K)
      this.sendPcmChunk(chunk)
    }
  }

  private sendPcmChunk(samples: Float32Array): void {
    if (this.paused || this.destroyed || this.rotating) return
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    const pcm = floatTo16BitPCM(samples)
    const audio = arrayBufferToBase64(pcm.buffer)
    const status = this.frameStatus
    if (status === 0) this.frameStatus = 1

    const frame: Record<string, unknown> = {
      data: {
        status,
        format: 'audio/L16;rate=16000',
        encoding: 'raw',
        audio,
      },
    }
    if (status === 0) {
      frame.common = { app_id: this.appId }
      frame.business = this.business
    }
    try {
      this.ws.send(JSON.stringify(frame))
    } catch {
      this.scheduleRotate(600)
    }
  }

  private connectWebSocket(): Promise<void> {
    if (this.destroyed) return Promise.resolve()
    if (this.connectTask) return this.connectTask

    this.connectTask = this.openWebSocket().finally(() => {
      this.connectTask = null
      this.rotating = false
    })
    return this.connectTask
  }

  private async openWebSocket(): Promise<void> {
    if (this.destroyed) return

    const gen = ++this.connectGen
    this.detachWebSocket()

    const auth = await fetchXfyunIatAuth()
    if (this.destroyed || gen !== this.connectGen) return

    this.appId = auth.app_id
    this.business = {
      language: auth.language || 'zh_cn',
      domain: 'iat',
      accent: auth.accent || 'mandarin',
      vad_eos: 2500,
      dwa: 'wpgs',
    }
    this.segments = []
    this.frameStatus = 0
    this.pcmQueue = new Float32Array(0)
    this.rotating = true

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(auth.url)
      this.ws = socket
      let settled = false

      const finish = (ok: boolean, err?: Error) => {
        if (settled || gen !== this.connectGen) return
        settled = true
        if (ok) resolve()
        else reject(err ?? new Error('讯飞连接失败'))
      }

      socket.onopen = () => {
        if (gen !== this.connectGen) return
        this.rotating = false
        finish(true)
      }

      socket.onerror = () => {
        if (gen !== this.connectGen) return
        this.onError?.('讯飞 WebSocket 连接失败')
        finish(false, new Error('讯飞 WebSocket 连接失败'))
      }

      socket.onclose = () => {
        if (gen !== this.connectGen) return
        this.ws = null
        if (!settled) {
          finish(false, new Error('讯飞连接意外关闭'))
          return
        }
        if (!this.destroyed && !this.paused) {
          this.scheduleRotate(500)
        }
      }

      socket.onmessage = (event) => {
        if (gen !== this.connectGen) return
        try {
          const payload = JSON.parse(String(event.data))
          if (payload.code !== 0) {
            const friendly = formatXfyunError(payload.code, payload.message || '')
            if (isFatalXfyunAuthError(payload.code, payload.message || '')) {
              this.authFailed = true
              this.detachWebSocket()
            } else if (payload.code === 10165 || String(payload.message || '').toLowerCase().includes('invalid handle')) {
              // 会话句柄失效：重置帧状态后重连，不要当作致命错误
              this.frameStatus = 0
              this.segments = []
              this.scheduleRotate(600)
            } else {
              this.scheduleRotate(800)
            }
            this.onError?.(friendly)
            return
          }
          const result = payload.data?.result as IatResult | undefined
          if (!result) return

          const piece = extractWords(result)
          if (result.pgs === 'rpl' && Array.isArray(result.rg) && result.rg.length === 2) {
            const [from, to] = result.rg
            this.segments.splice(from - 1, to - from + 1, piece)
          } else if (result.pgs === 'apd') {
            this.segments.push(piece)
          } else if (piece) {
            this.segments = [piece]
          }

          const text = this.segments.join('')
          if (text) this.onInterim?.(text)

          if (payload.data?.status === 2) {
            if (text.trim() && isMeaningfulTranscript(text)) {
              this.onFinal?.(text.trim())
            }
            this.segments = []
            // 同一条 WebSocket 上继续下一轮：下一包 PCM 会以 status=0 开新会话
            this.frameStatus = 0
          }
        } catch {
          this.onError?.('讯飞识别结果解析失败')
        }
      }
    })
  }

  private scheduleRotate(delayMs: number): void {
    if (this.destroyed || this.paused || this.connectTask || this.authFailed) return
    if (this.rotateTimer) return

    this.rotateTimer = window.setTimeout(() => {
      this.rotateTimer = null
      if (this.destroyed || this.paused) return
      void this.connectWebSocket().catch(() => {
        if (!this.destroyed && !this.paused) {
          window.setTimeout(() => this.scheduleRotate(1200), 0)
        }
      })
    }, delayMs)
  }

  private detachWebSocket(): void {
    if (this.rotateTimer) {
      window.clearTimeout(this.rotateTimer)
      this.rotateTimer = null
    }
    if (!this.ws) return
    const socket = this.ws
    this.ws = null
    socket.onopen = null
    socket.onmessage = null
    socket.onerror = null
    socket.onclose = null
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      try { socket.close() } catch { /* ignore */ }
    }
  }

  stop(): void {
    this.destroyed = true
    this.paused = false
    this.rotating = false
    this.connectGen++
    this.detachWebSocket()
    this.teardownAudioNodes()
    this.stream?.getTracks().forEach((t) => t.stop())
    void this.context?.close()
    this.stream = null
    this.context = null
    this.onInterim = null
    this.onFinal = null
    this.onError = null
  }
}

/** @deprecated 使用 XfyunMicPipeline */
export class XfyunIatSession extends XfyunMicPipeline {}
