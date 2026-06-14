import { transcribeAudio } from './api'
import { loadXfyunPcmWorklet } from './xfyunWorklet'

const TARGET_SAMPLE_RATE = 16000
/** 说完话后静音多久再转写 */
const QUIET_AFTER_SPEECH_MS = 500
/** 两次转写 API 最短间隔 */
const MIN_FLUSH_INTERVAL_MS = 600
/** 转写开始后短暂回声抑制（仅影响触发新一段，不阻断采音） */
const ECHO_GUARD_MS = 350
/** 句首预录回溯时长 */
const PREROLL_TAIL_MS = 450
/** 单次上传最长有效语音（秒） */
const MAX_TRANSCRIBE_SECONDS = 7
/** 与后端 max_wait 对齐 */
const TRANSCRIBE_TIMEOUT_MS = 48000
/** 转写卡住后强制恢复 */
const TRANSCRIBE_STUCK_MS = 50000
/** 最短有效音频（约 0.4s @16kHz） */
const MIN_SAMPLES = 6400
/** RMS 阈值 */
const SPEECH_RMS_THRESHOLD = 0.014

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

/**
 * 讯飞极速录音转写（OST）：采音与上传转写解耦，转写进行中仍可说下一句。
 */
export class XfyunOstPipeline {
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private worklet: AudioWorkletNode | null = null
  private audioReady = false
  private chunks: Float32Array[] = []
  private transcribing = false
  private transcribeStartedAt = 0
  private pendingTranscribes = 0
  private transcribeChain: Promise<void> = Promise.resolve()
  private paused = false
  private destroyed = false
  private onInterim: ((text: string) => void) | null = null
  private onSpeechEnd: (() => void) | null = null
  private onError: ((message: string) => void) | null = null
  private quietTimer: number | null = null
  private echoGuardUntil = 0
  private lastFlushAt = 0
  private preRollChunks: Float32Array[] = []
  private preRollSamples = 0
  private speechActive = false

  isActive(): boolean {
    return !this.destroyed && !!this.stream && this.audioReady
  }

  isConnected(): boolean {
    return this.isActive() && !this.paused
  }

  isConnecting(): boolean {
    return this.pendingTranscribes > 0
  }

  resetIfStuck(): boolean {
    if (this.pendingTranscribes === 0) return false
    if (Date.now() - this.transcribeStartedAt < TRANSCRIBE_STUCK_MS) return false
    this.pendingTranscribes = 0
    this.transcribing = false
    this.transcribeChain = Promise.resolve()
    return true
  }

  isPaused(): boolean {
    return this.paused
  }

  pause(): void {
    this.paused = true
    this.clearQuietTimer()
  }

  resume(): void {
    if (this.destroyed) return
    this.paused = false
    void this.context?.resume()
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
    onSpeechEnd: () => void,
    onError: (message: string) => void,
  ): Promise<void> {
    this.destroyed = false
    this.paused = false
    this.echoGuardUntil = 0
    this.lastFlushAt = 0
    this.pendingTranscribes = 0
    this.transcribeChain = Promise.resolve()
    this.onInterim = onInterim
    this.onSpeechEnd = onSpeechEnd
    this.onError = onError

    if (!this.stream || !this.stream.active) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
    }

    await this.setupAudioCapture()
    if (this.context?.state === 'suspended') {
      await this.context.resume()
    }
  }

  private async setupAudioCapture(): Promise<void> {
    if (this.audioReady && this.context && this.source) return

    this.teardownAudioNodes()
    this.context = new AudioContext()
    this.source = this.context.createMediaStreamSource(this.stream!)

    await loadXfyunPcmWorklet(this.context)

    this.worklet = new AudioWorkletNode(this.context, 'xfyun-pcm-processor')
    this.worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (this.paused || this.destroyed) return
      const chunk = event.data
      const sampleRate = this.context?.sampleRate ?? 48000
      const maxPreRollSamples = Math.floor(sampleRate * PREROLL_TAIL_MS / 1000)

      this.preRollChunks.push(chunk)
      this.preRollSamples += chunk.length
      while (this.preRollSamples > maxPreRollSamples && this.preRollChunks.length) {
        const dropped = this.preRollChunks.shift()!
        this.preRollSamples -= dropped.length
      }

      const loud = measureRms(chunk) >= SPEECH_RMS_THRESHOLD
      if (loud) {
        if (!this.speechActive) {
          this.speechActive = true
          this.chunks.push(...this.preRollChunks)
        } else {
          this.chunks.push(chunk)
        }
        this.markSpeechActivity()
      } else if (this.speechActive) {
        this.chunks.push(chunk)
      }
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

  private markSpeechActivity(): void {
    if (Date.now() < this.echoGuardUntil) return
    this.clearQuietTimer()
    this.quietTimer = window.setTimeout(() => {
      this.quietTimer = null
      if (this.destroyed || this.paused) return
      void this.flushAndTranscribe()
    }, QUIET_AFTER_SPEECH_MS)
  }

  private enqueueTranscribe(samples: Float32Array): void {
    this.pendingTranscribes += 1
    this.transcribing = true
    this.transcribeStartedAt = Date.now()
    this.transcribeChain = this.transcribeChain
      .then(() => this.runTranscribe(samples))
      .catch(() => {})
      .finally(() => {
        this.pendingTranscribes = Math.max(0, this.pendingTranscribes - 1)
        this.transcribing = this.pendingTranscribes > 0
      })
  }

  private async runTranscribe(samples: Float32Array): Promise<void> {
    try {
      const blob = encodeWav(samples, TARGET_SAMPLE_RATE)
      const res = await Promise.race([
        transcribeAudio(blob),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error('转写超时')), TRANSCRIBE_TIMEOUT_MS)
        }),
      ])
      const text = res.text.trim()
      if (text) {
        this.onInterim?.(text)
      }
      this.onSpeechEnd?.()
    } catch (err) {
      const msg = err instanceof Error ? err.message : '讯飞转写失败'
      if (/转写超时|timeout/i.test(msg)) {
        this.onSpeechEnd?.()
        return
      }
      if (!/未识别到有效语音|20304|静音/.test(msg)) {
        this.onError?.(msg)
      }
    }
  }

  private flushAndTranscribe(): void {
    if (this.destroyed || this.paused) return
    const now = Date.now()
    if (now - this.lastFlushAt < MIN_FLUSH_INTERVAL_MS) return
    if (!this.chunks.length) return

    const rate = this.context?.sampleRate ?? 48000
    let samples = downsampleTo16k(mergeFloat32(this.chunks), rate)
    this.chunks = []
    this.speechActive = false

    const maxSamples = TARGET_SAMPLE_RATE * MAX_TRANSCRIBE_SECONDS
    if (samples.length > maxSamples) {
      samples = samples.subarray(samples.length - maxSamples)
    }
    if (samples.length < MIN_SAMPLES) return
    if (measureRms(samples) < SPEECH_RMS_THRESHOLD) return

    this.lastFlushAt = now
    this.echoGuardUntil = now + ECHO_GUARD_MS
    this.enqueueTranscribe(samples)
  }

  stop(): void {
    this.destroyed = true
    this.paused = false
    this.transcribing = false
    this.pendingTranscribes = 0
    this.transcribeStartedAt = 0
    this.transcribeChain = Promise.resolve()
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
