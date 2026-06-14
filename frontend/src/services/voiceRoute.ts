import { isContextualVoiceCommand, isMultiCommand } from './voiceCommands'
import type { DeepSeekMode } from '../types'

/** 复杂空间/多步/口语化指令 → 自动升级 v4-pro */
export function isComplexCommand(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (isContextualVoiceCommand(t)) return true
  if (isMultiCommand(t)) return true
  if (t.length > 36) return true
  if (/帮我|请|想要|需要|可以|能不能|我想|麻烦|希望|然后|接着|同时/.test(t)) return true
  if (/指向|对准|朝向|画布.*(角|边|右上|左上|右下|左下)/.test(t)) return true
  return false
}

/** 解析实际使用的 DeepSeek 模式：auto 时复杂走 pro，常规走 flash */
export function resolveDeepSeekMode(text: string, preference: DeepSeekMode): DeepSeekMode {
  if (preference === 'v4-pro' || preference === 'flash' || preference === 'chat') {
    return preference
  }
  return isComplexCommand(text) ? 'v4-pro' : 'flash'
}

/** 仅保留系统级本地指令（手册/聆听/模式切换），绘图全部走 LLM */
export function isSystemOnlyCommand(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (/手册|指领/.test(t) && !/画|绘制|生成/.test(t)) return true
  if (/帮助|怎么用|使用说明|指令帮助/.test(t)) return true
  if (/开始聆听|停止聆听|启动语音|暂停聆听|开始说话/.test(t)) return true
  if (/切换.*(flash|快速|v4|pro|深度|对话|chat|讯飞|浏览器|minimax|豆包|AI|自由|九宫格|漫画|3d)/i.test(t)) {
    return true
  }
  if (/AI创作|进入.*AI|开启.*AI|奇幻.*AI/i.test(t) && !/画|绘制/.test(t)) return true
  if (/打开画布|显示画布/.test(t)) return true
  return false
}
