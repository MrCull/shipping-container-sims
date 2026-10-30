/**
 * V11-10: real / instant / off modes for the quay, berth and yard (spec #60 story 104).
 * Instant stubs raise the same event types as the real run; off removes the subsystem's own work.
 */
import { describe, expect, it } from 'vitest'
import { runCli } from '../cli/runCli'
import { createSimulation, resolveSubsystemModes, validateSubsystemModes, ScenarioValidationError } from '../engine'
import { applyOverrides } from '../scenario/overrides'
import { fixtures } from '../scenario/fixtures'
import type { SubsystemModes } from '../scenario/types'

function run(name: string, subsystems?: SubsystemModes) {
  const sim = createSimulation(fixtures[name], {}, { subsystems })
  const result = sim.runUntil({ maxEvents: 200_000 })
  const types = new Set(sim.eventLog().map((e) => e.type))
  return { sim, result, types }
}

const FULL = 'mixed-discharge-then-load'
const BERTHS = 'two-vessels-compete-for-berth'

describe('subsystem modes: quay, berth, yard', () => {
  for (const [fixture, mode] of [
    [FULL, { quay: 'instant' }],
    [FULL, { berth: 'instant' }],
    [BERTHS, { berth: 'instant' }],
    [FULL, { yard: 'instant' }],
  ] as [string, SubsystemModes][]) {
    it(`${fixture} with ${JSON.stringify(mode)}: 0 violations, same event types as the real run (plus waits)`, () => {
      const real = run(fixture)
      const stub = run(fixture, mode)
      expect(stub.sim.firstError).toBeNull()
      expect(stub.sim.invariantReport().violations).toHaveLength(0)
      expect(stub.result.reason).toBe('ended')
      // every real event type is raised; the only extras are waits (an instant crane outruns its feeders)
      expect([...real.types].filter((t) => !stub.types.has(t))).toEqual([])
      expect([...stub.types].filter((t) => !real.types.has(t) && !/Wait/.test(t))).toEqual([])
    })
  }

  it('instant quay and berth make the run shorter', () => {
    const real = run(FULL)
    expect(run(FULL, { quay: 'instant' }).sim.kpiReport().simTimeS).toBeLessThan(real.sim.kpiReport().simTimeS)
    expect(run(FULL, { berth: 'instant' }).sim.kpiReport().simTimeS).toBeLessThan(real.sim.kpiReport().simTimeS)
  })

  it('instant quay: STS moves take no time and every box is still moved', () => {
    const { sim } = run(FULL, { quay: 'instant' })
    const picked = sim.eventLog().find((e) => e.type === 'StsPicked')!
    const started = sim.eventLog().find((e) => e.type === 'StsMoveStarted')!
    expect(picked.t).toBe(started.t)
    expect(sim.kpiReport().movesCompleted).toBe(run(FULL).sim.kpiReport().movesCompleted)
  })

  it('off berth: no berthAllocation decision, vessels still berth, work and depart', () => {
    const { sim, result } = run(BERTHS, { berth: 'off' })
    expect(sim.firstError).toBeNull()
    expect(sim.invariantReport().violations).toHaveLength(0)
    expect(result.reason).toBe('ended')
    const log = sim.eventLog()
    const types = log.map((e) => e.type)
    expect(types).toContain('BerthAllocated')
    expect(types).toContain('VesselDeparted')
    expect(log.some((e) => e.type === 'DecisionRequested' && e.payload.decisionPoint === 'berthAllocation')).toBe(false)
    const berthed = log.find((e) => e.type === 'VesselBerthed')!
    const allocated = log.find((e) => e.type === 'BerthAllocated')!
    expect(berthed.t).toBe(allocated.t)
  })

  it('off quay: vessels berth and depart without STS work', () => {
    const { sim, result, types } = run(FULL, { quay: 'off' })
    expect(sim.firstError).toBeNull()
    expect(sim.invariantReport().violations).toHaveLength(0)
    expect(result.reason).toBe('ended')
    expect(types.has('VesselBerthed')).toBe(true)
    expect(types.has('VesselDeparted')).toBe(true)
    expect(types.has('StsPicked')).toBe(false)
    expect(sim.kpiReport().movesCompleted).toBe(0)
  })

  it('off yard: no ASC work, no landside', () => {
    const { sim, types } = run(FULL, { yard: 'off' })
    expect(sim.firstError).toBeNull()
    expect(sim.invariantReport().violations).toHaveLength(0)
    expect(types.has('AscPicked')).toBe(false)
    expect(sim.snapshot().state.subsystems).toMatchObject({ yard: 'off', asc: 'off', landside: 'off' })
  })

  it('resolves defaults; yard instant makes the ASC instant', () => {
    expect(resolveSubsystemModes(fixtures[FULL])).toMatchObject({ quay: 'real', berth: 'real', yard: 'real' })
    expect(resolveSubsystemModes(fixtures[FULL], { yard: 'instant' }).asc).toBe('instant')
  })

  describe('validation', () => {
    it('rejects impossible combinations', () => {
      expect(validateSubsystemModes(fixtures[FULL], { yard: 'off', asc: 'real' }).length).toBeGreaterThan(0)
      expect(validateSubsystemModes(fixtures[FULL], { yard: 'off', landside: 'real' }).length).toBeGreaterThan(0)
      expect(validateSubsystemModes(fixtures[BERTHS], { yard: 'instant' }).length).toBeGreaterThan(0) // no blocks
      expect(validateSubsystemModes(fixtures[FULL], { quay: 'instant', berth: 'off', yard: 'instant' })).toHaveLength(0)
      expect(validateSubsystemModes(fixtures[FULL], { yard: 'off', asc: 'off', landside: 'off' })).toHaveLength(0)
    })
    it('createSimulation refuses them', () => {
      expect(() => createSimulation(fixtures[FULL], {}, { subsystems: { yard: 'off', asc: 'real' } })).toThrow(ScenarioValidationError)
      expect(() => createSimulation({ ...fixtures[FULL], subsystems: { yard: 'off', asc: 'instant' } })).toThrow(ScenarioValidationError)
    })
  })

  it('setup overrides carry the modes into the scenario and the run', () => {
    const config = applyOverrides(fixtures[FULL], { subsystems: { quay: 'instant', berth: 'off' } })
    expect(config.subsystems).toMatchObject({ quay: 'instant', berth: 'off' })
    expect(createSimulation(config).snapshot().state.subsystems).toMatchObject({ quay: 'instant', berth: 'off' })
  })

  describe('CLI', () => {
    const cli = (...args: string[]) => {
      const lines: string[] = []
      return { exitCode: runCli(args, (l) => lines.push(l)), text: lines.join('\n') }
    }
    it('--subsystem sets a mode and the run stays valid', () => {
      const real = cli('--fixture', FULL)
      const out = cli('--fixture', FULL, '--subsystem', 'quay=instant', '--subsystem', 'berth=instant')
      expect(out.exitCode).toBe(0)
      expect(out.text).not.toBe(real.text)
      expect(out.text).toMatch(/0 violations/)
    })
    it('--subsystem rejects unknown and impossible values with exit code 2', () => {
      expect(cli('--fixture', FULL, '--subsystem', 'quay=slow').exitCode).toBe(2)
      expect(cli('--fixture', FULL, '--subsystem', 'moon=off').exitCode).toBe(2)
      expect(cli('--fixture', FULL, '--subsystem', 'yard=off', '--subsystem', 'asc=real').exitCode).toBe(2)
    })
  })
})
