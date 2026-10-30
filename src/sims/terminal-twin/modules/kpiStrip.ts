/**
 * KPI strip logic (pure): which headline KPIs to show, how to format them, the
 * count-up easing and the threshold-crossing test that triggers the pulse.
 */
import type { HeadlineKpis } from '../engine'
import type { Formatter } from '../i18n/format'
import { t, type MessageKey } from '../i18n/messages'

export type StripItemId = 'moves' | 'vessels' | 'gross' | 'net' | 'shcBusy' | 'shcEmpty' | 'asc' | 'yard' | 'dwell'

export interface StripItem {
  id: StripItemId
  labelKey: MessageKey
  value: number | null
  format(fmt: Formatter, value: number): string
  /** Minimum width of the value in `ch` (tabular figures), so the tile does not resize as the value ticks. */
  minWidthCh: number
  /** The pulse fires when the value crosses this limit in either direction. [A] illustrative targets. */
  threshold?: number
}

/** Rates and percentages always show one decimal; counts none. */
const count = (f: Formatter, v: number) => f.fixed(v, 0)
const rate = (f: Formatter, v: number) => t('unit.movesPerHour', { value: f.fixed(v, 1) })
const pct = (f: Formatter, v: number) => t('unit.percent', { value: f.fixed(v, 1) })

// Widths fit the longest realistic text: "1,000.0 moves/h", "100.0 %", "12 min 05 s", "99,999".
const W_COUNT = 6
const W_RATE = 15
const W_PCT = 7
const W_DURATION = 11

export function stripItems(h: HeadlineKpis): StripItem[] {
  const items: StripItem[] = [
    { id: 'moves', labelKey: 'kpi.moves', value: h.movesDone, format: count, minWidthCh: W_COUNT },
    { id: 'vessels', labelKey: 'kpi.vessels', value: h.vesselsDone, format: count, minWidthCh: W_COUNT },
    { id: 'gross', labelKey: 'kpi.gross', value: h.grossMovesPerHour, format: rate, minWidthCh: W_RATE },
    // net productivity falling under ~20 moves/h per crane-sum is worth a look
    { id: 'net', labelKey: 'kpi.net', value: h.netMovesPerHour, format: rate, minWidthCh: W_RATE, threshold: 20 },
  ]
  if (h.shcBusyPct !== null) {
    items.push({ id: 'shcBusy', labelKey: 'kpi.shcBusy', value: h.shcBusyPct, format: pct, minWidthCh: W_PCT, threshold: 90 })
    items.push({
      id: 'shcEmpty',
      labelKey: 'kpi.shcEmpty',
      value: h.shcEmptyTravelRatio,
      format: (f, v) => pct(f, v * 100),
      minWidthCh: W_PCT,
      threshold: 0.6,
    })
  }
  if (h.ascUtilisationPct !== null)
    items.push({ id: 'asc', labelKey: 'kpi.asc', value: h.ascUtilisationPct, format: pct, minWidthCh: W_PCT, threshold: 85 })
  if (h.yardFillPct !== null)
    items.push({ id: 'yard', labelKey: 'kpi.yard', value: h.yardFillPct, format: pct, minWidthCh: W_PCT, threshold: 80 })
  if (h.wtpDwellS !== null) items.push({ id: 'dwell', labelKey: 'kpi.dwell', value: h.wtpDwellS, format: (f, v) => f.duration(v), minWidthCh: W_DURATION })
  return items
}

/** True when the value moved from one side of `limit` to the other (never from or to "no data"). */
export function crossedThreshold(prev: number | null, next: number | null, limit: number): boolean {
  if (prev === null || next === null) return false
  return prev > limit !== next > limit
}

/** Ease-out count-up from `from` to `to` after `elapsedMs` of `durationMs`. */
export function tween(from: number, to: number, elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0 || elapsedMs >= durationMs) return to
  if (elapsedMs <= 0) return from
  const p = elapsedMs / durationMs
  const eased = 1 - (1 - p) ** 3
  return from + (to - from) * eased
}

/** The user asked the system for less animation: count-ups jump straight to the value. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}
