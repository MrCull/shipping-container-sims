/**
 * Grouped yard decking (spec #106, #111): the opt-in `grouped` yardAllocation strategy, through the pure strategy
 * and the headless engine. Group mismatch costs score, never a slot; the KPI report counts the broken preferences.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, getStrategy, strategies, type YardAllocationRequest, type YardBoxView } from '../engine'
import { runCli } from '../cli/runCli'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig } from '../scenario/types'

/** The registered strategy, called on a bare request (a strategy is a pure function of its message). */
function groupedSlot(payload: YardAllocationRequest): { slotId: string | null } {
  const handler = getStrategy('yardAllocation', 'grouped')
  return handler({ correlationId: 'test', decisionPoint: 'yardAllocation', version: 1, t: 0, payload }, undefined as never) as { slotId: string | null }
}

const BAYS = 6
const ROWS = 8

function box(over: Partial<YardBoxView> = {}): YardBoxView {
  return { direction: 'IMPORT', line: 'MSC', size: '40', isoType: '45G1', pod: 'ESALG', weightClass: 'MEDIUM', plannedDepartureS: 1000, ...over }
}

/** A block of `BAYS` bays x 8 rows holding the given stacks (bay-row -> boxes bottom to top). */
function request(me: YardBoxView, stacks?: Record<string, YardBoxView[]>, closeOthers = true): YardAllocationRequest {
  const heights: number[] = []
  const stackTops: (YardBoxView | null)[] = []
  for (let bay = 1; bay <= BAYS; bay++)
    for (let row = 1; row <= ROWS; row++) {
      // with `stacks` given, every stack not named is full of another line's boxes: the choice is between the named ones
      const s = stacks?.[`${bay}-${row}`] ?? (stacks && closeOthers ? Array.from({ length: 4 }, () => box({ line: 'ZIM' })) : [])
      heights.push(s.length)
      stackTops.push(s.length > 0 ? s[s.length - 1] : null)
    }
  return {
    containerId: 'ME',
    size: '20',
    full: true,
    line: me.line,
    vesselId: 'V001',
    wtpPadId: 'P1',
    blockId: 'B01',
    bays: BAYS,
    rows: ROWS,
    tiers: 4,
    blockX: 0,
    firstBayZ: 100,
    wtpX: 0,
    wtpZ: 64,
    heights,
    topVessels: heights.map((h) => (h > 0 ? 'V001' : null)),
    stackSpans: heights.map((h) => (h > 0 ? 1 : 0)),
    box: { ...me, size: '20' },
    stackTops: stackTops.map((t) => (t ? { ...t, size: '20' as const } : null)),
    random: 0.5,
  }
}

describe('the grouped strategy (pure)', () => {
  it('replaces group-by-vessel: three strategies, nearest-wtp stays the default until the default flip', () => {
    expect(Object.keys(strategies.yardAllocation.strategies).sort()).toEqual(['grouped', 'nearest-wtp', 'random'])
    expect(strategies.yardAllocation.default).toBe('nearest-wtp')
  })

  it('stacks an import on a box of its own line rather than on another line', () => {
    const msc = box({ line: 'MSC' })
    const hmm = box({ line: 'HMM' })
    expect(groupedSlot(request(msc, { '1-1': [hmm], '1-2': [msc] })).slotId).toBe('B01:01-2-2')
    expect(groupedSlot(request(msc, { '1-1': [msc], '1-2': [hmm] })).slotId).toBe('B01:01-1-2')
  })

  it('puts an import that leaves earlier above one that leaves later, not below', () => {
    const early = box({ plannedDepartureS: 100 })
    const late = box({ plannedDepartureS: 900 })
    const mid = box({ plannedDepartureS: 500 })
    expect(groupedSlot(request(mid, { '1-1': [early], '1-2': [late] })).slotId).toBe('B01:01-2-2')
    expect(groupedSlot(request(mid, { '1-1': [late], '1-2': [early] })).slotId).toBe('B01:01-1-2')
  })

  it('puts a heavy export under a light one of the same vessel and POD', () => {
    const heavy = box({ direction: 'EXPORT', outboundVesselId: 'V002', pod: 'NLRTM', weightClass: 'HEAVY' })
    const light = { ...heavy, weightClass: 'LIGHT' as const }
    const medium = { ...heavy, weightClass: 'MEDIUM' as const }
    expect(groupedSlot(request(medium, { '1-1': [light], '1-2': [heavy] })).slotId).toBe('B01:01-2-2')
    expect(groupedSlot(request(medium, { '1-1': [heavy], '1-2': [light] })).slotId).toBe('B01:01-1-2')
    // a heavy export never loses a slot: when only a light box is left to stand on, it stands on it
    expect(groupedSlot(request(heavy, { '1-1': [light] })).slotId).toBe('B01:01-1-2')
  })

  it('keeps exports of one POD apart from another POD, and transshipment apart from exports', () => {
    const rtm = box({ direction: 'EXPORT', outboundVesselId: 'V002', pod: 'NLRTM' })
    const ham = { ...rtm, pod: 'DEHAM' }
    const trx = { ...rtm, direction: 'TRANSSHIPMENT' as const }
    expect(groupedSlot(request(rtm, { '1-1': [ham], '1-2': [rtm] })).slotId).toBe('B01:01-2-2')
    expect(groupedSlot(request(trx, { '1-1': [rtm], '1-2': [trx] })).slotId).toBe('B01:01-2-2')
  })

  it('groups storage empties by line, size and type', () => {
    const empty = box({ direction: 'STORAGE' })
    const other = { ...empty, isoType: '45R1' }
    expect(groupedSlot(request(empty, { '1-1': [other], '1-2': [empty] })).slotId).toBe('B01:01-2-2')
  })

  it('never fails to find a slot, however badly the groups mix', () => {
    // every stack but one is full of other groups: the box still takes the last legal slot
    const stacks: Record<string, YardBoxView[]> = {}
    for (let bay = 1; bay <= BAYS; bay++)
      for (let row = 1; row <= ROWS; row++) stacks[`${bay}-${row}`] = Array.from({ length: 4 }, () => box({ line: 'ZIM' }))
    delete stacks['3-5']
    expect(groupedSlot(request(box({ line: 'MSC' }), stacks, false)).slotId).toBe('B01:03-5-1')
    const full = { ...stacks, '3-5': Array.from({ length: 4 }, () => box({ line: 'ZIM' })) }
    expect(groupedSlot(request(box(), full, false)).slotId).toBeNull()
  })

  it('falls back to keeping a vessel together when the box has no properties (the pre-fill)', () => {
    const req = request(box())
    delete req.box
    delete req.stackTops
    expect(groupedSlot(req).slotId).not.toBeNull()
  })
})

const clone = (c: ScenarioConfig): ScenarioConfig => JSON.parse(JSON.stringify(c)) as ScenarioConfig

function withStrategy(name: string): ScenarioConfig {
  const c = clone(fixtures['yard-grouped'])
  c.decisions = { points: { yardAllocation: { strategy: name } } }
  return c
}

describe('fixture yard-grouped (headless engine)', () => {
  const run = (config: ScenarioConfig, handlers = {}) => {
    const sim = createSimulation(config, handlers)
    sim.runUntil()
    return sim
  }

  it('runs to the end with zero invariant violations and never fails to find a slot', () => {
    const sim = run(fixtures['yard-grouped'])
    expect(sim.status).toBe('ended')
    expect(sim.firstError).toBeNull()
    expect(sim.invariantReport().violations).toEqual([])
    const yard = sim.kpiReport().yard
    expect(yard?.allocationFailures).toBe(0)
    expect(yard?.boxesStacked).toBeGreaterThan(40)
    expect(sim.kpiReport().handlers.yardAllocation.handler).toBe('strategy:grouped')
  })

  it('decks several directions: imports, exports, transshipment and empties all reach the yard', () => {
    const sim = run(fixtures['yard-grouped'])
    const dirs = new Set(sim.query.containers().map((c) => c.props.direction))
    for (const d of ['IMPORT', 'EXPORT', 'TRANSSHIPMENT', 'STORAGE'] as const) expect(dirs.has(d), d).toBe(true)
  })

  it('counts the grouping preferences it broke', () => {
    const g = run(fixtures['yard-grouped']).kpiReport().yard?.grouping
    expect(g).toBeDefined()
    expect(g?.placements).toBeGreaterThan(40)
    for (const k of ['mixedStack', 'orderBroken', 'mixedBay'] as const) expect(g?.[k]).toBeGreaterThanOrEqual(0)
  })

  it('keeps groups together better than nearest-wtp on the same boxes', () => {
    const broken = (g: { mixedStack: number; orderBroken: number; mixedBay: number } | undefined) =>
      (g?.mixedStack ?? 0) * 3 + (g?.orderBroken ?? 0) + (g?.mixedBay ?? 0)
    // the same scenario, the same counters (the config says grouped); only the handler differs
    const nearest = run(fixtures['yard-grouped'], { yardAllocation: getStrategy('yardAllocation', 'nearest-wtp') })
    const grouped = run(fixtures['yard-grouped'])
    expect(nearest.invariantReport().violations).toEqual([])
    expect(nearest.kpiReport().yard?.allocationFailures).toBe(0)
    const ng = nearest.kpiReport().yard?.grouping
    const gg = grouped.kpiReport().yard?.grouping
    expect(ng?.placements).toBeGreaterThan(40)
    expect(broken(gg)).toBeLessThan(broken(ng))
    expect((gg?.mixedStack ?? 0) + (gg?.orderBroken ?? 0)).toBeLessThanOrEqual((ng?.mixedStack ?? 0) + (ng?.orderBroken ?? 0))
  })

  it('selects every yard strategy through config; only grouped adds the KPI counts and the request data', () => {
    for (const name of ['nearest-wtp', 'random', 'grouped']) {
      const sim = run(withStrategy(name))
      expect(sim.status, name).toBe('ended')
      expect(sim.invariantReport().violations, name).toEqual([])
      expect(sim.kpiReport().handlers.yardAllocation.handler).toBe(`strategy:${name}`)
      expect(sim.kpiReport().yard?.grouping !== undefined, name).toBe(name === 'grouped')
    }
  })

  it('is selectable from the CLI: --strategy yardAllocation=grouped, and the old ones too', () => {
    const cli = (...args: string[]) => {
      const out: string[] = []
      const exitCode = runCli(args, (l) => out.push(l))
      return { exitCode, text: out.join('\n') }
    }
    const plain = cli('--fixture', 'asc-1sts-10-boxes-1block', '--strategy', 'yardAllocation=grouped')
    expect(plain.exitCode).toBe(0)
    expect(plain.text).toMatch(/yardAllocation\s+strategy:grouped/)
    expect(cli('--fixture', 'yard-grouped', '--strategy', 'yardAllocation=nearest-wtp').text).toMatch(/yardAllocation\s+strategy:nearest-wtp/)
    const old = cli('--fixture', 'yard-grouped', '--strategy', 'yardAllocation=group-by-vessel')
    expect(old.exitCode).not.toBe(0)
    expect(old.text).toMatch(/grouped/)
  })
})
