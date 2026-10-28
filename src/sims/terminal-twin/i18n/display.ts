/**
 * Display settings (locale + units): browser defaults, the remembered choice,
 * and how they are stored with the scenario config. Pure TS; the browser's
 * `navigator.languages` and `localStorage` are passed in.
 */
import type { DisplaySettings, ScenarioConfig } from '../scenario/types'
import { localeRegion } from './format'

export const DISPLAY_STORAGE_KEY = 'terminal-twin.display'
const FALLBACK: DisplaySettings = { locale: 'en-GB', units: 'metric' }

/** Regions that use imperial (US customary) units in the UI. */
const IMPERIAL_REGIONS = new Set(['US'])

function validLocale(tag: unknown): string | null {
  if (typeof tag !== 'string' || !tag) return null
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? null
  } catch {
    return null
  }
}

/** Defaults from the browser: its first valid language; imperial for US regions, else metric. */
export function browserDisplayDefaults(languages: readonly string[]): DisplaySettings {
  const locale = languages.map(validLocale).find((l): l is string => !!l)
  if (!locale) return { ...FALLBACK }
  return { locale, units: IMPERIAL_REGIONS.has(localeRegion(locale) ?? '') ? 'imperial' : 'metric' }
}

/** A well-formed DisplaySettings, or null. */
export function parseDisplaySettings(value: unknown): DisplaySettings | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const locale = validLocale(v.locale)
  if (!locale || (v.units !== 'metric' && v.units !== 'imperial')) return null
  return { locale, units: v.units }
}

type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>

/** The remembered choice, or the browser defaults on first open (or if storage is unavailable). */
export function loadDisplaySettings(storage: SettingsStorage | null, languages: readonly string[]): DisplaySettings {
  try {
    const raw = storage?.getItem(DISPLAY_STORAGE_KEY)
    const saved = raw ? parseDisplaySettings(JSON.parse(raw)) : null
    if (saved) return saved
  } catch {
    // blocked or corrupt storage: use the defaults
  }
  return browserDisplayDefaults(languages)
}

export function saveDisplaySettings(storage: SettingsStorage | null, settings: DisplaySettings): void {
  try {
    storage?.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // a per-viewer convenience only
  }
}

/** The config a run starts from: a copy of the scenario with the start date and display settings. All values stay SI. */
export function runConfigFor(base: ScenarioConfig, startDateTime: string, display: DisplaySettings): ScenarioConfig {
  // KPI hours and shifts follow the clock the user sees (local time of the start), not UTC.
  const d = new Date(startDateTime)
  const kpi = Number.isNaN(d.getTime())
    ? base.kpi
    : { ...base.kpi, startTimeOfDayS: d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() }
  return JSON.parse(JSON.stringify({ ...base, startDateTime, display, ...(kpi ? { kpi } : {}) })) as ScenarioConfig
}
