/**
 * Smooth hero arrival (#259): the pure scheduler (allowance, nearest first), the camera gate (no new faces while the
 * camera is fast, resume after the settle time), the fade, and the renderer through the instancer with a fake clock.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { ContainerAssets } from '../modules/containerAssets'
import type { CloseupSource } from '../modules/containerCloseups'
import { ContainerCloseups } from '../modules/containerCloseups'
import { ContainerInstancer } from '../modules/containerInstancer'
import { describeMarkings } from '../modules/containerMarkings'
import type { HeroPart } from '../modules/heroAssets'
import { CameraGate, fadeAlpha, HERO_CAMERA_SPEED_MPS, HERO_FADE_MS, HERO_PREP_ALLOWANCE_MS, HERO_SETTLE_MS, HERO_STILL_SETTLE_MS, runPrep } from '../modules/heroPrep'
import { HeroLevel } from '../modules/heroRenderer'
import { makeIso6346Id } from '../scenario/iso6346'

describe('prep scheduler (fake clock)', () => {
  it('never exceeds the allowance and runs the nearest items first', () => {
    let t = 0
    const order: number[] = []
    const items = [9, 1, 25, 4, 16, 36].map((d2) => ({ d2, run: () => ((t += 1), order.push(d2)) })) // 1 ms each
    const ran = runPrep(items, () => t, 3)
    expect(ran).toBe(3)
    expect(t).toBeLessThanOrEqual(3)
    expect(order).toEqual([1, 4, 9])
  })

  it('always runs one item so a backlog drains, even when it alone exceeds the allowance', () => {
    let t = 0
    const items = [{ d2: 1, run: () => (t += 10) }, { d2: 2, run: () => (t += 10) }]
    expect(runPrep(items, () => t, 3)).toBe(1)
  })

  it('does nothing for an empty queue and drains a backlog over frames', () => {
    let t = 0
    expect(runPrep([], () => t)).toBe(0)
    const left = Array.from({ length: 10 }, (_, i) => ({ d2: i, run: () => (t += 1) }))
    let frames = 0
    while (left.length) {
      const before = t
      const n = runPrep(left, () => t, HERO_PREP_ALLOWANCE_MS)
      expect(t - before).toBeLessThanOrEqual(HERO_PREP_ALLOWANCE_MS)
      left.splice(0, n)
      frames++
    }
    expect(frames).toBe(Math.ceil(10 / HERO_PREP_ALLOWANCE_MS))
  })
})

describe('camera gate (pure)', () => {
  it('stays closed while the camera is fast and opens after the settle time', () => {
    const g = new CameraGate()
    const fast = HERO_CAMERA_SPEED_MPS * 3
    let x = 0
    let t = 0
    for (let i = 0; i < 20; i++) {
      x += fast * 0.016
      t += 16
      expect(g.update(x, 0, 0, t)).toBe(false)
    }
    let openedAt = -1
    for (let i = 0; i < 40 && openedAt < 0; i++) {
      t += 16
      if (g.update(x, 0, 0, t)) openedAt = t
    }
    expect(openedAt).toBeGreaterThan(0)
  })

  it('opens once the camera has been calm for the settle time, not before', () => {
    const g = new CameraGate()
    g.update(0, 0, 0, 0)
    g.update(10, 0, 0, 16) // 625 m/s: fast
    expect(g.update(10, 0, 0, 32)).toBe(false) // calm starts here
    expect(g.update(10, 0, 0, 32 + HERO_SETTLE_MS - 1)).toBe(false)
    expect(g.update(10, 0, 0, 32 + HERO_SETTLE_MS)).toBe(true)
  })

  it('closes again the moment the camera speeds up', () => {
    const g = new CameraGate()
    g.update(0, 0, 0, 0)
    expect(g.update(0, 0, 0, 1000)).toBe(true)
    expect(g.update(5, 0, 0, 1016)).toBe(false)
  })

  it('a slow drift under the threshold does not close it', () => {
    const g = new CameraGate()
    g.update(0, 0, 0, 0)
    let t = 0
    let x = 0
    let open = false
    for (let i = 0; i < 30; i++) {
      t += 16
      x += HERO_CAMERA_SPEED_MPS * 0.5 * 0.016
      open = g.update(x, 0, 0, t)
    }
    expect(open).toBe(true)
  })
})

describe('fade', () => {
  it('goes linearly from 0 to 1 over the fade time and stays there', () => {
    expect(fadeAlpha(100, 100)).toBe(0)
    expect(fadeAlpha(100, 100 + HERO_FADE_MS / 2)).toBeCloseTo(0.5)
    expect(fadeAlpha(100, 100 + HERO_FADE_MS)).toBe(1)
    expect(fadeAlpha(100, 5000)).toBe(1)
  })
})

function stubParts(): HeroPart[] {
  const geometry = () => new THREE.BoxGeometry(1, 1, 1)
  return [
    { geometry: geometry(), material: new THREE.MeshStandardMaterial({ name: 'hero_paint' }), tinted: true, triangles: 12 },
    { geometry: geometry(), material: new THREE.MeshStandardMaterial({ name: 'hero_dark' }), tinted: false, triangles: 12 },
  ]
}
const source = (key: number): CloseupSource => ({ markings: describeMarkings({ id: makeIso6346Id('MSCU', key + 1), size: '40', line: 'MSC', laden: true }), bodyColour: '#d8c9a3' })
function assets(): ContainerAssets {
  const b = () => new THREE.BoxGeometry(1, 1, 1)
  return { sizes: { '20': { lod0: b(), lod1: b() }, '40': { lod0: b(), lod1: b() }, '40HC': { lod0: b(), lod1: b() } }, lod0Material: new THREE.MeshStandardMaterial(), lod1Material: new THREE.MeshStandardMaterial() }
}

function setup(boxes: number) {
  const clock = { t: 1000 }
  const hero = new HeroLevel(async () => stubParts(), () => clock.t)
  hero.setLimits({ boxes })
  const closeups = new ContainerCloseups({ createPage: () => ({ texture: new THREE.Texture(), ctx: null }), paint: () => {} }, () => null)
  const inst = new ContainerInstancer({ '40': 80 }, {}, closeups)
  inst.setHero(hero)
  inst.setAssets(assets())
  inst.setMarkingsSource(source)
  return { inst, hero, clock }
}
function frame(inst: ContainerInstancer, cam: THREE.Vector3) {
  inst.begin()
  for (let i = 0; i < 20; i++) inst.push(i, '40', i * 13, 1.3, 0, 0)
  return inst.end(cam)
}
const settle = () => new Promise((r) => setTimeout(r, 0))
const near = new THREE.Vector3(6, 3, 12)
const fadeOf = (hero: HeroLevel): number[] => {
  const paint = hero.group.children.find((c) => c.name.endsWith('-paint') && (c as THREE.InstancedMesh).count > 0) as THREE.InstancedMesh | undefined
  if (!paint) return []
  const a = paint.geometry.getAttribute('heroFade') as THREE.InstancedBufferAttribute
  return Array.from(a.array.slice(0, paint.count))
}

describe('hero level arrival through the instancer', () => {
  it('prepares nothing while the camera flies, then draws faces after the settle time, fading in', async () => {
    const { inst, hero, clock } = setup(8)
    frame(inst, near)
    await settle() // models arrive
    // a fast fly-through: 2 m every 16 ms
    for (let i = 0; i < 30; i++) {
      clock.t += 16
      frame(inst, new THREE.Vector3(6 + i * 2, 3, 12))
    }
    expect(hero.prepared).toBe(0)
    expect(hero.faces).toBe(0)
    const still = new THREE.Vector3(6 + 29 * 2, 3, 12)
    clock.t += 16
    frame(inst, still)
    clock.t += HERO_SETTLE_MS - 20
    frame(inst, still)
    expect(hero.prepared).toBe(0)
    clock.t += 40
    const s = frame(inst, still)
    expect(hero.prepared).toBeGreaterThan(0)
    expect(s.heroFaces).toBeGreaterThan(0)
    expect(fadeOf(hero).every((a) => a >= 0 && a < 1)).toBe(true) // just prepared: still fading in
    clock.t += HERO_FADE_MS / 2
    frame(inst, still)
    const mid = fadeOf(hero)
    expect(mid.some((a) => a > 0.3 && a < 0.8)).toBe(true)
    clock.t += HERO_FADE_MS
    frame(inst, still)
    expect(fadeOf(hero).every((a) => a === 1)).toBe(true)
    expect(hero.busy).toBe(false)
  })

  it('keeps faces that are already hero through a camera move, and prepares none while it moves', async () => {
    const { inst, hero, clock } = setup(8)
    frame(inst, near)
    await settle()
    clock.t += 400
    frame(inst, near)
    clock.t += 400
    frame(inst, near)
    const before = hero.faces
    const prepared = hero.prepared
    expect(before).toBeGreaterThan(0)
    for (let i = 1; i <= 10; i++) {
      clock.t += 16
      frame(inst, new THREE.Vector3(6 + i * 0.5, 3, 12)) // 31 m/s, nearly the same view
      expect(hero.faces).toBeGreaterThan(0)
    }
    expect(hero.prepared).toBe(prepared)
  })

  it('still-camera floor: a shed cap (0) draws nothing while the camera drifts, and the floor once it has stopped', async () => {
    const { inst, hero, clock } = setup(0)
    hero.setLimits({ boxes: 0, stillBoxes: 2 })
    frame(inst, near)
    await settle() // models arrive
    // a slow orbit, 1 m/s: calm enough for the quality cap's gate, not stopped
    for (let i = 1; i <= 60; i++) {
      clock.t += 16
      frame(inst, new THREE.Vector3(6 + i * 0.016, 3, 12))
    }
    expect(hero.prepared).toBe(0)
    expect(hero.busy).toBe(true) // faces wait: a stopped camera keeps redrawing until they arrive
    const still = new THREE.Vector3(6 + 60 * 0.016, 3, 12)
    clock.t += 16
    frame(inst, still)
    clock.t += HERO_STILL_SETTLE_MS - 20
    frame(inst, still)
    expect(hero.prepared).toBe(0)
    clock.t += 40
    frame(inst, still)
    clock.t += 16
    const s = frame(inst, still)
    expect(s.heroFaces).toBeGreaterThan(0)
    expect(s.heroFaces).toBeLessThanOrEqual(2 * 3)
    // the faces prepared stay through a move, and none is added while it lasts
    const prepared = hero.prepared
    for (let i = 1; i <= 5; i++) {
      clock.t += 16
      expect(frame(inst, new THREE.Vector3(still.x + i * 0.05, 3, 12)).heroFaces).toBeGreaterThan(0)
    }
    expect(hero.prepared).toBe(prepared)
    // a manual level has no floor: nothing is drawn
    hero.setLimits({ boxes: 0, stillBoxes: 0 })
    clock.t += 16
    expect(frame(inst, still).heroFaces).toBe(0)
  })

  it('still-camera floor never lowers a higher quality cap, nor tightens its gate', async () => {
    const { inst, hero, clock } = setup(8)
    hero.setLimits({ boxes: 8, stillBoxes: 1 })
    frame(inst, near)
    await settle()
    for (let i = 1; i <= 30; i++) {
      clock.t += 16
      frame(inst, new THREE.Vector3(6 + i * 0.016, 3, 12)) // 1 m/s: under the cap's 5 m/s gate
    }
    expect(hero.faces).toBeGreaterThan(1 * 3)
  })

  it('prepares a screenful over several frames, a few faces per frame, never past the allowance', async () => {
    const clock = { t: 1000 }
    let calls = 0
    const hero = new HeroLevel(async () => stubParts(), () => ((calls += 1), (clock.t += 0.4))) // every clock read costs 0.4 ms
    hero.setLimits({ boxes: 32 })
    const closeups = new ContainerCloseups({ createPage: () => ({ texture: new THREE.Texture(), ctx: null }), paint: () => {} }, () => null)
    const inst = new ContainerInstancer({ '40': 80 }, {}, closeups)
    inst.setHero(hero)
    inst.setAssets(assets())
    inst.setMarkingsSource(source)
    frame(inst, near)
    await settle()
    clock.t += 1000
    const per: number[] = []
    for (let i = 0; i < 60; i++) {
      const before = hero.prepared
      clock.t += 16
      frame(inst, near)
      per.push(hero.prepared - before)
    }
    expect(calls).toBeGreaterThan(0)
    expect(Math.max(...per)).toBeGreaterThan(0)
    // 3 ms allowance, about 1 ms per face with this clock: a handful at most per frame, so a screenful takes several frames
    expect(Math.max(...per)).toBeLessThanOrEqual(HERO_PREP_ALLOWANCE_MS)
    expect(per.filter((n) => n > 0).length).toBeGreaterThan(1)
  })
})
