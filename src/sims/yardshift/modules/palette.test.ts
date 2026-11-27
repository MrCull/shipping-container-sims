/**
 * Yardshift palette: components take colours from the shared tokens (src/assets/main.css) or the sim's `--ys-*`
 * properties in styles/palette.css, never hex; the sequence colours and grey match the view-model's.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GREY, SEQUENCE_COLOURS } from './presentation'

const root = join(__dirname, '..')
const palette = readFileSync(join(root, 'styles/palette.css'), 'utf8')
const components = ['Yardshift.vue', 'components/modals/YardScreens.vue', 'components/ui/YardHud.vue', 'components/ui/YardQueue.vue']

function styleOf(file: string): string {
  const src = readFileSync(join(root, file), 'utf8')
  return src.slice(src.indexOf('<style'))
}

describe('Yardshift palette', () => {
  it('components use tokens, not hex colours', () => {
    for (const file of components) expect(styleOf(file), file).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  it('the sequence colours and grey in palette.css match the view-model', () => {
    SEQUENCE_COLOURS.forEach((hex, i) => expect(palette).toContain(`--ys-seq-${i}: ${hex};`))
    expect(palette).toContain(`--ys-grey: ${GREY};`)
  })
})
