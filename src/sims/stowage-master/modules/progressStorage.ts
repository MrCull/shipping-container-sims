import { LEVELS } from './levels'

const PROGRESS_STORAGE_KEY = 'stowage-master-progress'
const LEVEL_BESTS_STORAGE_KEY = 'stowage-master-level-bests'

interface StoredProgress {
  completedLevelIds: number[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function loadCompletedLevelIds(): number[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as Partial<StoredProgress>
    return Array.isArray(parsed.completedLevelIds)
      ? parsed.completedLevelIds.filter((id): id is number => Number.isInteger(id))
      : []
  } catch {
    return []
  }
}

function loadBestLevelIds(): number[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(LEVEL_BESTS_STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw)
    if (!isRecord(parsed)) {
      return []
    }

    return Object.keys(parsed)
      .map(Number)
      .filter(Number.isInteger)
  } catch {
    return []
  }
}

function clampLevelId(levelId: number): number {
  return Math.max(0, Math.min(LEVELS.length - 1, levelId))
}

export function getHighestStowageMasterLevelReached(): number {
  const reachedIds = [...loadCompletedLevelIds(), ...loadBestLevelIds()]
  if (reachedIds.length === 0) {
    return 1
  }

  const highestCompletedOrBestId = clampLevelId(Math.max(...reachedIds))
  const nextUnlockedId = clampLevelId(highestCompletedOrBestId + 1)
  return nextUnlockedId + 1
}

export function getStowageMasterProgressSummary(): string {
  return `Level ${getHighestStowageMasterLevelReached()}`
}
