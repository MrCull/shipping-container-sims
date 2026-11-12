/**
 * The remembered "strict checks" choice (#252): check every event in the browser run instead of by sweeps only. In
 * localStorage (a per-viewer convenience: the storage is passed in, every access is guarded, a blocked one means off).
 */
export const STRICT_CHECKS_STORAGE_KEY = 'terminal-twin.strictChecks'

export function loadStrictChecks(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(STRICT_CHECKS_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function saveStrictChecks(storage: Pick<Storage, 'setItem'> | null, on: boolean): void {
  try {
    storage?.setItem(STRICT_CHECKS_STORAGE_KEY, String(on))
  } catch {
    /* storage blocked: the choice just does not persist */
  }
}
