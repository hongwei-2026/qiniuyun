const CN_FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", "SimHei", sans-serif'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const ch of text) {
    const test = line + ch
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = ch
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

/** 在 AI 原图上叠加简体中文对白/标题（避免 AI 乱写字） */
export async function overlayPanelDialogue(
  imageDataUrl: string,
  options: {
    dialogue?: string
    caption?: string
    titleLine?: string
    isTitlePage?: boolean
  },
): Promise<string> {
  const dialogue = options.dialogue?.trim()
  const titleLine = options.titleLine?.trim()
  const caption = options.caption?.trim()
  const textBlock = dialogue || caption
  if (!textBlock && !titleLine) return imageDataUrl

  const img = await loadImage(imageDataUrl)
  const maxW = Math.min(img.width, 1400)
  const scale = maxW / img.width
  const imgH = Math.round(img.height * scale)

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return imageDataUrl

  const pad = 14
  let titleH = 0
  let footerH = 0
  let footerLines: string[] = []

  if (titleLine && options.isTitlePage) {
    titleH = 44
  }
  if (textBlock) {
    ctx.font = `bold 15px ${CN_FONT}`
    footerLines = wrapText(ctx, textBlock, maxW - pad * 2)
    footerH = 16 + footerLines.length * 22
  }

  canvas.width = maxW
  canvas.height = imgH + titleH + footerH
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  if (titleLine && options.isTitlePage) {
    ctx.fillStyle = '#1a1a2e'
    ctx.fillRect(0, 0, maxW, titleH)
    ctx.fillStyle = '#ffffff'
    ctx.font = `bold 20px ${CN_FONT}`
    ctx.textAlign = 'center'
    ctx.fillText(titleLine, maxW / 2, 28)
    ctx.textAlign = 'left'
  }

  ctx.drawImage(img, 0, titleH, maxW, imgH)

  if (footerLines.length) {
    const fy = titleH + imgH
    ctx.fillStyle = 'rgba(20, 20, 30, 0.88)'
    ctx.fillRect(0, fy, maxW, footerH)
    ctx.fillStyle = '#ffffff'
    ctx.font = `bold 15px ${CN_FONT}`
    footerLines.forEach((line, i) => {
      ctx.fillText(line, pad, fy + 18 + i * 22)
    })
  }

  return canvas.toDataURL('image/jpeg', 0.92)
}
