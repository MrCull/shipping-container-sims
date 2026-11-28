/**
 * Yardshift palette: the sequence colours and grey in styles/palette.css match the view-model's. (No hex in the
 * components is enforced repo-wide by `scripts/check-no-hex-colours.mjs` in verify.)
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GREY, SEQUENCE_COLOURS } from './presentation'
import { shade, YARD_COLOURS } from './yardPalette'

const palette = readFileSync(join(__dirname, '..', 'styles/palette.css'), 'utf8')

describe('Yardshift palette', () => {
  it('the sequence colours and grey in palette.css match the view-model', () => {
    SEQUENCE_COLOURS.forEach((hex, i) => expect(palette).toContain(`--ys-seq-${i}: ${hex};`))
    expect(palette).toContain(`--ys-grey: ${GREY};`)
  })
})

describe('Yardshift 2D yard palette', () => {
  it('every canvas colour in yardPalette.ts has its --ys-yard-* entry in palette.css', () => {
    for (const [name, hex] of Object.entries(YARD_COLOURS)) expect(palette).toContain(`--ys-yard-${name}: ${hex};`)
  })

  it('the active bonus is bright metallic gold, never brown (owner round 5): every gold face is light and warm', () => {
    const rgb = (hex: string) => [16, 8, 0].map((s) => ((parseInt(hex.slice(1), 16) >> s) & 255) / 255)
    const lum = (hex: string) =>
      rgb(hex)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
        .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i]!, 0)
    expect(YARD_COLOURS['gold-body']).toBe('#ffd84a')
    expect(YARD_COLOURS['gold-deep']).toBe('#f0b428')
    for (const name of ['gold-shine', 'gold-body', 'gold-deep'] as const) {
      const hex = YARD_COLOURS[name]
      // Brown is a dark orange: a gold face keeps a relative luminance of at least 0.45.
      expect(lum(hex), name).toBeGreaterThanOrEqual(0.45)
      const [r, g, b] = rgb(hex)
      expect(r! >= g! && g! >= b!, name).toBe(true)
    }
  })

  it('shade lightens towards white and darkens towards black', () => {
    expect(shade('#808080', 1)).toBe('rgb(255 255 255)')
    expect(shade('#808080', -1)).toBe('rgb(0 0 0)')
    expect(shade('#808080', 0)).toBe('rgb(128 128 128)')
  })
})
