/**
 * #336 (spec #320): the yard group's scene checks, moved from the browser smoke specs to the headless scene
 * (`cli/headlessScene.ts`): container LOD by distance, livery per line, close-up boxes and marking faces by camera pose,
 * and infrastructure instance counts. Hero faces (caps per level, Auto rungs, nothing prepared in a fly-through) are
 * covered by `hero-faces.test.ts` and `hero-prep.test.ts` (no hero GLB loads in Node); lighting per hour and the
 * daylight lock by `atmosphere.test.ts`. Was: `container-assets.smoke.ts`, `container-closeup.smoke.ts`,
 * `hero-faces.smoke.ts`, `infrastructure.smoke.ts`. The mapping is in the #336 PR body.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import atlas from '../assets/models/containers/livery-atlas.json' with { type: 'json' }
import { headlessScene, type HeadlessScene } from '../cli/headlessScene'

type Box = { id: string; line: string; size: string }

describe('headless scene: container LODs, liveries and close-ups (was container-assets, container-closeup smoke)', () => {
  // High: the LOD and close-up distances checked are High's (Low scales them by 0.4)
  let s: HeadlessScene
  let boxes: Box[]
  beforeAll(async () => {
    s = await headlessScene('liveries-mixed', { quality: 'high' })
    await s.runTo(200)
    boxes = await s.controller.query<Box[]>('containers')
  })
  afterAll(() => s.dispose())

  it('draws each box in its own line livery and size, from the instanced container layers', () => {
    expect(new Set(boxes.map((b) => b.line)).size).toBeGreaterThanOrEqual(5)
    expect(new Set(boxes.map((b) => b.size))).toEqual(new Set(['20', '40', '40HC']))
    const state = s.sceneState()
    for (const box of boxes) {
      const rendered = state.liveries[box.id]
      expect(rendered, box.id).toBeDefined()
      expect(atlas.liveries[rendered.index].line, box.id).toBe(box.line)
      expect(rendered.size, box.id).toBe(box.size)
    }
    const stats = s.stats()
    expect(stats.containers).toBe(boxes.length)
    expect(stats.containerLods.lod0 + stats.containerLods.lod1).toBe(stats.containers)
  })

  it('uses LOD0 close up (boxes outside the view culled) and LOD1 from far, liveries unchanged', () => {
    const near = s.sceneState()
    s.cameraTo('STS01', 60)
    const at60 = s.stats()
    expect(at60.containerLods.lod0).toBeGreaterThan(0)
    expect(at60.containerLods.lod0 + at60.containerLods.culled).toBe(at60.containers)
    s.cameraTo('STS01', 600)
    expect(s.stats().containerLods.lod1).toBe(s.stats().containers)
    const far = s.sceneState()
    for (const box of boxes) expect(far.liveries[box.id].index, box.id).toBe(near.liveries[box.id].index)
  })

  it('boxes within about 35 m become close-ups with at least one marking face each, within the budget; from far none', () => {
    s.cameraTo('STS01', 600)
    expect(s.stats().containerLods).toMatchObject({ closeup: 0, closeupFaces: 0 })
    s.cameraTo('STS01', 22)
    const near = s.stats().containerLods
    expect(near.closeup).toBeGreaterThan(0)
    expect(near.closeupFaces).toBeGreaterThanOrEqual(near.closeup)
    expect(near.closeupFaces).toBeLessThanOrEqual(400)
    s.cameraTo('STS01', 600)
    expect(s.stats().containerLods).toMatchObject({ closeup: 0, closeupFaces: 0 })
  })
})

describe('headless scene: yard block edge close up (was container-closeup.smoke.ts)', () => {
  for (const [level, budget, distanceM] of [['low', 48, 12], ['high', 400, 22]] as const) {
    it(`draws marking faces on ${level} near B01, none from far, never above the budget (${budget})`, async () => {
      const s = await headlessScene('yard-no-mixed-length', { quality: level }) // a half-full block B01
      try {
        await s.runTo(60)
        expect(s.cameraTo('B01', distanceM)).toBe(true)
        const near = s.stats().containerLods
        expect(near.closeup).toBeGreaterThan(0)
        expect(near.closeupFaces).toBeGreaterThan(0)
        expect(near.closeupFaces).toBeLessThanOrEqual(budget)
        s.cameraTo('B01', 600)
        expect(s.stats().containerLods).toMatchObject({ closeup: 0, closeupFaces: 0 })
      } finally {
        s.dispose()
      }
    })
  }
})

describe('headless scene: infrastructure instances (was infrastructure.smoke.ts)', () => {
  it('the gate fixture lays out the gate islands and the one out-of-gauge lane as instances', async () => {
    const s = await headlessScene('truck-gate-queue')
    try {
      const infra = s.stats().infrastructure
      expect(infra.instances['gate-island']).toBeGreaterThan(2)
      expect(infra.instances['gate-lane-oog']).toBe(1)
    } finally {
      s.dispose()
    }
  })
})

describe('headless scene: lighting per sim hour and the daylight lock (was terminal-twin-atmosphere.smoke.ts)', () => {
  const TRACER = 'tracer-1sts-10-boxes'
  const at = async (startDateTime: string, lockDaylight: boolean) => {
    const s = await headlessScene(TRACER, { quality: 'high', startDateTime, lockDaylight }) // day shadows are a High (and Medium) feature
    try {
      await s.step()
      return s.atmosphere()
    } finally {
      s.dispose()
    }
  }

  it('the sun follows the sim clock: day with shadows at 13:00, cheaper night mode with lights at 02:00', async () => {
    expect(await at('2026-10-26T13:00:00.000Z', false)).toMatchObject({ mode: 'day', shadows: true, masts: 0, equipmentLights: 0 })
    const night = await at('2026-10-26T02:00:00.000Z', false)
    expect(night).toMatchObject({ mode: 'night', shadows: false })
    expect(night.masts).toBeGreaterThan(0)
    expect(night.equipmentLights).toBeGreaterThan(0)
  })

  it('the daylight lock holds day at 02:00 and lifting it lets night fall', async () => {
    expect(await at('2026-10-26T02:00:00.000Z', true)).toMatchObject({ mode: 'day', shadows: true, masts: 0 })
    const s = await headlessScene(TRACER, { quality: 'high', startDateTime: '2026-10-26T02:00:00.000Z' })
    try {
      expect(s.atmosphere().mode).toBe('day') // the default, as every launch
      s.setLockDaylight(false)
      expect(s.atmosphere().mode).toBe('night')
    } finally {
      s.dispose()
    }
  })

  it('a generic preset keeps the procedural backdrop', async () => {
    const s = await headlessScene('truck-gate-queue')
    try {
      const { backdrop } = s.atmosphere()
      expect(backdrop).toMatchObject({ kind: 'generic', models: 'procedural' })
      for (const part of ['shore', 'anchorage', 'tanks', 'landside', 'town']) expect(backdrop.parts).not.toContain(part)
    } finally {
      s.dispose()
    }
  })
})
