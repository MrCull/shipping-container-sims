/**
 * TT-05: SHC horizontal transport (STS ground position → WTP pad), through
 * the public engine API (seam 1) and the shcDispatch decision point (seam 2).
 */
import { describe, expect, it } from 'vitest'
import {
  createSimulation,
  getStrategy,
  restoreSimulation,
  strategies,
  summarizeRun,
  type ShcDispatchReply,
  type ShcDispatchRequest,
  type WtpPadSelectionReply,
  type WtpPadSelectionRequest,
  type Simulation,
} from '../engine'
import { ScenarioBuilder, withShcFleet } from '../scenario/builder'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig } from '../scenario/types'

const FIXTURE = 'shc-1sts-2shc-1wtp'
const shcFixture = fixtures[FIXTURE]

describe('SHC fixture: 1 STS → 2 SHC → 1 WTP strip', () => {
  it('runs headless to the end with no invariant violations', () => {
    const sim = createSimulation(shcFixture)
    const result = sim.runUntil()
    expect(result.reason).toBe('ended')
    expect(sim.firstError).toBeNull()
    expect(sim.invariantReport().violations).toEqual([])
  })

  it("every box's custody goes vessel slot → STS → ground position → SHC → WTP pad", () => {
    const sim = createSimulation(shcFixture)
    sim.runUntil()
    const shcIds = new Set<string>()
    const typeOf = (eventId: number | null) => sim.eventLog().find((e) => e.id === eventId)?.type
    for (const { id } of sim.query.containers()) {
      const history = sim.query.container(id).custodyHistory
      expect(history.slice(0, 5).map((h) => h.owner.kind), id).toEqual([
        'vesselSlot',
        'sts',
        'groundPosition',
        'shc',
        'wtpPad',
      ])
      shcIds.add(history[3].owner.id)
      // custody changes at the SHC's confirmed grip and release
      expect(typeOf(history[3].eventId)).toBe('ShcPicked')
      expect(typeOf(history[4].eventId)).toBe('ShcDroppedAtWtp')
      for (let i = 1; i < history.length; i++) expect(history[i].t).toBeGreaterThanOrEqual(history[i - 1].t)
    }
    // with cornering at speed (V11-12) one SHC keeps up with this crane and takes every box
    expect([...shcIds].sort()).toEqual(['SHC01'])
  })

  it('an SHC trip runs through the whole state machine in order, each phase caused by the previous', () => {
    const sim = createSimulation(shcFixture)
    sim.runUntil()
    const dropped = sim.eventLog().find((e) => e.type === 'ShcDroppedAtWtp')!
    const chain = sim.why(dropped.id).map((e) => e.type)
    expect(chain.slice(0, 11).reverse()).toEqual([
      'DecisionResolved',
      'ShcJobAssigned',
      'ShcRoutingEmpty',
      'ShcPositioningAtPickup',
      'ShcLocking',
      'ShcPicked',
      'ShcRoutingLoaded',
      'ShcPositioningAtDropoff',
      'ShcLowering',
      'ShcUnlocking',
      'ShcDroppedAtWtp',
    ])
    // idle SHCs end up parked
    for (const shc of sim.query.shcs()) expect(shc.status).toBe('parked')
  })
})

/** Same fixture, scarce SHCs: 1 slow SHC and 2 ground positions. */
function scarce(): ScenarioConfig {
  const c = withShcFleet(shcFixture, 1, {
    driveEmpty: { vMax: 1.2, accel: 0.3, decel: 0.3 },
    driveLoaded: { vMax: 1, accel: 0.2, decel: 0.2 },
  })
  c.name = 'shc-scarce'
  c.sts[0].groundPositions = 2
  c.endConditions = { simDurationS: 4 * 3600 }
  return c
}

/** Crowded: two cranes feed one block with 6 SHCs, so trips cross and compete for conflict zones. */
function crowded(): ScenarioConfig {
  return new ScenarioBuilder('shc-crowded', '2 STS → 6 SHC → 1 WTP strip')
    .seed(7)
    .moveVariation(10)
    .driverVariability(20)
    .quay(500, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 60, groundPositions: 3 })
    .sts('STS02', { gantryX: 300, groundPositions: 3 })
    .vesselCall('V001', { name: 'Shuttle One', sizeClass: 'feeder', discharge: 10, maxSts: 1, sizeMix: { '40': 1 } })
    .vesselCall('V002', { name: 'Shuttle Two', sizeClass: 'feeder', arrivalS: 30, discharge: 10, maxSts: 1, sizeMix: { '40': 1 } })
    .shcs(6)
    .block('B01', { x: 180, wtpPads: 4 })
    .endWhen({ simDurationS: 2400 })
    .build()
}

/** Occupation intervals per place, from custody histories (independent of the engine's invariants). */
function occupationOverlaps(sim: Simulation, kinds: string[]): string[] {
  const intervals = new Map<string, { box: string; from: number; to: number }[]>()
  for (const box of sim.query.containers()) {
    box.custodyHistory.forEach((h, i) => {
      if (!kinds.includes(h.owner.kind)) return
      const to = box.custodyHistory[i + 1]?.t ?? Infinity
      const key = `${h.owner.kind}:${h.owner.id}`
      intervals.set(key, [...(intervals.get(key) ?? []), { box: box.id, from: h.t, to }])
    })
  }
  const problems: string[] = []
  for (const [place, list] of intervals) {
    list.sort((a, b) => a.from - b.from)
    for (let i = 1; i < list.length; i++)
      if (list[i].from < list[i - 1].to) problems.push(`${place}: ${list[i - 1].box} and ${list[i].box}`)
  }
  return problems
}

/** SHC reservations as published in events (ShcJobAssigned / ShcRoutingToParking). */
function publishedReservationOverlaps(sim: Simulation): string[] {
  const all = sim
    .eventLog()
    .flatMap((e) => (e.type === 'ShcJobAssigned' || e.type === 'ShcRoutingToParking' ? e.payload.reservations : []))
  const problems: string[] = []
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]
      const b = all[j]
      if (a.zone === b.zone && a.from < b.to - 1e-9 && b.from < a.to - 1e-9) problems.push(`${a.zone}: ${a.holder} / ${b.holder}`)
    }
  return problems
}

describe('SHC invariants hold for every fixture and stress variant', () => {
  const scenarios: [string, () => ScenarioConfig][] = [
    ...Object.entries(fixtures).map(([name, c]) => [name, () => c] as [string, () => ScenarioConfig]),
    ['scarce SHCs', scarce],
    ['crowded SHCs', crowded],
  ]
  for (const [name, build] of scenarios) {
    it(`${name}: no double occupancy, overlapping reservations or double claims`, () => {
      const sim = createSimulation(build())
      expect(sim.runUntil().reason).toBe('ended')
      expect(sim.invariantReport().violations).toEqual([])
      expect(occupationOverlaps(sim, ['groundPosition', 'wtpPad'])).toEqual([])
      expect(publishedReservationOverlaps(sim)).toEqual([])
    })
  }

  it('crowded SHCs really compete: some trips wait for their reservations', () => {
    const sim = createSimulation(crowded())
    sim.runUntil()
    const waits = Object.values(sim.kpiReport().horizontal!.shcs).map((s) => s.reservationWaitS)
    expect(Math.max(...waits)).toBeGreaterThan(0)
    const delayed = sim
      .eventLog()
      .filter((e) => (e.type === 'ShcJobAssigned' || e.type === 'ShcRoutingToParking') && e.payload.departAt > e.t)
    expect(delayed.length).toBeGreaterThan(0)
  })

  it('a broken dispatch handler that hands out an already claimed job trips claim.single-holder', () => {
    // Hands every SHC the first job it ever saw, as long as that job is still in flight.
    let first: string | null = null
    const sim = createSimulation(crowded(), {
      shcDispatch: (msg, query) => {
        if (!first || !query.shcJobs().some((j) => j.id === first)) first = msg.payload.jobs[0]?.jobId ?? null
        return { jobId: first }
      },
    })
    expect(sim.runUntil().reason).toBe('failed')
    expect(sim.firstError?.message).toMatch(/claim\.single-holder/)
  })

  it('a broken dispatch handler that always picks pad 1 (ASC off) double-occupies it', () => {
    const sim = createSimulation(
      shcFixture,
      { wtpPadSelection: (msg) => ({ wtpPadId: msg.payload.wtpPads[0].id }) },
      { subsystems: { asc: 'off' } },
    )
    expect(sim.runUntil().reason).toBe('failed')
    expect(sim.firstError?.message).toMatch(/custody\.single-owner.*B01-WTP1 is double-occupied/)
  })

  it('overlapping reservations are reported (tampered snapshot)', () => {
    const sim = createSimulation(shcFixture)
    sim.runUntil({ eventType: 'ShcJobAssigned' })
    const snap = sim.snapshot()
    const r = snap.state.reservations.find((x) => x.holder === 'SHC01')!
    snap.state.reservations.push({ ...r, id: 9999, holder: 'SHC02' })
    const tampered = restoreSimulation(snap)
    tampered.step()
    expect(tampered.status).toBe('failed')
    expect(tampered.firstError?.message).toMatch(/reservation\.no-overlap/)
  })
})

describe('waiting when SHCs are scarce', () => {
  it('the STS waits for a free ground position, and the wait is recorded', () => {
    // back-off timer off: only a freed position (an SHC pick) wakes the crane
    const config = scarce()
    config.layout = { ...config.layout, stsGroundRetryS: 0 }
    const sim = createSimulation(config)
    expect(sim.runUntil().reason).toBe('ended')
    const log = sim.eventLog()
    const started = log.filter((e) => e.type === 'StsWaitingForGroundPosition')
    const ended = log.filter((e) => e.type === 'StsGroundPositionWaitEnded')
    expect(started.length).toBeGreaterThan(0)
    expect(ended).toHaveLength(started.length)
    const waited = ended.reduce((sum, e) => sum + (e.type === 'StsGroundPositionWaitEnded' ? e.payload.waitedS : 0), 0)
    expect(waited).toBeGreaterThan(0)
    expect(sim.kpiReport().horizontal!.stsGroundPositionWaitS.STS01).toBeCloseTo(waited, 3)
    // the wait ends because an SHC picked a box from that crane's ground position
    expect(sim.why(ended[0].id)[1].type).toBe('ShcPicked')
    // and every box still reaches the WTP pad
    expect(sim.kpiReport().horizontal!.boxesToWtp).toBe(10)
  })

  it('with the default back-off the crane also re-asks on a timer and every box still arrives', () => {
    const sim = createSimulation(scarce())
    expect(sim.runUntil().reason).toBe('ended')
    expect(sim.invariantReport().violations).toEqual([])
    expect(sim.kpiReport().horizontal!.boxesToWtp).toBe(10)
  })
})

describe('shcDispatch decision point', () => {
  const withStrategy = (strategy: string): ScenarioConfig => ({
    ...shcFixture,
    decisions: { points: { shcDispatch: { strategy }, wtpPadSelection: { strategy: strategy === 'nearest-job' ? 'nearest-box' : 'first-free' } } },
  })

  it('offers at least two built-in strategies', () => {
    expect(Object.keys(strategies.shcDispatch.strategies).length).toBeGreaterThanOrEqual(2)
    expect(strategies.shcDispatch.default).toBe('oldest-job')
  })

  it("the fixture's golden summary differs between oldest-job and nearest-job", () => {
    const oldest = createSimulation(withStrategy('oldest-job'))
    const nearest = createSimulation(withStrategy('nearest-job'))
    oldest.runUntil()
    nearest.runUntil()
    const a = summarizeRun(oldest)
    const b = summarizeRun(nearest)
    expect(a.eventLogHash).not.toBe(b.eventLogHash)
    expect(a.kpis.horizontal).not.toEqual(b.kpis.horizontal)
    // nearest-job + nearest-box deliver to the pad nearest the crane (block B01 is west of STS01)
    const pads = (sim: Simulation) =>
      new Set(sim.eventLog().flatMap((e) => (e.type === 'ShcDroppedAtWtp' ? [e.payload.wtpPadId] : [])))
    expect([...pads(oldest)]).toContain('B01-WTP1')
    expect([...pads(nearest)]).toContain('B01-WTP4')
    expect([...pads(nearest)]).not.toContain('B01-WTP1')
    for (const sim of [oldest, nearest]) expect(sim.invariantReport().violations).toEqual([])
  })

  it('a dispatch request lists the open jobs with route distances and the pads', () => {
    const seen: ShcDispatchRequest[] = []
    const oldest = getStrategy('shcDispatch', 'oldest-job')
    const sim = createSimulation(shcFixture, {
      shcDispatch: (msg, query) => {
        seen.push(msg.payload)
        return oldest(msg, query) as ShcDispatchReply
      },
    })
    sim.runUntil()
    expect(seen).toHaveLength(10)
    const first = seen[0]
    expect(first.shcId).toBe('SHC01')
    expect(first.jobs).toHaveLength(1)
    expect(first.jobs[0]).toMatchObject({ groundPositionId: 'STS01-GP1', stsId: 'STS01' })
    expect(first.jobs[0].distanceM).toBeGreaterThan(0)
    expect(first.wtpPads.map((p) => p.id)).toEqual(['B01-WTP1', 'B01-WTP2', 'B01-WTP3', 'B01-WTP4'])
  })

  it('TOS latency on shcDispatch idles the waiting SHC (keep-running)', () => {
    const sim = createSimulation({
      ...shcFixture,
      decisions: { points: { shcDispatch: { latency: { delay: { kind: 'fixed', ms: 3000 } } } } },
    })
    sim.runUntil()
    const k = sim.kpiReport().handlers.shcDispatch
    expect(k.simLatencyS.mean).toBeCloseTo(3, 6)
    expect(k.equipmentIdleS).toBeCloseTo(3 * k.resolved, 6)
    expect(sim.invariantReport().violations).toEqual([])
    expect(sim.kpiReport().horizontal!.boxesToWtp).toBe(10)
  })
})

describe('wtpPadSelection decision point (V11-11)', () => {
  const padChoices = (sim: Simulation) =>
    sim.eventLog().flatMap((e) =>
      e.type === 'DecisionResolved' && e.payload.decisionPoint === 'wtpPadSelection' ? [e.payload.reply.wtpPadId] : [],
    )
  const resolved = (sim: Simulation, dp: 'shcDispatch' | 'wtpPadSelection') =>
    sim.eventLog().flatMap((e) => (e.type === 'DecisionResolved' && e.payload.decisionPoint === dp ? [e] : []))
  const withPad = (extra: object): ScenarioConfig => ({ ...shcFixture, decisions: { points: { wtpPadSelection: extra } } })

  it('is its own decision point with first-free as default and 2+ strategies', () => {
    expect(strategies.wtpPadSelection.default).toBe('first-free')
    expect(Object.keys(strategies.wtpPadSelection.strategies).length).toBeGreaterThanOrEqual(2)
  })

  it('SHC dispatch picks the job, then the pad is asked once per discharge job (default: first free pad)', () => {
    const sim = createSimulation(shcFixture)
    sim.runUntil()
    const dispatch = resolved(sim, 'shcDispatch')[0]
    expect((dispatch.payload as { reply: unknown }).reply).toEqual({ jobId: 'J1' })
    expect(padChoices(sim)).toHaveLength(10)
    expect(padChoices(sim)[0]).toBe('B01-WTP1')
    // the pad decision follows its dispatch decision, and the trip is planned from the pad reply
    const firstPad = resolved(sim, 'wtpPadSelection')[0]
    expect(firstPad.id).toBeGreaterThan(dispatch.id)
    expect(sim.kpiReport().handlers.wtpPadSelection.calls).toBe(10)
    expect(sim.invariantReport().violations).toEqual([])
  })

  it('the request names the job, the box position and every pad', () => {
    const seen: WtpPadSelectionRequest[] = []
    const first = getStrategy('wtpPadSelection', 'first-free')
    const sim = createSimulation(shcFixture, {
      wtpPadSelection: (msg, query) => {
        seen.push(msg.payload)
        return first(msg, query) as WtpPadSelectionReply
      },
    })
    sim.runUntil()
    expect(seen[0]).toMatchObject({ shcId: 'SHC01', jobId: 'J1', stsId: 'STS01', groundPositionId: 'STS01-GP1' })
    expect(seen[0].wtpPads.map((p) => p.id)).toEqual(['B01-WTP1', 'B01-WTP2', 'B01-WTP3', 'B01-WTP4'])
  })

  it('an alternative strategy diverges at the first wtpPadSelection decision', () => {
    const a = createSimulation(shcFixture)
    const b = createSimulation(withPad({ strategy: 'nearest-box' }))
    a.runUntil()
    b.runUntil()
    const ra = resolved(a, 'wtpPadSelection')
    const rb = resolved(b, 'wtpPadSelection')
    expect((rb[0].payload as { reply: unknown }).reply).not.toEqual((ra[0].payload as { reply: unknown }).reply)
    // everything before that first pad decision is identical
    const idx = a.eventLog().findIndex((e) => e.id === ra[0].id)
    expect(b.eventLog().slice(0, idx).map((e) => [e.type, e.t])).toEqual(a.eventLog().slice(0, idx).map((e) => [e.type, e.t]))
    expect(summarizeRun(a).eventLogHash).not.toBe(summarizeRun(b).eventLogHash)
    expect(b.invariantReport().violations).toEqual([])
  })

  it('latency on wtpPadSelection idles the SHC waiting for its pad', () => {
    const sim = createSimulation(withPad({ latency: { delay: { kind: 'fixed', ms: 2000 } } }))
    sim.runUntil()
    const k = sim.kpiReport().handlers.wtpPadSelection
    expect(k.simLatencyS.mean).toBeCloseTo(2, 6)
    expect(k.equipmentIdleS).toBeCloseTo(2 * k.resolved, 6)
    expect(sim.kpiReport().horizontal!.boxesToWtp).toBe(10)
    expect(sim.invariantReport().violations).toEqual([])
  })

  it('a timeout falls back to the default strategy', () => {
    const sim = createSimulation(withPad({ strategy: 'last-free', latency: { timeoutPct: 100 }, fallbackStrategy: 'first-free' }))
    sim.runUntil()
    expect(sim.kpiReport().handlers.wtpPadSelection.timeouts).toBe(10)
    expect(padChoices(sim)[0]).toBe('B01-WTP1')
    expect(sim.kpiReport().horizontal!.boxesToWtp).toBe(10)
  })

  it('a null reply gives the job back (open again) and parks the SHC', () => {
    const sim = createSimulation(shcFixture, { wtpPadSelection: () => ({ wtpPadId: null }) })
    const resolved = () =>
      sim.eventLog().some((e) => e.type === 'DecisionResolved' && e.payload.decisionPoint === 'wtpPadSelection')
    while (!resolved()) sim.step()
    expect(sim.query.shcJobs().find((j) => j.id === 'J1')).toMatchObject({ shcId: null })
    expect(sim.query.shcs().find((x) => x.id === 'SHC01')).toMatchObject({ status: 'parked', jobId: null })
    expect(sim.firstError).toBeNull()
  })
})

describe('subsystem modes', () => {
  const types = (sim: Simulation) => new Set(sim.eventLog().map((e) => e.type))

  it('the instant ASC takes each box as soon as its SHC has cleared the pad, with zero-duration moves', () => {
    const sim = createSimulation(shcFixture)
    sim.runUntil()
    const log = sim.eventLog()
    const cleared = log.filter((e) => e.type === 'ShcCleared')
    const picks = log.filter((e) => e.type === 'AscPicked')
    expect(picks).toHaveLength(10)
    expect(log.filter((e) => e.type === 'AscStacked')).toHaveLength(10)
    for (const p of picks) {
      const stacked = log.find((e) => e.type === 'AscStacked' && e.payload.containerId === p.payload.containerId)!
      expect(stacked.t).toBe(p.t)
      const c = cleared.find((e) => e.payload.containerId === p.payload.containerId)!
      expect(p.t).toBeGreaterThanOrEqual(c.t)
    }
    for (const { id } of sim.query.containers())
      expect(sim.query.container(id).custodyHistory.slice(5).map((h) => h.owner.kind)).toEqual(['asc', 'yardSlot'])
  })

  it('ASC off: pads fill up and nothing clears them', () => {
    const sim = createSimulation(shcFixture, {}, { subsystems: { asc: 'off' } })
    expect(sim.runUntil().reason).toBe('ended')
    expect(types(sim).has('AscPicked')).toBe(false)
    expect(sim.query.containers().filter((c) => c.custody.kind === 'wtpPad')).toHaveLength(4)
    expect(sim.invariantReport().violations).toEqual([])
  })

  it('SHC off (isolated quay test): boxes stay on the ground positions and the STS waits', () => {
    const sim = createSimulation(shcFixture, {}, { subsystems: { shc: 'off' } })
    expect(sim.runUntil().reason).toBe('ended')
    expect([...types(sim)].filter((t) => t.startsWith('Shc'))).toEqual([])
    expect(sim.query.containers().filter((c) => c.custody.kind === 'groundPosition')).toHaveLength(3)
    expect(types(sim).has('StsWaitingForGroundPosition')).toBe(true)
    expect(sim.invariantReport().violations).toEqual([])
  })

  it('SHC instant: the same event types as real, with zero-duration trips', () => {
    const real = createSimulation(shcFixture)
    const instant = createSimulation(shcFixture, {}, { subsystems: { shc: 'instant' } })
    real.runUntil()
    expect(instant.runUntil().reason).toBe('ended')
    const shcTypes = (sim: Simulation) => [...types(sim)].filter((t) => t.startsWith('Shc') && t !== 'ShcRoutingToParking').sort()
    expect(shcTypes(instant)).toEqual(shcTypes(real))
    const log = instant.eventLog()
    for (const a of log) {
      if (a.type !== 'ShcJobAssigned') continue
      const drop = log.find((e) => e.type === 'ShcDroppedAtWtp' && e.payload.jobId === a.payload.jobId)
      expect(drop?.t).toBe(a.t)
    }
    expect(instant.invariantReport().violations).toEqual([])
  })
})

describe('determinism and snapshots', () => {
  it('same seed → same hash; a snapshot mid-trip resumes to the same end', () => {
    const a = createSimulation(shcFixture)
    a.runUntil()
    const b = createSimulation(shcFixture)
    b.runUntil({ eventType: 'ShcRoutingLoaded' })
    const resumed = restoreSimulation(b.snapshot())
    resumed.runUntil()
    expect(resumed.eventLogHash()).toBe(a.eventLogHash())
    expect(resumed.kpiReport()).toEqual(a.kpiReport())
  })
})
