/** The hero equipment level (#273) through its public interface: offers in, hero spreaders attached to the rigs out. */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { HeroEquipmentLevel, heroSpreaderMount, type HeroSpreaderMount } from '../modules/heroEquipment'
import type { HeroEquipmentKind } from '../modules/heroEquipmentAssets'
import { HERO_FADE_MS, HERO_SETTLE_MS } from '../modules/heroPrep'

const material = new THREE.MeshStandardMaterial()
const mesh = (name: string): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BufferGeometry(), material)
  m.name = name
  return m
}

/** A spreader subtree as the GLBs have it: a body mesh and one twistlock empty with its mesh child. `bodyScale` stands for the file's dequantisation scale. */
function spreaderTree(name: string, bodyScale: number): THREE.Object3D {
  const root = new THREE.Group()
  root.name = name
  const body = mesh('spreader_geo')
  body.position.set(0, 0.5, 0)
  body.scale.setScalar(bodyScale)
  const lock = new THREE.Group()
  lock.name = 'twistlock_fl'
  lock.position.set(1.13, 0, -6)
  lock.add(mesh('twistlock_fl_geo'))
  root.add(body, lock)
  return root
}

interface FakeRig {
  mount: HeroSpreaderMount
  spreader: THREE.Object3D
  body: THREE.Mesh
  lock: THREE.Object3D
}

/** A rig whose spreader hangs at `x` on the X axis. */
function fakeRig(x: number): FakeRig {
  const lod0 = new THREE.Group()
  const spreader = spreaderTree('spreader', 6.35)
  spreader.position.set(x, 0, 0)
  lod0.add(spreader)
  return { mount: heroSpreaderMount(lod0)!, spreader, body: spreader.getObjectByName('spreader_geo') as THREE.Mesh, lock: spreader.getObjectByName('twistlock_fl')! }
}

function harness(cap: number) {
  const loads: HeroEquipmentKind[] = []
  const level = new HeroEquipmentLevel({ load: async (kind) => (loads.push(kind), spreaderTree('LOD0', 2)), now: () => 0 })
  level.setCap(cap)
  const camera = new THREE.Vector3(0, 0, 0)
  let t = 0
  /** One frame `dtMs` later with these rigs offered, then the loader's promises settled. */
  const frame = async (rigs: Record<string, FakeRig>, dtMs = 100) => {
    t += dtMs
    level.begin()
    for (const [id, rig] of Object.entries(rigs)) level.offer({ id, kind: 'asc', mount: rig.mount }, camera)
    level.update(camera, t)
    await Promise.resolve()
    await Promise.resolve()
  }
  /** Frames until the camera gate is calm, the model is loaded, attached and faded in. */
  const settle = async (rigs: Record<string, FakeRig>) => {
    for (let i = 0; i < 4 + Math.ceil((HERO_SETTLE_MS + HERO_FADE_MS) / 100); i++) await frame(rigs)
  }
  return { level, loads, camera, frame, settle }
}

const heroOf = (rig: FakeRig): THREE.Object3D | undefined => rig.spreader.children.find((c) => c.name === 'LOD0')

describe('hero equipment level', () => {
  it('attaches the hero spreader under the rig spreader node, identity transform, and hides the rig meshes', async () => {
    const h = harness(3)
    const rig = fakeRig(10)
    expect(h.level.settled).toBe(true)
    await h.settle({ a: rig })
    const hero = heroOf(rig)!
    expect(hero).toBeDefined()
    expect(hero.position.toArray()).toEqual([0, 0, 0])
    expect(hero.scale.toArray()).toEqual([1, 1, 1])
    expect(rig.body.visible).toBe(false)
    expect(rig.lock.children[0].visible).toBe(false)
    expect(hero.getObjectByName('spreader_geo')!.visible).toBe(true)
    expect(h.level.count).toBe(1)
    expect(h.level.settled).toBe(true)
    expect(h.loads).toEqual(['asc'])
  })

  it('chooses the nearest spreaders up to the cap and leaves the others on their rig model', async () => {
    const h = harness(1)
    const near = fakeRig(5)
    const far = fakeRig(15)
    const tooFar = fakeRig(40)
    await h.settle({ far, near, tooFar })
    expect(heroOf(near)).toBeDefined()
    expect(heroOf(far)).toBeUndefined()
    expect(heroOf(tooFar)).toBeUndefined()
    expect(far.body.visible).toBe(true)
    expect(h.level.count).toBe(1)
  })

  it('is not settled while a chosen spreader is being prepared or fades in, and keeps the rig spreader until then', async () => {
    const h = harness(3)
    const rig = fakeRig(10)
    await h.frame({ a: rig })
    expect(h.level.settled).toBe(false)
    expect(rig.body.visible).toBe(true)
    let sawFade = false
    for (let i = 0; i < 12 && !(h.level.settled && h.level.count === 1); i++) {
      await h.frame({ a: rig }, 50)
      if (heroOf(rig) && !h.level.settled) {
        sawFade = true
        expect(rig.body.visible).toBe(true) // the hero dithers in over the rig spreader
        const fading = heroOf(rig)!.getObjectByName('spreader_geo') as THREE.Mesh
        expect(fading.material).not.toBe(material)
      }
    }
    expect(sawFade).toBe(true)
    expect(h.level.settled).toBe(true)
    expect(rig.body.visible).toBe(false)
    expect((heroOf(rig)!.getObjectByName('spreader_geo') as THREE.Mesh).material).toBe(material)
  })

  it('prepares nothing while the camera moves fast', async () => {
    const h = harness(3)
    const rig = fakeRig(10)
    for (let i = 0; i < 10; i++) {
      h.camera.x += 1 // 10 m/s at 100 ms frames
      await h.frame({ a: rig })
    }
    expect(h.loads).toEqual([])
    expect(heroOf(rig)).toBeUndefined()
    expect(h.level.settled).toBe(false)
    await h.settle({ a: rig })
    expect(heroOf(rig)).toBeDefined()
  })

  it('the hero nodes show the rig motion: twistlock turn and telescoping', async () => {
    const h = harness(3)
    const rig = fakeRig(10)
    await h.settle({ a: rig })
    // what the ASC rig does for a locked 20 ft spreader: locks turn and move in, the body shrinks about the centre
    rig.lock.rotation.y = Math.PI / 2
    rig.lock.position.z = -3
    rig.body.scale.z = 6.35 * 0.5
    await h.frame({ a: rig })
    rig.spreader.updateMatrixWorld(true)
    const hero = heroOf(rig)!
    const heroLock = hero.getObjectByName('twistlock_fl')!
    const p = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    heroLock.matrixWorld.decompose(p, q, s)
    expect(p.x).toBeCloseTo(10 + 1.13, 6)
    expect(p.z).toBeCloseTo(-3, 6)
    expect(new THREE.Euler().setFromQuaternion(q, 'YXZ').y).toBeCloseTo(Math.PI / 2, 6)
    // the hero body keeps its own file scale (2), times the rig's 0.5 along the spreader
    hero.getObjectByName('spreader_geo')!.matrixWorld.decompose(p, q, s)
    expect(s.x).toBeCloseTo(2, 6)
    expect(s.z).toBeCloseTo(1, 6)
    expect(p.y).toBeCloseTo(0.5, 6)
  })

  it('cap 0 removes every hero spreader and shows the rig spreaders again', async () => {
    const h = harness(3)
    const a = fakeRig(5)
    const b = fakeRig(8)
    await h.settle({ a, b })
    expect(h.level.count).toBe(2)
    h.level.setCap(0)
    await h.frame({ a, b })
    expect(h.level.count).toBe(0)
    expect(heroOf(a)).toBeUndefined()
    expect(a.body.visible).toBe(true)
    expect(b.lock.children[0].visible).toBe(true)
    expect(h.level.settled).toBe(true)
  })

  it('a rig that is no longer offered (left LOD0) loses its hero spreader', async () => {
    const h = harness(3)
    const rig = fakeRig(10)
    await h.settle({ a: rig })
    await h.frame({})
    expect(heroOf(rig)).toBeUndefined()
    expect(rig.body.visible).toBe(true)
  })

  it('dispose restores the rigs', async () => {
    const h = harness(3)
    const rig = fakeRig(10)
    await h.settle({ a: rig })
    h.level.dispose()
    expect(heroOf(rig)).toBeUndefined()
    expect(rig.body.visible).toBe(true)
    expect(rig.lock.children[0].visible).toBe(true)
    expect(h.level.count).toBe(0)
  })
})
