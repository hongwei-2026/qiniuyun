import { jsPDF } from 'jspdf'
import type { ComicPanel, EpisodeAsset } from '../types'

const PAGE_W = 210
const MARGIN = 12
const CN_FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", "SimHei", sans-serif'
const EXPORT_MAX_PX = 1400

function panelImage(panel: ComicPanel): string | undefined {
  return panel.imageData
}

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

/** 用 Canvas 渲染中文，避免 jsPDF 默认字体乱码 */
async function compositePanelForPdf(
  imgSrc: string,
  options?: { header?: string; footer?: string },
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await loadImage(imgSrc)
  const maxW = EXPORT_MAX_PX
  const scale = maxW / img.width
  const imgH = Math.round(img.height * scale)

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 不可用')

  const padX = 12
  const headerH = options?.header ? 40 : 0
  let footerLines: string[] = []
  let footerH = 0
  if (options?.footer) {
    ctx.font = `14px ${CN_FONT}`
    footerLines = wrapText(ctx, options.footer, maxW - padX * 2)
    footerH = 12 + footerLines.length * 22
  }

  canvas.width = maxW
  canvas.height = headerH + imgH + footerH
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  if (options?.header) {
    ctx.fillStyle = '#1a1a1a'
    ctx.font = `bold 20px ${CN_FONT}`
    ctx.fillText(options.header, padX, 28)
  }

  ctx.drawImage(img, 0, headerH, maxW, imgH)

  if (footerLines.length) {
    const fy = headerH + imgH
    ctx.fillStyle = '#282828'
    ctx.fillRect(0, fy, maxW, footerH)
    ctx.fillStyle = '#ffffff'
    ctx.font = `14px ${CN_FONT}`
    footerLines.forEach((line, i) => {
      ctx.fillText(line, padX, fy + 18 + i * 22)
    })
  }

  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.92),
    width: maxW,
    height: canvas.height,
  }
}

function panelPdfFooter(panel: ComicPanel): string | undefined {
  const parts: string[] = []
  if (panel.caption?.trim()) parts.push(panel.caption.trim())
  if (panel.dialogue?.trim()) parts.push(`「${panel.dialogue.trim()}」`)
  return parts.length ? parts.join('  ') : undefined
}

function panelPdfLabel(episode: EpisodeAsset, panel: ComicPanel): string | undefined {
  const parts: string[] = []
  if (panel.pageNumber) {
    parts.push(`第 ${episode.episodeNumber} 集 · 第 ${panel.pageNumber} 页`)
  } else if (panel.caption?.trim()) {
    parts.push(panel.caption.trim())
  }
  if (panel.dialogue?.trim()) parts.push(`「${panel.dialogue.trim()}」`)
  return parts.length ? parts.join('  ') : undefined
}

function filledPanels(episode: EpisodeAsset): ComicPanel[] {
  return episode.panels?.filter((p) => panelImage(p)) ?? []
}

/** 将单集漫画导出为多页 PDF（标题页单独一页，分镜每页 2 格） */
export async function exportEpisodePdf(episode: EpisodeAsset): Promise<boolean> {
  const panels = filledPanels(episode)
  if (!panels.length) return false

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const PAGE_H = 297
  let pageAdded = false

  const titlePanel = panels.find((p) => p.isTitlePage) ?? panels[0]
  const titleSrc = panelImage(titlePanel)
  if (titleSrc) {
    const composite = await compositePanelForPdf(titleSrc, {
      header: `第 ${episode.episodeNumber} 集 · ${episode.title}`,
      footer: panelPdfFooter(titlePanel) ?? titlePanel.caption,
    })
    const usableH = PAGE_H - MARGIN * 2
    const ratio = Math.min((PAGE_W - MARGIN * 2) / (composite.width * 0.264583), usableH / (composite.height * 0.264583))
    const w = composite.width * 0.264583 * ratio
    const h = composite.height * 0.264583 * ratio
    pdf.addImage(composite.dataUrl, 'JPEG', (PAGE_W - w) / 2, MARGIN, w, h)
    pageAdded = true
  }

  const storyPanels = panels.filter((p) => p !== titlePanel)
  for (let i = 0; i < storyPanels.length; i += 2) {
    if (pageAdded) pdf.addPage()
    pageAdded = true
    const pair = storyPanels.slice(i, i + 2)
    const slotH = (PAGE_H - MARGIN * 3) / 2
    const slotW = PAGE_W - MARGIN * 2

    for (const [idx, panel] of pair.entries()) {
      const src = panelImage(panel)
      if (!src) continue
      const composite = await compositePanelForPdf(src, {
        footer: panelPdfLabel(episode, panel),
      })
      const ratio = Math.min(slotW / (composite.width * 0.264583), slotH / (composite.height * 0.264583))
      const w = composite.width * 0.264583 * ratio
      const h = composite.height * 0.264583 * ratio
      const y = MARGIN + idx * (slotH + MARGIN)
      pdf.addImage(composite.dataUrl, 'JPEG', (PAGE_W - w) / 2, y, w, h)
    }
  }

  pdf.save(`comic-ep${episode.episodeNumber}.pdf`)
  return true
}

/** 导出全部已绘制漫画为 PDF */
export async function exportAllComicPdf(
  episodes: EpisodeAsset[],
  onlyEpisode?: number,
): Promise<boolean> {
  const list = episodes
    .filter((e) => !onlyEpisode || e.episodeNumber === onlyEpisode)
    .filter((e) => filledPanels(e).length > 0)
    .sort((a, b) => a.episodeNumber - b.episodeNumber)

  if (!list.length) return false

  if (list.length === 1) {
    return exportEpisodePdf(list[0])
  }

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const PAGE_H = 297
  let first = true

  for (const episode of list) {
    const panels = filledPanels(episode)
    if (!panels.length) continue

    const titlePanel = panels.find((p) => p.isTitlePage) ?? panels[0]
    if (!first) pdf.addPage()
    first = false

    const titleSrc = panelImage(titlePanel)
    if (titleSrc) {
      const composite = await compositePanelForPdf(titleSrc, {
        header: `第 ${episode.episodeNumber} 集 · ${episode.title}`,
        footer: panelPdfFooter(titlePanel) ?? titlePanel.caption,
      })
      const usableH = PAGE_H - MARGIN * 2
      const ratio = Math.min((PAGE_W - MARGIN * 2) / (composite.width * 0.264583), usableH / (composite.height * 0.264583))
      const w = composite.width * 0.264583 * ratio
      const h = composite.height * 0.264583 * ratio
      pdf.addImage(composite.dataUrl, 'JPEG', (PAGE_W - w) / 2, MARGIN, w, h)
    }

    const storyPanels = panels.filter((p) => p !== titlePanel)
    for (let i = 0; i < storyPanels.length; i += 2) {
      pdf.addPage()
      const pair = storyPanels.slice(i, i + 2)
      const slotH = (PAGE_H - MARGIN * 3) / 2
      const slotW = PAGE_W - MARGIN * 2
      for (const [idx, panel] of pair.entries()) {
        const src = panelImage(panel)
        if (!src) continue
        const composite = await compositePanelForPdf(src, {
          footer: panelPdfLabel(episode, panel),
        })
        const ratio = Math.min(slotW / (composite.width * 0.264583), slotH / (composite.height * 0.264583))
        const w = composite.width * 0.264583 * ratio
        const h = composite.height * 0.264583 * ratio
        const y = MARGIN + idx * (slotH + MARGIN)
        pdf.addImage(composite.dataUrl, 'JPEG', (PAGE_W - w) / 2, y, w, h)
      }
    }
  }

  pdf.save(onlyEpisode ? `comic-ep${onlyEpisode}.pdf` : 'voicecanvas-comic.pdf')
  return true
}
