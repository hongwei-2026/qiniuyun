import { transcribeAudio } from './api'

const TARGET_SAMPLE_RATE = 16000
/** 说完话后多久判定为「已结束」（用于极速转写 VAD） */
const QUIET_AFTER_SPEECH_MS = 700
/** 有语音活动才上传；窗口加长，减少句中停顿被切断 */
const WINDOW_MS = 9000
/** 最短有效音频（约 0.5s @16kHz） */
const MIN_SAMPLES = 8000
/** RMS 阈值：低于此视为静音，不请求转写 */
const SPEECH_RMS_THRESHOLD = 0.006

function mergeFloat32(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function measureRms(samples: Float32Array): number {
  if (!samples.length) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
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

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

let workletModuleLoaded = false

/**
 * 讯飞极速录音转写（OST）：检测到语音活动后才上传，避免静音刷接口。
 */
export class XfyunOstPipeline {
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private worklet: AudioWorkletNode | null = null
  private audioReady = false
  private chunks: Float32Array[] = []
  private windowTimer: number | null = null
  private transcribing = false
  private paused = false
  private destroyed = false
  private onInterim: ((text: string) => void) | null = null
  private onSpeechEnd: (() => void) | null = null
  private onError: ((message: string) => void) | null = null
  private lastSpeechAt = 0
  private quietTimer: number | null = null

  isActive(): boolean {
    return !this.destroyed && !!this.stream && this.audioReady
  }

  isConnected(): boolean {
    return this.isActive() && !this.paused
  }

  isConnecting(): boolean {
    return this.transcribing
  }

  isPaused(): boolean {
    return this.paused
  }

  pause(): void {
    this.paused = true
    this.clearWindowTimer()
    this.clearQuietTimer()
  }

  resume(): void {
    if (this.destroyed) return
    this.paused = false
    void this.context?.resume()
    this.scheduleWindow()
  }

  /** 浏览器策略：须用户点击后 resume，否则采不到音 */
  async resumeAudioContext(): Promise<boolean> {
    if (!this.context) return false
    if (this.context.state === 'suspended') {
      await this.context.resume()
    }
    return this.context.state === 'running'
  }

  async start(
    onInterim: (text: string) => void,
    onSpeechEnd: () => void,
    onError: (message: string) => void,
  ): Promise<void> {
    this.destroyed = false
    this.paused = false
    this.onInterim = onInterim
    this.onSpeechEnd = onSpeechEnd
    this.onError = onError

    if (!this.stream || !this.stream.active) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
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
    this.scheduleWindow()
  }

  private async setupAudioCapture(): Promise<void> {
    if (this.audioReady && this.context && this.source) return

    this.teardownAudioNodes()
    this.context = new AudioContext()
    this.source = this.context.createMediaStreamSource(this.stream!)

    if (!workletModuleLoaded) {
      await this.context.audioWorklet.addModule('/xfyun-pcm-processor.js')
      workletModuleLoaded = true
    }

    this.worklet = new AudioWorkletNode(this.context, 'xfyun-pcm-processor')
    this.worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (this.paused || this.destroyed) return
      this.chunks.push(event.data)
    }

    const silent = this.context.createGain()
    silent.gain.value = 0
    this.source.connect(this.worklet)
    this.worklet.connect(silent)
    silent.connect(this.context.destination)
    this.chunks = []
    this.audioReady = true
  }

  private teardownAudioNodes(): void {
    this.worklet?.port.close()
    this.worklet?.disconnect()
    this.source?.disconnect()
    this.worklet = null
    this.source = null
    this.chunks = []
    this.audioReady = false
  }

  private clearQuietTimer(): void {
    if (this.quietTimer) {
      window.clearTimeout(this.quietTimer)
      this.quietTimer = null
    }
  }

  /** 检测到语音后，静音一段时间则视为「本段说完了」 */
  private markSpeechActivity(): void {
    this.lastSpeechAt = Date.now()
    this.clearQuietTimer()
    this.quietTimer = window.setTimeout(() => {
      this.quietTimer = null
      if (!this.destroyed && !this.paused && Date.now() - this.lastSpeechAt >= QUIET_AFTER_SPEECH_MS - 50) {
        this.onSpeechEnd?.()
      }
    }, QUIET_AFTER_SPEECH_MS)
  }

  private clearWindowTimer(): void {
    if (this.windowTimer) {
      window.clearTimeout(this.windowTimer)
      this.windowTimer = null
    }
  }

  private scheduleWindow(): void {
    if (this.destroyed || this.paused || this.windowTimer) return
    this.windowTimer = window.setTimeout(() => {
      this.windowTimer = null
      void this.flushAndTranscribe().finally(() => {
        if (!this.destroyed && !this.paused) {
          this.scheduleWindow()
        }
      })
    }, WINDOW_MS)
  }

  private async flushAndTranscribe(): Promise<void> {
    if (this.destroyed || this.paused || this.transcribing) return

    const rate = this.context?.sampleRate ?? 48000
    const samples = downsampleTo16k(mergeFloat32(this.chunks), rate)
    this.chunks = []
    if (samples.length < MIN_SAMPLES) return
    const rms = measureRms(samples)
    if (rms < SPEECH_RMS_THRESHOLD) return

    this.markSpeechActivity()
    this.transcribing = true
    try {
      const blob = encodeWav(samples, TARGET_SAMPLE_RATE)
      const { text } = await transcribeAudio(blob)
      const trimmed = text.trim()
      if (trimmed) {
        this.onInterim?.(trimmed)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '讯飞转写失败'
      if (!/未识别到有效语音|20304|静音/.test(msg)) {
        this.onError?.(msg)
      }
    } finally {
      this.transcribing = false
    }
  }

  stop(): void {
    this.destroyed = true
    this.paused = false
    this.transcribing = false
    this.clearWindowTimer()
    this.clearQuietTimer()
    this.teardownAudioNodes()
    this.stream?.getTracks().forEach((t) => t.stop())
    void this.context?.close()
    this.stream = null
    this.context = null
    this.onInterim = null
    this.onSpeechEnd = null
    this.onError = null
  }
}
