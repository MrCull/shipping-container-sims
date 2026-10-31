/**
 * Dashboard palette (seam: dashboardPalette module). The categorical steps were
 * validated with the dataviz skill's validate_palette.js (light mode, surface
 * #fcfcfb): all checks PASS (worst adjacent CVD dE 8.4, normal vision 19.3).
 * This test pins those exact validated values and the non-colour channels.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_SERIES,
  PHASE_COLOURS,
  PHASE_PATTERNS,
  SERIES_COLOURS,
  SERIES_DASHES,
  SERIES_SYMBOLS,
  SURFACE,
  seriesStyle,
} from '../modules/dashboardPalette'

describe('dashboard palette', () => {
  it('is exactly the validated light categorical set, in order', () => {
    expect(SURFACE).toBe('#fcfcfb')
    expect([...SERIES_COLOURS].join(',')).toBe('#2a78d6,#eb6834,#1baf7a,#eda100,#e87ba4,#008300,#6250d6,#e34948')
  })

  it('gives every series slot a distinct marker symbol as well as a colour', () => {
    expect(new Set(SERIES_SYMBOLS).size).toBe(MAX_SERIES)
    expect(SERIES_DASHES).toHaveLength(MAX_SERIES)
    // neighbours also differ in dash so adjacent lines are never colour-only
    for (let i = 1; i < MAX_SERIES; i++) expect(SERIES_DASHES[i]).not.toBe(SERIES_DASHES[i - 1])
  })

  it('assigns styles by slot and clamps beyond the last', () => {
    expect(seriesStyle(0).colour).toBe('#2a78d6')
    expect(seriesStyle(99).colour).toBe(SERIES_COLOURS[MAX_SERIES - 1])
  })

  it('gives every Gantt phase a distinct colour and a distinct pattern', () => {
    const colours = Object.values(PHASE_COLOURS)
    expect(new Set(colours).size).toBe(colours.length)
    // the first five validated slots, in order (validated as a set with the skill's script)
    expect(colours).toEqual(SERIES_COLOURS.slice(0, colours.length))
    const patterns = Object.values(PHASE_PATTERNS).map((p) => `${p.symbol}/${p.rotation}`)
    expect(new Set(patterns).size).toBe(patterns.length)
  })
})
