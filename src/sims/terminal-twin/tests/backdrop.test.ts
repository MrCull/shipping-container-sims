import { Box3 } from 'three'
import { describe, expect, it } from 'vitest'
import { buildBackdrop, GENERIC_SCENERY, sceneryFor } from '../modules/backdrop'
import { presets } from '../scenario/presets'

describe('backdrop', () => {
  it('uses the Algeciras backdrop for the TTI presets only', () => {
    const kinds = Object.fromEntries(Object.keys(presets).map((name) => [name, sceneryFor(name).kind]))
    expect(kinds).toEqual({ 'TTI Algeciras baseline': 'tti', 'Small automated': 'generic', 'TTI Algeciras, peak day': 'tti' })
    expect(sceneryFor('tracer').kind).toBe('generic')
  })

  it('builds the named parts, and only those', () => {
    for (const scenery of [sceneryFor('TTI Algeciras baseline'), GENERIC_SCENERY]) {
      const b = buildBackdrop(scenery, 1000)
      const names = b.group.children.map((c) => c.name).sort()
      expect(names).toEqual([...scenery.parts].sort())
      b.dispose()
    }
    expect(GENERIC_SCENERY.parts).not.toContain('rock')
  })

  it('draws the North Quay 550 m long (the Rock is in terminals.test.ts)', () => {
    const b = buildBackdrop(sceneryFor('TTI Algeciras baseline'), 1000)
    const quay = b.group.getObjectByName('northQuay') as import('three').Group
    const slab = quay.children[0] as import('three').Mesh
    slab.geometry.computeBoundingBox()
    const bb = slab.geometry.boundingBox!
    expect(bb.max.x - bb.min.x).toBe(550)
  })

  it('puts the North Quay at the north end (x < 0) and the ground parts on TTI only (#147)', () => {
    const b = buildBackdrop(sceneryFor('TTI Algeciras baseline'), 1000)
    b.group.updateMatrixWorld(true)
    const box = new Box3().setFromObject(b.group.getObjectByName('northQuay')!)
    expect(box.max.x).toBeLessThanOrEqual(1)
    expect(box.min.x).toBeLessThan(-60)
    expect(box.max.z - box.min.z).toBeCloseTo(550, 0)
    for (const part of ['tarmacSouth', 'seaChannel', 'greenLand', 'northMountains']) expect(b.group.getObjectByName(part)).toBeDefined()
    b.dispose()
    for (const part of ['tarmacSouth', 'seaChannel', 'greenLand', 'northMountains', 'northQuay']) expect(GENERIC_SCENERY.parts).not.toContain(part)
  })
})
