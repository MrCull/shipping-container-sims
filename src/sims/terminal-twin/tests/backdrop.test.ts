import { describe, expect, it } from 'vitest'
import { BACKDROP_PARTS, backdropKindFor, buildBackdrop } from '../modules/backdrop'
import { presets } from '../scenario/presets'

describe('backdrop', () => {
  it('uses the Algeciras backdrop for the TTI preset only', () => {
    const kinds = Object.fromEntries(Object.keys(presets).map((name) => [name, backdropKindFor(name)]))
    expect(kinds).toEqual({ 'TTI Algeciras baseline': 'tti', 'Small automated': 'generic', 'Stress test': 'generic' })
    expect(backdropKindFor('tracer')).toBe('generic')
  })

  it('builds the named parts, and only those', () => {
    for (const kind of ['tti', 'generic'] as const) {
      const b = buildBackdrop(kind, 1000)
      const names = b.group.children.map((c) => c.name).sort()
      expect(names).toEqual([...BACKDROP_PARTS[kind]].sort())
      b.dispose()
    }
    expect(BACKDROP_PARTS.generic).not.toContain('rock')
  })

  it('draws the Rock about 426 m high (stretched a little for the view) and the North Quay 550 m long', () => {
    const b = buildBackdrop('tti', 1000)
    const rock = b.group.getObjectByName('rock') as import('three').Mesh
    rock.geometry.computeBoundingBox()
    const h = (rock.geometry.boundingBox?.max.y ?? 0) * rock.scale.y
    expect(h).toBeGreaterThan(426)
    expect(h).toBeLessThan(600)
    const quay = b.group.getObjectByName('northQuay') as import('three').Group
    const slab = quay.children[0] as import('three').Mesh
    slab.geometry.computeBoundingBox()
    const bb = slab.geometry.boundingBox!
    expect(bb.max.x - bb.min.x).toBe(550)
  })
})
