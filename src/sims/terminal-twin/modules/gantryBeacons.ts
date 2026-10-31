/**
 * Gantry beacons (#125): flashing amber lamps on STS cranes and ASCs, lit only while the machine gantries along its
 * rails (the same condition as the gantry alarm). One small mesh per lamp, hidden unless lit, so a stopped crane
 * costs nothing to draw. The flash phase is wall-clock, so it stays readable at any sim speed.
 */
import * as THREE from 'three'
import ascMeta from '../assets/models/asc/asc.meta.json'
import stsMeta from '../assets/models/sts/sts-malaccamax.meta.json'
import { STS } from './equipmentDims'
import type { Vec3 } from './soundMixer'

/** STS lamp offsets from the sidecar's `beaconMounts` (model coordinates; the root sits on the waterside rail, so z shifts by it). */
export function stsBeaconOffsets(): Vec3[] {
  return stsMeta.beaconMounts.map((m) => ({ x: m.position[0], y: m.position[1], z: m.position[2] + STS.waterRailZ }))
}

/** ASC lamp offsets from the sidecar's `beaconMounts`; `scaleY` is the model's vertical stretch for tall blocks (`ascScaleY`). */
export function ascBeaconOffsets(scaleY: number): Vec3[] {
  return ascMeta.beaconMounts.map((m) => ({ x: m.position[0], y: m.position[1] * scaleY, z: m.position[2] }))
}

/** One full flash cycle (ms): lit for the first half. */
export const BEACON_PERIOD_MS = 800

export function beaconFlashOn(nowMs: number): boolean {
  return nowMs % BEACON_PERIOD_MS < BEACON_PERIOD_MS / 2
}

interface BeaconSet {
  offsets: Vec3[]
  lamps: THREE.Mesh[]
  gantrying: boolean
  lit: boolean
}

export class GantryBeacons {
  private sets = new Map<string, BeaconSet>()
  private geometry: THREE.BufferGeometry
  private material: THREE.Material

  constructor(
    private scene: THREE.Scene,
    track: <T extends { dispose(): void }>(thing: T) => T,
  ) {
    this.geometry = track(new THREE.SphereGeometry(0.45, 10, 8))
    this.material = track(new THREE.MeshBasicMaterial({ color: '#ffb000' }))
  }

  /** Register a machine's lamps, as offsets from its origin (world axes). */
  add(id: string, offsets: Vec3[]): void {
    const lamps = offsets.map(() => {
      const m = new THREE.Mesh(this.geometry, this.material)
      m.visible = false
      m.name = `${id}-beacon`
      this.scene.add(m)
      return m
    })
    this.sets.set(id, { offsets, lamps, gantrying: false, lit: false })
  }

  /** Place a machine's lamps at `origin`; they show only while `gantrying` and `flashOn`. */
  update(id: string, origin: Vec3, gantrying: boolean, flashOn: boolean): void {
    const s = this.sets.get(id)
    if (!s) return
    s.gantrying = gantrying
    s.lit = gantrying && flashOn
    s.lamps.forEach((lamp, i) => {
      lamp.visible = s.lit
      if (s.lit) lamp.position.set(origin.x + s.offsets[i].x, origin.y + s.offsets[i].y, origin.z + s.offsets[i].z)
    })
  }

  /** Dev/test view: machines gantrying (beacons flashing) and those whose lamps are lit this instant. */
  stats(): { gantrying: string[]; lit: string[] } {
    const entries = [...this.sets.entries()]
    return {
      gantrying: entries.filter(([, s]) => s.gantrying).map(([id]) => id),
      lit: entries.filter(([, s]) => s.lit).map(([id]) => id),
    }
  }
}
