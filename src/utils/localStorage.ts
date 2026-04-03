import type { SiteStorageData } from '@/types/local-storage'

const STORAGE_KEY = 'shipping-container-sims'

const DEFAULT_STORAGE: SiteStorageData = {
  version: 1,
  global: {
    soundMuted: false,
    godModeEnabled: false,
  },
  sims: {},
}

function cloneDefaultStorage(): SiteStorageData {
  return {
    version: DEFAULT_STORAGE.version,
    global: { ...DEFAULT_STORAGE.global },
    sims: { ...DEFAULT_STORAGE.sims },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function sanitizeStorage(raw: unknown): SiteStorageData {
  const storage = cloneDefaultStorage()

  if (!isRecord(raw)) {
    return storage
  }

  if (raw.version === 1) {
    storage.version = 1
  }

  if (isRecord(raw.global) && typeof raw.global.soundMuted === 'boolean') {
    storage.global.soundMuted = raw.global.soundMuted
  }
  if (isRecord(raw.global) && typeof raw.global.godModeEnabled === 'boolean') {
    storage.global.godModeEnabled = raw.global.godModeEnabled
  }

  if (isRecord(raw.sims)) {
    storage.sims = raw.sims
  }

  return storage
}

function loadLegacyGodMode(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    const raw = window.localStorage.getItem('stowage-master-progress')
    if (!raw) return false
    const parsed = JSON.parse(raw) as { godMode?: unknown }
    return parsed.godMode === true
  } catch {
    return false
  }
}

export function loadSiteStorage(): SiteStorageData {
  if (typeof window === 'undefined') {
    return cloneDefaultStorage()
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return cloneDefaultStorage()
    }

    const parsed = JSON.parse(raw)
    const storage = sanitizeStorage(parsed)
    if (!isRecord(parsed.global) || typeof parsed.global.godModeEnabled !== 'boolean') {
      storage.global.godModeEnabled = loadLegacyGodMode()
    }
    return storage
  } catch {
    const storage = cloneDefaultStorage()
    storage.global.godModeEnabled = loadLegacyGodMode()
    return storage
  }
}

export function saveSiteStorage(storage: SiteStorageData): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storage))
}

export function updateSiteStorage(
  updater: (storage: SiteStorageData) => SiteStorageData,
): SiteStorageData {
  const nextStorage = updater(loadSiteStorage())
  saveSiteStorage(nextStorage)
  return nextStorage
}
