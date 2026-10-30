/**
 * Spec #106 (#112): the opt-in `iso-type-best-position` empty allocation, through the headless engine.
 * Matches the ISO type and ignores the line (`matchLine` restricts it), picks the best yard position: fewest boxes on top,
 * then the block serving the vessel and the nearest its WTP, then next to other allocated empties.
 */
import { describe, expect, it } from 'vitest'
import { runCli } from '../cli/runCli'
import { createSimulation, strategies, type EngineEvent, type Simulation } from '../engine'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig } from '../scenario/types'

type Request = Parameters<typeof strategies.emptyAllocation.strategies['nearest-wtp']['handler']>[0]['payload']
type EmptyCandidate = Request['candidates'][number]
const isoHandler = strategies.emptyAllocation.strategies['iso-type-best-position'].handler as unknown as (msg: { payload: Request }) => { containerIds: string[] }
const isoTypeBestPositionEmpties = (payload: Request) => isoHandler({ payload })

const NAME = 'empty-allocation-iso'

function run(config: ScenarioConfig): Simulation {
  const sim = createSimulation(config)
  sim.runUntil({ maxEvents: 300_000 })
  return sim
}

const ofType = <T extends EngineEvent['type']>(sim: Simulation, type: T) =>
  sim.eventLog().filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type)

const requestOf = (sim: Simulation) => {
  const asked = sim.eventLog().filter((e) => e.type === 'DecisionRequested' && e.payload.decisionPoint === 'emptyAllocation')
  expect(asked).toHaveLength(1)
  const e = asked[0]
  if (e.type !== 'DecisionRequested') throw new Error('unreachable')
  return e.payload.request as Request
}

describe('empty-allocation-iso fixture', () => {
  const sim = run(fixtures[NAME])

  it('completes with zero invariant violations', () => {
    expect(sim.firstError).toBeNull()
    expect(sim.status).toBe('ended')
    expect(sim.invariantReport().violations).toEqual([])
    expect(sim.query.vessel('V001').status).toBe('departed')
  })

  it('carries the ISO type in the requirement and the request', () => {
    const req = requestOf(sim)
    expect(req.isoType).toBe('42G1')
    expect(req.matchLine).toBe(false)
    expect(req.candidates.every((c) => c.isoType === '42G1')).toBe(true)
  })

  it('allocates empties of the ISO type from any line, and loads them', () => {
    const ids = ofType(sim, 'EmptiesAllocated')[0].payload.containerIds
    expect(ids).toHaveLength(18)
    const boxes = ids.map((id) => sim.query.container(id))
    for (const b of boxes) expect(b).toMatchObject({ full: false, size: '40' })
    expect(boxes.every((b) => b.props.isoType === '42G1')).toBe(true)
    expect(new Set(boxes.map((b) => b.line)).size).toBeGreaterThan(1) // MSC was asked for, Maersk empties go too
    expect(ofType(sim, 'StsLoaded').map((e) => e.payload.containerId).sort()).toEqual([...ids].sort())
  })

  it('never takes a 20 ft empty for a 40 ft requirement', () => {
    const ids = new Set(ofType(sim, 'EmptiesAllocated')[0].payload.containerIds)
    const twenties = sim.query.containers().filter((c) => c.size === '20' && !c.full)
    expect(twenties.length).toBeGreaterThan(0)
    for (const c of twenties) expect(ids.has(c.id)).toBe(false)
  })

  it('picks the empties with the fewest boxes on top', () => {
    const req = requestOf(sim)
    const ids = new Set(ofType(sim, 'EmptiesAllocated')[0].payload.containerIds)
    const picked = req.candidates.filter((c) => ids.has(c.containerId))
    const rest = req.candidates.filter((c) => !ids.has(c.containerId))
    expect(picked).toHaveLength(18)
    expect(rest.length).toBeGreaterThan(0)
    const worstPicked = Math.max(...picked.map((c) => c.boxesOnTop as number))
    const bestLeft = Math.min(...rest.map((c) => c.boxesOnTop as number))
    expect(worstPicked).toBeLessThanOrEqual(bestLeft)
    expect(req.candidates.some((c) => (c.boxesOnTop as number) > 0)).toBe(true) // the yard really has buried empties
  })

  it('loads a buried pick after the picks standing on it, so nothing is rehandled', () => {
    const req = requestOf(sim)
    const ids = new Set(ofType(sim, 'EmptiesAllocated')[0].payload.containerIds)
    const buried = req.candidates.filter((c) => ids.has(c.containerId) && (c.boxesOnTop as number) > 0)
    expect(buried.length).toBeGreaterThan(0)
    expect(sim.kpiReport().yard?.rehandles.total ?? 0).toBe(0)
  })
})

describe('matchLine', () => {
  it('restricts the allocation to the requesting line', () => {
    const config = structuredClone(fixtures[NAME])
    config.emptyAllocation = { matchLine: true }
    config.vessels[0].empties = [{ size: '40', line: 'MSC', count: 4 }]
    const sim = run(config)
    expect(sim.firstError).toBeNull()
    expect(sim.status).toBe('ended')
    expect(sim.invariantReport().violations).toEqual([])
    const req = requestOf(sim)
    expect(req.matchLine).toBe(true)
    expect(req.candidates.every((c) => c.line === 'MSC')).toBe(true)
    const ids = ofType(sim, 'EmptiesAllocated')[0].payload.containerIds
    expect(ids).toHaveLength(4)
    for (const id of ids) expect(sim.query.container(id).line).toBe('MSC')
  })

  it('digs out a matching empty buried under another line\'s box (rehandles) and still completes', () => {
    const config = structuredClone(fixtures[NAME])
    config.emptyAllocation = { matchLine: true }
    config.emptyPool = { count: 28, sizeMix: { '40': 1 }, lines: { MSC: 1, Maersk: 1 } }
    config.vessels[0].empties = [{ size: '40', line: 'MSC', count: 8 }]
    const sim = run(config)
    expect(sim.firstError).toBeNull()
    expect(sim.status).toBe('ended')
    expect(sim.invariantReport().violations).toEqual([])
    expect(sim.kpiReport().yard?.rehandles.total ?? 0).toBeGreaterThan(0)
  })

  it('without it, a line with no empties of its own is still served', () => {
    const config = structuredClone(fixtures[NAME])
    config.emptyPool = { count: 12, sizeMix: { '40': 1 }, lines: { Maersk: 1 } }
    config.vessels[0].empties = [{ size: '40', line: 'MSC', count: 4 }]
    const sim = run(config)
    expect(sim.firstError).toBeNull()
    expect(sim.status).toBe('ended')
    for (const id of ofType(sim, 'EmptiesAllocated')[0].payload.containerIds) expect(sim.query.container(id).line).toBe('Maersk')
  })

  it('an explicit ISO type on the requirement is matched (45G1 high cubes)', () => {
    const config = structuredClone(fixtures[NAME])
    config.emptyPool = { count: 12, sizeMix: { '40': 1, '40HC': 1 }, lines: { MSC: 1 } }
    config.vessels[0].empties = [{ size: '40HC', line: 'MSC', count: 3, isoType: '45G1' }]
    const sim = run(config)
    expect(sim.firstError).toBeNull()
    expect(sim.status).toBe('ended')
    const ids = ofType(sim, 'EmptiesAllocated')[0].payload.containerIds
    expect(ids).toHaveLength(3)
    for (const id of ids) expect(sim.query.container(id).props.isoType).toBe('45G1')
  })
})

describe('best position order (the strategy as a pure function)', () => {
  const cand = (id: string, over: Partial<EmptyCandidate>): EmptyCandidate => ({
    containerId: id,
    blockId: 'B01',
    slotId: `B01:1-1-1`,
    bay: 1,
    row: 1,
    tier: 1,
    distanceM: 10,
    yardSince: 0,
    boxesOnTop: 0,
    blockRank: 0,
    adjacentAllocated: 0,
    ...over,
  })
  const ask = (candidates: EmptyCandidate[], count: number) =>
    isoTypeBestPositionEmpties({ packageId: 'p', stsId: 's', vesselId: 'v', size: '40', line: 'MSC', count, candidates }).containerIds

  it('ranks fewest boxes on top, then the serving block, then WTP distance, then adjacency', () => {
    expect(ask([cand('A', { boxesOnTop: 1 }), cand('B', { boxesOnTop: 0, distanceM: 50 })], 1)).toEqual(['B'])
    expect(ask([cand('A', { blockRank: 1, distanceM: 1 }), cand('B', { blockRank: 0, distanceM: 50 })], 1)).toEqual(['B'])
    expect(ask([cand('A', { distanceM: 20 }), cand('B', { distanceM: 10 })], 1)).toEqual(['B'])
    expect(ask([cand('A', { adjacentAllocated: 0 }), cand('B', { adjacentAllocated: 2 })], 1)).toEqual(['B'])
  })

  it('prefers a neighbour of an empty it already picked, and replies boxes on top first', () => {
    const picks = ask(
      [
        cand('A', { row: 1, bay: 1 }),
        cand('B', { row: 8, bay: 7 }),
        cand('C', { row: 2, bay: 1 }), // next to A
      ],
      2,
    )
    expect(picks).toEqual(['A', 'C'])
    expect(ask([cand('L', { boxesOnTop: 1, distanceM: 1 }), cand('T', { boxesOnTop: 0, distanceM: 5 })], 2)).toEqual(['T', 'L'])
  })
})

describe('strategy selection', () => {
  it('is selectable by config, and the older strategies stay selectable', () => {
    for (const strategy of ['nearest-wtp', 'oldest-first', 'iso-type-best-position']) {
      const config = structuredClone(fixtures['empties-load-4-of-16'])
      config.decisions = { points: { emptyAllocation: { strategy } } }
      const sim = run(config)
      expect(sim.firstError, strategy).toBeNull()
      expect(sim.status, strategy).toBe('ended')
      expect(sim.invariantReport().violations, strategy).toEqual([])
      expect(ofType(sim, 'EmptiesAllocated')[0].payload.containerIds, strategy).toHaveLength(4)
    }
  })

  it('leaves the request of the older strategies unchanged (no new fields)', () => {
    const config = structuredClone(fixtures['empties-load-4-of-16'])
    const req = requestOf(run(config))
    expect(req.isoType).toBeUndefined()
    expect(req.matchLine).toBeUndefined()
    expect(Object.keys(req.candidates[0]).sort()).toEqual(['bay', 'blockId', 'containerId', 'distanceM', 'row', 'slotId', 'tier', 'yardSince'])
  })

  it('rejects an unknown strategy name at start', () => {
    const config = structuredClone(fixtures[NAME])
    config.decisions = { points: { emptyAllocation: { strategy: 'nope' } } }
    expect(() => createSimulation(config)).toThrow(/Unknown emptyAllocation strategy/)
  })
})

describe('CLI', () => {
  const cli = (...args: string[]) => {
    const out: string[] = []
    const exitCode = runCli(args, (line) => out.push(line))
    return { exitCode, text: out.join('\n') }
  }
  const hash = (text: string) => /Event-log hash:\s+(\S+)/.exec(text)?.[1]

  it('selects the strategy with --strategy and the option with --match-line; the old strategies stay selectable', () => {
    const fx = ['--fixture', 'empties-load-4-of-16']
    const near = cli(...fx, '--strategy', 'emptyAllocation=nearest-wtp')
    const old = cli(...fx, '--strategy', 'emptyAllocation=oldest-first')
    const iso = cli(...fx, '--strategy', 'emptyAllocation=iso-type-best-position')
    const isoLine = cli(...fx, '--strategy', 'emptyAllocation=iso-type-best-position', '--match-line')
    for (const r of [near, old, iso, isoLine]) {
      expect(r.exitCode).toBe(0)
      expect(r.text).toMatch(/Invariants:\s+\d+ checks, 0 violations/)
    }
    expect(near.text).toMatch(/emptyAllocation\s+strategy:nearest-wtp/)
    expect(old.text).toMatch(/emptyAllocation\s+strategy:oldest-first/)
    expect(iso.text).toMatch(/emptyAllocation\s+strategy:iso-type-best-position/)
    expect(hash(isoLine.text)).toBeDefined()
  })
})
