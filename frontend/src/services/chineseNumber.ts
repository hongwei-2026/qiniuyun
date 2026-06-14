const CN_DIGIT: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9,
}

/** 解析中文或阿拉伯数字（支持 二、十二、21） */
export function parseChineseNumber(raw: string): number | null {
  const s = raw.trim()
  if (!s) return null
  if (/^\d+$/.test(s)) return Number(s)
  if (CN_DIGIT[s] != null) return CN_DIGIT[s]
  if (s === '十') return 10
  if (s.startsWith('十')) return 10 + (CN_DIGIT[s.slice(1)] ?? 0)
  if (s.endsWith('十')) return (CN_DIGIT[s.slice(0, -1)] ?? 0) * 10
  const tenIdx = s.indexOf('十')
  if (tenIdx > 0) {
    const hi = CN_DIGIT[s.slice(0, tenIdx)] ?? 0
    const lo = CN_DIGIT[s.slice(tenIdx + 1)] ?? 0
    return hi * 10 + lo
  }
  return null
}

export function parseEpisodeNumbersFromText(text: string): number[] {
  const nums = new Set<number>()
  const re = /第\s*(\d+|[一二三四五六七八九十两〇零]+)\s*集/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const n = parseChineseNumber(m[1])
    if (n != null && n > 0) nums.add(n)
  }
  // 「第一集第二集」：第二集可能省略「第」
  const compact = text.replace(/\s/g, '')
  const re2 = /第?(\d+|[一二三四五六七八九十两]+)集/g
  let m2: RegExpExecArray | null
  while ((m2 = re2.exec(compact)) !== null) {
    const n = parseChineseNumber(m2[1])
    if (n != null && n > 0) nums.add(n)
  }
  return [...nums].sort((a, b) => a - b)
}

export function parsePageNumbersFromText(text: string): number[] {
  const nums = new Set<number>()
  const withoutEpisode = text.replace(/第\s*(\d+|[一二三四五六七八九十两〇零]+)\s*集/g, ' ')
  const patterns = [
    /第\s*(\d+|[一二三四五六七八九十两]+)\s*[页张图]/g,
    /(?:和|、|跟|及|以及|与|\s)(\d+|[一二三四五六七八九十两]+)\s*[页张图]/g,
    /(\d+|[一二三四五六七八九十两]+)\s*[页张图]/g,
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(withoutEpisode)) !== null) {
      const n = parseChineseNumber(m[1])
      if (n != null && n > 0) nums.add(n)
    }
  }
  return [...nums].sort((a, b) => a - b)
}

/** 从「删除漫画二漫画三」等口语中提取项目序号或名称片段 */
export function parseProjectKeysFromText(text: string): string[] {
  const keys = new Set<string>()
  const re = /漫画\s*([一二三四五六七八九十两〇零\d]{1,3})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    keys.add(m[1])
  }
  if (!keys.size) {
    const nameMatch = text.match(/(?:项目|漫画)\s*([^\s，,。.]{1,16})/)
    if (nameMatch?.[1]) keys.add(nameMatch[1])
  }
  return [...keys]
}
