import { useAssetStore } from '../stores/assetStore'
import { useAppStore } from '../stores/appStore'
import type { CharacterAsset, EpisodeAsset } from '../types'

export function AssetManager() {
  const projects = useAssetStore((s) => s.projects)
  const activeProjectId = useAssetStore((s) => s.activeProjectId)
  const characters = useAssetStore((s) => s.characters)
  const episodes = useAssetStore((s) => s.episodes)
  const projectSettings = useAssetStore((s) => s.projectSettings)
  const createProject = useAssetStore((s) => s.createProject)
  const switchProject = useAssetStore((s) => s.switchProject)
  const deleteProject = useAssetStore((s) => s.deleteProject)
  const storageReady = useAssetStore((s) => s.storageReady)
  const removeCharacter = useAssetStore((s) => s.removeCharacter)
  const removeEpisode = useAssetStore((s) => s.removeEpisode)

  const activeProject = projects.find((p) => p.id === activeProjectId)

  if (!storageReady) {
    return (
      <div className="asset-manager">
        <p className="asset-empty">正在加载漫画项目…</p>
      </div>
    )
  }

  return (
    <div className="asset-manager">
      <header className="asset-header">
        <h2>资产管理</h2>
        <p>漫画项目、角色与剧本；数据保存在浏览器 IndexedDB，容量更大</p>
      </header>

      <section className="asset-section asset-project-section">
        <div className="asset-section-head">
          <h3>漫画项目 ({projects.length})</h3>
          <button type="button" className="asset-new-btn" onClick={() => createProject()}>
            新建项目
          </button>
        </div>
        <ul className="asset-project-list">
          {projects.map((p) => (
            <li key={p.id} className={p.id === activeProjectId ? 'asset-project-active' : ''}>
              <button type="button" className="asset-project-btn" onClick={() => { switchProject(p.id); useAppStore.getState().setComicDetail(null) }}>
                <strong>{p.name}</strong>
                <small>
                  {p.characters.length} 角色 · {p.episodes.length} 集
                  {p.id === activeProjectId ? ' · 当前' : ''}
                </small>
              </button>
              {projects.length > 1 && (
                <button
                  type="button"
                  className="asset-del asset-del-inline"
                  onClick={() => deleteProject(p.id)}
                >
                  删
                </button>
              )}
            </li>
          ))}
        </ul>
        {activeProject && (
          <p className="asset-project-meta">
            当前：{activeProject.name} · 风格：{projectSettings.visualStyle || '未设定'}
          </p>
        )}
      </section>

      <section className="asset-section">
        <h3>角色库 ({characters.length})</h3>
        {characters.length === 0 ? (
          <p className="asset-empty">暂无角色。可说「创建角色小明，赛博朋克少女」</p>
        ) : (
          <div className="asset-grid">
            {characters.map((c: CharacterAsset) => (
              <article key={c.id} className="asset-card">
                {c.imageData && <img src={c.imageData} alt={c.name} className="asset-thumb" />}
                <div className="asset-card-body">
                  <strong>{c.name}</strong>
                  <p>{c.description}</p>
                  <small>{c.personality}</small>
                  <button type="button" className="asset-del" onClick={() => removeCharacter(c.id)}>
                    删除
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="asset-section">
        <h3>剧本库 ({episodes.length})</h3>
        {episodes.length === 0 ? (
          <p className="asset-empty">暂无剧本。可说「写第一集剧本，冒险开始」</p>
        ) : (
          <div className="asset-list">
            {episodes.map((e: EpisodeAsset) => (
              <article key={e.id} className="asset-episode">
                <header>
                  <strong>第 {e.episodeNumber} 集 · {e.title}</strong>
                  <button type="button" className="asset-del" onClick={() => removeEpisode(e.id)}>
                    删除
                  </button>
                </header>
                <p className="asset-synopsis">{e.synopsis}</p>
                <details>
                  <summary>查看剧本（{e.panels?.length ?? 0} 页分镜）</summary>
                  <pre className="asset-script">{e.script}</pre>
                </details>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer className="asset-hints">
        <p>
          项目：「新建漫画项目」· 删除：「删除角色小美」「删除第二集剧情」「清除第二集漫画」「删除第一集第3页」·
          「关闭详情」
        </p>
      </footer>
    </div>
  )
}
