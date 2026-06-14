import { normalizeVoiceText } from './voiceTextNormalize'

const FILLER_ONLY =
  /^(嗯+|啊+|呃+|哦+|唔+|哈+|嘿+|喂+|那个+|这个+|就是+|然后+|对对+|好好+|谢谢+|再见+)[。！？!?]*$/i

const AMBIENT_NOISE =
  /^(你?好|谢谢|再见|嗯嗯|啊啊|喂喂|在吗|听到了|测试|hello|hi|ok|okay)[。！？!?]*$/i

const DRAW_VERB = /画|绘制|绘|生成|做|弄|写|创建|加/

const SHAPE_FRAGMENT =
  /^(正方形|方形|方块|矩形|圆形|圆|三角|三角形|椭圆|五角星|星星?|心形|爱心)$/i

/** 仅有形状词、无「画/绘制」等动词 → 多半是转写碎片，不执行 */
export function isDrawFragmentOnly(text: string): boolean {
  const compact = normalizeVoiceText(text).replace(/[\s。，！？、.!?；;：:'"「」【】()（）,]/g, '')
  if (!compact) return false
  if (DRAW_VERB.test(compact)) return false
  if (SHAPE_FRAGMENT.test(compact)) return true
  if (compact.length <= 8 && /正方形|矩形|方块|圆形|椭圆|五角星/.test(compact)) return true
  return false
}

/** 与上一条指令相同或为其子串/超串 → 视为重复 */
export function isDuplicateUtterance(
  newText: string,
  lastText: string,
  lastAt: number,
  windowMs = 6000,
): boolean {
  if (!lastText || Date.now() - lastAt > windowMs) return false
  const a = normalizeVoiceText(newText).trim()
  const b = normalizeVoiceText(lastText).trim()
  if (!a || !b) return false
  if (a === b) return true
  if (a.includes(b) || b.includes(a)) return true
  return false
}

/** 识别结果是否像有效用户指令（过滤环境杂音、TTS 回声碎片） */
export function isActionableTranscript(text: string): boolean {
  const t = normalizeVoiceText(text).trim()
  if (!t) return false
  const compact = t.replace(/[\s。，！？、.!?；;：:'"「」【】()（）,]/g, '')
  if (compact.length < 2) return false
  if (FILLER_ONLY.test(compact)) return false
  if (compact.length <= 4 && AMBIENT_NOISE.test(compact)) return false
  // 极短且无中文的片段多为杂音
  if (compact.length <= 3 && !/[\u4e00-\u9fff]/.test(compact)) return false
  return true
}

export function isMeaningfulTranscript(text: string): boolean {
  const compact = text.replace(/[\s。，！？、.!?；;：:'"「」【】()（）,]/g, '')
  return compact.length >= 2 && isActionableTranscript(text)
}

/** Web Speech 置信度过低时丢弃（Chrome/Edge 支持） */
export function isConfidentSpeechResult(confidence: number | undefined, isFinal: boolean): boolean {
  if (confidence == null || Number.isNaN(confidence)) return true
  if (isFinal) return confidence >= 0.35
  return confidence >= 0.5
}
