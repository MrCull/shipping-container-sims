/**
 * TT-R15: truck appointment windows. Trucks book windows (default 30 min), bookings are capped per window by gate
 * and transfer stall capacity, arrivals spread inside their window, peaks come from bunched windows.
 */
import { describe, expect, it } from 'vitest'
import { appointmentCap, createSimulation, planAppointments, type EngineEvent, type Simulation } from '../engine'
import { fixtures } from '../scenario/fixtures'
import { ScenarioBuilder } from '../scenario/builder'
import type { AppointmentConfig, ScenarioConfig } from '../scenario/types'

const ofType = <T extends EngineEvent['type']>(sim: Simulation, type: T) =>
  sim.eventLog().filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type)

const base = (appointments: AppointmentConfig, perHour = 40, stalls = 2): ScenarioConfig =>
  new ScenarioBuilder('appt-test', 'appointment test')
    .seed(4)
    .quay(400, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 60, groundPositions: 3 })
    .vesselCall('V001', { name: 'Import Star', sizeClass: 'feeder', discharge: 8, maxSts: 1 })
    .shcs(2)
    .block('B01', { x: 20, bays: 10, tiers: 3, transferStalls: stalls })
    .ascsPerBlock(2)
    .landside({
      hourlyProfile: Array.from({ length: 24 }, () => perHour),
      importDwell: { kind: 'fixed', s: 300 },
      gate: { inLanes: 2, outLanes: 2, inProcessingS: 60 },
      appointments,
    })
    .endWhen({ simDurationS: 7200 })
    .build()

/** A deterministic stand-in for the landside RNG stream. */
const golden = () => {
  let n = 0
  return () => (n++ * 0.6180339887) % 1
}

describe('appointment cap', () => {
  it('is the smaller of gate and transfer stall capacity per window', () => {
    // gate: 2 lanes * 1800 / 60 = 60; stalls: 2 * 1800 / 300 = 12
    expect(appointmentCap(base({ windowS: 1800 }))).toBe(12)
    // stalls served in 30 s: 120 > the gate's 60
    expect(appointmentCap(base({ windowS: 1800, stallServiceS: 30 }))).toBe(60)
    expect(appointmentCap(base({ windowS: 1800, maxPerWindow: 5 }))).toBe(5)
  })
})

describe('planAppointments', () => {
  it('never books beyond a window cap, even when demand is bunched far above it', () => {
    const config = base({ windowS: 1800, bunching: [{ fromS: 1800, toS: 3600, factor: 10 }] })
    const cap = appointmentCap(config)
    const plan = planAppointments(config, golden())
    const perWindow = new Map<number, number>()
    for (const a of plan.appointments) perWindow.set(a.windowIndex, (perWindow.get(a.windowIndex) ?? 0) + 1)
    for (const count of perWindow.values()) expect(count).toBeLessThanOrEqual(cap)
    expect(perWindow.get(1)).toBe(cap)
    expect(plan.rejected).toBeGreaterThan(0)
  })

  it('spreads arrivals inside their window', () => {
    const plan = planAppointments(base({ windowS: 1800 }), golden())
    for (const a of plan.appointments) {
      expect(a.arriveAtS).toBeGreaterThanOrEqual(a.windowIndex * 1800)
      expect(a.arriveAtS).toBeLessThan((a.windowIndex + 1) * 1800)
    }
    expect(new Set(plan.appointments.map((a) => Math.round(a.arriveAtS))).size).toBeGreaterThan(plan.appointments.length / 2)
  })
})

describe('truck-appointment-windows fixture', () => {
  const run = () => {
    const sim = createSimulation(fixtures['truck-appointment-windows'])
    sim.runUntil()
    return sim
  }

  it('runs clean: trucks arrive at their appointment, bookings within the cap, rejections reported', () => {
    const sim = run()
    expect(sim.invariantReport().violations).toHaveLength(0)
    const k = sim.kpiReport().landside
    expect(k?.appointments).toBeDefined()
    const appts = sim.query.appointments()
    expect(appts.length).toBe(k?.appointments?.booked)
    const arrivals = ofType(sim, 'TruckArrived').filter((e) => e.payload.appointmentId)
    expect(arrivals.length).toBeGreaterThan(0)
    for (const e of arrivals) {
      const a = appts.find((x) => x.id === e.payload.appointmentId)
      expect(a?.arriveAtS).toBeCloseTo(e.t, 3)
    }
    expect(k?.appointments?.rejected).toBeGreaterThan(0)
    const perWindow = new Map<number, number>()
    for (const a of appts) perWindow.set(a.windowIndex, (perWindow.get(a.windowIndex) ?? 0) + 1)
    for (const c of perWindow.values()) expect(c).toBeLessThanOrEqual(k?.appointments?.capPerWindow ?? 0)
  })

  it('has no Poisson arrivals: every truck has an appointment', () => {
    expect(ofType(run(), 'TruckArrived').every((e) => e.payload.appointmentId !== undefined)).toBe(true)
  })
})
