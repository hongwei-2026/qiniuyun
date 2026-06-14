import { useEffect, type ReactNode } from 'react'
import { useAppStore } from '../stores/appStore'
import { useAssetStore } from '../stores/assetStore'
import type { CharacterAsset, EpisodeAsset } from '../types'

function CharacterDetailContent({
  character,
  visualStyle,
}: {
  character: CharacterAsset
  visualStyle: string
}) {
  return (
    <article className="comic-detail-char-block">
      <div className="comic-detail-hero">
        {character.imageData ? (
          <img src={character.imageData} alt={character.name} className="comic-detail-portrait" />
        ) : (
          <div className="comic-detail-portrait comic-detail-portrait-empty">暂无立绘</div>
        )}
        <div className="comic-detail-meta">
          <h4 className="comic-detail-char-name">{character.name}</h4>
          <dl>
            <dt>画风</dt>
            <dd>{character.style || visualStyle || '未设定'}</dd>
            <dt>性格</dt>
            <dd>{character.personality || '—'}</dd>
            {character.catchphrase && (
              <>
                <dt>代表台词</dt>
                <dd>「{character.catchphrase}」</dd>
              </>
            )}
          </dl>
        </div>
      </div>
      <section className="comic-detail-section">
        <h4>外貌与人设</h4>
        <p>{character.description || '暂无描述'}</p>
      </section>
      {character.sampleDialogues && character.sampleDialogues.length > 0 && (
        <section className="comic-detail-section">
          <h4>示例对白</h4>
          <ul className="comic-detail-panel-list">
            {character.sampleDialogues.map((line) => (
              <li key={line}>「{line}」</li>
            ))}
          </ul>
        </section>
      )}
      {character.imagePrompt && (
        <section className="comic-detail-section comic-detail-section-muted">
          <h4>生图提示词</h4>
          <p>{character.imagePrompt}</p>
        </section>
      )}
    </article>
  )
}

function EpisodeDetailContent({ episode }: { episode: EpisodeAsset }) {
  return (
    <article className="comic-detail-ep-block">
      <h4 className="comic-detail-ep-title">
        第 {episode.episodeNumber} 集 · {episode.title}
      </h4>
      {episode.synopsis && (
        <section className="comic-detail-section">
          <h4>本集梗概</h4>
          <p>{episode.synopsis}</p>
        </section>
      )}
      {episode.script && (
        <section className="comic-detail-section">
          <h4>剧本正文</h4>
          <pre className="comic-detail-script">{episode.script}</pre>
        </section>
      )}
      {episode.panels && episode.panels.length > 0 && (
        <section className="comic-detail-section">
          <h4>分镜 ({episode.panels.length} 页)</h4>
          <ul className="comic-detail-panel-list">
            {episode.panels.map((p) => (
              <li key={p.index}>
                <strong>{p.isTitlePage ? '标题页' : `第 ${p.pageNumber ?? p.index} 页`}</strong>
                {p.caption && <span> — {p.caption}</span>}
                {p.dialogue && <em> 「{p.dialogue}」</em>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  )
}

export function ComicDetailModal() {
  const detail = useAppStore((s) => s.comicDetail)
  const setComicDetail = useAppStore((s) => s.setComicDetail)
  const characters = useAssetStore((s) => s.characters)
  const episodes = useAssetStore((s) => s.episodes)
  const projectSettings = useAssetStore((s) => s.projectSettings)

  useEffect(() => {
    if (!detail) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setComicDetail(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detail, setComicDetail])

  if (!detail) return null

  const character = detail.kind === 'character'
    ? characters.find((c) => c.id === detail.characterId)
    : undefined
  const episode = detail.kind === 'episode'
    ? episodes.find((e) => e.id === detail.episodeId)
    : undefined
  const sortedEpisodes = [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber)

  let title = ''
  let body: ReactNode = null
  let wide = false

  if (detail.kind === 'character' && character) {
    title = character.name
    body = (
      <CharacterDetailContent character={character} visualStyle={projectSettings.visualStyle} />
    )
  } else if (detail.kind === 'characters_all') {
    title = `全部角色 (${characters.length})`
    wide = true
    body = (
      <div className="comic-detail-all-list">
        {characters.map((c) => (
          <CharacterDetailContent key={c.id} character={c} visualStyle={projectSettings.visualStyle} />
        ))}
      </div>
    )
  } else if (detail.kind === 'episode' && episode) {
    title = `第 ${episode.episodeNumber} 集 · ${episode.title}`
    body = <EpisodeDetailContent episode={episode} />
  } else if (detail.kind === 'episodes_all') {
    title = `全部剧情 (${sortedEpisodes.length} 集)`
    wide = true
    body = (
      <div className="comic-detail-all-list">
        {sortedEpisodes.map((ep) => (
          <EpisodeDetailContent key={ep.id} episode={ep} />
        ))}
      </div>
    )
  } else if (detail.kind === 'story') {
    title = '故事背景'
    body = (
      <>
        <section className="comic-detail-section">
          <h4>世界观 / 背景设定</h4>
          <p>{projectSettings.storyBackground || '尚未设定故事背景，可说「设定故事背景为……」'}</p>
        </section>
        <section className="comic-detail-section">
          <h4>漫画风格</h4>
          <p>{projectSettings.visualStyle || '尚未设定风格，可说「设定风格为日式漫画」'}</p>
        </section>
        {sortedEpisodes.length > 0 && (
          <section className="comic-detail-section">
            <h4>已创作分集</h4>
            <ul className="comic-detail-panel-list">
              {sortedEpisodes.map((ep) => (
                <li key={ep.id}>
                  第 {ep.episodeNumber} 集 · {ep.title}
                  {ep.synopsis && (
                    <span>
                      {' '}
                      — {ep.synopsis.slice(0, 48)}
                      {ep.synopsis.length > 48 ? '…' : ''}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    )
  } else {
    return null
  }

  return (
    <div className="comic-detail-backdrop" onClick={() => setComicDetail(null)} role="presentation">
      <div
        className={`comic-detail-dialog${wide ? ' comic-detail-dialog-wide' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="comic-detail-title"
      >
        <header className="comic-detail-header">
          <h3 id="comic-detail-title">{title}</h3>
          <button type="button" className="comic-detail-close" onClick={() => setComicDetail(null)} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="comic-detail-body">{body}</div>
      </div>
    </div>
  )
}
