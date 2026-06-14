/** 两次识别片段间隔超过此值，视为用户在句中停顿思考 */
export const PAUSE_GAP_MS = 1800

const SILENCE_FAST_MS = 1200
const SILENCE_FAST_MAX_MS = 2400
const SILENCE_SHORT_MS = 450
const SILENCE_SLOW_BASE_MS = 4800
const SILENCE_SLOW_PER_CHAR_MS = 85
const SILENCE_SLOW_MAX_MS = 14000
const SILENCE_FINAL_MS = 700
const SILENCE_FINAL_SHORT_MS = 280

const SHORT_ACK_RE =
  /^(欧克|ok|okay|好的|好|行|可以|是|对|嗯|收到|确认|继续|停止|算了|开始|帮助)$/i

/** 短句/确认语：不应按长句停顿逻辑等待 */
export function isShortUtterance(text: string): boolean {
  const t = text.trim().replace(/[。.!！?？，,、]+$/g, '')
  if (!t) return false
  if (SHORT_ACK_RE.test(t)) return true
  const compact = t.replace(/\s/g, '')
  return compact.length <= 6 && !looksLikeIncompleteCommand(t)
}

export type UtteranceTimingState = {
  lastChunkAt: number
  hadMidPause: boolean
}

export function createUtteranceTimingState(): UtteranceTimingState {
  return { lastChunkAt: 0, hadMidPause: false }
}

export function markUtteranceChunk(state: UtteranceTimingState, now = Date.now()): void {
  if (state.lastChunkAt && now - state.lastChunkAt > PAUSE_GAP_MS) {
    state.hadMidPause = true
  }
  state.lastChunkAt = now
}

export function resetUtteranceTiming(state: UtteranceTimingState): void {
  state.lastChunkAt = 0
  state.hadMidPause = false
}

/** 口语尚未说完（末尾像还要接着说） */
export function looksLikeIncompleteCommand(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (/[。！？!?]$/.test(t)) return false
  if (/[，,、；;：:]$/.test(t)) return true
  if (/(?:的|和|跟|及|以及|或|第|把|将|到|在|然后|接着|还有|以及|跟)$/.test(t)) return true
  if (/(?:打开|切换|进入|生成|重绘|删除|创建|画|说|设定|创作|绘制|打开|切换|局部)$/.test(t)) {
    return true
  }
  return false
}

export function looksLikeCompleteCommand(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (isShortUtterance(t)) return true
  if (/[。！？!?]$/.test(t)) return true
  const compact = t.replace(/\s/g, '')
  return compact.length >= 2 && !looksLikeIncompleteCommand(t)
}

export type SilenceDelayOptions = {
  hadMidPause: boolean
  isFinal: boolean
  speechEnded: boolean
}

/** 根据是否停顿、是否说完，计算执行前等待时间 */
export function computeAdaptiveSilenceMs(text: string, opts: SilenceDelayOptions): number {
  const t = text.trim()
  const len = t.length
  const short = isShortUtterance(t)
  const incomplete = looksLikeIncompleteCommand(text)
  const complete = looksLikeCompleteCommand(text)

  if (short) {
    if (opts.isFinal || opts.speechEnded) return SILENCE_FINAL_SHORT_MS
    return SILENCE_SHORT_MS
  }

  if (opts.isFinal) {
    return Math.min(SILENCE_FAST_MAX_MS, SILENCE_FINAL_MS + len * 15)
  }

  const slow = () =>
    Math.min(SILENCE_SLOW_MAX_MS, SILENCE_SLOW_BASE_MS + len * SILENCE_SLOW_PER_CHAR_MS)

  if (opts.hadMidPause && incomplete) {
    return slow()
  }

  if (opts.speechEnded && complete) {
    return Math.min(SILENCE_FAST_MAX_MS, SILENCE_FAST_MS + len * 20)
  }

  if (complete) {
    return Math.min(SILENCE_FAST_MAX_MS, 800 + len * 30)
  }

  if (opts.hadMidPause) {
    return slow()
  }

  return Math.min(2800, 1400 + len * 35)
}
