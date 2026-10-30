/** Native min/step validation blocks form submit before the catalogue error messages can show (TT-07). `step="any"` is fine: it turns step validation off. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('setup dialog end-condition inputs', () => {
  it('carry no min, max or fixed step attributes', () => {
    const src = readFileSync(new URL('../components/modals/SetupDialog.vue', import.meta.url), 'utf8')
    const start = src.indexOf('data-testid="tt-end-conditions"')
    expect(start).toBeGreaterThan(0)
    const fieldset = src.slice(start, src.indexOf('</fieldset>', start))
    expect(fieldset).not.toMatch(/\s:?(min|max)=/)
    expect(fieldset).not.toMatch(/\s:?step="(?!any")/)
  })
})
