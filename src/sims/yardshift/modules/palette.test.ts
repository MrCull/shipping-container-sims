/**
 * Yardshift palette: the sequence colours and grey in styles/palette.css match the view-model's. (No hex in the
 * components is enforced repo-wide by `scripts/check-no-hex-colours.mjs` in verify.)
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GREY, SEQUENCE_COLOURS } from './presentation'

const palette = readFileSync(join(__dirname, '..', 'styles/palette.css'), 'utf8')

describe('Yardshift palette', () => {
  it('the sequence colours and grey in palette.css match the view-model', () => {
    SEQUENCE_COLOURS.forEach((hex, i) => expect(palette).toContain(`--ys-seq-${i}: ${hex};`))
    expect(palette).toContain(`--ys-grey: ${GREY};`)
  })
})
