/**
 * TT-10: export load flow and work packages, through the headless engine API (seam 1).
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, restoreSimulation, type EngineEvent, type Simulation } from '../engine'
import { DEFAULT_SHC_KINEMATICS, ScenarioBuilder, withShcFleet } from '../scenario/builder'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig } from '../scenario/types'
import { isCellUsable, isStackBase, vesselClass } from '../scenario/vesselClasses'

function run(config: ScenarioConfig, handlers = {}): Simulation {
  const sim = createSimulation(config, handlers)
  sim.runUntil({ maxEvents: 200_000 })
  return sim
}

const ofType = <T extends EngineEvent['type']>(sim: Simulation, type: T) =>
  sim.eventLog().filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type)

describe('load fixture: 1 STS loads 10 export boxes from 1 block', () => {
  const sim = run(fixtures['load-1sts-10-boxes-1block'])

  it('runs end to end without an invariant violation', () => {
    expect(sim.firstError).toBeNull()
    expect(sim.status).toBe('ended')
    expect(sim.invariantReport().violations).toEqual([])
    expect(sim.query.vessel('V001').status).toBe('departed')
  })

  it('moves every export box yard slot → ASC → WTP pad → SHC → ground position → STS → vessel slot', () => {
    const boxes = sim.query.containers()
    expect(boxes).toHaveLength(10)
    for (const box of boxes)
      expect(box.custodyHistory.map((h) => h.owner.kind), box.id).toEqual([
        'yardSlot',
        'asc',
        'wtpPad',
        'shc',
        'groundPosition',
        'sts',
        'vesselSlot',
      ])
    // every booked slot got its box
    const booked = sim.query.vesselSlots('V001').filter((s) => s.purpose === 'load')
    expect(booked).toHaveLength(10)
    for (const s of booked) expect(s.containerId).toBe(s.plannedContainerId)
    expect(sim.query.yardSlots()).toHaveLength(0)
  })

  it('each step happens only after the previous holder has set the box down', () => {
    for (const box of sim.query.containers()) {
      const times = box.custodyHistory.map((h) => h.t)
      expect([...times].sort((a, b) => a - b)).toEqual(times)
      // the hand-over events are distinct and ordered
      expect(new Set(box.custodyHistory.map((h) => h.eventId)).size).toBe(box.custodyHistory.length)
    }
    expect(ofType(sim, 'StsLoaded')).toHaveLength(10)
  })
})

describe('mixed fixture: discharge then load on one vessel', () => {
  const sim = run(fixtures['mixed-discharge-then-load'])

  it('completes and the vessel departs', () => {
    expect(sim.firstError).toBeNull()
    expect(sim.status).toBe('ended')
    expect(sim.query.vessel('V001').status).toBe('departed')
    expect(sim.kpiReport().movesCompleted).toBe(16)
  })

  it('discharges before it loads', () => {
    const log = sim.eventLog()
    const lastGrounded = Math.max(...ofType(sim, 'StsGrounded').map((e) => e.seq))
    const firstLoadStart = Math.min(...ofType(sim, 'StsLoadStarted').map((e) => e.seq))
    expect(lastGrounded).toBeLessThan(firstLoadStart)
    expect(log.length).toBeGreaterThan(0)
  })
})

/** A feeder with `load` 40 ft export boxes: stacks two high on board. */
function stackedLoad(opts: { load: number; shcs?: number }): ScenarioConfig {
  const config = new ScenarioBuilder('stacked-load', 'export boxes stacked on board').hatch({ enabled: false })
    .seed(3)
    .moveVariation(10)
    .quay(400, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 60, groundPositions: 3 })
    .vesselCall('V001', { name: 'Stack Load', sizeClass: 'feeder', load: opts.load, maxSts: 1, sizeMix: { '40': 1 } })
    .shcs(opts.shcs ?? 3)
    .block('B01', { x: 20 })
    .ascsPerBlock(2)
    .endWhen({ vesselsCompleted: 1 })
    .build()
  return config
}

describe('stowage order', () => {
  it('loads bottom tiers before upper tiers in every stack', () => {
    const sim = run(stackedLoad({ load: 70 }))
    expect(sim.firstError).toBeNull()
    expect(sim.status).toBe('ended')
    const filled = new Set<string>()
    const loaded = ofType(sim, 'StsLoaded')
    expect(loaded).toHaveLength(70)
    let stacked = 0
    for (const e of loaded) {
      const slot = sim.query.vesselSlot(e.payload.slotId)
      if (!isStackBase(vesselClass('feeder'), slot.row, slot.tier)) {
        stacked++
        expect(filled.has(`${slot.bay}:${slot.row}:${slot.tier - 1}`), `${slot.id} loaded before the slot below`).toBe(true)
      }
      filled.add(`${slot.bay}:${slot.row}:${slot.tier}`)
    }
    expect(stacked).toBeGreaterThan(0)
  })

  it('an invariant fails a box put into a slot whose lower tier is empty', () => {
    const sim = createSimulation(stackedLoad({ load: 70 }))
    sim.runUntil({ eventType: 'BerthAllocated' })
    const snap = sim.snapshot()
    const upper = Object.values(snap.state.vesselSlots).find((s) => s.purpose === 'load' && s.tier === 1 && isCellUsable(vesselClass('feeder'), s.row, 0))
    expect(upper).toBeDefined()
    // cheat: a box appears in the upper slot while the one below is still empty
    const slot = snap.state.vesselSlots[(upper as { id: string }).id]
    const box = snap.state.containers[slot.plannedContainerId as string]
    slot.containerId = box.id
    const restored = restoreSimulation(snap, {}, { invariants: { failFast: false } })
    restored.runUntil({ maxEvents: 5 })
    const ids = restored.invariantReport().violations.map((v) => v.invariant)
    expect(ids).toContain('stowage.order')
  })
})

describe('work-package release', () => {
  it('keeps exactly K packages released ahead per STS (default 2): ahead = min(K, packages left to start)', () => {
    for (const k of [1, 2, 3]) {
      const config = stackedLoad({ load: 30 })
      config.workPackages = { releaseAhead: k }
      const sim = run(config)
      expect(sim.firstError).toBeNull()
      const log = sim.eventLog().filter((e) => e.type.startsWith('WorkPackage'))
      const totalPackages = log.filter((e) => e.type === 'WorkPackageReleased').length
      expect(totalPackages).toBeGreaterThan(k + 1)
      let started = 0
      let released = 0
      let maxAhead = 0
      log.forEach((e, i) => {
        if (e.type === 'WorkPackageStarted') started++
        if (e.type === 'WorkPackageReleased') {
          released++
          expect(e.payload.ahead).toBeLessThanOrEqual(k)
        }
        const endOfInstant = i === log.length - 1 || log[i + 1].t !== e.t
        if (!endOfInstant) return
        // once the crane and the release decision have both acted, exactly K packages wait ahead (fewer at the end)
        const ahead = released - started
        maxAhead = Math.max(maxAhead, ahead)
        expect(ahead, `after t=${e.t}`).toBe(Math.min(k, totalPackages - started))
      })
      expect(maxAhead).toBe(k)
    }
  })

  it('the just-in-time strategy releases one package at a time', () => {
    const config = stackedLoad({ load: 30 })
    config.decisions = { points: { workPackageRelease: { strategy: 'just-in-time' } } }
    const sim = run(config)
    expect(sim.firstError).toBeNull()
    expect(sim.status).toBe('ended')
    for (const e of ofType(sim, 'WorkPackageReleased')) expect(e.payload.ahead).toBe(0)
  })

  it('records the release lead time and completion in the KPIs', () => {
    const sim = run(stackedLoad({ load: 30 }))
    const wp = sim.kpiReport().workPackages as NonNullable<ReturnType<Simulation['kpiReport']>['workPackages']>
    expect(wp.released).toBeGreaterThan(0)
    expect(wp.completed).toBe(wp.released)
    expect(wp.boxesLoaded).toBe(30)
    expect(wp.leadTimeMeanS).toBeGreaterThan(0)
    expect(wp.leadTimeMaxS).toBeGreaterThanOrEqual(wp.leadTimeMeanS)
  })
})

describe('STS waiting for the SHC', () => {
  it('waiting time rises when the SHC count is reduced', () => {
    const waitOf = (shcs: number): number => {
      // slow SHCs: with cornering at speed (V11-12) one default SHC keeps up with this crane
      const slow = { ...DEFAULT_SHC_KINEMATICS, driveEmpty: { vMax: 3, accel: 0.4, decel: 0.5 }, driveLoaded: { vMax: 3, accel: 0.4, decel: 0.5 } }
      const config = withShcFleet(stackedLoad({ load: 24, shcs: 6 }), shcs, slow)
      const sim = run(config)
      expect(sim.firstError).toBeNull()
      expect(sim.status).toBe('ended')
      return sim.kpiSeries().series['sts.wait-shc-s'].entities.STS01.total ?? 0
    }
    const many = waitOf(6)
    const one = waitOf(1)
    expect(one).toBeGreaterThan(many)
    expect(one).toBeGreaterThan(0)
  })
})
