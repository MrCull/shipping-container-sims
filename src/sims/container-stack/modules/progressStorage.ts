const STORAGE_KEY = 'container-stack-progress'

interface ContainerStackProgress {
  highestLevelReached: number
}

function sanitizeProgress(raw: unknown): ContainerStackProgress {
  if (typeof raw !== 'object' || raw === null) {
    return { highestLevelReached: 0 }
  }

  const maybeProgress = raw as Partial<ContainerStackProgress>
  return {
    highestLevelReached:
      typeof maybeProgress.highestLevelReached === 'number' &&
      Number.isFinite(maybeProgress.highestLevelReached)
        ? Math.max(0, Math.floor(maybeProgress.highestLevelReached))
        : 0,
  }
}

export function loadContainerStackProgress(): ContainerStackProgress {
  if (typeof window === 'undefined') {
    return { highestLevelReached: 0 }
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return { highestLevelReached: 0 }
    }
    return sanitizeProgress(JSON.parse(raw))
  } catch {
    return { highestLevelReached: 0 }
  }
}

export function saveHighestContainerStackLevelReached(level: number): void {
  if (typeof window === 'undefined') {
    return
  }

  const safeLevel = Math.max(1, Math.floor(level))
  const progress = loadContainerStackProgress()
  if (safeLevel <= progress.highestLevelReached) {
    return
  }

  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ highestLevelReached: safeLevel } satisfies ContainerStackProgress)
  )
}

export function getContainerStackProgressSummary(): string | null {
  const { highestLevelReached } = loadContainerStackProgress()
  if (highestLevelReached <= 0) {
    return null
  }

  return `Level ${highestLevelReached}`
}
