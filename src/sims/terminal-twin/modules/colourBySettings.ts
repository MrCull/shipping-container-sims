/**
 * The remembered colour-by choice (#130): the mode and Hide ROB, in localStorage (a per-viewer convenience: the storage
 * is passed in and every access is guarded, so a blocked or empty one just means the defaults).
 */
import { DEFAULT_COLOUR_BY, parseColourBy, type ColourBy } from './colourBy'

export type { ColourBy }

export const COLOUR_BY_STORAGE_KEY = 'terminal-twin.colourBy'

export interface ColourBySettings {
  mode: ColourBy
  hideRob: boolean
}

export function loadColourBySettings(storage: Pick<Storage, 'getItem'> | null): ColourBySettings {
  try {
    const raw = storage?.getItem(COLOUR_BY_STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as { mode?: unknown; hideRob?: unknown }) : {}
    return { mode: parseColourBy(parsed.mode), hideRob: parsed.hideRob === true }
  } catch {
    return { mode: DEFAULT_COLOUR_BY, hideRob: false }
  }
}

export function saveColourBySettings(storage: Pick<Storage, 'setItem'> | null, settings: ColourBySettings): void {
  try {
    storage?.setItem(COLOUR_BY_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* storage blocked: the choice just does not persist */
  }
}
