import { useAppStore } from '../stores/appStore'
import { useAssetStore } from '../stores/assetStore'
import type { ComicPanel, EpisodeAsset } from '../types'
import { ComicDetailModal } from './ComicDetailModal'

function PanelCard({ panel }: { panel: ComicPanel }) {
  const label = panel.isTitlePage
    ? '标题页'
    : panel.pageNumber
      ? `第 ${panel.pageNumber} 页`
      : panel.caption

  return (
    <figure
      className={`comic-panel-card ${panel.isTitlePage ? 'comic-panel-title' : 'comic-panel-story'} status-${panel.status ?? 'empty'}`}
    >
      <div className="comic-panel-frame">
        {panel.imageData ? (
          <img src={panel.imageData} alt={panel.caption || label} />
        ) : (
          <div className="comic-panel-placeholder">
            {panel.status === 'generating' ? (
              <span className="comic-panel-loading">生成中…</span>
            ) : (
              <>
                <span className="comic-panel-label">{label}</span>
                {panel.scene && <p className="comic-panel-scene">{panel.scene}</p>}
              </>
            )}
          </div>
        )}
        {panel.status === 'generating' && panel.imageData && (
          <div className="comic-panel-overlay">生成中…</div>
        )}
      </div>
      {(panel.caption || panel.dialogue) && (
        <figcaption className="comic-panel-caption">
          {panel.caption}
          {panel.dialogue && <span className="comic-panel-dialogue">「{panel.dialogue}」</span>}
        </figcaption>
      )}
    </figure>
  )
}

function EpisodeBlock({
  episode,
  onOpenDetail,
}: {
  episode: EpisodeAsset
  onOpenDetail: () => void
}) {
  const panels = episode.panels ?? []
  const titlePanel = panels.find((p) => p.isTitlePage)
  const storyPanels = panels.filter((p) => !p.isTitlePage)
  const hasImages = panels.some((p) => p.imageData)

  return (
    <section className="comic-episode-block">
      <header className="comic-episode-header">
        <div>
          <h3>第 {episode.episodeNumber} 集 · {episode.title}</h3>
          {episode.synopsis && <p className="comic-episode-synopsis">{episode.synopsis}</p>}
        </div>
        <button type="button" className="comic-ghost-btn" onClick={onOpenDetail}>
          查看剧情
        </button>
      </header>

      {!panels.length ? (
        <p className="comic-episode-empty">剧本尚未生成分镜，可说「创作第{episode.episodeNumber}集剧本」</p>
      ) : (
        <div className="comic-episode-panels">
          {titlePanel && <PanelCard panel={titlePanel} />}
          {storyPanels.length > 0 && (
            <div className="comic-story-grid">
              {storyPanels.map((panel) => (
                <PanelCard key={panel.index} panel={panel} />
              ))}
            </div>
          )}
          {!hasImages && (
            <p className="comic-episode-empty">可说「生成第{episode.episodeNumber}集漫画」开始绘制</p>
          )}
        </div>
      )}
    </section>
  )
}

function CharacterShowcase({
  onSelect,
}: {
  onSelect: (id: string) => void
}) {
  const characters = useAssetStore((s) => s.characters)
  if (!characters.length) return null

  return (
    <section className="comic-showcase">
      <h3>角色阵容</h3>
      <div className="comic-char-grid">
        {characters.map((c) => (
          <button
            key={c.id}
            type="button"
            className="comic-char-card"
            onClick={() => onSelect(c.id)}
          >
            <div className="comic-char-card-frame">
              {c.imageData ? (
                <img src={c.imageData} alt={c.name} />
              ) : (
                <span className="comic-char-card-empty">{c.name.slice(0, 1)}</span>
              )}
            </div>
            <span className="comic-char-card-name">{c.name}</span>
            <span className="comic-char-card-hint">点击查看详情</span>
          </button>
        ))}
      </div>
    </section>
  )
}

/** 漫画创作画布：纵向分集分镜条，与九宫格模式独立 */
export function ComicView() {
  const aiGenerating = useAppStore((s) => s.aiGenerating)
  const setComicDetail = useAppStore((s) => s.setComicDetail)
  const characters = useAssetStore((s) => s.characters)
  const episodes = useAssetStore((s) => s.episodes)
  const projectSettings = useAssetStore((s) => s.projectSettings)
  const projects = useAssetStore((s) => s.projects)
  const activeProjectId = useAssetStore((s) => s.activeProjectId)
  const storageReady = useAssetStore((s) => s.storageReady)
  const createProject = useAssetStore((s) => s.createProject)
  const switchProject = useAssetStore((s) => s.switchProject)
  const sortedEpisodes = [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber)

  const activeProject = projects.find((p) => p.id === activeProjectId)

  const handleSwitchProject = (id: string) => {
    switchProject(id)
    setComicDetail(null)
  }

  const handleNewProject = () => {
    createProject()
    setComicDetail(null)
  }

  if (!storageReady) {
    return (
      <div className="comic-view comic-view-loading">
        <p>正在加载漫画项目…</p>
      </div>
    )
  }

  const openCharacter = (id: string) => setComicDetail({ kind: 'character', characterId: id })
  const openEpisode = (id: string) => setComicDetail({ kind: 'episode', episodeId: id })
  const openStory = () => setComicDetail({ kind: 'story' })

  const stylePreview = projectSettings.visualStyle || '尚未设定风格'
  const bgPreview = projectSettings.storyBackground || '尚未设定故事背景'

  return (
    <div className="comic-view">
      <ComicDetailModal />

      <aside className="comic-sidebar">
        <div className="comic-sidebar-brand">
          <span className="comic-sidebar-icon">✦</span>
          <div>
            <h3>漫画工作室</h3>
            {activeProject && <p className="comic-project-name">{activeProject.name}</p>}
          </div>
        </div>

        <div className="comic-project-actions">
          <button type="button" className="comic-ghost-btn comic-project-new" onClick={handleNewProject}>
            ＋ 新建漫画
          </button>
        </div>

        {projects.length > 0 && (
          <section className="comic-sidebar-section comic-project-section">
            <h4>我的漫画 <span>{projects.length}</span></h4>
            <ul className="comic-project-list">
              {projects.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`comic-project-tab ${p.id === activeProjectId ? 'comic-project-tab-active' : ''}`}
                    onClick={() => handleSwitchProject(p.id)}
                  >
                    <span className="comic-project-tab-name">{p.name}</span>
                    <span className="comic-project-tab-meta">
                      {p.characters.length} 角色 · {p.episodes.length} 集
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="comic-project-hint">点击切换项目，可说「打开漫画1」</p>
          </section>
        )}

        <button type="button" className="comic-setting-card" onClick={openStory}>
          <span className="comic-setting-label">漫画风格</span>
          <p className="comic-setting-value">{stylePreview}</p>
        </button>

        <button type="button" className="comic-setting-card comic-setting-card-accent" onClick={openStory}>
          <span className="comic-setting-label">故事背景</span>
          <p className="comic-setting-value">{bgPreview}</p>
        </button>

        <section className="comic-sidebar-section">
          <h4>角色 <span>{characters.length}</span></h4>
          {characters.length === 0 ? (
            <p className="comic-side-empty">说「画角色立绘小明」</p>
          ) : (
            <ul className="comic-char-list">
              {characters.map((c) => (
                <li key={c.id}>
                  <button type="button" className="comic-char-row" onClick={() => openCharacter(c.id)}>
                    <span className="comic-char-thumb">
                      {c.imageData ? <img src={c.imageData} alt={c.name} /> : c.name.slice(0, 1)}
                    </span>
                    <span className="comic-char-name">{c.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="comic-sidebar-section">
          <h4>剧本 <span>{episodes.length}</span></h4>
          {episodes.length === 0 ? (
            <p className="comic-side-empty">说「创作第一集剧本」</p>
          ) : (
            <ul className="comic-ep-list">
              {sortedEpisodes.map((ep) => (
                <li key={ep.id}>
                  <button type="button" className="comic-ep-row" onClick={() => openEpisode(ep.id)}>
                    <span>第{ep.episodeNumber}集 · {ep.title}</span>
                    {ep.panels?.some((p) => p.imageData) && <em className="comic-ep-done">已绘制</em>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>

      <div className="comic-strip-wrap">
        <div className="comic-toolbar">
          <div>
            <span className="comic-toolbar-title">分镜画布</span>
            <span className="comic-toolbar-sub">
              {activeProject
                ? `${activeProject.name} · ${sortedEpisodes.length ? `${sortedEpisodes.length} 集 · ${characters.length} 角色` : '空项目，等待第一条指令'}`
                : '等待你的第一条指令'}
            </span>
          </div>
          {aiGenerating && <span className="comic-toolbar-status">AI 绘制中…</span>}
        </div>

        <div className="comic-strip-scroll">
          <CharacterShowcase onSelect={openCharacter} />

          {sortedEpisodes.length === 0 ? (
            <div className="comic-onboard">
              <div className="comic-onboard-hero">
                <h2>开始你的漫画连载</h2>
                <p>用语音设定世界观与画风，创建角色、撰写剧本，再一键生成分镜。</p>
              </div>
              <div className="comic-onboard-grid">
                <article className="comic-onboard-card">
                  <span className="comic-onboard-step">01</span>
                  <h4>设定风格与背景</h4>
                  <p>「设定风格为赛博朋克漫画」「设定故事背景为……」</p>
                </article>
                <article className="comic-onboard-card">
                  <span className="comic-onboard-step">02</span>
                  <h4>创建角色</h4>
                  <p>「画角色立绘小明，短发少年冒险者」</p>
                </article>
                <article className="comic-onboard-card">
                  <span className="comic-onboard-step">03</span>
                  <h4>撰写并绘制</h4>
                  <p>「创作第一集剧本」「生成第一集漫画」</p>
                </article>
                <article className="comic-onboard-card">
                  <span className="comic-onboard-step">04</span>
                  <h4>查看详情</h4>
                  <p>「查看角色」「查看剧情」展示全部；也可指定「查看角色小明」</p>
                </article>
              </div>
            </div>
          ) : (
            sortedEpisodes.map((ep) => (
              <EpisodeBlock key={ep.id} episode={ep} onOpenDetail={() => openEpisode(ep.id)} />
            ))
          )}
        </div>

        <footer className="comic-footer-hints">
          新建项目 · 风格/背景 · 角色 · 剧本 · 生成/重绘 · 删除 · 关闭详情 · 导出 PDF
        </footer>
      </div>
    </div>
  )
}
