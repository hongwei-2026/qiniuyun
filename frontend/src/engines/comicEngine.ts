import { generateImage, generateComicCharacter, generateComicEpisodeScript, reviseComicEpisodeScript } from '../services/api'
import { beginGeneration, isGenerationCancelled, throwIfCancelled } from '../services/generationControl'
import { useAssetStore, getComicProjectStyle, getComicStoryBackground } from '../stores/assetStore'
import { useAppStore } from '../stores/appStore'
import type { CharacterAsset, ComicPanel, EpisodeAsset } from '../types'
import {
  buildCharacterTurnaroundPlan,
  createGrid,
  extractBase64FromDataUrl,
  parseCellId,
  resizeDataUrlToJpegBase64,
} from './gridEngine'
import { exportAllComicPdf } from './comicPdf'
import { overlayPanelDialogue } from './comicPanelOverlay'
import { parseChineseNumber } from '../services/chineseNumber'

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 生图时禁止 AI 写字，对白由 Canvas 叠加中文 */
const COMIC_IMAGE_TEXT_POLICY =
  'pure illustration only, absolutely no text, no speech bubbles, no letters, no words, ' +
  'no writing, no typography, no captions in image, silent comic panel art'

const STYLE_CONTINUITY_HINT =
  'exact same art style, same line weight, same color palette, same cel shading, ' +
  'consistent character face and costume, seamless comic panel continuity, single unified illustration style'

async function drawComicPanelImage(
  prompt: string,
  referenceBase64?: string,
  aspect: '1:1' | '16:9' = '1:1',
): Promise<string> {
  const store = useAppStore.getState()
  const ref = referenceBase64
    ? await resizeDataUrlToJpegBase64(
        referenceBase64.startsWith('data:') ? referenceBase64 : `data:image/jpeg;base64,${referenceBase64}`,
        768,
      ).catch(() => referenceBase64)
    : undefined
  const fullPrompt = ref
    ? `${prompt}, ${STYLE_CONTINUITY_HINT}, same art style as reference image`
    : prompt
  const result = await generateImage({
    prompt: fullPrompt,
    aspect_ratio: aspect,
    provider: ref ? 'minimax' : store.imageProvider,
    reference_image_base64: ref,
    size: aspect === '16:9' ? '2K' : undefined,
  })
  if (!result.images[0]) throw new Error('AI 未返回图片')
  const src = result.format === 'base64'
    ? `data:image/jpeg;base64,${result.images[0]}`
    : result.images[0]
  store.setLastAiImageDataUrl(src)
  return src
}

function patchEpisodePanel(
  episodeId: string,
  panelIndex: number,
  patch: Partial<ComicPanel>,
): void {
  const assetStore = useAssetStore.getState()
  const episode = assetStore.episodes.find((e) => e.id === episodeId)
  if (!episode?.panels) return
  assetStore.updateEpisode(episodeId, {
    panels: episode.panels.map((p) => (p.index === panelIndex ? { ...p, ...patch } : p)),
  })
}

async function redrawGridCell(
  cellIdStr: string,
  prompt: string,
  referenceBase64?: string,
): Promise<void> {
  const store = useAppStore.getState()
  const ref = referenceBase64
    ? await resizeDataUrlToJpegBase64(
        referenceBase64.startsWith('data:') ? referenceBase64 : `data:image/jpeg;base64,${referenceBase64}`,
        768,
      ).catch(() => referenceBase64)
    : undefined
  store.upsertCell({
    ...store.gridCells[cellIdStr],
    id: cellIdStr,
    row: parseCellId(cellIdStr).row,
    col: parseCellId(cellIdStr).col,
    status: 'generating',
  })
  const result = await generateImage({
    prompt: ref ? `${prompt}, same art style as reference` : prompt,
    aspect_ratio: '1:1',
    provider: ref ? 'minimax' : store.imageProvider,
    reference_image_base64: ref,
  })
  if (!result.images[0]) throw new Error('AI 未返回图片')
  const src = result.format === 'base64'
    ? `data:image/jpeg;base64,${result.images[0]}`
    : result.images[0]
  store.upsertCell({
    ...store.gridCells[cellIdStr],
    id: cellIdStr,
    row: parseCellId(cellIdStr).row,
    col: parseCellId(cellIdStr).col,
    imageData: src,
    prompt,
    status: 'filled',
  })
  store.setLastAiImageDataUrl(src)
}

export function parseEpisodeNumber(text: string): number | null {
  const cnMap: Record<string, number> = {
    一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  }
  const m = text.match(/第\s*(\d+|[一二三四五六七八九十]+)\s*集/)
  if (!m) return null
  const raw = m[1]
  if (/^\d+$/.test(raw)) return Number(raw)
  return cnMap[raw] ?? null
}

export function parseCharacterNameFromSpeech(text: string): string | null {
  const patterns = [
    /(?:创建|新建|设计|画)(?:一个|一位)?\s*角色\s*([^\s，,。.]{1,8})/,
    /角色\s*([^\s，,。.]{1,8})\s*(?:的人设|形象|立绘)/,
    /人物\s*([^\s，,。.]{1,8})/,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]) return m[1].trim()
  }
  return null
}

export async function createCharacterAsset(
  description: string,
  nameHint?: string,
  onStep?: (msg: string) => void,
): Promise<string> {
  const token = beginGeneration()
  const store = useAppStore.getState()
  const assetStore = useAssetStore.getState()
  const projectStyle = getComicProjectStyle()
  const storyBg = getComicStoryBackground()
  onStep?.('正在生成角色人设…')
  const profile = await generateComicCharacter({
    description: [description, storyBg ? `Story background: ${storyBg}` : ''].filter(Boolean).join('. '),
    style: projectStyle,
    existing_name: nameHint,
  })
  throwIfCancelled(token)

  onStep?.(`正在为 ${profile.name} 绘制角色形象…`)
  store.setAiGenerating(true, `正在绘制角色 ${profile.name}…`)
  try {
    const img = await generateImage({
      prompt: `${profile.image_prompt}, ${COMIC_IMAGE_TEXT_POLICY}`,
      aspect_ratio: '1:1',
      provider: store.imageProvider,
      size: '2K',
    })
    throwIfCancelled(token)
    const imageData = img.images[0]
      ? img.format === 'base64'
        ? `data:image/jpeg;base64,${img.images[0]}`
        : img.images[0]
      : undefined

    const character: CharacterAsset = {
      id: uid(),
      name: profile.name,
      description: profile.description,
      personality: profile.personality,
      catchphrase: profile.catchphrase,
      sampleDialogues: profile.sample_dialogues,
      style: profile.style,
      imagePrompt: profile.image_prompt,
      imageData,
      createdAt: Date.now(),
    }
    assetStore.addCharacter(character)
    useAppStore.getState().setComicDetail({ kind: 'character', characterId: character.id })
    const line = profile.catchphrase || profile.personality
    return `角色 ${profile.name} 已创建：${line}`
  } finally {
    store.setAiGenerating(false)
  }
}

export async function createEpisodeScript(
  episodeNumber: number,
  synopsis: string,
  onStep?: (msg: string) => void,
): Promise<string> {
  const token = beginGeneration()
  const assetStore = useAssetStore.getState()
  const characters = assetStore.characters
  const projectStyle = getComicProjectStyle()
  const storyBg = getComicStoryBackground()
  const previous = assetStore.episodes
    .filter((e) => e.episodeNumber < episodeNumber)
    .map((e) => ({
      episode_number: e.episodeNumber,
      title: e.title,
      synopsis: e.synopsis,
      script: e.script,
    }))

  onStep?.(`正在撰写第 ${episodeNumber} 集剧本…`)
  const script = await generateComicEpisodeScript({
    episode_number: episodeNumber,
    synopsis: [synopsis, storyBg ? `World setting: ${storyBg}` : ''].filter(Boolean).join('. '),
    characters: characters.map((c) => ({
      name: c.name,
      description: c.description,
      personality: c.personality,
    })),
    previous_episodes: previous,
    style: projectStyle,
  })
  throwIfCancelled(token)

  const panels: ComicPanel[] = script.panels.map((p, i) => ({
    index: p.index,
    caption: p.caption,
    scene: p.scene,
    dialogue: p.dialogue,
    characters: p.characters,
    isTitlePage: p.is_title_page,
    pageNumber: p.is_title_page ? 1 : i + 1,
    layout: p.is_title_page ? 'title_spread' : 'half',
    status: 'empty',
  }))

  const episode: EpisodeAsset = {
    id: assetStore.getEpisodeByNumber(episodeNumber)?.id ?? uid(),
    episodeNumber,
    title: script.title,
    synopsis: script.synopsis || synopsis,
    script: script.script,
    style: projectStyle,
    characterIds: characters.map((c) => c.id),
    panels,
    createdAt: assetStore.getEpisodeByNumber(episodeNumber)?.createdAt ?? Date.now(),
  }
  const existing = assetStore.getEpisodeByNumber(episodeNumber)
  if (existing) {
    assetStore.updateEpisode(existing.id, episode)
  } else {
    assetStore.addEpisode(episode)
  }
  return `第 ${episodeNumber} 集《${script.title}》剧本已生成，共 ${panels.length} 页`
}

export async function regenerateCharacterAsset(
  nameHint: string | undefined,
  description: string,
  onStep?: (msg: string) => void,
): Promise<string> {
  const assetStore = useAssetStore.getState()
  const existing = nameHint ? assetStore.getCharacterByName(nameHint) : undefined
  if (existing) {
    assetStore.removeCharacter(existing.id)
  }
  return createCharacterAsset(description, nameHint ?? existing?.name, onStep)
}

export async function regenerateEpisodeScript(
  episodeNumber: number,
  synopsis: string,
  onStep?: (msg: string) => void,
): Promise<string> {
  const assetStore = useAssetStore.getState()
  const existing = assetStore.getEpisodeByNumber(episodeNumber)
  if (existing) {
    assetStore.removeEpisode(existing.id)
  }
  return createEpisodeScript(episodeNumber, synopsis || existing?.synopsis || '', onStep)
}

export async function regenerateComicEpisode(
  episodeNumber: number,
  onStep?: (msg: string) => void,
): Promise<string> {
  const assetStore = useAssetStore.getState()
  const episode = assetStore.getEpisodeByNumber(episodeNumber)
  if (episode?.panels) {
    assetStore.updateEpisode(episode.id, {
      panels: episode.panels.map((p) => ({
        ...p,
        imageData: undefined,
        status: 'empty' as const,
      })),
    })
  }
  return generateComicEpisode(episodeNumber, onStep)
}

export async function reviseEpisodeScript(
  episodeNumber: number,
  revision: string,
  onStep?: (msg: string) => void,
): Promise<string> {
  const token = beginGeneration()
  const assetStore = useAssetStore.getState()
  const existing = assetStore.getEpisodeByNumber(episodeNumber)
  if (!existing) return `第 ${episodeNumber} 集剧本不存在，请先说「写第${episodeNumber}集剧本」`

  const characters = assetStore.characters
  const previous = assetStore.episodes
    .filter((e) => e.episodeNumber < episodeNumber)
    .map((e) => ({
      episode_number: e.episodeNumber,
      title: e.title,
      synopsis: e.synopsis,
    }))

  onStep?.(`正在根据意见修订第 ${episodeNumber} 集剧本…`)
  const script = await reviseComicEpisodeScript({
    episode_number: episodeNumber,
    revision,
    current_title: existing.title,
    current_synopsis: existing.synopsis,
    current_script: existing.script,
    characters: characters.map((c) => ({
      name: c.name,
      description: c.description,
      personality: c.personality,
    })),
    previous_episodes: previous,
    style: existing.style,
  })
  throwIfCancelled(token)

  const panels: ComicPanel[] = script.panels.map((p, i) => ({
    index: p.index,
    caption: p.caption,
    scene: p.scene,
    dialogue: p.dialogue,
    characters: p.characters,
    isTitlePage: p.is_title_page,
    pageNumber: p.is_title_page ? 1 : i + 1,
    layout: p.is_title_page ? 'title_spread' : 'half',
    status: 'empty',
  }))

  assetStore.updateEpisode(existing.id, {
    title: script.title,
    synopsis: script.synopsis || existing.synopsis,
    script: script.script,
    panels,
  })
  return `第 ${episodeNumber} 集剧本已修订为《${script.title}》，共 ${panels.length} 页`
}

function normalizeComicStyleForImage(style: string): string {
  const s = style.trim() || 'Chinese comic manhua style'
  if (/日漫|日式|日本|manga/i.test(s)) {
    return 'Chinese youth manhua style with manga-inspired aesthetics, Simplified Chinese visual culture'
  }
  return s
}

function buildPanelPrompt(
  panel: ComicPanel,
  episode: EpisodeAsset,
  characters: CharacterAsset[],
  style: string,
): string {
  const visualStyle = normalizeComicStyleForImage(style)
  const charDesc = panel.characters
    .map((n) => {
      const c = characters.find((x) => x.name === n || x.name.includes(n))
      return c ? `${c.name}: ${c.description}` : n
    })
    .join('; ')
  if (panel.isTitlePage) {
    return [
      `${visualStyle} comic title page spread, episode ${episode.episodeNumber}: ${episode.title}`,
      `large readable Simplified Chinese title text only: 第${episode.episodeNumber}集 ${episode.title}`,
      `visual storytelling illustration summarizing plot: ${episode.synopsis}`,
      panel.scene,
      charDesc ? `featuring characters: ${charDesc}` : '',
      'dramatic cover art showing key story moment, decorative comic borders, rich detailed background',
      COMIC_IMAGE_TEXT_POLICY,
    ].filter(Boolean).join(', ').slice(0, 1400)
  }
  return [
    `${visualStyle} comic panel page ${panel.pageNumber ?? panel.index}`,
    `episode ${episode.episodeNumber} story continuity: ${episode.synopsis?.slice(0, 200) ?? ''}`,
    panel.scene,
    charDesc ? `characters must look identical to reference: ${charDesc}` : '',
    STYLE_CONTINUITY_HINT,
    'consistent character design, clear composition, comic panel borders, expressive scene',
    COMIC_IMAGE_TEXT_POLICY,
  ].filter(Boolean).join(', ').slice(0, 1400)
}

function pickPrimaryCharacterRef(
  allChars: CharacterAsset[],
  panel: ComicPanel,
): string | undefined {
  for (const name of panel.characters) {
    const c = allChars.find((x) => x.name === name || x.name.includes(name) || name.includes(x.name))
    if (c?.imageData) return extractBase64FromDataUrl(c.imageData)
  }
  const fallback = allChars.find((c) => c.imageData)
  return fallback?.imageData ? extractBase64FromDataUrl(fallback.imageData) : undefined
}

function pickStyleReference(
  panel: ComicPanel,
  allChars: CharacterAsset[],
  titleImageData?: string,
  prevImageData?: string,
): string | undefined {
  if (prevImageData) return extractBase64FromDataUrl(prevImageData)
  if (titleImageData) return extractBase64FromDataUrl(titleImageData)
  const charRef = pickPrimaryCharacterRef(allChars, panel)
  if (charRef) return charRef
  const fallback = allChars.find((c) => c.imageData)
  return fallback?.imageData ? extractBase64FromDataUrl(fallback.imageData) : undefined
}

function sortEpisodePanels(panels: ComicPanel[]): ComicPanel[] {
  return [...panels].sort((a, b) => a.index - b.index)
}

function findPanelByPageNumber(sorted: ComicPanel[], pageNum: number): ComicPanel | undefined {
  return sorted.find((p) => (p.pageNumber ?? p.index) === pageNum) ?? sorted[pageNum - 1]
}

async function drawEpisodePanelImage(
  episode: EpisodeAsset,
  panel: ComicPanel,
  allChars: CharacterAsset[],
  style: string,
  styleRef?: string,
  titleImageData?: string,
): Promise<string> {
  const prompt = buildPanelPrompt(panel, episode, allChars, style)
  const ref = styleRef ?? pickStyleReference(panel, allChars, titleImageData)
  let raw: string
  if (panel.isTitlePage) {
    raw = await drawComicPanelImage(
      `${prompt}, wide cinematic title splash banner, episode ${episode.episodeNumber}, visual summary of plot: ${episode.synopsis}`,
      ref,
      '16:9',
    )
  } else {
    raw = await drawComicPanelImage(prompt, ref, '1:1')
  }
  return overlayPanelDialogue(raw, {
    dialogue: panel.dialogue,
    caption: panel.caption,
    titleLine: panel.isTitlePage ? `第${episode.episodeNumber}集 ${episode.title}` : undefined,
    isTitlePage: panel.isTitlePage,
  })
}

export async function generateComicEpisode(
  episodeNumber: number,
  onStep?: (msg: string) => void,
): Promise<string> {
  const token = beginGeneration()
  const store = useAppStore.getState()
  const assetStore = useAssetStore.getState()
  let episode = assetStore.getEpisodeByNumber(episodeNumber)

  if (!episode) {
    onStep?.(`第 ${episodeNumber} 集剧本不存在，正在自动撰写…`)
    await createEpisodeScript(episodeNumber, '', onStep)
    episode = useAssetStore.getState().getEpisodeByNumber(episodeNumber)
  }
  if (!episode?.panels?.length) return `第 ${episodeNumber} 集没有可绘制的分镜`

  const allChars = assetStore.characters
  const style = episode.style || getComicProjectStyle() || allChars[0]?.style || 'manga comic style'
  const panels = [...episode.panels]
  const titlePanel = panels.find((p) => p.isTitlePage) ?? panels[0]
  const storyPanels = panels.filter((p) => p !== titlePanel)

  store.setCanvasMode('comic')
  store.setAiGenerating(true, `正在绘制第 ${episodeNumber} 集漫画…`)

  let prevImageData: string | undefined
  let drawn = 0

  try {
    throwIfCancelled(token)
    onStep?.(`第 ${episodeNumber} 集 · 标题页`)
    patchEpisodePanel(episode.id, titlePanel.index, { status: 'generating' })
    const titleRef = pickStyleReference(titlePanel, allChars, undefined, undefined)
    const titleImage = await drawEpisodePanelImage(episode, titlePanel, allChars, style, titleRef)
    patchEpisodePanel(episode.id, titlePanel.index, {
      imageData: titleImage,
      status: 'filled',
      layout: 'title_spread',
    })
    prevImageData = titleImage
    drawn++

    for (const [idx, panel] of storyPanels.entries()) {
      throwIfCancelled(token)
      onStep?.(`第 ${episodeNumber} 集 · 第 ${panel.pageNumber ?? idx + 2} 页（${idx + 1}/${storyPanels.length}）`)
      patchEpisodePanel(episode.id, panel.index, { status: 'generating' })
      const imageData = await drawEpisodePanelImage(
        episode,
        panel,
        allChars,
        style,
        pickStyleReference(panel, allChars, titleImage, prevImageData),
        titleImage,
      )
      patchEpisodePanel(episode.id, panel.index, {
        imageData,
        status: 'filled',
        layout: 'half',
      })
      prevImageData = imageData
      drawn++
    }

    return `第 ${episodeNumber} 集漫画已绘制完成，共 ${drawn} 页`
  } catch (err) {
    if (err instanceof Error && err.message === 'GENERATION_CANCELLED') {
      return '漫画绘制已停止'
    }
    throw err
  } finally {
    if (!isGenerationCancelled(token)) {
      store.setAiGenerating(false)
    }
  }
}

export async function generateComicEpisodes(
  episodeNumbers: number[],
  onStep?: (msg: string) => void,
): Promise<string> {
  const unique = [...new Set(episodeNumbers)].sort((a, b) => a - b)
  const parts: string[] = []
  for (const n of unique) {
    parts.push(await generateComicEpisode(n, onStep))
  }
  return parts.join('；')
}

export async function redrawComicPanels(
  episodeNumber: number,
  pageNumbers: number[],
  onStep?: (msg: string) => void,
): Promise<string> {
  const token = beginGeneration()
  const store = useAppStore.getState()
  const assetStore = useAssetStore.getState()
  const episode = assetStore.getEpisodeByNumber(episodeNumber)
  if (!episode?.panels?.length) {
    return `第 ${episodeNumber} 集还没有分镜剧本，请先说「创作第 ${episodeNumber} 集剧本」`
  }

  const sorted = sortEpisodePanels(episode.panels)
  const targets: ComicPanel[] = []
  const missing: number[] = []
  for (const pageNum of pageNumbers) {
    const panel = findPanelByPageNumber(sorted, pageNum)
    if (panel) targets.push(panel)
    else missing.push(pageNum)
  }
  if (!targets.length) {
    return `未找到指定页码（本集共 ${sorted.length} 页）${missing.length ? `，无效页码：${missing.join('、')}` : ''}`
  }

  const allChars = assetStore.characters
  const style = episode.style || getComicProjectStyle() || allChars[0]?.style || 'manga comic style'
  store.setCanvasMode('comic')
  store.setAiGenerating(true, `正在局部重绘第 ${episodeNumber} 集…`)

  const titleImage = sorted.find((p) => p.isTitlePage)?.imageData
    ?? sorted.find((p) => p.imageData)?.imageData
  const orderedTargets = [...targets].sort(
    (a, b) => (a.pageNumber ?? a.index) - (b.pageNumber ?? b.index),
  )
  let chainRef: string | undefined = titleImage

  const drawnPages: number[] = []
  try {
    for (const panel of orderedTargets) {
      throwIfCancelled(token)
      const pageLabel = panel.pageNumber ?? panel.index
      onStep?.(`第 ${episodeNumber} 集 · 重绘第 ${pageLabel} 页`)
      patchEpisodePanel(episode.id, panel.index, { status: 'generating' })
      const styleRef = pickStyleReference(panel, allChars, titleImage, chainRef)
      const imageData = await drawEpisodePanelImage(
        episode,
        panel,
        allChars,
        style,
        styleRef,
        titleImage,
      )
      patchEpisodePanel(episode.id, panel.index, {
        imageData,
        status: 'filled',
        layout: panel.isTitlePage ? 'title_spread' : 'half',
      })
      chainRef = imageData
      drawnPages.push(pageLabel)
    }
    return `第 ${episodeNumber} 集已局部重绘第 ${drawnPages.join('、')} 页，画风与角色已继承参考图`
  } catch (err) {
    if (err instanceof Error && err.message === 'GENERATION_CANCELLED') {
      return '局部重绘已停止'
    }
    throw err
  } finally {
    if (!isGenerationCancelled(token)) {
      store.setAiGenerating(false)
    }
  }
}

export async function exportComicPdf(episodeNumber?: number): Promise<string> {
  const assetStore = useAssetStore.getState()
  const ok = await exportAllComicPdf(assetStore.episodes, episodeNumber)
  if (!ok) return episodeNumber
    ? `第 ${episodeNumber} 集尚未绘制，无法导出 PDF`
    : '没有可导出的漫画，请先生成漫画'
  return episodeNumber
    ? `第 ${episodeNumber} 集 PDF 已导出`
    : '全部漫画 PDF 已导出'
}

export function setComicVisualStyle(style: string): string {
  const trimmed = style.trim()
  if (!trimmed) return '请说明要设定的画风，例如「设定风格为日式漫画」'
  useAssetStore.getState().updateProjectSettings({ visualStyle: trimmed })
  return `漫画风格已设定：${trimmed}`
}

export function setComicStoryBackground(background: string): string {
  const trimmed = background.trim()
  if (!trimmed) return '请说明故事背景，例如「设定故事背景为赛博朋克城市」'
  useAssetStore.getState().updateProjectSettings({ storyBackground: trimmed })
  useAppStore.getState().setComicDetail({ kind: 'story' })
  return '故事背景已更新，详情窗口已打开'
}

export function showAllCharacters(): string {
  const characters = useAssetStore.getState().characters
  if (!characters.length) return '还没有角色，先说「画角色立绘」'
  useAppStore.getState().setComicDetail({ kind: 'characters_all' })
  return `已展示全部 ${characters.length} 个角色`
}

export function showCharacterDetail(name?: string): string {
  const trimmed = name?.trim()
  if (!trimmed) return showAllCharacters()
  const character = useAssetStore.getState().getCharacterByName(trimmed)
  if (!character) return `未找到角色「${trimmed}」`
  useAppStore.getState().setComicDetail({ kind: 'character', characterId: character.id })
  return `已打开 ${character.name} 的详细信息`
}

export function showAllEpisodes(): string {
  const episodes = useAssetStore.getState().episodes
  if (!episodes.length) return '还没有剧本，先说「创作第一集剧本」'
  useAppStore.getState().setComicDetail({ kind: 'episodes_all' })
  return `已展示全部 ${episodes.length} 集剧情`
}

export function showEpisodeDetail(episodeNumber?: number): string {
  if (episodeNumber == null || Number.isNaN(episodeNumber)) return showAllEpisodes()
  const episode = useAssetStore.getState().getEpisodeByNumber(episodeNumber)
  if (!episode) return `第 ${episodeNumber} 集剧本不存在`
  useAppStore.getState().setComicDetail({ kind: 'episode', episodeId: episode.id })
  return `已打开第 ${episodeNumber} 集《${episode.title}》剧情详情`
}

export function showStoryBackground(): string {
  useAppStore.getState().setComicDetail({ kind: 'story' })
  const bg = getComicStoryBackground()
  return bg ? '已打开故事背景详情' : '尚未设定故事背景，可说「设定故事背景为……」'
}

export function closeComicDetail(): string {
  const open = useAppStore.getState().comicDetail
  if (!open) return '当前没有打开的详情窗口'
  useAppStore.getState().setComicDetail(null)
  return '详情窗口已关闭'
}

export function createNewComicProject(name?: string): string {
  useAssetStore.getState().createProject(name)
  useAppStore.getState().setComicDetail(null)
  const project = useAssetStore.getState().getActiveProject()
  return `已新建漫画项目「${project?.name ?? name ?? '新漫画'}」，可开始设定背景与角色`
}

function findProjectByKey(
  projects: ReturnType<typeof useAssetStore.getState>['projects'],
  nameOrIndex: string,
) {
  let key = nameOrIndex.trim()
  if (!key) return undefined
  key = key.replace(/^(?:请|帮我|给我)?(?:切换|打开|进入)(?:到|至|一下)?/u, '').trim()
  const normalized = key.replace(/\s/g, '')

  const byName = projects.find(
    (p) =>
      p.name === key
      || p.name.includes(key)
      || key.includes(p.name)
      || p.name.replace(/\s/g, '') === normalized
      || new RegExp(`漫画\\s*${key}$`).test(p.name),
  )
  if (byName) return byName

  if (!key.endsWith('漫画') && !key.endsWith('项目')) {
    const withSuffix = projects.find(
      (p) => p.name === `${key}漫画` || p.name === `${key}项目`,
    )
    if (withSuffix) return withSuffix
  }

  const num =
    parseChineseNumber(key)
    ?? parseChineseNumber(key.replace(/^漫画/, ''))
    ?? (Number(key) >= 1 ? Number(key) : null)
  if (num != null && num >= 1) {
    const byNum = projects.find((p) => {
      const m = p.name.match(/(\d+)\s*$/)
      if (m && Number(m[1]) === num) return true
      const cn = p.name.match(/漫画\s*([一二三四五六七八九十两\d]+)\s*$/)
      if (cn) return parseChineseNumber(cn[1]) === num
      return false
    })
    if (byNum) return byNum
    if (num <= projects.length) return projects[num - 1]
  }
  return undefined
}

export function switchComicProject(nameOrIndex: string): string {
  const store = useAssetStore.getState()
  const key = nameOrIndex.trim()
  if (!key) {
    const active = store.getActiveProject()
    return active ? `当前项目：${active.name}` : '没有活动项目'
  }
  const target = findProjectByKey(store.projects, key)
  if (target && store.switchProject(target.id)) {
    useAppStore.getState().setComicDetail(null)
    return `已切换到「${target.name}」（${target.characters.length} 角色 · ${target.episodes.length} 集）`
  }
  const names = store.projects.map((p) => p.name).join('、')
  return `未找到「${nameOrIndex}」。现有项目：${names || '无'}`
}

export function deleteComicProject(name?: string): string {
  const store = useAssetStore.getState()
  if (store.projects.length <= 1) return '至少保留一个漫画项目，无法删除'
  const target = name ? findProjectByKey(store.projects, name) : store.getActiveProject()
  if (!target) return name ? `未找到项目「${name}」` : '没有可删除的项目'
  if (!store.deleteProject(target.id)) return '删除失败'
  useAppStore.getState().setComicDetail(null)
  return `漫画项目「${target.name}」已删除`
}

export function deleteComicProjects(names: string[]): string {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  if (!unique.length) return deleteComicProject()
  const parts: string[] = []
  for (const name of unique) {
    parts.push(deleteComicProject(name))
  }
  return parts.join('；')
}

export function deleteCharacterByName(name?: string): string {
  const trimmed = name?.trim()
  if (!trimmed) return '请说明要删除的角色名，例如「删除角色小美」'
  const assetStore = useAssetStore.getState()
  const character = assetStore.getCharacterByName(trimmed)
  if (!character) return `未找到角色「${trimmed}」`
  assetStore.removeCharacter(character.id)
  const detail = useAppStore.getState().comicDetail
  if (detail?.kind === 'character' && detail.characterId === character.id) {
    useAppStore.getState().setComicDetail(null)
  }
  return `角色「${character.name}」已删除`
}

export function deleteEpisodeByNumber(episodeNumber: number): string {
  const assetStore = useAssetStore.getState()
  const episode = assetStore.getEpisodeByNumber(episodeNumber)
  if (!episode) return `第 ${episodeNumber} 集剧本不存在`
  assetStore.removeEpisode(episode.id)
  const detail = useAppStore.getState().comicDetail
  if (detail?.kind === 'episode' && detail.episodeId === episode.id) {
    useAppStore.getState().setComicDetail(null)
  }
  return `第 ${episodeNumber} 集《${episode.title}》剧本与分镜已删除`
}

export function clearEpisodeComicImages(episodeNumber: number): string {
  const assetStore = useAssetStore.getState()
  const episode = assetStore.getEpisodeByNumber(episodeNumber)
  if (!episode?.panels?.length) return `第 ${episodeNumber} 集没有漫画内容`
  assetStore.updateEpisode(episode.id, {
    panels: episode.panels.map((p) => ({
      ...p,
      imageData: undefined,
      status: 'empty' as const,
    })),
  })
  return `第 ${episodeNumber} 集漫画图片已清除，剧本保留`
}

export function deleteEpisodePages(episodeNumber: number, pageNumbers: number[]): string {
  const assetStore = useAssetStore.getState()
  const episode = assetStore.getEpisodeByNumber(episodeNumber)
  if (!episode?.panels?.length) return `第 ${episodeNumber} 集没有分镜页`
  const sorted = sortEpisodePanels(episode.panels)
  const removeIndexes = new Set<number>()
  for (const num of pageNumbers) {
    const panel = findPanelByPageNumber(sorted, num)
    if (panel) removeIndexes.add(panel.index)
  }
  if (!removeIndexes.size) {
    return `未找到要删除的页码（本集共 ${sorted.length} 页）`
  }
  const remaining = sorted
    .filter((p) => !removeIndexes.has(p.index))
    .map((p, i) => ({
      ...p,
      index: i + 1,
      pageNumber: p.isTitlePage ? 1 : i + 1,
    }))
  assetStore.updateEpisode(episode.id, { panels: remaining })
  return `第 ${episodeNumber} 集已删除 ${removeIndexes.size} 页，剩余 ${remaining.length} 页`
}

export async function drawCharacterTurnaroundInGrid(
  subject: string,
  onStep?: (msg: string) => void,
): Promise<string> {
  const store = useAppStore.getState()
  if (!Object.keys(store.gridCells).length) {
    store.setGridCells(createGrid(3, 3, store.cellSize))
  }
  const token = beginGeneration()
  const plan = buildCharacterTurnaroundPlan(store.gridCells, subject, 'pixel art')
  store.setAiGenerating(true, '正在绘制多视角像素角色…')
  let anchorRef: string | undefined
  try {
    for (const [idx, item] of plan.entries()) {
      throwIfCancelled(token)
      onStep?.(`正在绘制${item.label}视角 ${item.cellId}（${idx + 1}/${plan.length}）`)
      await redrawGridCell(item.cellId, item.prompt, anchorRef)
      if (!anchorRef) {
        const img = store.gridCells[item.cellId]?.imageData
        if (img) anchorRef = extractBase64FromDataUrl(img)
      }
    }
    return `已为 ${plan.length} 个格子绘制多视角像素角色`
  } catch (err) {
    if (err instanceof Error && err.message === 'GENERATION_CANCELLED') {
      return '角色绘制已停止'
    }
    throw err
  } finally {
    store.setAiGenerating(false)
  }
}
