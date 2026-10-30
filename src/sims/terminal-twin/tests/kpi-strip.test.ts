import { describe, expect, it } from 'vitest'
import type { HeadlineKpis } from '../engine'
import { createFormatter } from '../i18n/format'
import { crossedThreshold, stripItems, tween } from '../modules/kpiStrip'

const fmt = createFormatter({ locale: 'en-GB', units: 'metric' })
const headline = (over: Partial<HeadlineKpis> = {}): HeadlineKpis => ({
  movesDone: 12,
  vesselsDone: 1,
  grossMovesPerHour: 24.5,
  netMovesPerHour: 31,
  shcEmptyTravelRatio: null,
  shcEmptyDistanceM: null,
  shcHandovers: null,
  shcStateS: null,
  shcBusyPct: null,
  ascUtilisationPct: null,
  yardFillPct: null,
  wtpDwellS: null,
  ...over,
})

describe('KPI strip', () => {
  it('always shows moves, vessels and crane productivity; subsystem KPIs only when they exist', () => {
    expect(stripItems(headline()).map((i) => i.id)).toEqual(['moves', 'vessels', 'gross', 'net'])
    const full = stripItems(headline({ shcBusyPct: 40, shcEmptyTravelRatio: 0.5, ascUtilisationPct: 55, yardFillPct: 3, wtpDwellS: 80 }))
    expect(full.map((i) => i.id)).toEqual(['moves', 'vessels', 'gross', 'net', 'shcBusy', 'shcEmpty', 'asc', 'yard', 'dwell'])
  })

  it('formats through the shared formatter', () => {
    const items = Object.fromEntries(stripItems(headline({ ascUtilisationPct: 55.55, wtpDwellS: 80 })).map((i) => [i.id, i]))
    expect(items.moves.format(fmt, 12)).toBe('12')
    expect(items.gross.format(fmt, 24.5)).toBe('24.5 moves/h')
    expect(items.asc.format(fmt, 55.55)).toBe('55.6 %')
    expect(items.dwell.format(fmt, 80)).toBe('1 min 20 s')
  })

  it('detects a threshold crossing in either direction, never from or to "no data"', () => {
    expect(crossedThreshold(80, 90, 85)).toBe(true)
    expect(crossedThreshold(90, 80, 85)).toBe(true)
    expect(crossedThreshold(80, 84, 85)).toBe(false)
    expect(crossedThreshold(null, 90, 85)).toBe(false)
    expect(crossedThreshold(90, null, 85)).toBe(false)
    expect(crossedThreshold(85, 85, 85)).toBe(false)
  })

  it('counts up with an ease-out curve and lands exactly on the target', () => {
    expect(tween(0, 100, 0, 600)).toBe(0)
    expect(tween(0, 100, 600, 600)).toBe(100)
    expect(tween(0, 100, 9999, 600)).toBe(100)
    const mid = tween(0, 100, 300, 600)
    expect(mid).toBeGreaterThan(50) // ease-out: more than linear at the half way point
    expect(mid).toBeLessThan(100)
    expect(tween(40, 10, 600, 600)).toBe(10)
  })
})
