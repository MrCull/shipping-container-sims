/**
 * Dashboard data palette (TT-16). Colour-blind-safe by the repo's dataviz skill:
 * the dark-mode categorical steps below were validated with its
 * `validate_palette.js --mode dark` (lightness band, chroma floor, adjacent CVD
 * and normal-vision separation, contrast >= 3:1 on the surface).
 *
 * Colour never carries identity alone: every series slot also has its own marker
 * symbol and line dash, and charts always show a legend.
 */

/** Chart surface the palette was validated against (the dashboard panel background). */
export const SURFACE = '#1a1a19'

/** Categorical slots in fixed order (never cycled; a 9th series is folded away). */
export const SERIES_COLOURS = [
  '#3987e5', // blue
  '#d95926', // orange
  '#199e70', // aqua
  '#c98500', // yellow
  '#d55181', // magenta
  '#008300', // green
  '#9085e9', // violet
  '#e66767', // red
] as const

export const MAX_SERIES = SERIES_COLOURS.length

export type MarkerSymbol = 'circle' | 'rect' | 'triangle' | 'diamond' | 'roundRect' | 'pin' | 'arrow' | 'emptyCircle'
export type DashStyle = 'solid' | 'dashed' | 'dotted'

/** Secondary encodings, one per slot. */
export const SERIES_SYMBOLS: readonly MarkerSymbol[] = [
  'circle',
  'rect',
  'triangle',
  'diamond',
  'roundRect',
  'pin',
  'arrow',
  'emptyCircle',
]
export const SERIES_DASHES: readonly DashStyle[] = ['solid', 'dashed', 'dotted', 'solid', 'dashed', 'dotted', 'solid', 'dashed']

export interface SeriesStyle {
  colour: string
  symbol: MarkerSymbol
  dash: DashStyle
}

export function seriesStyle(slot: number): SeriesStyle {
  const i = Math.min(Math.max(0, Math.floor(slot)), MAX_SERIES - 1)
  return { colour: SERIES_COLOURS[i], symbol: SERIES_SYMBOLS[i], dash: SERIES_DASHES[i] }
}

/** One-hue sequential ramp (blue, light to dark steps 250 to 700) for the heatmap: low = recedes. */
export const SEQUENTIAL_BLUE = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#184f95', '#104281', '#0d366b'] as const

/**
 * Gantt phases. Every phase has its own fill texture as well as its colour, and
 * is labelled in the legend.
 */
export const PHASE_COLOURS = {
  work: '#3987e5',
  anchorage: '#d95926',
  package: '#199e70',
  mooring: '#c98500',
  unmooring: '#d55181',
} as const

export type TimelinePhase = keyof typeof PHASE_COLOURS

/** Fill pattern per phase (ECharts decal symbol / dash angle), so state is not conveyed by colour alone. */
export const PHASE_PATTERNS: Record<TimelinePhase, { symbol: string; rotation: number }> = {
  anchorage: { symbol: 'rect', rotation: Math.PI / 4 },
  mooring: { symbol: 'circle', rotation: 0 },
  work: { symbol: 'none', rotation: 0 },
  unmooring: { symbol: 'rect', rotation: -Math.PI / 4 },
  package: { symbol: 'triangle', rotation: 0 },
}
