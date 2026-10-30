/**
 * TT-R14: the `paired-dual-cycle` shcDispatch strategy, through the engine API, the decision-point registry, the CLI and
 * the invariant checker.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, getStrategy, type ShcDispatchRequest, type Simulation } from '../engine'
import { runCli } from '../cli/runCli'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig } from '../scenario/types'

const FIXTURE = 'shc-paired-dual-cycle'
const fixture = fixtures[FIXTURE]

const withStrategy = (config: ScenarioConfig, strategy: string): ScenarioConfig => ({
  ...structuredClone(config),
  decisions: { ...config.decisions, points: { ...config.decisions?.points, shcDispatch: { strategy } } },
})

const shcs = (sim: Simulation) => Object.values(sim.kpiReport().horizontal?.shcs ?? {})
const emptyM = (sim: Simulation) => shcs(sim).reduce((n, s) => n + s.emptyDistanceM, 0)
const loadedM = (sim: Simulation) => shcs(sim).reduce((n, s) => n + s.loadedDistanceM, 0)

function run(config: ScenarioConfig): Simulation {
  const sim = createSimulation(config)
  expect(sim.runUntil().reason).toBe('ended')
  expect(sim.firstError).toBeNull()
  return sim
}

const job = (jobId: string, kind: 'load' | undefined, distanceM: number, readyAt = 0) => ({
  jobId,
  containerId: `C-${jobId}`,
  groundPositionId: 'GP',
  stsId: 'STS01',
  readyAt,
  x: 0,
  z: 0,
  distanceM,
  ...(kind ? { kind, padId: 'P' } : {}),
})

const ask = (lastJobKind: 'discharge' | 'load' | undefined, jobs: ReturnType<typeof job>[]): string | null => {
  const handler = getStrategy('shcDispatch', 'paired-dual-cycle')
  const request: ShcDispatchRequest = { shcId: 'SHC01', nodeId: 'N', x: 0, z: 0, ...(lastJobKind ? { lastJobKind } : {}), jobs, wtpPads: [] }
  const reply = (handler as unknown as (m: { payload: ShcDispatchRequest }) => { jobId: string | null })({ payload: request })
  return reply.jobId
}

describe('paired-dual-cycle handler', () => {
  it('after a discharge delivery prefers a load pickup within the pairing radius, even when a discharge pickup is nearer', () => {
    expect(ask('discharge', [job('D', undefined, 40), job('L', 'load', 120)])).toBe('L')
  })

  it('after a load delivery prefers a discharge pickup, even when a load pickup is nearer', () => {
    expect(ask('load', [job('L', 'load', 40), job('D', undefined, 120)])).toBe('D')
  })

  it('takes the nearest job when the paired one is out of range or there is none, and with no history', () => {
    expect(ask('discharge', [job('D', undefined, 40), job('L', 'load', 400)])).toBe('D')
    expect(ask('discharge', [job('D2', undefined, 90), job('D1', undefined, 40)])).toBe('D1')
    expect(ask(undefined, [job('D', undefined, 90), job('L', 'load', 40)])).toBe('L')
    expect(ask('load', [])).toBeNull()
  })
})

describe('paired-dual-cycle on the mixed fixture', () => {
  it('is selected by the scenario and runs clean: all boxes moved, invariants hold, queues and pads never overfill', () => {
    const sim = run(fixture)
    expect(sim.kpiReport().handlers.shcDispatch.handler).toBe('strategy:paired-dual-cycle')
    expect(sim.invariantReport().violations).toEqual([])
    const horizontal = sim.kpiReport().horizontal
    expect(horizontal?.boxesToWtp).toBe(16)
    const snap = sim.snapshot().state
    // every claim names an SHC at its spot, one claim per spot, no SHC holds two
    const holders = Object.values(snap.queueClaims)
    expect(new Set(holders).size).toBe(holders.length)
    expect(Object.values(snap.wtpPads).every((p) => p.claimedBy === null)).toBe(true)
  })

  it('drives less empty than chained-nearest on the same scenario, for the same loaded work', () => {
    const paired = run(fixture)
    const chained = run(withStrategy(fixture, 'chained-nearest'))
    expect(chained.invariantReport().violations).toEqual([])
    expect(chained.kpiReport().horizontal?.boxesToWtp).toBe(paired.kpiReport().horizontal?.boxesToWtp)
    expect(emptyM(paired)).toBeLessThan(emptyM(chained))
    expect(emptyM(paired) / (emptyM(paired) + loadedM(paired))).toBeLessThan(emptyM(chained) / (emptyM(chained) + loadedM(chained)))
  })

  it('SHCs pair: dispatch requests carry lastJobKind, and an SHC that just delivered one kind is given the other when both are open', () => {
    const sim = run(fixture)
    const asks = sim
      .eventLog()
      .flatMap((e) => (e.type === 'DecisionResolved' && e.payload.decisionPoint === 'shcDispatch' ? [e.payload] : []))
      .filter((p) => p.request.lastJobKind !== undefined)
    expect(asks.length).toBeGreaterThan(10)
    const both = asks.filter((p) => {
      const kinds = new Set(p.request.jobs.filter((j) => j.distanceM <= 150).map((j) => (j.kind === 'load' ? 'load' : 'discharge')))
      return kinds.size === 2
    })
    expect(both.length).toBeGreaterThan(0)
    for (const p of both) {
      const chosen = p.request.jobs.find((j) => j.jobId === p.reply.jobId)
      expect(chosen?.kind === 'load').toBe(p.request.lastJobKind === 'discharge')
    }
    // other strategies leave the request shape alone
    const base = run(withStrategy(fixture, 'chained-nearest'))
    const plain = base.eventLog().filter((e) => e.type === 'DecisionResolved' && e.payload.decisionPoint === 'shcDispatch')
    expect(plain.every((e) => e.type === 'DecisionResolved' && !('lastJobKind' in (e.payload.request as object)))).toBe(true)
  })

  it('SHCs are reassigned between STS cranes: an SHC serves both', () => {
    const sim = run(fixture)
    const stsByShc = new Map<string, Set<string>>()
    for (const e of sim.eventLog()) {
      if (e.type !== 'ShcJobAssigned') continue
      const jobStsId = sim.eventLog().find((x) => x.type === 'StsGrounded' && x.payload.containerId === e.payload.containerId)?.payload
      const gp = e.payload.groundPositionId
      const sts = jobStsId && 'stsId' in jobStsId ? jobStsId.stsId : gp.split(':')[0]
      stsByShc.set(e.payload.shcId, (stsByShc.get(e.payload.shcId) ?? new Set()).add(sts))
    }
    expect([...stsByShc.values()].some((s) => s.size > 1)).toBe(true)
  })

  it('is deterministic and leaves oldest-job and nearest-job selectable', () => {
    expect(run(fixture).eventLogHash()).toBe(run(fixture).eventLogHash())
    for (const strategy of ['oldest-job', 'nearest-job']) {
      const sim = run(withStrategy(fixture, strategy))
      expect(sim.invariantReport().violations).toEqual([])
      expect(sim.kpiReport().handlers.shcDispatch.handler).toBe(`strategy:${strategy}`)
    }
  })
})

describe('CLI --strategy', () => {
  const cli = (...args: string[]) => {
    const out: string[] = []
    const exitCode = runCli(args, (l) => out.push(l))
    return { exitCode, text: out.join('\n') }
  }

  it('selects paired-dual-cycle on another fixture, and the fixture runs with it by default', () => {
    const forced = cli('--fixture', 'shc-queue-chained', '--strategy', 'shcDispatch=paired-dual-cycle')
    expect(forced.exitCode).toBe(0)
    expect(forced.text).toMatch(/shcDispatch\s+strategy:paired-dual-cycle/)
    expect(forced.text).toMatch(/Invariants:\s+\d+ checks, 0 violations/)
    const own = cli('--fixture', FIXTURE)
    expect(own.exitCode).toBe(0)
    expect(own.text).toMatch(/shcDispatch\s+strategy:paired-dual-cycle/)
    const base = cli('--fixture', FIXTURE, '--strategy', 'shcDispatch=chained-nearest')
    expect(base.text).toMatch(/shcDispatch\s+strategy:chained-nearest/)
  })
})
