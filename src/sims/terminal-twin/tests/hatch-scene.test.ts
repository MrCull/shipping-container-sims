/**
 * TT-R10: the scene model draws hatch panels from engine state. Steps the hatch-cover-cycle fixture through the worker host
 * (as the browser does), feeds every delta to a SceneModel, and checks the panel poses against the engine's panel state at
 * each hatch event: on the hatch, hanging from the crane, stacked in the laydown, back on the hatch.
 */
import { describe, expect, it } from 'vitest'
import type { HatchPanelState } from '../engine'
import { entityBounds, pickEntity } from '../modules/picking'
import { SceneModel } from '../modules/sceneModel'
import { hullWithOpenHatches, hullHatchOpenings } from '../modules/hullHatchOpening'
import type { HullMeta } from '../modules/vesselHull'
import { fixtures } from '../scenario/fixtures'
import { HATCH_THICKNESS_M } from '../scenario/vesselClasses'
import type { ScenarioConfig } from '../scenario/types'
import { createEngineHost } from '../worker/engineHost'
import type { Delta, EventSummary, WorkerRequest } from '../worker/protocol'

const config = fixtures['hatch-cover-cycle'] as ScenarioConfig
const HALF = HATCH_THICKNESS_M / 2
const EPS = 1e-6

interface Sample {
  event: EventSummary
  panel: HatchPanelState
}

/** Run the fixture one event at a time; return the model and the engine's state of the panel each hatch event named. */
async function run(): Promise<{ model: SceneModel; samples: Sample[]; query: <T>(kind: 'hatch' | 'hatchList', id?: string) => Promise<T> }> {
  const host = createEngineHost()
  const model = new SceneModel(config, config.seed)
  let rid = 0
  const call = async (req: WorkerRequest) => {
    const reply = await host.handle({ ...req, rid: ++rid })
    if (!reply.ok) throw new Error(reply.error)
    model.apply(reply.delta as Delta)
    return reply.result
  }
  // the host answers in-process with live state: copy it, as the worker's structured clone does
  const query = async <T>(kind: 'hatch' | 'hatchList', id?: string) => structuredClone(await call({ op: 'query', kind, id })) as T
  await call({ op: 'load', config, seed: config.seed })
  const samples: Sample[] = []
  for (let n = 0; n < 20000; n++) {
    const ev = (await call({ op: 'step' })) as EventSummary | null
    if (!ev) break
    const panelId = ev.type.startsWith('Hatch') ? ev.subjects.equipment?.find((id) => id.includes(':H')) : undefined
    if (panelId) samples.push({ event: ev, panel: await query<HatchPanelState>('hatch', panelId) })
  }
  return { model, samples, query }
}

describe('hatch panels in the scene model', () => {
  it('has exactly the engine panels', async () => {
    const { model, query } = await run()
    const engine = (await query<HatchPanelState[]>('hatchList')).map((p) => p.id).sort()
    expect(engine.length).toBeGreaterThan(0)
    expect([...model.hatchPanelIds].sort()).toEqual(engine)
  })

  it('poses panels like the engine through a remove and replace cycle', async () => {
    const { model, samples } = await run()
    const seen = new Set<string>()
    for (const { event, panel } of samples) {
      seen.add(event.type)
      const at = model.hatchPanelPose(panel.id, event.t)
      expect(at, `${event.type} ${panel.id}`).not.toBeNull()
      if (!at) continue
      expect(at.status).toBe(panel.status)
      if (panel.status === 'lifted') {
        // the spreader is at the panel: top face level with the hoist, over the panel's own hatch or its laydown bay
        expect(at.stsId).toBe(panel.stsId)
        continue
      }
      expect(at.x).toBeCloseTo(panel.pos.x, 6)
      expect(at.y + HALF).toBeCloseTo(panel.pos.y, 6)
      expect(at.z).toBeCloseTo(panel.pos.z, 6)
    }
    for (const type of ['HatchLashingReleased', 'HatchLifted', 'HatchSetInLaydown', 'HatchReplaced', 'HatchSecured']) expect(seen).toContain(type)
  })

  it('carries a panel on the spreader: lifted at its hatch, set down exactly in its laydown bay', async () => {
    const { model, samples } = await run()
    const lifts = samples.filter((s) => s.event.type === 'HatchLifted')
    const downs = samples.filter((s) => s.event.type === 'HatchSetInLaydown')
    expect(lifts.length).toBeGreaterThan(0)
    for (const { event, panel } of lifts) {
      const p = model.hatchPanelPose(panel.id, event.t)
      expect(p?.status).toBe('lifted')
      // at the instant of the lift the panel is still where it lay: on its hatch (removal) or at the top of its laydown stack (replacement)
      const from = panel.level === null ? { x: panel.home.x, y: panel.home.y, z: panel.home.z } : panel.pos
      expect(p?.x).toBeCloseTo(from.x, 3)
      expect(p?.y).toBeCloseTo(from.y - HALF, 3)
      expect(p?.z).toBeCloseTo(from.z, 3)
    }
    for (const { event, panel } of downs) {
      // still on the spreader the instant before it is set down, and at the very place the engine put it
      const before = model.hatchPanelPose(panel.id, event.t - EPS)
      expect(before?.status).toBe('lifted')
      expect(before?.x).toBeCloseTo(panel.pos.x, 3)
      expect(before?.y).toBeCloseTo(panel.pos.y - HALF, 3)
      expect(before?.z).toBeCloseTo(panel.pos.z, 3)
    }
  })

  it('keeps stacked panels on top of each other, clear of the quay', async () => {
    const { model, samples } = await run()
    const stacked = samples.filter((s) => s.event.type === 'HatchSetInLaydown' && (s.panel.level ?? 0) > 0)
    for (const { event, panel } of stacked) {
      const lower = samples.find((s) => s.event.type === 'HatchSetInLaydown' && s.panel.siteId === panel.siteId && s.panel.level === (panel.level ?? 0) - 1)
      if (!lower) continue
      const a = model.hatchPanelPose(panel.id, event.t)
      const b = model.hatchPanelPose(lower.panel.id, event.t)
      expect(a?.y).toBeGreaterThan(b?.y ?? 0)
    }
  })

  it('selects a panel: bounds, and a ray through it picks the panel and not the vessel', async () => {
    const { model, samples } = await run()
    const down = (b: { x: number; y: number; z: number }) => ({ origin: { x: b.x, y: b.y + 60, z: b.z }, dir: { x: 0, y: -1, z: 0 } })
    // on its hatch, inside the vessel's box
    const onHatch = samples.find((s) => s.event.type === 'HatchLashingReleased') as Sample
    const a = entityBounds(model, onHatch.panel.id, onHatch.event.t)
    expect(a).not.toBeNull()
    expect(pickEntity(model, onHatch.event.t, down(a as NonNullable<typeof a>))).toBe(onHatch.panel.id)
    // in the laydown
    const laid = samples.find((s) => s.event.type === 'HatchSetInLaydown') as Sample
    const b = entityBounds(model, laid.panel.id, laid.event.t)
    expect(b).not.toBeNull()
    expect(pickEntity(model, laid.event.t, down(b as NonNullable<typeof b>))).toBe(laid.panel.id)
    expect(model.statusAt('hatch', laid.panel.id, laid.event.t)).toBe('in-laydown')
    expect(model.entityCentre(laid.panel.id, laid.event.t)).not.toBeNull()
  })

  it('draws no panels with hatch covers off', () => {
    const off = new SceneModel({ ...config, hatch: { ...config.hatch, enabled: false } }, config.seed)
    expect(off.hatchPanelIds).toEqual([])
  })
})

describe('hull with open hatches', () => {
  // origin = aft edge of bay 0 (x 10), quay-side edge of row 0 (z 5), cover top (y 12); 4 rows of 2.5 m: z 5 .. -5
  const meta = { bayGrid: { origin: [10, 12, 5], holdTopY: 11.5, holdTiers: 4, tierPitchM: 2.9, rows: 4, rowPitchM: 2.5, bayPitchM: 14, bays: 3 } } as unknown as HullMeta
  const deck = 11.5 - 1.7
  /** Two triangles of a flat quad at y spanning [x0, x1] x [z0, z1], positions only. */
  const quad = (x0: number, x1: number, y: number, z0: number, z1: number) => [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1]
  const mesh = (positions: number[]) => ({ index: null, attributes: { position: { array: positions, itemSize: 3 } } })
  const open = (positions: number[], lod: 0 | 1, bays: number[]) => hullWithOpenHatches(meta, lod, mesh(positions), new Set(bays)).position
  const area = (p: Float32Array) => {
    let a = 0
    for (let t = 0; t < p.length; t += 9) a += Math.abs((p[t + 3] - p[t]) * (p[t + 8] - p[t + 2]) - (p[t + 6] - p[t]) * (p[t + 5] - p[t + 2])) / 2
    return a
  }

  it('drops the cover faces of the named bays only, keeping coaming walls and lashing bridges', () => {
    const panelTop = quad(10.7, 23.3, 12, -5.25, 5.25) // bay 0 cover top, 0.1 beyond the coaming each way
    const coaming = quad(10.8, 23.2, 10.5, -5.15, 5.15) // a wall below the hold top
    const otherBay = quad(24.7, 37.3, 12, -5.25, 5.25) // bay 1
    const bridge = quad(23.5, 24.5, 12, -5.25, 5.25) // lashing bridge in the gap
    const p = open([...panelTop, ...coaming, ...otherBay, ...bridge], 0, [0])
    expect(p.length / 9).toBe(6) // 8 triangles, the cover top (2) gone
    expect(Math.max(...Array.from(p).filter((_, i) => i % 3 === 1))).toBe(12)
    expect(open([...panelTop, ...coaming, ...otherBay, ...bridge], 0, [])).toHaveLength(8 * 9)
  })

  it('clips the main deck open inside the coaming and keeps the rest of it', () => {
    const deckQuad = quad(10, 24, deck, -8, 8) // full-beam deck over bay 0 (a hull 16 m wide)
    const p = open(deckQuad, 0, [0])
    const [o] = hullHatchOpenings(meta, [0])
    expect(area(Float32Array.from(deckQuad))).toBeCloseTo(14 * 16, 6)
    expect(area(p)).toBeCloseTo(14 * 16 - (o.x1 - o.x0) * (o.zQuay - o.zSea), 3)
    // nothing left inside the opening
    for (let t = 0; t < p.length; t += 9) {
      const cx = (p[t] + p[t + 3] + p[t + 6]) / 3
      const cz = (p[t + 2] + p[t + 5] + p[t + 8]) / 3
      expect(cx > o.x0 && cx < o.x1 && cz > o.zSea && cz < o.zQuay).toBe(false)
    }
  })

  it('interpolates the other attributes when it clips', () => {
    const positions = quad(10, 24, deck, -8, 8)
    const uv = positions.map((_, i) => (i % 3 === 0 ? positions[i] : 0)).filter((_, i) => i % 3 === 0).flatMap((x) => [x / 100, 0])
    const out = hullWithOpenHatches(meta, 0, { index: null, attributes: { position: { array: positions, itemSize: 3 }, uv: { array: uv, itemSize: 2 } } }, new Set([0]))
    for (let v = 0; v < out.position.length / 3; v++) expect(out.uv[v * 2]).toBeCloseTo(out.position[v * 3] / 100, 5)
  })

  it('LOD1: removes box sides and tops from the main deck up, and handles an index buffer', () => {
    const side = [10.7, deck, 5.25, 23.3, deck, 5.25, 23.3, 12, 5.25] // a box side from the deck to the cover top
    const top = quad(10.7, 23.3, 12, -5.25, 5.25)
    const all = [...side, ...top]
    const index = Array.from({ length: all.length / 3 }, (_, i) => i)
    const p = hullWithOpenHatches(meta, 1, { index, attributes: { position: { array: all, itemSize: 3 } } }, new Set([0])).position
    expect(p).toHaveLength(0)
  })
})
