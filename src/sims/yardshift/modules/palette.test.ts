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

  it('shade lightens towards white and darkens towards black', () => {
    expect(shade('#808080', 1)).toBe('rgb(255 255 255)')
    expect(shade('#808080', -1)).toBe('rgb(0 0 0)')
    expect(shade('#808080', 0)).toBe('rgb(128 128 128)')
  })
})
