/**
 * #249: the far tier of the infrastructure (stand-ins for yard fences, ASC rails and masts beyond a distance). Pure
 * logic and the instanced scene with fake geometries (no WebGL): the stand-in is a 12-triangle box around the real
 * geometry, the switch has hysteresis, and the far tier cuts triangles while keeping the draw-call count bounded.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { blockSpecs, buildLandsideGraph, wtpPadLayout } from '../engine'
import { FAR_TIER, FarTierSelector, standInGeometry } from '../modules/farTier'
import type { InfraAssets, InfraKey } from '../modules/infrastructureAssets'
import { countByKey, type InfraLayoutInput } from '../modules/infrastructureLayout'
import { InfrastructureScene } from '../modules/infrastructureRenderer'
import { presets, TTI_PRESET_NAME } from '../scenario/presets'

const tti = presets[TTI_PRESET_NAME]()
const input: InfraLayoutInput = { config: tti, landside: buildLandsideGraph(tti), pads: wtpPadLayout(tti), blocks: blockSpecs(tti) }

describe('standInGeometry', () => {
  it('is a 12-triangle box as tall as the source, with the footprint of its lower part, and UVs from the source', () => {
    const src = new THREE.CylinderGeometry(0.2, 0.3, 10, 16).translate(1, 5, 2)
    const g = standInGeometry(src)
    expect(g.index!.count / 3).toBe(12)
    g.computeBoundingBox()
    src.computeBoundingBox()
    expect(g.boundingBox!.min.x).toBeCloseTo(src.boundingBox!.min.x, 5)
    expect(g.boundingBox!.max.y).toBeCloseTo(src.boundingBox!.max.y, 5)
    expect(g.boundingBox!.max.z).toBeCloseTo(src.boundingBox!.max.z, 5)
    expect(g.boundingBox!.max.x - g.boundingBox!.min.x).toBeLessThan(0.7) // the pole, not a block
    expect(g.getAttribute('uv').count).toBe(g.getAttribute('position').count)
  })
})

describe('FarTierSelector', () => {
  const positions: [number, number][] = [
    [0, 0],
    [100, 0],
    [200, 0],
  ]
  it('switches an instance far beyond the far distance and back only inside the hysteresis band', () => {
    const s = new FarTierSelector(positions, 150, 20)
    expect(s.update(0, 0, 0)).toBe(true)
    expect([...s.far]).toEqual([0, 0, 1])
    s.update(60, 0, 0) // instance 2 is 140 m away: inside the band (130 to 150), stays far
    expect([...s.far]).toEqual([0, 0, 1])
    s.update(80, 0, 0) // 120 m: back to near
    expect([...s.far]).toEqual([0, 0, 0])
    s.update(-60, 0, 0) // instance 1 is 160 m away: far; instance 2 at 260 far
    expect([...s.far]).toEqual([0, 1, 1])
  })
  it('counts the camera height in the distance', () => {
    const s = new FarTierSelector(positions, 150, 20)
    s.update(0, 160, 0)
    expect([...s.far]).toEqual([1, 1, 1])
  })
  it('reports no change when the camera has not moved enough to flip anything', () => {
    const s = new FarTierSelector(positions, 150, 20)
    s.update(0, 0, 0)
    expect(s.update(1, 0, 0)).toBe(false)
  })
})

describe('InfrastructureScene far tier', () => {
  function fakeAssets(keys: InfraKey[]): InfraAssets {
    const geometries: InfraAssets['geometries'] = {}
    for (const k of keys) geometries[k] = new THREE.CylinderGeometry(0.2, 0.3, 10, 16) // 64 triangles
    return { material: new THREE.MeshStandardMaterial(), geometries }
  }
  const keys = () => Object.keys(countByKey(new InfrastructureScene(input).placements)) as InfraKey[]

  it('draws far instances as stand-ins and cuts triangles, then restores them when the camera returns', () => {
    const scene = new InfrastructureScene(input)
    scene.setAssets(fakeAssets(keys()))
    scene.update(new THREE.Vector3(tti.quay.lengthM / 2, 5, 150)) // down among the yard
    const near = scene.stats().triangles
    scene.update(new THREE.Vector3(tti.quay.lengthM / 2, 1100, 600)) // overview
    const far = scene.stats().triangles
    expect(far).toBeLessThan(near)
    const counts = countByKey(scene.placements)
    for (const f of FAR_TIER) expect(counts[f.key]).toBeGreaterThan(0)
    scene.update(new THREE.Vector3(tti.quay.lengthM / 2, 5, 150))
    expect(scene.stats().triangles).toBeGreaterThan(far) // not equal to `near`: hysteresis keeps the band far
    scene.dispose()
  })

  it('adds no more draw calls than one per tiered key', () => {
    const scene = new InfrastructureScene(input)
    scene.setAssets(fakeAssets(keys()))
    const base = scene.stats().drawCalls
    scene.update(new THREE.Vector3(tti.quay.lengthM / 2, 1100, 600))
    expect(scene.stats().drawCalls).toBeLessThanOrEqual(base + FAR_TIER.length)
    scene.dispose()
  })
})
