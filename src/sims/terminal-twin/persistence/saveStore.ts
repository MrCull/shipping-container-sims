/**
 * Named list of saves in IndexedDB (TT-17). Two object stores: `meta` (the list, small) and
 * `files` (the full documents, snapshots can be megabytes), written together in one transaction.
 *
 * Where IndexedDB is missing or refuses to open (private windows, blocked site data),
 * `openSaveStore` rejects with `StorageUnavailableError`; the UI says so and file export/import still works.
 */
import { metaOf, type SaveFile, type SaveMeta } from './saves'

export class StorageUnavailableError extends Error {
  constructor(reason: string) {
    super(`Browser storage is unavailable: ${reason}`)
    this.name = 'StorageUnavailableError'
  }
}

export interface SaveStore {
  /** Newest first. */
  list(): Promise<SaveMeta[]>
  get(id: string): Promise<SaveFile | null>
  put(file: SaveFile): Promise<SaveMeta>
  remove(id: string): Promise<void>
}

export const DB_NAME = 'terminal-twin'
const DB_VERSION = 1

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const done = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })

const txDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })

export async function openSaveStore(factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB): Promise<SaveStore> {
  if (!factory) throw new StorageUnavailableError('IndexedDB is not available')
  let db: IDBDatabase
  try {
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        req.result.createObjectStore('meta', { keyPath: 'id' })
        req.result.createObjectStore('files')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('open failed'))
      req.onblocked = () => reject(new Error('open blocked'))
    })
  } catch (err) {
    throw new StorageUnavailableError(err instanceof Error ? err.message : String(err))
  }
  return {
    async list() {
      const metas = await done(db.transaction('meta').objectStore('meta').getAll() as IDBRequest<SaveMeta[]>)
      return metas.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    },
    async get(id) {
      return ((await done(db.transaction('files').objectStore('files').get(id))) as SaveFile | undefined) ?? null
    },
    async put(file) {
      const meta = metaOf(newId(), file)
      const tx = db.transaction(['meta', 'files'], 'readwrite')
      tx.objectStore('meta').put(meta)
      tx.objectStore('files').put(file, meta.id)
      await txDone(tx)
      return meta
    },
    async remove(id) {
      const tx = db.transaction(['meta', 'files'], 'readwrite')
      tx.objectStore('meta').delete(id)
      tx.objectStore('files').delete(id)
      await txDone(tx)
    },
  }
}
