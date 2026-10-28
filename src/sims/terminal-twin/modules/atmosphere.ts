/**
 * Time of day (TT-21): the sun follows the sim clock (local time, as the clock
 * display). Pure maths: the Three.js side (`atmosphereRig.ts`) applies the result.
 * At night the scene switches to a cheaper mode: no shadow pass, floodlight
 * glow and emissive equipment lights instead of real lights.
 */
import { STRESS_PRESET_NAME } from '../scenario/presets'

export const SUNRISE_H = 6.5
export const SUNSET_H = 19.5

export type LightingMode = 'day' | 'dusk' | 'night'

export interface Lighting {
  mode: LightingMode
  /** 0 (dark) to 1 (full day). */
  daylight: number
  /** Direction towards the sun (not normalised); y is up. */
  sun: { x: number; y: number; z: number }
  /** The sun casts shadows: not at night (the cheaper mode). */
  shadows: boolean
  /** 0 to 1: strength of floodlight glow and equipment lights. */
  floodGlow: number
}

/** Local hour of day (0 to 24) at sim time `simTimeS`. */
export function hourOfDay(startIso: string, simTimeS: number): number {
  const d = new Date(new Date(startIso).getTime() + simTimeS * 1000)
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
}

const smooth = (a: number, b: number, x: number): number => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return k * k * (3 - 2 * k)
}

/**
 * Lighting at a local hour. `lockDaylight` squeezes the whole 24 h into the
 * daylight window, so the sun still travels but it never gets dark.
 */
export function lightingFor(hour: number, lockDaylight: boolean): Lighting {
  const h = ((hour % 24) + 24) % 24
  const effective = lockDaylight ? SUNRISE_H + 1 + (h / 24) * (SUNSET_H - SUNRISE_H - 2) : h
  const p = (effective - SUNRISE_H) / (SUNSET_H - SUNRISE_H)
  const inDay = p >= 0 && p <= 1
  const elevation = inDay ? Math.sin(Math.PI * p) : 0
  const daylight = lockDaylight ? 1 : smooth(0, 0.22, inDay ? elevation : 0)
  const mode: LightingMode = daylight > 0.7 ? 'day' : daylight > 0.05 ? 'dusk' : 'night'
  return {
    mode,
    daylight,
    sun: { x: 300 * Math.cos(Math.PI * p), y: 40 + 260 * elevation, z: 180 },
    shadows: mode !== 'night',
    floodGlow: 1 - daylight,
  }
}

/** Whether the daylight lock starts on: yes for the Stress test preset (a long run should stay readable). */
export function daylightLockDefault(scenarioName: string): boolean {
  return scenarioName === STRESS_PRESET_NAME
}
