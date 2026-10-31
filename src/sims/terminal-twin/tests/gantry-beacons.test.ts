/**
 * Gantry beacons (#125): amber meshes on STS cranes and ASCs that flash only while the machine gantries.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import ascMeta from '../assets/models/asc/asc.meta.json'
import stsMeta from '../assets/models/sts/sts-malaccamax.meta.json'
import { ascBeaconOffsets, beaconFlashOn, GantryBeacons, BEACON_PERIOD_MS, stsBeaconOffsets } from '../modules/gantryBeacons'
import { ascScaleY } from '../modules/ascRig'
import { STS } from '../modules/equipmentDims'

describe('beaconFlashOn', () => {
  it('alternates on and off every half period', () => {
    expect(beaconFlashOn(0)).toBe(true)
    expect(beaconFlashOn(BEACON_PERIOD_MS * 0.25)).toBe(true)
    expect(beaconFlashOn(BEACON_PERIOD_MS * 0.75)).toBe(false)
    expect(beaconFlashOn(BEACON_PERIOD_MS * 1.1)).toBe(true)
  })
})

describe('GantryBeacons', () => {
  function setup() {
    const scene = new THREE.Scene()
    const tracked: { dispose(): void }[] = []
    const beacons = new GantryBeacons(scene, (t) => {
      tracked.push(t)
      return t
    })
    beacons.add('STS01', [{ x: -9, y: 5, z: 0 }, { x: 9, y: 5, z: 0 }])
    beacons.add('B01-ASC1', [{ x: 0, y: 3, z: -2 }])
    return { scene, beacons, tracked }
  }

  it('lights only the beacons of a gantrying machine, and only on the flash phase', () => {
    const { scene, beacons } = setup()
    beacons.update('STS01', { x: 100, y: 0, z: 10 }, true, true)
    beacons.update('B01-ASC1', { x: 0, y: 0, z: 0 }, false, true)
    expect(beacons.stats()).toEqual({ gantrying: ['STS01'], lit: ['STS01'] })
    const lit = scene.children.filter((o) => o.visible)
    expect(lit).toHaveLength(2)
    expect(lit.map((o) => o.position.x).sort((a, b) => a - b)).toEqual([91, 109])
    expect(lit[0].position.z).toBe(10)
    beacons.update('STS01', { x: 100, y: 0, z: 10 }, true, false)
    expect(beacons.stats()).toEqual({ gantrying: ['STS01'], lit: [] })
    beacons.update('STS01', { x: 100, y: 0, z: 10 }, false, true)
    expect(beacons.stats()).toEqual({ gantrying: [], lit: [] })
    expect(scene.children.some((o) => o.visible)).toBe(false)
  })

  it('tracks its geometry and material for disposal', () => {
    const { tracked } = setup()
    expect(tracked.length).toBeGreaterThanOrEqual(2)
  })
})

describe('beacon offsets from the model sidecars (#128, follow-up from #124)', () => {
  it('places the STS lamps at the sidecar mounts, shifted to the waterside rail', () => {
    const offsets = stsBeaconOffsets()
    expect(offsets).toHaveLength(stsMeta.beaconMounts.length)
    stsMeta.beaconMounts.forEach((m, i) => {
      expect(offsets[i]).toEqual({ x: m.position[0], y: m.position[1], z: m.position[2] + STS.waterRailZ })
    })
  })

  it('places the ASC lamps at the sidecar mounts and stretches their height with the model', () => {
    expect(ascMeta.beaconMounts.length).toBeGreaterThanOrEqual(4)
    const flat = ascBeaconOffsets(1)
    const tall = ascBeaconOffsets(ascScaleY(8))
    expect(ascScaleY(8)).toBeGreaterThan(1)
    ascMeta.beaconMounts.forEach((m, i) => {
      expect(flat[i]).toEqual({ x: m.position[0], y: m.position[1], z: m.position[2] })
      expect(tall[i].y).toBeCloseTo(m.position[1] * ascScaleY(8), 6)
    })
  })
})
