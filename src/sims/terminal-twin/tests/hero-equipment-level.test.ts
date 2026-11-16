/** The hero equipment level (#273) through its public interface: offers in, hero spreaders attached to the rigs out. */
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { HERO_EQUIPMENT_RETRY_MS, HeroEquipmentLevel } from '../modules/heroEquipment'
import { heroBodyMount, heroSpreaderMount, type HeroMount } from '../modules/heroEquipmentMount'
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
  mount: HeroMount
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

function harness(cap: number, loadModel: () => THREE.Object3D = () => spreaderTree('LOD0', 2)) {
  const loads: HeroEquipmentKind[] = []
  const level = new HeroEquipmentLevel({ load: async (kind) => (loads.push(kind), loadModel()), now: () => 0 })
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
        // the rig spreader dithers out with the complementary pattern: its own copy of the material while it fades
        expect(rig.body.material).not.toBe(material)
        expect(rig.body.material).not.toBe(fading.material)
      }
    }
    expect(sawFade).toBe(true)
    expect(h.level.settled).toBe(true)
    expect(rig.body.visible).toBe(false)
    expect(rig.body.material).toBe(material)
    expect((heroOf(rig)!.getObjectByName('spreader_geo') as THREE.Mesh).material).toBe(material)
  })

  it('a spreader released in the middle of its fade gets its rig spreader back whole', async () => {
    const h = harness(3)
    const rig = fakeRig(10)
    for (let i = 0; i < 20 && !heroOf(rig); i++) await h.frame({ a: rig }, 50)
    expect(heroOf(rig)).toBeDefined()
    expect(rig.body.material).not.toBe(material)
    await h.frame({}, 50)
    // it fades back out from where its fade-in had got to, so it is gone well within one full fade
    expect(h.level.count).toBe(0)
    await h.frame({}, HERO_FADE_MS)
    expect(heroOf(rig)).toBeUndefined()
    expect(rig.body.visible).toBe(true)
    expect(rig.body.material).toBe(material)
  })

  it('drops back without a pop: a released spreader dithers out over the fade while the rig spreader dithers back in', async () => {
    const h = harness(3)
    const rig = fakeRig(10)
    await h.settle({ a: rig })
    const hero = heroOf(rig)!
    const heroBody = hero.getObjectByName('spreader_geo') as THREE.Mesh
    expect(rig.body.visible).toBe(false)
    await h.frame({}, 100)
    for (let i = 0; i < 2; i++) {
      // still drawn, now through the complementary dither patterns; no longer counted or described, and the level is busy
      expect(heroOf(rig)).toBe(hero)
      expect(rig.body.visible).toBe(true)
      expect(rig.lock.children[0].visible).toBe(true)
      expect(rig.body.material).not.toBe(material)
      expect(heroBody.material).not.toBe(material)
      expect(heroBody.material).not.toBe(rig.body.material)
      expect(h.level.count).toBe(0)
      expect(h.level.describe()).toEqual([])
      expect(h.level.settled).toBe(false)
      await h.frame({}, HERO_FADE_MS / 4)
    }
    await h.frame({}, HERO_FADE_MS)
    expect(heroOf(rig)).toBeUndefined()
    expect(rig.body.visible).toBe(true)
    expect(rig.body.material).toBe(material)
    expect(heroBody.material).toBe(material)
    expect(h.level.settled).toBe(true)
  })

  it('a spreader chosen again in the middle of its fade-out fades back in from where it is, without a new load', async () => {
    const h = harness(3)
    const rig = fakeRig(10)
    await h.settle({ a: rig })
    const hero = heroOf(rig)!
    await h.frame({}, 50) // release starts at alpha 1
    await h.frame({}, HERO_FADE_MS / 2) // alpha 0.5
    await h.frame({ a: rig }, HERO_FADE_MS / 4) // chosen again at alpha 0.25
    expect(heroOf(rig)).toBe(hero)
    expect(h.level.count).toBe(1)
    await h.frame({ a: rig }, HERO_FADE_MS / 2) // 0.75: a restart from 0 would be at 0.5, a jump to 1 would be settled
    expect(h.level.settled).toBe(false)
    expect(rig.body.visible).toBe(true)
    await h.frame({ a: rig }, HERO_FADE_MS / 4) // 1
    expect(h.level.settled).toBe(true)
    expect(rig.body.visible).toBe(false)
    expect(rig.body.material).toBe(material)
    expect(heroOf(rig)).toBe(hero)
    expect(h.loads).toEqual(['asc'])
  })

  it('retries a failed load after a back-off while the spreader stays chosen, and is settled while it waits', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let failures = 2
    const h = harness(3, () => {
      if (failures-- > 0) throw new Error('offline')
      return spreaderTree('LOD0', 2)
    })
    const rig = fakeRig(10)
    for (let i = 0; i < 10; i++) await h.frame({ a: rig }) // 1 s
    expect(h.loads).toHaveLength(1)
    expect(h.level.settled).toBe(true) // waiting on the back-off: nothing more is coming for now
    expect(h.level.count).toBe(0)
    expect(rig.body.visible).toBe(true)
    // not retried every frame: still one request just before the back-off ends
    for (let i = 0; i < HERO_EQUIPMENT_RETRY_MS / 100 - 10; i++) await h.frame({ a: rig })
    expect(h.loads).toHaveLength(1)
    for (let i = 0; i < 10; i++) await h.frame({ a: rig })
    expect(h.loads).toHaveLength(2)
    // the second failure waits longer; the third request succeeds and the model arrives
    for (let i = 0; i < (HERO_EQUIPMENT_RETRY_MS * 2) / 100 + 20; i++) await h.frame({ a: rig })
    expect(h.loads).toHaveLength(3)
    expect(heroOf(rig)).toBeDefined()
    expect(h.level.settled).toBe(true)
    expect(rig.body.visible).toBe(false)
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('a file that keeps failing never leaves the level unsettled for good', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const h = harness(3, () => {
      throw new Error('offline')
    })
    const rig = fakeRig(10)
    let settledFrames = 0
    for (let i = 0; i < 600; i++) {
      await h.frame({ a: rig }) // 60 s
      if (h.level.settled) settledFrames++
    }
    expect(h.loads.length).toBeGreaterThanOrEqual(3)
    expect(h.loads.length).toBeLessThanOrEqual(6)
    expect(settledFrames).toBeGreaterThan(570)
    expect(h.level.settled).toBe(true)
    warn.mockRestore()
  })

  it('a frame with no offers and nothing attached does nothing, also at cap 0', async () => {
    const h = harness(0)
    const rig = fakeRig(10)
    await h.settle({ a: rig })
    await h.settle({})
    expect(h.loads).toEqual([])
    expect(h.level.count).toBe(0)
    expect(h.level.settled).toBe(true)
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
    await h.frame({ a, b }, HERO_FADE_MS)
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
    await h.frame({}, HERO_FADE_MS)
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

  it('describes each attached spreader: world bounds of the hero model and of the rig spreader it replaces', async () => {
    const h = harness(3)
    const rig = fakeRig(10)
    rig.body.geometry = new THREE.BoxGeometry(1, 1, 1) // 6.35 m after the body scale, centred at (10, 0.5, 0)
    const hero = spreaderTree('LOD0', 2)
    ;(hero.getObjectByName('spreader_geo') as THREE.Mesh).geometry = new THREE.BoxGeometry(1, 1, 1)
    const level = new HeroEquipmentLevel({ load: async () => hero, now: () => 0 })
    level.setCap(1)
    expect(level.describe()).toEqual([])
    let t = 0
    for (let i = 0; i < 10; i++) {
      t += 100
      level.begin()
      level.offer({ id: 'a', kind: 'shc', mount: rig.mount }, h.camera)
      level.update(h.camera, t)
      await Promise.resolve()
      await Promise.resolve()
    }
    const [info] = level.describe()
    expect(info).toMatchObject({ id: 'a', kind: 'shc', fading: false, rigHidden: true })
    // the hero body follows the rig body (same motion from rest), so it keeps its own 2 m size at the rig's place
    expect(info.rig.min[0]).toBeCloseTo(10 - 3.175, 5)
    expect(info.rig.max[0]).toBeCloseTo(10 + 3.175, 5)
    expect(info.hero.min[0]).toBeCloseTo(9, 5)
    expect(info.hero.max[0]).toBeCloseTo(11, 5)
    expect(info.hero.min[1]).toBeCloseTo(-0.5, 5)
    // a 20 ft squeeze of the rig body squeezes the hero body by the same factor
    rig.body.scale.z *= 0.5
    level.begin()
    level.offer({ id: 'a', kind: 'shc', mount: rig.mount }, h.camera)
    level.update(h.camera, t + 100)
    const squeezed = level.describe()[0]
    expect(squeezed.hero.max[2] - squeezed.hero.min[2]).toBeCloseTo(1, 5)
    expect(squeezed.rig.max[2] - squeezed.rig.min[2]).toBeCloseTo(3.175, 5)
  })
})

/** An SHC LOD0 as `shc.glb` has it, trimmed: frame mesh, a wheel empty (mesh child), the hoist empty with the spreader under it. */
interface FakeShc {
  lod0: THREE.Group
  spreaderMount: HeroMount
  bodyMount: HeroMount
  frameMesh: THREE.Mesh
  wheel: THREE.Object3D
  hoist: THREE.Object3D
  spreader: THREE.Object3D
  spreaderBody: THREE.Mesh
}

function fakeShc(x: number): FakeShc {
  const lod0 = new THREE.Group()
  lod0.name = 'LOD0'
  lod0.position.set(x, 0, 0)
  const frameMesh = mesh('frame')
  const wheel = new THREE.Group()
  wheel.name = 'wheel_fl'
  wheel.position.set(2, 0.8, 1)
  wheel.add(mesh('wheel_fl_geo'))
  const hoist = new THREE.Group()
  hoist.name = 'hoist'
  hoist.position.set(0, 10, 0)
  hoist.add(mesh('hoist_geo'))
  const spreader = spreaderTree('spreader', 1)
  spreader.position.set(0, -2, 0)
  hoist.add(spreader)
  lod0.add(frameMesh, wheel, hoist)
  return {
    lod0,
    spreaderMount: heroSpreaderMount(lod0)!,
    bodyMount: heroBodyMount(lod0, new THREE.Vector3(0, 7.5, 0)),
    frameMesh,
    wheel,
    hoist,
    spreader,
    spreaderBody: spreader.getObjectByName('spreader_geo') as THREE.Mesh,
  }
}

/** The hero body file: the same rig nodes minus the spreader, each mesh a detailed stand-in. */
function heroBody(): THREE.Object3D {
  const root = new THREE.Group()
  root.name = 'LOD0'
  const wheel = new THREE.Group()
  wheel.name = 'wheel_fl'
  wheel.position.set(2, 0.8, 1)
  wheel.add(mesh('wheel_fl_geo'))
  const hoist = new THREE.Group()
  hoist.name = 'hoist'
  hoist.position.set(0, 10, 0)
  hoist.add(mesh('hoist_geo'))
  root.add(mesh('frame'), wheel, hoist)
  return root
}

const heroBodyOf = (shc: FakeShc): THREE.Object3D | undefined => shc.lod0.children.find((c) => c.name === 'LOD0')
const heroSpreaderOf = (shc: FakeShc): THREE.Object3D | undefined => shc.spreader.children.find((c) => c.name === 'LOD0')
const bodyRigMeshes = (shc: FakeShc): THREE.Mesh[] => [shc.frameMesh, shc.wheel.children[0] as THREE.Mesh, shc.hoist.children[0] as THREE.Mesh]
type Piece = 'spreader' | 'body'

function shcHarness(caps: { spreader: number; body: number }) {
  const loads: HeroEquipmentKind[] = []
  const level = new HeroEquipmentLevel({ load: async (kind) => (loads.push(kind), kind === 'shc-body' ? heroBody() : spreaderTree('LOD0', 2)), now: () => 0 })
  level.setCaps({ heroEquipment: caps.spreader, heroShc: caps.body })
  const camera = new THREE.Vector3(0, 7.5, 0)
  let t = 0
  /** One frame with these SHCs offered (`pieces` chooses which pieces each offers). */
  const frame = async (shcs: Record<string, FakeShc>, pieces: readonly Piece[] = ['spreader', 'body'], dtMs = 100) => {
    t += dtMs
    level.begin()
    for (const [id, shc] of Object.entries(shcs)) {
      if (pieces.includes('spreader')) level.offer({ id, kind: 'shc', mount: shc.spreaderMount }, camera)
      if (pieces.includes('body')) level.offer({ id, kind: 'shc-body', mount: shc.bodyMount }, camera)
    }
    level.update(camera, t)
    await Promise.resolve()
    await Promise.resolve()
  }
  const settle = async (shcs: Record<string, FakeShc>, pieces?: readonly Piece[]) => {
    for (let i = 0; i < 4 + Math.ceil((HERO_SETTLE_MS + HERO_FADE_MS) / 100); i++) await frame(shcs, pieces)
  }
  return { level, loads, camera, frame, settle }
}

describe('hero SHC body (#275)', () => {
  it('attaches under the LOD0 node, hides only the body meshes after the fade, and leaves the spreader subtree alone', async () => {
    const h = shcHarness({ spreader: 0, body: 1 })
    const shc = fakeShc(10)
    await h.settle({ a: shc }, ['body'])
    const hero = heroBodyOf(shc)!
    expect(hero).toBeDefined()
    expect(hero.position.toArray()).toEqual([0, 0, 0])
    for (const m of bodyRigMeshes(shc)) expect(m.visible, m.name).toBe(false)
    expect(shc.spreaderBody.visible).toBe(true)
    expect(shc.spreader.getObjectByName('twistlock_fl')!.children[0].visible).toBe(true)
    hero.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) expect((o as THREE.Mesh).castShadow).toBe(true)
    })
    expect(h.level.count).toBe(1)
    expect(h.level.countOf('shc-body')).toBe(1)
    expect(h.level.describe('shc-body')).toMatchObject([{ id: 'a', kind: 'shc-body', rigHidden: true }])
    expect(h.level.describe('spreader')).toEqual([])
    expect(h.loads).toEqual(['shc-body'])
  })

  it('dithers the body meshes out while it fades in, never the spreader', async () => {
    const h = shcHarness({ spreader: 0, body: 1 })
    const shc = fakeShc(10)
    let sawFade = false
    for (let i = 0; i < 20 && !(h.level.settled && h.level.count === 1); i++) {
      await h.frame({ a: shc }, ['body'], 50)
      if (heroBodyOf(shc) && !h.level.settled) {
        sawFade = true
        expect(shc.frameMesh.visible).toBe(true)
        expect(shc.frameMesh.material).not.toBe(material)
        expect(shc.spreaderBody.material).toBe(material)
      }
    }
    expect(sawFade).toBe(true)
    expect(shc.frameMesh.material).toBe(material)
  })

  it('copies the rig motion: a wheel spin and the hoist travel show on the hero body', async () => {
    const h = shcHarness({ spreader: 0, body: 1 })
    const shc = fakeShc(10)
    await h.settle({ a: shc }, ['body'])
    const hero = heroBodyOf(shc)!
    shc.wheel.rotation.z = 1.2
    shc.hoist.position.y = 6
    await h.frame({ a: shc }, ['body'])
    const q = new THREE.Quaternion()
    const p = new THREE.Vector3()
    hero.getObjectByName('wheel_fl')!.matrix.decompose(p, q, new THREE.Vector3())
    expect(new THREE.Euler().setFromQuaternion(q).z).toBeCloseTo(1.2, 6)
    p.toArray().forEach((c, i) => expect(c).toBeCloseTo([2, 0.8, 1][i], 6))
    hero.getObjectByName('hoist')!.matrix.decompose(p, q, new THREE.Vector3())
    expect(p.y).toBeCloseTo(6, 6)
  })

  it('spreader and body on one SHC attach, fade and release independently', async () => {
    const h = shcHarness({ spreader: 1, body: 1 })
    const shc = fakeShc(10)
    await h.settle({ a: shc })
    expect(heroBodyOf(shc)).toBeDefined()
    expect(heroSpreaderOf(shc)).toBeDefined()
    expect(h.level.count).toBe(2)
    expect(shc.spreaderBody.visible).toBe(false)
    // the body goes: its meshes come back, the spreader's stay hidden under the hero spreader
    await h.frame({ a: shc }, ['spreader'])
    await h.frame({ a: shc }, ['spreader'], HERO_FADE_MS)
    expect(heroBodyOf(shc)).toBeUndefined()
    for (const m of bodyRigMeshes(shc)) expect(m.visible, m.name).toBe(true)
    expect(shc.spreaderBody.visible).toBe(false)
    expect(heroSpreaderOf(shc)).toBeDefined()
    // the body comes back; then the spreader goes and leaves the body meshes hidden
    await h.settle({ a: shc })
    await h.frame({ a: shc }, ['body'])
    await h.frame({ a: shc }, ['body'], HERO_FADE_MS)
    expect(heroSpreaderOf(shc)).toBeUndefined()
    expect(shc.spreaderBody.visible).toBe(true)
    for (const m of bodyRigMeshes(shc)) expect(m.visible, m.name).toBe(false)
    expect(h.level.countOf('shc-body')).toBe(1)
    expect(h.level.countOf('spreader')).toBe(0)
  })

  it('has its own cap: a full spreader cap does not keep a body out, and a body cap of 0 (Medium, Low) draws none', async () => {
    const h = shcHarness({ spreader: 1, body: 1 })
    const a = fakeShc(5)
    const b = fakeShc(12)
    await h.settle({ a, b })
    expect(h.level.countOf('spreader')).toBe(1)
    expect(h.level.countOf('shc-body')).toBe(1)
    expect(heroBodyOf(a)).toBeDefined()
    expect(heroBodyOf(b)).toBeUndefined()
    h.level.setCaps({ heroEquipment: 1, heroShc: 0 })
    await h.frame({ a, b })
    expect(h.level.countOf('shc-body')).toBe(0)
    expect(h.level.countOf('spreader')).toBe(1)
    for (const m of bodyRigMeshes(a)) expect(m.visible).toBe(true)
  })

  it('reaches 30 m from the SHC centre, where a spreader (25 m) does not', async () => {
    const h = shcHarness({ spreader: 1, body: 1 })
    const shc = fakeShc(28)
    await h.settle({ a: shc })
    expect(h.level.countOf('shc-body')).toBe(1)
    expect(h.level.countOf('spreader')).toBe(0)
  })
})

describe('scene teardown (#275)', () => {
  it('disposes the hero level before the kind renderers, so no hero SHC body still wears a plate material ShcRig.dispose() has freed', () => {
    const src = readFileSync(new URL('../modules/sceneRenderer.ts', import.meta.url), 'utf8')
    const body = src.slice(src.indexOf('\n  dispose(): void {'))
    const hero = body.indexOf('this.heroEquipment.dispose()')
    const kinds = body.indexOf('renderer.dispose()')
    expect(hero).toBeGreaterThan(0)
    expect(kinds).toBeGreaterThan(hero)
  })

  it('dispose detaches a hero SHC body at once, also in the middle of its fade-out, and puts the shared materials back', async () => {
    const h = shcHarness({ spreader: 0, body: 1 })
    const shc = fakeShc(10)
    await h.settle({ a: shc })
    expect(heroBodyOf(shc)).toBeDefined()
    await h.frame({}, [], 50)
    expect(heroBodyOf(shc)).toBeDefined()
    h.level.dispose()
    expect(heroBodyOf(shc)).toBeUndefined()
    for (const m of bodyRigMeshes(shc)) expect([m.visible, m.material]).toEqual([true, material])
  })
})
