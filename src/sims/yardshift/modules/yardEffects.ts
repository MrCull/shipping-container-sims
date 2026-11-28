/**
 * Render-only effects of the 2D yard (art pass 2): urgency vibration and glow, landing squash, the collection truck's
 * bounce and drive-off, the red reject shake, bonus collect particles and the missed-bonus poof. Pure and deterministic:
 * every value is a function of the time (ms) and the effect's start, so a frame can be redrawn exactly and the tests can
 * sample it. Nothing here moves a hit region; the renderer only offsets what it paints.
 */
import { FOCUS_BASE_RISK } from './presentation'
import { CHEVRON_BOUNCE } from './yardGeometry'
import type { HitTarget } from '../types/presentation'

/** One effect in flight; `at` is its start time (ms, the renderer's clock). */
export type Fx =
  /** A container set down on a stack top or a truck: squash and a dust puff. */
  | { kind: 'land'; at: number; target: HitTarget }
  /** The collection truck took a container: bounce, then drive off with it and come back empty. */
  | { kind: 'collect'; at: number; label: string; colour: string; bonus: boolean }
  /** A bonus was collected: coin and star burst over the collection truck, gold flash. */
  | { kind: 'bonus'; at: number }
  /** A bonus was missed: the container's gold fades to its own colour with a poof. */
  | { kind: 'bonus-miss'; at: number; id: number }
  /** A move was refused: the tapped container shakes red, sideways only. */
  | { kind: 'reject'; at: number; target: HitTarget }

export const FX_MS: Record<Fx['kind'], number> = {
  land: 320,
  collect: 1400,
  bonus: 900,
  'bonus-miss': 520,
  reject: 320,
}

/** Progress 0..1 of an effect at `now` (1 once it is over). */
export function fxProgress(fx: Fx, now: number): number {
  return Math.min(1, Math.max(0, (now - fx.at) / FX_MS[fx.kind]))
}

/** The effects still running at `now`. */
export function liveFx(list: readonly Fx[], now: number): Fx[] {
  return list.filter((fx) => now - fx.at < FX_MS[fx.kind])
}

/** Vibration frequency (Hz) of an urgent container: a tight buzz, not a wobble. */
export const VIBRATE_HZ = 27

/** Horizontal vibration offset (px) for a shake risk 0..1: about 1 px rising to 2 px at 27 Hz. Never vertical. */
export function vibrateX(risk: number, now: number, seed: number): number {
  if (risk <= 0) return 0
  const amp = 1 + Math.min(1, risk)
  return amp * Math.sin((2 * Math.PI * VIBRATE_HZ * now) / 1000 + seed * 1.7)
}

export interface UrgencyStyle {
  /** Risk the container vibrates with (0: still). */
  vibrate: number
  /** Urgency outline: white flashing red under normal motion, static white with a red inner line under reduced motion (round 5). */
  red: boolean
  /** Soft glow of the calm current container. */
  glow: boolean
}

/**
 * How a container shows urgency (owner, art pass 2): the current container on a calm turn glows softly; when the next
 * truck clock is low (risk above the calm base) it vibrates with the white and red urgency outline; in the last seconds of the shift every
 * container vibrates. Under reduced motion nothing moves: the static `urgent` flag gives the static urgency outline.
 */
export function urgencyStyle(c: { shake: number; urgent: boolean }, current: boolean, reducedMotion: boolean): UrgencyStyle {
  if (reducedMotion || c.urgent) return { vibrate: 0, red: c.urgent, glow: current && !c.urgent }
  const calm = c.shake <= FOCUS_BASE_RISK + 1e-6
  // Art pass 3: the next container glows from the start of its turn, whatever its shake.
  if (current) return calm ? { vibrate: 0, red: false, glow: true } : { vibrate: c.shake, red: true, glow: false }
  return { vibrate: c.shake, red: false, glow: false }
}

/** How far the next container bobs (px, peak to peak; owner, art pass 3: about 2 px at about 1 Hz). */
export const BOB_PX = 2

/** Vertical paint offset (px, up is negative) of the next container: a gentle 1 Hz bob; 0 under reduced motion. */
export function nextBob(now: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0
  return -BOB_PX * (0.5 - 0.5 * Math.cos((2 * Math.PI * now) / 1000))
}

/** Vertical paint offset (px) of the NEXT chevron: a bounce within `CHEVRON_BOUNCE`; 0 under reduced motion. */
export function chevronBounce(now: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0
  return CHEVRON_BOUNCE * -Math.abs(Math.sin((Math.PI * now) / 700)) * 2 + CHEVRON_BOUNCE
}

/** A 0..1 pulse with period `periodMs`. */
export function pulse(now: number, periodMs: number, phase = 0): number {
  return 0.5 + 0.5 * Math.sin((2 * Math.PI * now) / periodMs + phase)
}

/** Landing squash: scale x up and y down, then spring back to 1 by the end. */
export function squash(t: number): { sx: number; sy: number } {
  if (t <= 0 || t >= 1) return { sx: 1, sy: 1 }
  const e = Math.sin(Math.PI * Math.min(1, t * 1.6)) * (1 - t)
  return { sx: 1 + 0.1 * e, sy: 1 - 0.14 * e }
}

/** Reject shake: a short decaying sideways shake (px). */
export function rejectX(t: number): number {
  if (t <= 0 || t >= 1) return 0
  return 4 * Math.sin(t * Math.PI * 6) * (1 - t)
}

/** The collection truck's motion over a collect effect: a bounce, off to the left with the box, back in empty. */
export function collectMotion(t: number, distance: number): { x: number; y: number; carrying: boolean } {
  if (t <= 0 || t >= 1) return { x: 0, y: 0, carrying: false }
  if (t < 0.18) return { x: 0, y: -3 * Math.abs(Math.sin((t / 0.18) * Math.PI * 2)) * (1 - t / 0.18), carrying: true }
  if (t < 0.5) {
    const u = (t - 0.18) / 0.32
    return { x: -distance * u * u, y: 0, carrying: true }
  }
  if (t < 0.6) return { x: distance, y: 0, carrying: false }
  const u = (t - 0.6) / 0.4
  const ease = 1 - (1 - u) * (1 - u)
  return { x: distance * (1 - ease), y: 0, carrying: false }
}

export interface Particle {
  x: number
  y: number
  r: number
  alpha: number
  star: boolean
}

/** Deterministic hash 0..1 of an integer. */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** Coin and star burst: `count` particles fly out from the origin, fall and fade. Offsets from the origin (px). */
export function burst(t: number, count = 14, reach = 60): Particle[] {
  if (t <= 0 || t >= 1) return []
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 + hash(i) * 0.5
    const v = reach * (0.6 + 0.4 * hash(i + 50))
    const ease = 1 - (1 - t) * (1 - t)
    return {
      x: Math.cos(a) * v * ease,
      y: Math.sin(a) * v * ease * 0.8 - 26 * ease + 40 * t * t,
      r: 2.5 + 2 * hash(i + 90),
      alpha: 1 - t * t,
      star: i % 3 === 0,
    }
  })
}

/** Sparkle points over a gold container: four twinkles whose size follows their own phase. */
export function sparkles(now: number, seed: number, fast: boolean): { u: number; v: number; s: number }[] {
  const period = fast ? 520 : 1100
  return Array.from({ length: 4 }, (_, i) => {
    const phase = (now / period + hash(seed * 7 + i)) % 1
    const s = Math.max(0, Math.sin(phase * Math.PI))
    return { u: hash(seed * 13 + i * 3 + Math.floor(now / period + hash(seed * 7 + i))), v: hash(seed * 17 + i * 5), s: s * s }
  })
}

/** The shine sweep across a gold container: 0..1 position of the band, or null between sweeps (every 1.6 s). */
export function shineAt(now: number, seed: number): number | null {
  const period = 1600
  const t = ((now + seed * 211) % period) / period
  return t < 0.35 ? t / 0.35 : null
}
