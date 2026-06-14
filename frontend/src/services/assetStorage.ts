const DB_NAME = 'voicecanvas-db'
const STORE_NAME = 'kv'
export const ASSET_STORAGE_KEY = 'voicecanvas-assets-v2'
const LEGACY_LS_KEY = 'voicecanvas-assets-v1'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveAssetBlob(data: unknown): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(data, ASSET_STORAGE_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function loadAssetBlob<T>(): Promise<T | null> {
  try {
    const db = await openDb()
    const value = await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(ASSET_STORAGE_KEY)
      req.onsuccess = () => resolve((req.result as T) ?? null)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return value
  } catch {
    return null
  }
}

export function loadLegacyLocalStorage<T>(): T | null {
  try {
    const raw = localStorage.getItem(LEGACY_LS_KEY)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function clearLegacyLocalStorage(): void {
  try {
    localStorage.removeItem(LEGACY_LS_KEY)
  } catch {
    /* ignore */
  }
}
