import { describe, expect, it } from 'vitest'
import { createSimulation } from '../engine'
import { fixtures } from '../scenario/fixtures'
import { fixtureDefinitions } from '../scenario/fixtures/definitions'
import { isValidIso6346 } from '../scenario/iso6346'

const tracer = fixtures['tracer-1sts-10-boxes']

describe('tracer fixture: 1 STS discharges 10 boxes to ground positions', () => {
  it('committed fixture JSON matches its builder definition', () => {
    for (const [name, build] of Object.entries(fixtureDefinitions)) {
      expect(fixtures[name], `fixture ${name}: run pnpm run tt:fixtures`).toEqual(build())
    }
  })

  it('has 10 boxes with valid ISO 6346 ids', () => {
    const boxes = createSimulation(tracer).query.containers()
    expect(boxes).toHaveLength(10)
    for (const c of boxes) expect(isValidIso6346(c.id), c.id).toBe(true)
  })

  it('runs to completion: the vessel departs and the scenario ends', () => {
    const sim = createSimulation(tracer)
    const result = sim.runUntil()
    expect(result.reason).toBe('ended')
    expect(sim.status).toBe('ended')
    const types = sim.eventLog().map((e) => e.type)
    expect(types[0]).toBe('ScenarioStarted')
    expect(types.filter((t) => t === 'StsGrounded')).toHaveLength(10)
    expect(types.at(-2)).toBe('VesselDeparted')
    expect(types.at(-1)).toBe('ScenarioEnded')
    expect(sim.kpiReport().movesCompleted).toBe(10)
    expect(sim.kpiReport().vesselsCompleted).toBe(1)
  })

  it("every box's custody goes vessel slot → STS → ground position", () => {
    const sim = createSimulation(tracer)
    sim.runUntil()
    const groundPositionsUsed = new Set<string>()
    for (const { id } of sim.query.containers()) {
      const box = sim.query.container(id)
      expect(box.custodyHistory.map((h) => h.owner.kind)).toEqual(['vesselSlot', 'sts', 'groundPosition'])
      expect(box.custodyHistory[1].owner.id).toBe('STS01')
      // times strictly increase and each change points at the event that caused it
      expect(box.custodyHistory[1].t).toBeGreaterThan(box.custodyHistory[0].t)
      expect(box.custodyHistory[2].t).toBeGreaterThan(box.custodyHistory[1].t)
      expect(sim.eventLog().find((e) => e.id === box.custodyHistory[2].eventId)?.type).toBe('StsGrounded')
      groundPositionsUsed.add(box.custody.id)
      expect(sim.query.groundPosition(box.custody.id).containerId).toBe(id)
    }
    expect(groundPositionsUsed.size).toBe(10)
  })

  it('crane moves are planned as motion segments whose end matches the next event', () => {
    const sim = createSimulation(tracer)
    sim.runUntil()
    const log = sim.eventLog()
    const picked = log.find((e) => e.type === 'StsPicked')
    const grounded = log.find((e) => e.type === 'StsGrounded')
    if (picked?.type !== 'StsPicked' || grounded?.type !== 'StsGrounded') throw new Error('missing events')
    // segments = the motion that led up to the event (approach, then loaded carry)
    const end = (segs: { t1: number }[]) => Math.max(...segs.map((s) => s.t1))
    expect(picked.t).toBeCloseTo(end(picked.payload.segments) + tracer.kinematics.sts.lockS, 9)
    expect(grounded.t).toBeCloseTo(end(grounded.payload.segments) + tracer.kinematics.sts.unlockS, 9)
    // picked → ground-position decision → grounded
    const chain = sim.why(grounded.id)
    expect(chain.slice(0, 4).map((e) => e.type)).toEqual(['StsGrounded', 'DecisionResolved', 'DecisionRequested', 'StsPicked'])
    expect(chain[3].id).toBe(picked.id)
  })
})
