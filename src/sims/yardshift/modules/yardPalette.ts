/**
 * Colours of the 2D yard drawing (canvas). The canvas cannot read the `--ys-*` custom properties cheaply every frame,
 * so they are mirrored here; `palette.test.ts` keeps each one equal to its `--ys-yard-*` entry in styles/palette.css.
 */
export const YARD_COLOURS = {
  'sky-top': '#a9c3cf',
  'sky-low': '#dbe6e9',
  distant: '#6d8a9c',
  quay: '#e3ddcf',
  concrete: '#d2cdc0',
  'concrete-dark': '#bdb7a8',
  'slot-line': '#c9a14a',
  'yard-text': '#2c3a44',
  gantry: '#2f68a3',
  'gantry-dark': '#1c4675',
  trolley: '#f2b632',
  cable: '#1a1f24',
  outline: '#1b2630',
  'number-ink': '#13212b',
  ghost: '#5ff0b0',
  rim: '#ffffff',
  urgent: '#e9483d',
  'collection-bay': '#2c5759',
  'collection-line': '#8fd1c6',
  'receipt-bay': '#4b5863',
  'receipt-line': '#b4c2cc',
  'receipt-urgent': '#8f3a2e',
  chassis: '#2a3138',
  wheel: '#14181c',
  'cab-white': '#eef2f3',
  'cab-steel': '#6f93b0',
  glass: '#6f97ad',
  'medal-light': '#fff2bd',
  'medal-dark': '#d39b31',
  'medal-rim': '#87531d',
  'medal-star': '#634016',
  'heavy-tile': '#1d232a',
  'sky-haze': '#c3d4da',
  'cab-teal': '#2f9e93',
  'hub': '#c9d3d8',
  'headlight': '#ffe9a8',
  'casting': '#20282f',
  'dust': '#efe7d6',
  'gold-shine': '#fffbe8',
  'gold-body': '#ffd84a',
  'gold-deep': '#f0b428',
  'receipt-cargo': '#d3dadf',
} as const

export type YardColour = keyof typeof YARD_COLOURS

/** `#rrggbb` mixed towards white (`amount` > 0) or black (`amount` < 0), as `rgb(...)`. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const mix = (c: number) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount))
  return `rgb(${mix((n >> 16) & 255)} ${mix((n >> 8) & 255)} ${mix(n & 255)})`
}
