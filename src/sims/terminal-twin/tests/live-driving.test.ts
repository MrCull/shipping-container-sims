/**
 * How the browser drives the engine (through the public engine API only):
 * the Web Worker advances it in small time slices, and the dev API can
 * inject events. Both must leave the run deterministic.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation } from '../engine'
import { fixtures } from '../scenario/fixtures'
import golden from '../scenario/fixtures/tracer-1sts-10-boxes.golden.json'

const tracer = fixtures['tracer-1sts-10-boxes']

describe('time-sliced running (worker playback)', () => {
  it('advancing in many small time slices gives the golden event-log hash', () => {
    const sim = createSimulation(tracer)
    let t = 0
    while (sim.status === 'ready') {
      t += 7.5
      const result = sim.runUntil({ time: t })
      if (result.reason === 'idle') break
    }
    expect(sim.status).toBe('ended')
    expect(sim.eventLogHash()).toBe(golden.eventLogHash)
  })

  it('a different start date/time does not change the run', () => {
    const sim = createSimulation({ ...tracer, startDateTime: '2030-03-04T06:00:00.000Z' })
    sim.runUntil()
    expect(sim.eventLogHash()).toBe(golden.eventLogHash)
  })
})

describe('inject', () => {
  it('schedules an event as a new root that is processed at its time', () => {
    const sim = createSimulation(tracer)
    sim.runUntil({ time: 30 })
    const injected = sim.inject('VesselBerthed', 45, { vessels: ['V001'] }, { vesselId: 'V001', berthX: 50 })
    expect(injected.causedBy).toBeNull()
    const result = sim.runUntil({ eventType: 'VesselBerthed' })
    expect(result.now).toBe(45)
    expect(sim.why(injected.id)).toEqual([sim.eventLog().find((e) => e.id === injected.id)])
    expect(sim.query.vessel('V001').status).toBe('berthed')
  })

  it('refuses an event in the past', () => {
    const sim = createSimulation(tracer)
    sim.runUntil({ time: 30 })
    expect(() => sim.inject('VesselDeparted', 10, {}, { vesselId: 'V001' })).toThrow(/before now/)
  })
})
