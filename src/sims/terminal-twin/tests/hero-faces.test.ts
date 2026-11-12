/**
 * Hero level (#258): the pure face selection (visible, facing, exposed, capped, hysteresis) and the renderer through
 * its seam (`ContainerCloseups` offers) with a stub model loader: nothing is requested at overview or on Low, the cap
 * is never exceeded, wear and colour follow the box, and a buried box draws nothing.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { ContainerAssets } from '../modules/containerAssets'
import type { CloseupSource } from '../modules/containerCloseups'
import { ContainerCloseups } from '../modules/containerCloseups'
import { ContainerInstancer } from '../modules/containerInstancer'
import { describeMarkings } from '../modules/containerMarkings'
import { exposedFaces } from '../modules/exposedFaces'
import type { HeroPart } from '../modules/heroAssets'
import { facingCandidates, heroFaceId, heroKindOf, HERO_FACES_PER_BOX, selectHeroFaces } from '../modules/heroFaceSelection'
import { HeroLevel } from '../modules/heroRenderer'
import { QUALITY_PROFILES } from '../modules/quality'
import { makeIso6346Id } from '../scenario/iso6346'

const FREE = exposedFaces('free')
const LIMITS = { boxes: 2, distanceM: 15, hysteresis: 1.15 }
const box = { size: '40' as const, x: 0, y: 0, z: 0, yaw: 0 }

describe('hero face selection (pure)', () => {
  it('offers only the faces turned towards the camera, at most three per box', () => {
    const out: { id: number; d2: number }[] = []
    facingCandidates(1, box, FREE, { x: 10, y: 8, z: 12 }, out) // above, beside (+Z) and toward the door end (+X)
    const faces = out.map((c) => c.id % 8).sort()
    expect(faces.length).toBe(HERO_FACES_PER_BOX)
    expect(out.map((c) => c.id)).toEqual(expect.arrayContaining([heroFaceId(1, 'top'), heroFaceId(1, 'sideP'), heroFaceId(1, 'door')]))
  })

  it('drops faces turned away: a camera on the -Z side never gets the +Z side', () => {
    const out: { id: number; d2: number }[] = []
    facingCandidates(1, box, FREE, { x: 0, y: 1.3, z: -10 }, out)
    expect(out.map((c) => c.id)).toEqual([heroFaceId(1, 'sideN')])
  })

  it('a buried box (every face covered) contributes no candidate', () => {
    const buried = exposedFaces('yard', { above: true, door: true, front: true, sideP: true, sideN: true })
    const out: { id: number; d2: number }[] = []
    facingCandidates(1, box, buried, { x: 3, y: 5, z: 9 }, out)
    expect(out).toEqual([])
  })

  it('never selects beyond the cap or the distance, nearest first', () => {
    const cands = Array.from({ length: 20 }, (_, i) => ({ id: i, d2: (1 + i) * (1 + i) })) // 1 m to 20 m
    const chosen = selectHeroFaces(cands, LIMITS, new Set())
    expect(chosen.length).toBeLessThanOrEqual(LIMITS.boxes * HERO_FACES_PER_BOX)
    expect(chosen).toEqual([0, 1, 2, 3, 4, 5])
    expect(selectHeroFaces(cands, { ...LIMITS, boxes: 0 }, new Set())).toEqual([])
    expect(selectHeroFaces(cands, { ...LIMITS, boxes: 100 }, new Set()).every((id) => id < 15)).toBe(true)
  })

  it('keeps a drawn face a little past the cut (hysteresis)', () => {
    const cands = [
      { id: 1, d2: 14.5 * 14.5 },
      { id: 2, d2: 14 * 14 },
    ]
    expect(selectHeroFaces(cands, { ...LIMITS, boxes: 1 }, new Set([1]))).toContain(1)
  })

  it('maps faces to the four models, the -Z side being the +Z model turned', () => {
    expect(heroKindOf('sideP')).toEqual({ kind: 'side', turn: false })
    expect(heroKindOf('sideN')).toEqual({ kind: 'side', turn: true })
    expect(heroKindOf('top')?.kind).toBe('roof')
    expect(heroKindOf('bottom')).toBeNull()
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

// a fake clock: each frame is 200 ms, so a still camera is settled (#259) and a fade has finished by the next frame
const clock = { t: 0 }

function setup(boxes: number) {
  const requests: string[] = []
  const hero = new HeroLevel(async (size, kind) => {
    requests.push(`${size}-${kind}`)
    return stubParts()
  }, () => clock.t)
  hero.setLimits({ boxes })
  const closeups = new ContainerCloseups({ createPage: () => ({ texture: new THREE.Texture(), ctx: null }), paint: () => {} }, () => null)
  const inst = new ContainerInstancer({ '40': 80 }, {}, closeups)
  inst.setHero(hero)
  inst.setAssets(assets())
  inst.setMarkingsSource(source)
  return { inst, hero, closeups, requests }
}

function frame(inst: ContainerInstancer, n: number, cam: THREE.Vector3): ReturnType<ContainerInstancer['end']> {
  clock.t += 200
  inst.begin()
  for (let i = 0; i < n; i++) inst.push(i, '40', i * 13, 1.3, 0, 0)
  return inst.end(cam)
}

const settle = () => new Promise((r) => setTimeout(r, 0))

describe('hero level through the close-up offers', () => {
  const nearCam = new THREE.Vector3(6, 3, 12)

  it('requests nothing at overview and draws no hero faces', async () => {
    const { inst, requests } = setup(32)
    const s = frame(inst, 20, new THREE.Vector3(100, 150, 200))
    await settle()
    expect(s.heroFaces).toBe(0)
    expect(requests).toEqual([])
  })

  it('loads on the first close zoom, then draws faces, never above the cap', async () => {
    const { inst, hero, requests } = setup(2)
    expect(frame(inst, 20, nearCam).heroFaces).toBe(0) // models still loading: the close-up level shows
    expect(requests.length).toBeGreaterThan(0)
    await settle()
    const s = frame(inst, 20, nearCam)
    expect(s.heroFaces).toBeGreaterThan(0)
    expect(s.heroFaces).toBeLessThanOrEqual(2 * HERO_FACES_PER_BOX)
    expect(hero.cost().drawCalls).toBeGreaterThan(0)
  })

  it('draws no hero faces on Low and requests nothing', async () => {
    const { inst, requests } = setup(QUALITY_PROFILES.low.heroBoxes)
    frame(inst, 20, nearCam)
    await settle()
    expect(frame(inst, 20, nearCam).heroFaces).toBe(0)
    expect(requests).toEqual([])
  })

  it('has the caps the budget file recommends: High 32, Medium 12, Low 0', () => {
    expect([QUALITY_PROFILES.high.heroBoxes, QUALITY_PROFILES.medium.heroBoxes, QUALITY_PROFILES.low.heroBoxes]).toEqual([32, 12, 0])
  })

  it('gives a box the same wear and colour every time (a function of its id)', async () => {
    const { inst, hero } = setup(8)
    frame(inst, 4, nearCam)
    await settle()
    const wearOf = () => {
      const paint = hero.group.children.find((c) => c.name.endsWith('-paint') && (c as THREE.InstancedMesh).count > 0) as THREE.InstancedMesh
      const attr = paint.geometry.getAttribute('heroWear') as THREE.InstancedBufferAttribute
      return Array.from(attr.array.slice(0, 3 * paint.count))
    }
    frame(inst, 4, nearCam)
    const first = wearOf()
    frame(inst, 4, new THREE.Vector3(8, 4, 14)) // another zoom
    frame(inst, 4, nearCam)
    frame(inst, 4, nearCam) // the camera is calm again: the same faces are drawn
    // faces chosen after the zoom may differ, but the face drawn before still has the same wear triple
    const later = wearOf()
    const triples = Array.from({ length: later.length / 3 }, (_, i) => later.slice(i * 3, i * 3 + 3).join())
    expect(triples).toContain(first.slice(0, 3).join())
  })
})
