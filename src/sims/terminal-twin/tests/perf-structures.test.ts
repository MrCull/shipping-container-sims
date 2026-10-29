import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  blockersOf,
  boxesAbove,
  createSimulation,
  indexYardSlotAdded,
  indexYardSlotRemoved,
  suggestedInvariantEvery,
  yardIndexOf,
  type YardSlotState,
} from '../engine'
import { StaticBatch } from '../modules/staticBatch'
import { presets } from '../scenario/presets'

const slot = (id: string, bay: number, row: number, tier: number, span: 1 | 2 = 1): YardSlotState => ({ id, blockId: 'B01', bay, row, tier, span, containerId: id })

describe('yard index (TT-19)', () => {
  it('answers "what stands above" like the full scan did, and follows adds and removals', () => {
    const slots: Record<string, YardSlotState> = { a: slot('a', 1, 1, 1), b: slot('b', 1, 1, 2), c: slot('c', 2, 1, 1, 2), d: slot('d', 1, 1, 3) }
    const state = { yardSlots: slots } as unknown as Parameters<typeof boxesAbove>[0]
    expect(boxesAbove(state, slots.a).map((s) => s.id)).toEqual(['d', 'b'])
    // a 40 ft box on bays 2-3 and a 20 ft box on bay 1: nothing is above the 40 ft box
    expect(boxesAbove(state, slots.c)).toEqual([])
    const e = slot('e', 2, 1, 2, 2)
    slots.e = e
    indexYardSlotAdded(state, e)
    expect(boxesAbove(state, slots.c).map((s) => s.id)).toEqual(['e'])
    expect(blockersOf(state, slots.a).map((s) => s.id)).toEqual(['d', 'b'])
    const removed = slots.b
    delete slots.b
    indexYardSlotRemoved(state, removed)
    expect(boxesAbove(state, slots.a).map((s) => s.id)).toEqual(['d'])
    expect(yardIndexOf(state).byBlock.get('B01')?.length).toBe(4) // a, c, d, e
  })

  it('a run with the index in place keeps the engine deterministic (same hash twice)', () => {
    const run = () => {
      const sim = createSimulation(presets['Small automated'](), {}, { invariants: { every: 25 } })
      sim.runUntil({ time: 3600 })
      return sim.eventLogHash()
    }
    expect(run()).toBe(run())
  })
})

describe('invariant cadence for large yards', () => {
  it('checks every event for small scenarios and sparsely at TTI scale', () => {
    expect(suggestedInvariantEvery(presets['Small automated']())).toBeGreaterThan(1)
    expect(suggestedInvariantEvery(presets['TTI Algeciras baseline']())).toBeGreaterThan(100)
    expect(suggestedInvariantEvery(presets['TTI Algeciras baseline']())).toBeLessThanOrEqual(500)
  })
})

describe('static batch', () => {
  it('merges pieces into one mesh per material and keeps their placement', () => {
    const batch = new StaticBatch()
    const a = new THREE.MeshBasicMaterial()
    const b = new THREE.MeshBasicMaterial()
    for (let i = 0; i < 50; i++) {
      const geo = new THREE.PlaneGeometry(2, 4)
      batch.add(geo, a, { x: i * 10, y: 0.5, z: 3 }, { rotationX: -Math.PI / 2, receiveShadow: true })
      geo.dispose()
    }
    batch.add(new THREE.BoxGeometry(1, 1, 1), b, { x: 0, y: 1, z: 0 })
    expect(batch.pieces).toBe(51)
    const disposables: { dispose(): void }[] = []
    const meshes = batch.build((t) => (disposables.push(t), t))
    expect(meshes).toHaveLength(2)
    const ground = meshes.find((m) => m.material === a)!
    expect(ground.receiveShadow).toBe(true)
    ground.geometry.computeBoundingBox()
    const box = ground.geometry.boundingBox!
    expect(box.min.x).toBeCloseTo(-1)
    expect(box.max.x).toBeCloseTo(491)
    expect(box.min.y).toBeCloseTo(0.5)
    expect(box.max.y).toBeCloseTo(0.5) // laid flat
    expect(box.min.z).toBeCloseTo(1)
    expect(box.max.z).toBeCloseTo(5)
  })
})
