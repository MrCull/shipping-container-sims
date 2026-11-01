/**
 * Stored container properties (spec #106, #108): pure functions, then every creator through the headless engine
 * (`createSimulation`): consistency, allocation, and that the new stream leaves every existing box and golden alone.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, type ContainerState, type Simulation } from '../engine'
import { planCargo } from '../scenario/bayPlan'
import {
  DEFAULT_PORT_ROTATION,
  drawContainerProps,
  isoTypeOf,
  propsStream,
  resolveContainerProps,
  validateContainerProps,
  vesselEtdS,
  weightClassOf,
  type ContainerProps,
} from '../scenario/containerProps'
import { fixtures } from '../scenario/fixtures'
import { presets, SMALL_PRESET_NAME } from '../scenario/presets'
import { validateScenario } from '../scenario/validate'
import type { ScenarioConfig } from '../scenario/types'

const base = fixtures['tracer-1sts-10-boxes']
const input = { id: 'MSKU1234560', size: '40' as const, full: true, line: 'MSK', reefer: false, inbound: { kind: 'vessel' as const, id: 'V001' }, arrivalS: 100 }

describe('drawContainerProps (pure)', () => {
  it('is deterministic per seed and id, and independent of call order', () => {
    const a = drawContainerProps(base, 7, { ...input, direction: 'IMPORT' })
    drawContainerProps(base, 7, { ...input, id: 'OTHER', direction: 'IMPORT' })
    expect(drawContainerProps(base, 7, { ...input, direction: 'IMPORT' })).toEqual(a)
    expect(drawContainerProps(base, 8, { ...input, direction: 'IMPORT' })).not.toEqual(a)
  })

  it('takes POL and POD from the rotation by direction', () => {
    const { terminal, ports } = DEFAULT_PORT_ROTATION
    for (let i = 0; i < 40; i++) {
      const id = `BOX${i}`
      const imp = drawContainerProps(base, 1, { ...input, id, direction: 'IMPORT' })
      expect(imp.pod).toBe(terminal)
      expect(ports).toContain(imp.pol)
      expect(imp.pol).not.toBe(terminal)
      const exp = drawContainerProps(base, 1, { ...input, id, direction: 'EXPORT', outboundVesselId: 'V001' })
      expect(exp.pol).toBe(terminal)
      expect(ports).toContain(exp.pod)
      expect(exp.pod).not.toBe(terminal)
      const ts = drawContainerProps(base, 1, { ...input, id, direction: 'TRANSSHIPMENT' })
      expect([ts.pol, ts.pod]).not.toContain(terminal)
      expect(ts.pol).not.toBe(ts.pod)
    }
  })

  it('weighs an empty box at its tare, and a laden one above it within the payload', () => {
    const empty = drawContainerProps(base, 1, { ...input, full: false, direction: 'STORAGE' })
    expect(empty.cargoKg).toBe(0)
    expect(empty.tareKg).toBe(3750)
    expect(empty.weightClass).toBe('LIGHT')
    const laden = drawContainerProps(base, 1, { ...input, direction: 'IMPORT' })
    expect(laden.cargoKg).toBeGreaterThan(0)
    expect(laden.cargoKg).toBeLessThanOrEqual(26500)
  })

  it('gives the ISO type from size and reefer, and a setpoint to reefers only', () => {
    expect(isoTypeOf('20', false)).toBe('22G1')
    expect(isoTypeOf('40', false)).toBe('42G1')
    expect(isoTypeOf('40HC', false)).toBe('45G1')
    expect(isoTypeOf('40HC', true)).toBe('45R1')
    const reefer = drawContainerProps(base, 1, { ...input, size: '40HC', reefer: true, direction: 'EXPORT', outboundVesselId: 'V001' })
    expect(reefer.isoType).toBe('45R1')
    expect(reefer.reeferSetpointC).toBeTypeOf('number')
    expect(drawContainerProps(base, 1, { ...input, direction: 'IMPORT' })).not.toHaveProperty('reeferSetpointC')
  })

  it('bands the gross weight with the configured limits', () => {
    const bands = { lightMaxKg: 10000, mediumMaxKg: 20000 }
    expect([5000, 10000, 10001, 20000, 20001].map((kg) => weightClassOf(kg, bands))).toEqual(['LIGHT', 'LIGHT', 'MEDIUM', 'MEDIUM', 'HEAVY'])
  })

  it('plans the departure: outbound vessel ETD, else appointment, else arrival plus expected dwell by direction', () => {
    const v = base.vessels[0]
    const ex = drawContainerProps(base, 1, { ...input, direction: 'EXPORT', outboundVesselId: v.id, arrivalS: 0 })
    expect(ex.plannedDepartureS).toBe(vesselEtdS(v))
    expect(ex.outbound).toEqual({ kind: 'vessel', id: v.id })
    const appt = drawContainerProps(base, 1, { ...input, direction: 'IMPORT', appointmentS: 99999 })
    expect(appt.plannedDepartureS).toBe(99999)
    const day = 86400
    for (let i = 0; i < 20; i++) {
      const imp = drawContainerProps(base, 1, { ...input, id: `I${i}`, direction: 'IMPORT', arrivalS: 0 })
      expect(imp.plannedDepartureS).toBeGreaterThanOrEqual(3 * day)
      expect(imp.plannedDepartureS).toBeLessThanOrEqual(7 * day)
      expect(imp.outbound).toEqual({ kind: 'truck' })
      const st = drawContainerProps(base, 1, { ...input, id: `S${i}`, full: false, direction: 'STORAGE', arrivalS: 0 })
      expect(st.plannedDepartureS).toBeGreaterThanOrEqual(5 * day)
      expect(st.plannedDepartureS).toBeLessThanOrEqual(20 * day)
    }
  })

  it('uses the configured rotation, direction mix, weights and dwell', () => {
    const cfg: ScenarioConfig = {
      ...base,
      containerProps: {
        portRotation: { terminal: 'AAAAA', ports: ['AAAAA', 'BBBBB'] },
        directionMix: { IMPORT: 0, STORAGE: 1 },
        cargoWeight: { '40': { medianKg: 1000, sigma: 0, maxKg: 1000 } },
        weightClassBands: { lightMaxKg: 1, mediumMaxKg: 2 },
        expectedDwell: { IMPORT: { kind: 'fixed', s: 500 } },
      },
    }
    const imp = drawContainerProps(cfg, 1, { ...input, arrivalS: 10, direction: 'IMPORT' })
    expect([imp.pol, imp.pod]).toEqual(['BBBBB', 'AAAAA'])
    expect(imp.cargoKg).toBe(1000)
    expect(imp.weightClass).toBe('HEAVY')
    expect(imp.plannedDepartureS).toBe(510)
    expect(drawContainerProps(cfg, 1, { ...input, full: false, direction: null }).direction).toBe('STORAGE')
  })

  it('refuses a full storage box and a broken rotation', () => {
    expect(() => drawContainerProps(base, 1, { ...input, direction: 'STORAGE' })).toThrow(/always empty/)
    expect(validateContainerProps({ portRotation: { terminal: 'X', ports: ['A', 'B'] } })).toHaveLength(1)
    expect(validateContainerProps({ portRotation: { terminal: 'A', ports: ['A'] } })).toHaveLength(1)
    expect(validateContainerProps({ weightClassBands: { lightMaxKg: 5, mediumMaxKg: 4 } })).toHaveLength(1)
    expect(validateContainerProps(undefined)).toEqual([])
    expect(resolveContainerProps({}).portRotation).toBe(DEFAULT_PORT_ROTATION)
  })

  it('reports a broken scenario setting through scenario validation', () => {
    const bad: ScenarioConfig = { ...base, containerProps: { portRotation: { terminal: 'X', ports: ['A', 'B'] } } }
    expect(validateScenario(bad).errors.length).toBeGreaterThan(0)
    expect(validateScenario(base).errors).toEqual([])
  })

  it('has its own stream: the first value differs per id', () => {
    expect(propsStream(1, 'A')()).not.toBe(propsStream(1, 'B')())
  })
})

/** Every container of a finished run must carry consistent properties. */
function checkConsistent(sim: Simulation, config: ScenarioConfig): number {
  const { terminal, ports } = resolveContainerProps(config).portRotation
  const bands = resolveContainerProps(config).weightClassBands
  const boxes = sim.query.containers()
  for (const c of boxes) {
    const p: ContainerProps | undefined = c.props
    expect(p, c.id).toBeDefined()
    const props = p as ContainerProps
    if (props.direction === 'STORAGE') expect(c.full, `${c.id} storage must be empty`).toBe(false)
    if (!c.full) expect(props.cargoKg, `${c.id} empty weighs tare`).toBe(0)
    expect(props.tareKg + props.cargoKg).toBeGreaterThan(0)
    expect(props.weightClass).toBe(weightClassOf(props.tareKg + props.cargoKg, bands))
    expect(ports).toContain(props.pol)
    expect(ports).toContain(props.pod)
    expect(props.isoType).toBe(isoTypeOf(c.size, c.reefer === true))
    expect(props.holds).toEqual([])
    expect(props.bookingRef).toMatch(/^.+\d{7}$/)
    expect(props.plannedDepartureS).toBeGreaterThanOrEqual(0)
    expect(props.reeferSetpointC !== undefined).toBe(c.reefer === true)
    if (props.direction === 'EXPORT') expect(props.pol).toBe(terminal)
    if (props.direction === 'IMPORT' || props.direction === 'STORAGE') expect(props.pod).toBe(terminal)
    if (props.direction === 'EXPORT' || props.direction === 'TRANSSHIPMENT') expect(props.outbound.kind).toBe('vessel')
  }
  return boxes.length
}

describe('every creator sets consistent properties', () => {
  it('bay plan, pool, prefill, landside and allocation on the fixtures', () => {
    let total = 0
    for (const name of Object.keys(fixtures)) {
      const config = fixtures[name]
      const sim = createSimulation(config)
      sim.runUntil({ maxEvents: 400_000 })
      expect(sim.invariantReport().violations, name).toEqual([])
      total += checkConsistent(sim, config)
    }
    expect(total).toBeGreaterThan(500)
  })

  it('the direction of each flow: import, export, transshipment, storage', () => {
    const sim = createSimulation(fixtures['transshipment-a-to-b'])
    sim.runUntil({ maxEvents: 400_000 })
    const linked = sim.query.containers().filter((c) => c.onwardVesselId === 'VB')
    expect(linked.length).toBeGreaterThan(0)
    for (const c of linked) {
      expect(c.props.direction).toBe('TRANSSHIPMENT')
      expect(c.props.outbound).toEqual({ kind: 'vessel', id: 'VB' })
      expect(c.props.inbound).toEqual({ kind: 'vessel', id: 'VA' })
    }
    const tracer = createSimulation(fixtures['tracer-1sts-10-boxes'])
    expect(new Set(tracer.query.containers().map((c) => c.props.direction))).toEqual(new Set(['IMPORT']))
  })

  it('an allocated storage empty becomes EXPORT while it stays EMPTY', () => {
    const config = fixtures['empties-load-4-of-16']
    const sim = createSimulation(config)
    const before = new Map(sim.query.containers().map((c) => [c.id, c.props.direction]))
    expect([...before.values()]).toContain('STORAGE')
    sim.runUntil({ maxEvents: 400_000 })
    const allocated = sim.query.containers().filter((c: Readonly<ContainerState>) => c.allocatedTo !== undefined)
    expect(allocated.length).toBeGreaterThan(0)
    for (const c of allocated) {
      expect(before.get(c.id)).toBe('STORAGE')
      expect(c.props.direction).toBe('EXPORT')
      expect(c.full).toBe(false)
      expect(c.props.cargoKg).toBe(0)
      expect(c.props.outbound.kind).toBe('vessel')
    }
    const untouched = sim.query.containers().filter((c) => c.allocatedTo === undefined && before.get(c.id) === 'STORAGE')
    for (const c of untouched) expect(c.props.direction).toBe('STORAGE')
  })

  it('a prefilled preset is consistent too', () => {
    const config = presets[SMALL_PRESET_NAME]()
    const sim = createSimulation(config)
    sim.runUntil({ maxEvents: 3000 })
    expect(checkConsistent(sim, config)).toBeGreaterThan(100)
  })
})

describe('the new stream leaves existing boxes alone', () => {
  it('the bay plan keeps every id, size, line, slot and flow whatever the property settings', () => {
    // slots move on purpose when container props change (the POL/weight pass, #148); the event log below is the real check
    const strip = (c: ScenarioConfig) => planCargo(c, c.seed).containers.map((x) => ({ ...x, props: undefined, slotId: undefined }))
    const config = fixtures['mixed-discharge-then-load']
    const changed: ScenarioConfig = {
      ...config,
      containerProps: { portRotation: { terminal: 'XXXXX', ports: ['XXXXX', 'YYYYY', 'ZZZZZ'] }, cargoWeight: { '20': { medianKg: 5, sigma: 3, maxKg: 9 } }, directionMix: { STORAGE: 1 } },
    }
    expect(strip(changed)).toEqual(strip(config))
    expect(createSimulation(changed).eventLog().length).toBeGreaterThanOrEqual(0)
    const a = createSimulation(config)
    const b = createSimulation(changed)
    a.runUntil({ maxEvents: 400_000 })
    b.runUntil({ maxEvents: 400_000 })
    expect(b.eventLog().map((e) => [e.type, e.t])).toEqual(a.eventLog().map((e) => [e.type, e.t]))
  })
})
