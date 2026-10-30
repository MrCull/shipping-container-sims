/**
 * Gantry beacons (#125): amber meshes on STS cranes and ASCs that flash only while the machine gantries.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { beaconFlashOn, GantryBeacons, BEACON_PERIOD_MS } from '../modules/gantryBeacons'

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
