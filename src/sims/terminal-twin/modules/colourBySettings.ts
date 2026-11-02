/**
 * The remembered colour-by choice (#130, #168): the mode and the ROB display, in localStorage (a per-viewer convenience:
 * the storage is passed in and every access is guarded, so a blocked or empty one just means the defaults). A value saved
 * before #168 had `hideRob` instead of `robDisplay`: `hideRob: true` reads as `hide`, anything else as the default.
 */
import { DEFAULT_COLOUR_BY, DEFAULT_ROB_DISPLAY, parseColourBy, parseRobDisplay, type ColourBy, type RobDisplay } from './colourBy'

export type { ColourBy, RobDisplay }

export const COLOUR_BY_STORAGE_KEY = 'terminal-twin.colourBy'

export interface ColourBySettings {
  mode: ColourBy
  robDisplay: RobDisplay
}

export function loadColourBySettings(storage: Pick<Storage, 'getItem'> | null): ColourBySettings {
  try {
    const raw = storage?.getItem(COLOUR_BY_STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as { mode?: unknown; robDisplay?: unknown; hideRob?: unknown }) : {}
    const robDisplay = parsed.robDisplay === undefined && parsed.hideRob === true ? 'hide' : parseRobDisplay(parsed.robDisplay)
    return { mode: parseColourBy(parsed.mode), robDisplay }
  } catch {
    return { mode: DEFAULT_COLOUR_BY, robDisplay: DEFAULT_ROB_DISPLAY }
  }
}

export function saveColourBySettings(storage: Pick<Storage, 'setItem'> | null, settings: ColourBySettings): void {
  try {
    storage?.setItem(COLOUR_BY_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* storage blocked: the choice just does not persist */
  }
}
