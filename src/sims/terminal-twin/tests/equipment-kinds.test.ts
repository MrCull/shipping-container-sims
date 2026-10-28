/**
 * Adding an equipment kind touches several modules (picking, inspector, labels, catalogue). This source scan
 * fails when a kind is missing from one of them, so the author learns it from the test run, not from a later merge.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const inspector = read('modules/entityInspector.ts')
const KINDS = [...read('modules/entityInspector.ts').match(/export type EntityKind = ([^\n]+)/)![1]!.matchAll(/'(\w+)'/g)].map((m) => m[1]!)
const EQUIPMENT = KINDS.filter((k) => k !== 'container')

describe('equipment kinds are registered everywhere', () => {
  it('finds the kinds', () => {
    expect(EQUIPMENT.length).toBeGreaterThanOrEqual(4)
  })

  for (const kind of EQUIPMENT) {
    it(`${kind}: picking, inspector, labels and catalogue`, () => {
      expect(read('modules/picking.ts'), 'picking.ts (entityBounds / pickEntity)').toContain(`${kind}Ids`)
      expect(inspector, 'entityInspector.ts (entityKind / describeEntity)').toContain(`case '${kind}'`)
      expect(read('modules/overlayLayers.ts'), 'overlayLayers.ts (label kinds)').toContain(`'${kind}'`)
      const messages = read('i18n/messages.ts')
      expect(messages, 'catalogue key').toContain(`'inspector.kind.${kind}'`)
    })
  }
})
