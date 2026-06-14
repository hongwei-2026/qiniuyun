const REPLACEMENTS: [RegExp, string][] = [
  [/九官格|九宫阁|9宫格/g, '九宫格'],
  [/元形|园形|圆型/g, '圆形'],
  [/矩型|举形/g, '矩形'],
  [/生途|深图/g, '生图'],
  [/撤销/g, '撤销'],
  [/3\s*[dD]|三\s*维/g, '3D'],
  [/mini\s*max/gi, 'MiniMax'],
  [/豆\s*包/g, '豆包'],
  [/画\s*一个\s*元/g, '画一个圆'],
  [/会向/g, '像素'],
  [/像素向/g, '像素'],
  [/每个各|每各格/g, '每个格'],
  [/不同叫度|不同角渡/g, '不同角度'],
  [/改成\s*兰色/g, '改成蓝色'],
  [/实心\s*元/g, '实心圆'],
]

export function normalizeVoiceText(text: string): string {
  let result = text.trim()
  for (const [pattern, replacement] of REPLACEMENTS) {
    result = result.replace(pattern, replacement)
  }
  // 讯飞常见误识别：0.1 → 0,1；-1.1 保留负坐标
  result = result
    .replace(/(-?\d+)\s*[.。．·]\s*(-?\d+)/g, '$1,$2')
    .replace(/指令人册|指令人册|纸质手册|指令手策|指领手册/g, '指令手册')
    .replace(/打开指领/g, '打开指令')
    .replace(/^划/, '画')
  return result
}

/** 去掉标点与空白，便于语音指令模糊匹配 */
export function compactVoiceText(text: string): string {
  return text
    .trim()
    .replace(/[\s。，！？、.!?；;：:'"「」【】()（）]/g, '')
}
