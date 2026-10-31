import { describe, expect, it } from 'vitest'
import { createSimulation } from '../engine'
import { fixtures } from '../scenario/fixtures'
import { buildVesselStatus, collectVesselStatusInput, formatCountdown, vesselStatusInputFromModel, type VesselStatusInput } from '../modules/vesselStatus'
import { SceneModel } from '../modules/sceneModel'
import { emptyDelta } from './delta'

const base: VesselStatusInput = {
  status: 'scheduled',
  etaS: 600,
  berthAllocatedS: null,
  berthedS: null,
  departedS: null,
  mooringS: 1800,
  moves: { total: 40, done: 0 },
  perSts: [],
}

describe('buildVesselStatus', () => {
  it('approaching: ETA countdown, operations start unknown', () => {
    const s = buildVesselStatus(base, 100)
    expect(s.phase).toBe('approaching')
    expect(s.etaS).toBe(600)
    expect(s.etaCountdownS).toBe(500)
    expect(s.opsStartS).toBeNull()
    expect(s.countdownS).toBeNull()
    expect(s.label).toEqual({ phase: 'approaching', countdownS: 500 })
  })

  it('waiting for berth: no estimate, so no countdown', () => {
    const s = buildVesselStatus({ ...base, status: 'at-anchorage' }, 700)
    expect(s.phase).toBe('waiting')
    expect(s.opsStartS).toBeNull()
    expect(s.countdownS).toBeNull()
    expect(s.etaCountdownS).toBeNull()
    expect(s.label?.phase).toBe('waiting')
  })

  it('mooring: operations start is berth allocation plus the mooring time, counted down', () => {
    const input = { ...base, status: 'mooring' as const, berthAllocatedS: 100 }
    const s = buildVesselStatus(input, 400)
    expect(s.phase).toBe('mooring')
    expect(s.opsStartS).toBe(1900)
    expect(s.opsStartEstimated).toBe(true)
    expect(s.countdownS).toBe(1500)
    expect(s.label).toEqual({ phase: 'mooring', countdownS: 1500 })
  })

  it('the countdown stops at zero when the estimate has passed', () => {
    const input = { ...base, status: 'mooring' as const, berthAllocatedS: 100 }
    expect(buildVesselStatus(input, 1900).countdownS).toBe(0)
    expect(buildVesselStatus(input, 2500).countdownS).toBe(0)
  })

  it('working: the actual berth time is the operations start, no label, no countdown', () => {
    const s = buildVesselStatus({ ...base, status: 'berthed', berthAllocatedS: 100, berthedS: 1900, moves: { total: 40, done: 10 } }, 2000)
    expect(s.phase).toBe('working')
    expect(s.opsStartS).toBe(1900)
    expect(s.opsStartEstimated).toBe(false)
    expect(s.countdownS).toBeNull()
    expect(s.label).toBeNull()
    expect(s.moves).toEqual({ total: 40, done: 10, remaining: 30 })
  })

  it('unmooring and departed keep the facts and have no label', () => {
    const un = buildVesselStatus({ ...base, status: 'unmooring', berthAllocatedS: 0, berthedS: 1800, moves: { total: 4, done: 4 } }, 5000)
    expect(un.phase).toBe('unmooring')
    expect(un.label).toBeNull()
    expect(un.moves.remaining).toBe(0)
    const gone = buildVesselStatus({ ...base, status: 'departed', berthAllocatedS: 0, berthedS: 1800, departedS: 7000 }, 8000)
    expect(gone.phase).toBe('departed')
    expect(gone.label).toBeNull()
    expect(gone.countdownS).toBeNull()
  })

  it('reports moves done and remaining per STS and never goes negative', () => {
    const s = buildVesselStatus(
      { ...base, status: 'berthed', berthedS: 10, berthAllocatedS: 0, moves: { total: 10, done: 12 }, perSts: [{ id: 'STS01', total: 6, done: 2 }, { id: 'STS02', total: 4, done: 5 }] },
      50,
    )
    expect(s.moves).toEqual({ total: 10, done: 10, remaining: 0 })
    expect(s.perSts).toEqual([{ id: 'STS01', total: 6, done: 2, remaining: 4 }, { id: 'STS02', total: 4, done: 4, remaining: 0 }])
  })

  it('an unknown ETA stays unknown', () => {
    const s = buildVesselStatus({ ...base, etaS: null }, 0)
    expect(s.etaS).toBeNull()
    expect(s.etaCountdownS).toBeNull()
  })
})

describe('vessel status from the engine and from the scene model', () => {
  const config = fixtures['two-vessels-compete-for-berth']

  it('mooring, anchorage and working agree between the query and the scene model', () => {
    const sim = createSimulation(config)
    sim.runUntil({ time: 400 })
    const model = new SceneModel(config)
    const entities = sim.query.vessels().flatMap((v) => {
      const out: { kind: 'vessel'; id: string; t: number; status: string; berthX?: number | null }[] = []
      if (v.berthAllocatedAt !== null) out.push({ kind: 'vessel', id: v.id, t: v.berthAllocatedAt, status: 'mooring', berthX: v.berthX })
      else if (v.anchored && v.arrivedAt !== null) out.push({ kind: 'vessel', id: v.id, t: v.arrivedAt, status: 'at-anchorage' })
      return out
    })
    model.apply(emptyDelta({ entities: entities as never }))
    const v1 = collectVesselStatusInput(sim.query, config, 'V001')
    const v2 = collectVesselStatusInput(sim.query, config, 'V002')
    expect(buildVesselStatus(v1, 400).phase).toBe('mooring')
    expect(buildVesselStatus(v2, 400).phase).toBe('waiting')
    expect(buildVesselStatus(v1, 400).opsStartS).toBe(config.quay.mooringS)
    const fromModel = vesselStatusInputFromModel(model, 'V001', 400)
    expect(buildVesselStatus(fromModel, 400).phase).toBe('mooring')
    expect(buildVesselStatus(fromModel, 400).opsStartS).toBe(config.quay.mooringS)
    expect(buildVesselStatus(vesselStatusInputFromModel(model, 'V002', 400), 400).phase).toBe('waiting')
    expect(buildVesselStatus(v1, 400).moves.total).toBeGreaterThan(0)
  })

  it('counts moves per STS while the vessel is worked, and reading the view leaves the log alone', () => {
    const sim = createSimulation(config)
    sim.runUntil({ time: 1500 })
    const before = sim.eventLog().length
    const s = buildVesselStatus(collectVesselStatusInput(sim.query, config, 'V001'), 1500)
    expect(s.phase).toBe('working')
    expect(s.perSts.length).toBeGreaterThan(0)
    expect(s.moves.done + s.moves.remaining).toBe(s.moves.total)
    expect(s.perSts.reduce((n, p) => n + p.total, 0)).toBe(s.moves.total)
    expect(sim.eventLog().length).toBe(before)
  })
})

describe('formatCountdown', () => {
  it('formats minutes and hours at a fixed width, rounding a part second up', () => {
    expect(formatCountdown(0)).toBe('00:00')
    expect(formatCountdown(0.2)).toBe('00:01')
    expect(formatCountdown(1500)).toBe('25:00')
    expect(formatCountdown(3725)).toBe('1:02:05')
    expect(formatCountdown(-5)).toBe('00:00')
  })
})
