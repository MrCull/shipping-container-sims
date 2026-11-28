/**
 * Yardshift progress (#386): schema version, the highest unlocked level and per-level best stars and best score (kept
 * independently), in the `yardshift` section of the site-wide local storage (`src/utils/localStorage.ts`). A version
 * mismatch or malformed section discards the old data. Writes are guarded: blocked or full storage never breaks play.
 */
import { loadSiteStorage, updateSiteStorage } from '@/utils/localStorage'
import type { Stars } from './stars'

export const PROGRESS_VERSION = 1
const SECTION = 'yardshift'

export interface LevelBest {
  /** Best stars ever earned (0 = never completed). */
  stars: 0 | Stars
  /** Best score ever on a completed shift, or null. */
  score: number | null
}

export interface Progress {
  version: number
  /** Highest unlocked level number (1 at first). */
  unlocked: number
  /** Keyed by level number. */
  levels: Record<number, LevelBest>
}

export function emptyProgress(): Progress {
  return { version: PROGRESS_VERSION, unlocked: 1, levels: {} }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Validates a stored section; anything with another version or the wrong shape gives empty progress. */
export function parseProgress(raw: unknown): Progress {
  if (!isRecord(raw) || raw.version !== PROGRESS_VERSION) return emptyProgress()
  const unlocked = typeof raw.unlocked === 'number' && Number.isInteger(raw.unlocked) && raw.unlocked >= 1 ? raw.unlocked : 1
  const levels: Record<number, LevelBest> = {}
  if (isRecord(raw.levels)) {
    for (const [key, value] of Object.entries(raw.levels)) {
      const n = Number(key)
      if (!Number.isInteger(n) || n < 1 || !isRecord(value)) continue
      const stars = value.stars === 1 || value.stars === 2 || value.stars === 3 ? value.stars : 0
      const score = typeof value.score === 'number' && Number.isFinite(value.score) ? value.score : null
      levels[n] = { stars, score }
    }
  }
  return { version: PROGRESS_VERSION, unlocked, levels }
}

/** A completed shift: best stars and best score each keep their own maximum; the next level unlocks. */
export function recordCompletion(progress: Progress, level: number, stars: Stars, score: number, levelCount: number): Progress {
  const old = progress.levels[level] ?? { stars: 0, score: null }
  return {
    ...progress,
    unlocked: Math.max(progress.unlocked, Math.min(levelCount, level + 1)),
    levels: {
      ...progress.levels,
      [level]: { stars: Math.max(old.stars, stars) as Stars, score: old.score === null ? score : Math.max(old.score, score) },
    },
  }
}

/**
 * True when `?unlock=all` should unlock every level: only in dev and smoke builds (`dev` is `import.meta.env.DEV`,
 * `mode` is `import.meta.env.MODE`), never in production.
 */
export function unlockAllRequested(search: string, dev: boolean, mode: string): boolean {
  if (!dev && mode !== 'smoke') return false
  return new URLSearchParams(search).get('unlock') === 'all'
}

export function isUnlocked(progress: Progress, level: number, unlockAll: boolean): boolean {
  return unlockAll || level <= progress.unlocked
}

export function loadProgress(): Progress {
  try {
    return parseProgress(loadSiteStorage().sims[SECTION])
  } catch {
    return emptyProgress()
  }
}

/** Saves the section; returns false when storage refused the write. */
export function saveProgress(progress: Progress): boolean {
  try {
    updateSiteStorage((s) => ({ ...s, sims: { ...s.sims, [SECTION]: { ...progress } } }))
    return true
  } catch {
    return false
  }
}
