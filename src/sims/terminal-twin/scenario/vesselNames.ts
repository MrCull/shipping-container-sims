/**
 * Vessel operators (shipping lines) and fictional vessel names in each line's
 * naming style [A] ("HMM Tarifa", "Madrid Maersk", "Ever Alboran", ...).
 * The renderer paints a vessel in its line's hull livery (TT-27); the engine
 * ignores both. Pure, no RNG of its own: callers pass their `random()`.
 */
import { LINE_OWNER_PREFIX } from './lines'
import type { VesselConfig } from './types'

const PLACES = [
  'Tarifa', 'Alboran', 'Gibraltar', 'Ceuta', 'Tanger', 'Malaga', 'Cadiz', 'Huelva', 'Almeria', 'Valencia',
  'Sines', 'Lisbon', 'Genoa', 'Piraeus', 'Busan', 'Ningbo', 'Shanghai', 'Rotterdam', 'Antwerp', 'Hamburg',
]

interface NamingStyle {
  /** A name; `pick` draws one entry of a list. */
  name(pick: <T>(list: readonly T[]) => T): string
  /** Does a name follow this style? */
  matches(name: string): boolean
}

const prefixed = (prefix: string, words: readonly string[]): NamingStyle => ({
  name: (pick) => `${prefix} ${pick(words)}`,
  matches: (n) => n.startsWith(`${prefix} `),
})
const suffixed = (suffix: string, words: readonly string[]): NamingStyle => ({
  name: (pick) => `${pick(words)} ${suffix}`,
  matches: (n) => n.endsWith(` ${suffix}`),
})

/** [A] Naming styles per line, modelled on each fleet's real pattern; every name is fictional. */
const STYLES: Record<string, NamingStyle> = {
  HMM: prefixed('HMM', PLACES),
  MSC: prefixed('MSC', ['Aurelia', 'Celeste', 'Delfina', 'Elena', 'Fiorella', 'Giulia', 'Ilaria', 'Lorena', 'Marisa', 'Serena']),
  Maersk: {
    // "Madrid Maersk" style; older "Maersk Essen" style is still recognised.
    name: (pick) => `${pick(PLACES)} Maersk`,
    matches: (n) => n.endsWith(' Maersk') || n.startsWith('Maersk '),
  },
  'CMA CGM': prefixed('CMA CGM', ['Gibraltar', 'Magellan', 'Andalucia', 'Atlas', 'Tage', 'Corsica', 'Fidelio', 'Rigoletto']),
  'Hapag-Lloyd': suffixed('Express', PLACES),
  ONE: prefixed('ONE', ['Harmony', 'Integrity', 'Courage', 'Clarity', 'Endeavour', 'Fortune', 'Horizon', 'Solidarity']),
  Evergreen: prefixed('Ever', ['Alboran', 'Bright', 'Candor', 'Gentle', 'Lucent', 'Steady', 'Summit', 'Tribute']),
  COSCO: prefixed('COSCO Shipping', ['Andes', 'Danube', 'Orion', 'Pegasus', 'Rhine', 'Sirius', 'Taurus', 'Vega']),
  ZIM: prefixed('ZIM', ['Haifa', 'Ashdod', 'Kingston', 'Savannah', 'Tarifa', 'Valencia', 'Cadiz', 'Genoa']),
  'Yang Ming': prefixed('YM', ['Warmth', 'Welfare', 'Wellbeing', 'Wisdom', 'Witness', 'Worth', 'Wonder', 'Wealth']),
}

/** A fictional name for a vessel of `line`, in that line's style. `random` returns [0, 1). */
export function vesselName(line: string, random: () => number): string {
  const style = STYLES[line]
  if (!style) throw new Error(`Unknown shipping line ${line}`)
  return style.name((list) => list[Math.min(list.length - 1, Math.floor(random() * list.length))])
}

/** The line whose naming style `name` follows, if any. Longer prefixes win ("COSCO Shipping" before "CMA"). */
export function lineFromVesselName(name: string): string | undefined {
  return Object.keys(STYLES).find((line) => STYLES[line].matches(name))
}

/** A vessel's operator: its explicit `line` if known, else the one its name's style implies (undefined = generic livery). */
export function vesselLine(v: Pick<VesselConfig, 'name' | 'line'>): string | undefined {
  if (v.line && v.line in LINE_OWNER_PREFIX) return v.line
  return lineFromVesselName(v.name)
}
