const SYSTEM_COMMANDS: Record<string, RegExp> = {
  undo: /撤销|上一步/,
  redo: /重做|下一步/,
  clear: /清空(画布)?/,
  zoom_in: /放大|拉近/,
  zoom_out: /缩小|拉远/,
  fit: /适应窗口|全部显示/,
  reset_view: /重置视图|回到中心/,
}

export function matchSystemCommand(text: string): string | null {
  const normalized = text.trim()
  for (const [cmd, pattern] of Object.entries(SYSTEM_COMMANDS)) {
    if (pattern.test(normalized)) return cmd
  }
  return null
}

export function speak(text: string, onEnd?: () => void) {
  if (!('speechSynthesis' in window)) {
    onEnd?.()
    return
  }
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'zh-CN'
  utterance.rate = 1.05
  utterance.onend = () => onEnd?.()
  utterance.onerror = () => onEnd?.()
  window.speechSynthesis.speak(utterance)
}

export async function ensureMicrophoneAccess(): Promise<string | null> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return '当前浏览器不支持麦克风'
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop())
    return null
  } catch (err) {
    const name = err instanceof DOMException ? err.name : ''
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return '麦克风权限被拒绝，请说开始聆听重试'
    }
    if (name === 'NotFoundError') {
      return '未检测到麦克风设备'
    }
    return '麦克风启动失败，请检查系统设置'
  }
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}
