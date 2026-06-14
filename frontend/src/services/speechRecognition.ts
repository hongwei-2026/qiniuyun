type SpeechRecognitionCtor = new () => SpeechRecognitionInstance

export interface SpeechRecognitionInstance extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

interface SpeechRecognitionResultList {
  length: number
  [index: number]: { 0: { transcript: string }; isFinal: boolean; length: number }
}

interface SpeechRecognitionEvent {
  resultIndex: number
  results: SpeechRecognitionResultList
}

interface SpeechRecognitionErrorEvent {
  error: string
}

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function isSpeechRecognitionSupported(): boolean {
  return getRecognitionCtor() !== null
}

/** Web Speech API 仅 HTTPS 或 localhost 可用 */
export function isSecureSpeechContext(): boolean {
  if (typeof window === 'undefined') return false
  if (window.isSecureContext) return true
  const host = window.location.hostname
  return host === 'localhost' || host === '127.0.0.1'
}

export function getBrowserSpeechUnavailableReason(): string | null {
  if (!isSecureSpeechContext()) {
    return '浏览器语音识别需要 HTTPS 或 localhost，请用 http://localhost:5173 访问'
  }
  if (!isSpeechRecognitionSupported()) {
    return '当前浏览器不支持 Web Speech API，请用 Chrome/Edge 或说「切换讯飞识别」'
  }
  return null
}

export function safeRecognitionStart(recognition: SpeechRecognitionInstance): 'started' | 'already' | 'failed' {
  try {
    recognition.start()
    return 'started'
  } catch (err) {
    if (err instanceof DOMException && err.name === 'InvalidStateError') return 'already'
    return 'failed'
  }
}

export function isEdgeBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Edg\//.test(navigator.userAgent)
}

export function createRecognition(
  onResult: (text: string, isFinal: boolean, confidence?: number) => void,
  onError: (error: string) => void,
  onEnd?: () => void,
): SpeechRecognitionInstance | null {
  const unavailable = getBrowserSpeechUnavailableReason()
  if (unavailable) {
    onError(unavailable)
    return null
  }

  const Ctor = getRecognitionCtor()
  if (!Ctor) return null

  const recognition = new Ctor()
  recognition.lang = 'zh-CN'
  recognition.continuous = true
  recognition.interimResults = true

  recognition.onresult = (event) => {
    let transcript = ''
    let isFinal = false
    let confidence: number | undefined
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const alt = event.results[i][0]
      const piece = alt?.transcript ?? ''
      transcript += piece
      if (event.results[i].isFinal) isFinal = true
      const c = (alt as { confidence?: number } | undefined)?.confidence
      if (c != null) confidence = Math.max(confidence ?? 0, c)
    }
    const text = transcript.trim()
    if (text) onResult(text, isFinal, confidence)
  }

  recognition.onerror = (event) => onError(event.error)
  recognition.onend = () => onEnd?.()
  return recognition
}
