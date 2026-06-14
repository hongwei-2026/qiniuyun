import { create } from 'zustand'
import type { CharacterAsset, ComicProjectSettings, EpisodeAsset } from '../types'
import {
  clearLegacyLocalStorage,
  loadAssetBlob,
  loadLegacyLocalStorage,
  saveAssetBlob,
} from '../services/assetStorage'

const DEFAULT_PROJECT: ComicProjectSettings = {
  visualStyle: '国漫风格，细腻线条，网点阴影',
  storyBackground: '',
}

export interface ComicProject {
  id: string
  name: string
  createdAt: number
  settings: ComicProjectSettings
  characters: CharacterAsset[]
  episodes: EpisodeAsset[]
}

interface PersistedAssetData {
  version: 2
  projects: ComicProject[]
  activeProjectId: string | null
}

interface AssetStore {
  projects: ComicProject[]
  activeProjectId: string | null
  characters: CharacterAsset[]
  episodes: EpisodeAsset[]
  projectSettings: ComicProjectSettings
  storageReady: boolean
  addCharacter: (character: CharacterAsset) => void
  updateCharacter: (id: string, patch: Partial<CharacterAsset>) => void
  removeCharacter: (id: string) => void
  addEpisode: (episode: EpisodeAsset) => void
  updateEpisode: (id: string, patch: Partial<EpisodeAsset>) => void
  removeEpisode: (id: string) => void
  updateProjectSettings: (patch: Partial<ComicProjectSettings>) => void
  createProject: (name?: string) => string
  switchProject: (id: string) => boolean
  deleteProject: (id: string) => boolean
  renameProject: (id: string, name: string) => void
  getActiveProject: () => ComicProject | undefined
  getCharacterByName: (name: string) => CharacterAsset | undefined
  getEpisodeByNumber: (n: number) => EpisodeAsset | undefined
  loadFromStorage: () => Promise<void>
  persist: () => void
}

function newProjectId(): string {
  return `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createEmptyProject(name: string): ComicProject {
  return {
    id: newProjectId(),
    name,
    createdAt: Date.now(),
    settings: { ...DEFAULT_PROJECT },
    characters: [],
    episodes: [],
  }
}

function migrateLegacyData(): PersistedAssetData {
  const legacy = loadLegacyLocalStorage<{
    characters?: CharacterAsset[]
    episodes?: EpisodeAsset[]
    projectSettings?: Partial<ComicProjectSettings>
  }>()
  const project = createEmptyProject('漫画 1')
  if (legacy) {
    project.characters = legacy.characters ?? []
    project.episodes = legacy.episodes ?? []
    project.settings = { ...DEFAULT_PROJECT, ...legacy.projectSettings }
    clearLegacyLocalStorage()
  }
  return { version: 2, projects: [project], activeProjectId: project.id }
}

function syncActiveSlice(project: ComicProject | undefined) {
  return {
    characters: project?.characters ?? [],
    episodes: project?.episodes ?? [],
    projectSettings: project?.settings ?? { ...DEFAULT_PROJECT },
  }
}

function nextProjectName(projects: ComicProject[]): string {
  const nums = projects.map((p) => {
    const m = p.name.match(/^漫画\s*(\d+)$/)
    return m ? Number(m[1]) : 0
  })
  return `漫画 ${Math.max(0, ...nums, projects.length) + 1}`
}

async function flushPersist(get: () => AssetStore): Promise<void> {
  if (persistTimer) {
    window.clearTimeout(persistTimer)
    persistTimer = null
  }
  const { projects, activeProjectId } = get()
  const payload: PersistedAssetData = { version: 2, projects, activeProjectId }
  await saveAssetBlob(payload)
}

let persistTimer: number | null = null

function applyActiveUpdate(
  get: () => AssetStore,
  set: (partial: Partial<AssetStore> | ((s: AssetStore) => Partial<AssetStore>)) => void,
  updater: (project: ComicProject) => ComicProject,
) {
  const id = get().activeProjectId
  if (!id) return
  set((s) => {
    const projects = s.projects.map((p) => (p.id === id ? updater(p) : p))
    const active = projects.find((p) => p.id === id)
    return { projects, ...syncActiveSlice(active) }
  })
}

export const useAssetStore = create<AssetStore>((set, get) => ({
  projects: [],
  activeProjectId: null,
  characters: [],
  episodes: [],
  projectSettings: { ...DEFAULT_PROJECT },
  storageReady: false,

  getActiveProject: () => get().projects.find((p) => p.id === get().activeProjectId),

  addCharacter: (character) => {
    applyActiveUpdate(get, set, (p) => ({ ...p, characters: [...p.characters, character] }))
    get().persist()
  },
  updateCharacter: (id, patch) => {
    applyActiveUpdate(get, set, (p) => ({
      ...p,
      characters: p.characters.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }))
    get().persist()
  },
  removeCharacter: (id) => {
    applyActiveUpdate(get, set, (p) => ({
      ...p,
      characters: p.characters.filter((c) => c.id !== id),
    }))
    get().persist()
  },
  addEpisode: (episode) => {
    applyActiveUpdate(get, set, (p) => ({
      ...p,
      episodes: [...p.episodes, episode].sort((a, b) => a.episodeNumber - b.episodeNumber),
    }))
    get().persist()
  },
  updateEpisode: (id, patch) => {
    applyActiveUpdate(get, set, (p) => ({
      ...p,
      episodes: p.episodes
        .map((e) => (e.id === id ? { ...e, ...patch } : e))
        .sort((a, b) => a.episodeNumber - b.episodeNumber),
    }))
    get().persist()
  },
  removeEpisode: (id) => {
    applyActiveUpdate(get, set, (p) => ({
      ...p,
      episodes: p.episodes.filter((e) => e.id !== id),
    }))
    get().persist()
  },
  updateProjectSettings: (patch) => {
    applyActiveUpdate(get, set, (p) => ({
      ...p,
      settings: { ...p.settings, ...patch },
    }))
    get().persist()
  },

  createProject: (name) => {
    const trimmed = name?.trim()
    const project = createEmptyProject(trimmed || nextProjectName(get().projects))
    set((s) => ({
      projects: [...s.projects, project],
      activeProjectId: project.id,
      ...syncActiveSlice(project),
    }))
    void flushPersist(get)
    return project.id
  },

  switchProject: (id) => {
    const project = get().projects.find((p) => p.id === id)
    if (!project) return false
    set({ activeProjectId: id, ...syncActiveSlice(project) })
    void flushPersist(get)
    return true
  },

  deleteProject: (id) => {
    const { projects, activeProjectId } = get()
    if (projects.length <= 1) return false
    const next = projects.filter((p) => p.id !== id)
    const activeId = activeProjectId === id ? next[0].id : activeProjectId
    const active = next.find((p) => p.id === activeId)
    set({ projects: next, activeProjectId: activeId, ...syncActiveSlice(active) })
    get().persist()
    return true
  },

  renameProject: (id, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
    }))
    get().persist()
  },

  getCharacterByName: (name) => {
    const key = name.trim()
    return get().characters.find(
      (c) => c.name === key || c.name.includes(key) || key.includes(c.name),
    )
  },
  getEpisodeByNumber: (n) => get().episodes.find((e) => e.episodeNumber === n),

  loadFromStorage: async () => {
    if (get().storageReady) return
    let data = await loadAssetBlob<PersistedAssetData>()
    if (!data?.projects?.length) {
      data = migrateLegacyData()
      if (data.projects[0] && data.projects[0].name === '默认漫画') {
        data.projects[0].name = '漫画 1'
      }
      await saveAssetBlob(data)
    }
    const active = data.projects.find((p) => p.id === data.activeProjectId) ?? data.projects[0]
    set({
      projects: data.projects,
      activeProjectId: active.id,
      ...syncActiveSlice(active),
      storageReady: true,
    })
  },

  persist: () => {
    if (persistTimer) window.clearTimeout(persistTimer)
    persistTimer = window.setTimeout(() => {
      const { projects, activeProjectId } = get()
      const payload: PersistedAssetData = { version: 2, projects, activeProjectId }
      void saveAssetBlob(payload).catch((err) => {
        console.error('资产保存失败', err)
      })
    }, 400)
  },
}))

export function getComicProjectStyle(): string {
  return useAssetStore.getState().projectSettings.visualStyle || DEFAULT_PROJECT.visualStyle
}

export function getComicStoryBackground(): string {
  return useAssetStore.getState().projectSettings.storyBackground
}

export function getActiveProjectName(): string {
  return useAssetStore.getState().getActiveProject()?.name ?? '默认漫画'
}
