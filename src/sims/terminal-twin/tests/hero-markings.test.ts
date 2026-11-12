/**
 * Hero markings (#260): same content as the close-up face, painted at 4x inside the preparation allowance, bounded atlas pages
 * with least-recently-shown reuse, and a run-time switch to today's resolution that keeps the hero geometry.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { ContainerAssets } from '../modules/containerAssets'
import { ContainerCloseups, TILE_PX, type CloseupSource, type PaintJob } from '../modules/containerCloseups'
import { ContainerInstancer } from '../modules/containerInstancer'
import { describeMarkings } from '../modules/containerMarkings'
import type { Region } from '../modules/closeupGeometry'
import type { Face } from '../modules/exposedFaces'
import type { HeroPart } from '../modules/heroAssets'
import { HERO_FADE_MS, HERO_PREP_ALLOWANCE_MS } from '../modules/heroPrep'
import { HERO_MARK_SCALE, HeroMarkings, maxPages, tilesPerPage, type HeroMarkBackend } from '../modules/heroMarkings'
import { HeroLevel } from '../modules/heroRenderer'
import { makeIso6346Id } from '../scenario/iso6346'

interface PaintCall {
  source: CloseupSource
  face: Face
  px: number
  rect: Region
}
function markBackend(onPaint?: () => void) {
  const calls: PaintCall[] = []
  const backend: HeroMarkBackend = {
    createPage: (px) => ({ texture: Object.assign(new THREE.Texture(), { px }), ctx: null }),
    paint: (source, _size, face, page, rect) => {
      calls.push({ source, face, px: (page.texture as unknown as { px: number }).px, rect })
      onPaint?.()
    },
  }
  return { backend, calls }
}
const src = (key: number): CloseupSource => ({ markings: describeMarkings({ id: makeIso6346Id('MSCU', key + 1), size: '40', line: 'MSC', laden: true, heavy: key % 2 === 0 }), bodyColour: '#d8c9a3' })

describe('hero marking atlas (pure)', () => {
  it('paints at 4x the close-up tile and 1x on the standard step, with bounded pages', () => {
    expect(HERO_MARK_SCALE.sharp).toBe(4)
    const { backend, calls } = markBackend()
    const marks = new HeroMarkings(backend)
    marks.setBoxes(8)
    marks.beginFrame()
    expect(marks.paint(1, 'sideP', '40', src(1))).toBe(true)
    expect(marks.paint(2, 'door', '40', src(1))).toBe(true)
    expect(calls[0].rect.w).toBe(TILE_PX.side.w * 4)
    expect(calls[0].rect.h).toBe(TILE_PX.side.h * 4)
    expect(calls[1].rect.w).toBe(TILE_PX.end.w * 4)
    expect(calls[0].px).toBe(2048)
    expect(marks.paint(3, 'top', '40', src(1))).toBe(false) // roofs print nothing
    expect(marks.setStep('standard')).toBe(true)
    expect(marks.has(1)).toBe(false)
    marks.beginFrame()
    marks.paint(1, 'sideP', '40', src(1))
    expect(calls[2].rect.w).toBe(TILE_PX.side.w)
    expect(calls[2].px).toBe(512)
    expect(marks.setStep('standard')).toBe(false)
    expect(marks.setStep('sharp')).toBe(true) // and back
    expect(marks.step).toBe('sharp')
  })

  it('reuses the least recently shown tile when a kind is full, and never one shown this frame', () => {
    const { backend } = markBackend()
    const marks = new HeroMarkings(backend)
    marks.setBoxes(5)
    expect(maxPages('side', 'sharp', 5)).toBe(1)
    expect(tilesPerPage('side', 'sharp')).toBe(5)
    for (let id = 1; id <= 5; id++) {
      marks.beginFrame() // one tile shown per frame: id 1 is the oldest
      expect(marks.paint(id, 'sideP', '40', src(id))).toBe(true)
    }
    expect(marks.stats().pages).toBe(1)
    marks.beginFrame()
    marks.touch(1) // shown again: no longer the oldest
    expect(marks.paint(6, 'sideP', '40', src(6))).toBe(true)
    expect(marks.has(2)).toBe(false) // 2 was the least recently shown
    expect(marks.has(1)).toBe(true)
    expect(marks.has(6)).toBe(true)
    expect(marks.stats().pages).toBe(1) // bounded: no second page
    expect(marks.stats().tiles).toBe(5)
    // every tile shown this frame: nothing to give
    marks.beginFrame()
    for (const id of [1, 3, 4, 5, 6]) marks.touch(id)
    expect(marks.paint(7, 'sideP', '40', src(7))).toBe(false)
  })
})

function stubParts(): HeroPart[] {
  const geometry = () => new THREE.BoxGeometry(1, 1, 1)
  return [
    { geometry: geometry(), material: new THREE.MeshStandardMaterial({ name: 'hero_paint' }), tinted: true, triangles: 12 },
    { geometry: geometry(), material: new THREE.MeshStandardMaterial({ name: 'hero_dark' }), tinted: false, triangles: 12 },
  ]
}
function assets(): ContainerAssets {
  const b = () => new THREE.BoxGeometry(1, 1, 1)
  return { sizes: { '20': { lod0: b(), lod1: b() }, '40': { lod0: b(), lod1: b() }, '40HC': { lod0: b(), lod1: b() } }, lod0Material: new THREE.MeshStandardMaterial(), lod1Material: new THREE.MeshStandardMaterial() }
}
const settle = () => new Promise((r) => setTimeout(r, 0))
const near = new THREE.Vector3(6, 3, 12)

function setup(boxes: number, paintCostMs = 0, tick = 0) {
  const clock = { t: 1000 }
  const { backend, calls } = markBackend(() => (clock.t += paintCostMs))
  const closeupPaints: { source: CloseupSource; jobs: PaintJob[] }[] = []
  const hero = new HeroLevel(async () => stubParts(), () => (clock.t += tick), backend)
  hero.setLimits({ boxes })
  const closeups = new ContainerCloseups({ createPage: () => ({ texture: new THREE.Texture(), ctx: null }), paint: (source, _s, jobs) => closeupPaints.push({ source, jobs }) }, () => null)
  const inst = new ContainerInstancer({ '40': 80 }, {}, closeups)
  inst.setHero(hero)
  inst.setAssets(assets())
  inst.setMarkingsSource((k) => src(k))
  return { inst, hero, clock, calls, closeups, closeupPaints }
}
function frame(inst: ContainerInstancer, cam: THREE.Vector3) {
  inst.begin()
  for (let i = 0; i < 20; i++) inst.push(i, '40', i * 13, 1.3, 0, 0)
  return inst.end(cam)
}

describe('hero markings through the hero level', () => {
  it('a hero face and the close-up face of one box get identical markings content', async () => {
    const { inst, clock, calls, closeupPaints } = setup(8)
    frame(inst, near)
    await settle()
    for (let i = 0; i < 6; i++) {
      clock.t += 400
      frame(inst, near)
    }
    expect(calls.length).toBeGreaterThan(0)
    for (const c of calls) {
      const sameBox = closeupPaints.find((p) => p.source.markings.side.boxNumber === c.source.markings.side.boxNumber)
      expect(sameBox).toBeDefined()
      expect(c.source.markings).toEqual(sameBox!.source.markings) // one pure description feeds both levels
      expect(c.source.bodyColour).toBe(sameBox!.source.bodyColour)
    }
  })

  it('painting hero markings counts inside the per-frame allowance', async () => {
    // every clock read costs 0.4 ms and each paint 0.5 ms
    const { inst, hero, clock, calls } = setup(32, 0.5, 0.4)
    frame(inst, near)
    await settle()
    clock.t += 1000
    const per: number[] = []
    for (let i = 0; i < 60; i++) {
      const before = calls.length
      clock.t += 16
      frame(inst, near)
      per.push(calls.length - before)
    }
    expect(Math.max(...per)).toBeGreaterThan(0)
    expect(Math.max(...per)).toBeLessThanOrEqual(HERO_PREP_ALLOWANCE_MS)
    expect(per.filter((n) => n > 0).length).toBeGreaterThan(1)
    expect(hero.faces).toBeGreaterThan(0)
  })

  it('draws a decal per marked face and hides the close-up decal under a fully faded-in hero face', async () => {
    const { inst, hero, clock, closeups } = setup(8)
    frame(inst, near)
    await settle()
    clock.t += 400
    frame(inst, near)
    clock.t += HERO_FADE_MS / 2
    frame(inst, near)
    const mid = closeups.faces
    clock.t += HERO_FADE_MS * 2
    frame(inst, near)
    const marks = hero.marks.stats()
    expect(marks.tiles).toBeGreaterThan(0)
    expect(marks.drawCalls).toBeGreaterThan(0)
    expect(closeups.faces).toBeLessThan(mid) // covered faces are not drawn twice
  })

  it('a face with no marking tile to be had stays at the close-up level (its decal would hide behind the hero paint)', async () => {
    const run = async (noTiles: boolean) => {
      const { inst, hero, clock } = setup(8)
      if (noTiles) hero.marks.paint = () => false
      frame(inst, near)
      await settle()
      for (let i = 0; i < 6; i++) {
        clock.t += 400
        frame(inst, near)
      }
      return { faces: frame(inst, near).heroFaces, tiles: hero.marks.stats().tiles }
    }
    const withTiles = await run(false)
    const without = await run(true)
    expect(withTiles.tiles).toBeGreaterThan(0)
    expect(without.tiles).toBe(0)
    expect(without.faces).toBeLessThan(withTiles.faces) // only faces that print nothing (roofs) are left at hero level
  })

  it('switches the marking resolution at run time and back without losing the hero geometry', async () => {
    const { inst, hero, clock, calls } = setup(8)
    frame(inst, near)
    await settle()
    for (let i = 0; i < 4; i++) {
      clock.t += 400
      frame(inst, near)
    }
    const faces = hero.faces
    expect(faces).toBeGreaterThan(0)
    expect(calls.every((c) => c.px === 2048)).toBe(true)
    const painted = calls.length
    hero.setMarkStep('standard')
    expect(hero.marks.stats().pages).toBe(0)
    clock.t += 16
    frame(inst, near)
    expect(hero.faces).toBe(faces) // the geometry stayed drawn through the switch
    for (let i = 0; i < 4; i++) {
      clock.t += 400
      frame(inst, near)
    }
    expect(calls.length).toBeGreaterThan(painted)
    expect(calls.slice(painted).every((c) => c.px === 512 && c.rect.w <= 512)).toBe(true)
    hero.setMarkStep('sharp')
    for (let i = 0; i < 4; i++) {
      clock.t += 400
      frame(inst, near)
    }
    expect(calls[calls.length - 1].px).toBe(2048)
    expect(hero.faces).toBe(faces)
  })
})
