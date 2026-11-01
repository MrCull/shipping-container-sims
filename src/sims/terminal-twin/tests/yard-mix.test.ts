/**
 * #149: the big presets start with a realistic yard mix, stacked group by group. The pre-fill is the pure planner
 * (`prefillOf`, the same computation the engine's pre-run phase runs), so no simulation is run here.
 */
import { describe, expect, it } from 'vitest'
import { prefillOf, yardCapacityCells, yardGroupKey, yardViewOfProps } from '../engine'
import { planCargo } from '../scenario/bayPlan'
import { presets } from '../scenario/presets'

const BIG = ['TTI Algeciras baseline', 'TTI Algeciras, peak day']

describe.each(BIG)('yard mix: %s', (name) => {
  const config = presets[name]()
  const cargo = planCargo(config, config.seed)
  const plan = prefillOf(config, cargo, config.seed)
  const byId = new Map(cargo.containers.map((c) => [c.id, c]))
  const fillers = new Map((plan?.imports ?? []).map((i) => [i.id, i]))

  // direction and group key of every placed box; a pre-filled import stacks by flow, whatever its line (#163)
  const placed = (plan?.placements ?? []).map((p) => {
    const c = byId.get(p.containerId)
    const f = fillers.get(p.containerId)
    const props = (c?.props ?? f?.props) as NonNullable<typeof f>['props']
    const view = yardViewOfProps((c?.line ?? f?.line) as string, p.size, props)
    return { p, direction: props.direction, key: props.direction === 'IMPORT' ? 'IMP' : yardGroupKey(view) }
  })

  it('holds all four flows, each a real share of the yard', () => {
    const cells = (d: string) => placed.filter((x) => x.direction === d).reduce((n, x) => n + x.p.span, 0)
    const total = placed.reduce((n, x) => n + x.p.span, 0)
    expect(total / yardCapacityCells(config)).toBeGreaterThan((config.yardStart?.targetPct ?? 60) / 100 - 0.01)
    for (const d of ['IMPORT', 'EXPORT', 'TRANSSHIPMENT', 'STORAGE']) expect(cells(d) / total, d).toBeGreaterThan(0.02)
    // a hub yard is mostly transshipment, with a minority of imports
    expect(cells('TRANSSHIPMENT')).toBeGreaterThan(cells('IMPORT'))
  })

  it('never lets a stack mix groups', () => {
    const stacks = new Map<string, Set<string>>()
    for (const { p, key } of placed)
      for (let k = 0; k < p.span; k++) {
        const id = `${p.blockId}:${p.bay + k}-${p.row}`
        stacks.set(id, (stacks.get(id) ?? new Set()).add(key))
      }
    const mixed = [...stacks].filter(([, keys]) => keys.size > 1).map(([id]) => id)
    expect(mixed).toEqual([])
  })

  it('keeps a big group to a few blocks (groups form blocks of stacks)', () => {
    const blocksOf = new Map<string, Set<string>>()
    const count = new Map<string, number>()
    for (const { p, key } of placed) {
      blocksOf.set(key, (blocksOf.get(key) ?? new Set()).add(p.blockId))
      count.set(key, (count.get(key) ?? 0) + 1)
    }
    const big = [...blocksOf].filter(([key]) => (count.get(key) as number) >= 100)
    expect(big.length).toBeGreaterThan(0)
    for (const [, blocks] of big) expect(blocks.size).toBeLessThanOrEqual(8)
  })
})

/**
 * #163: the starting yard mixes shipping lines within blocks (it used to look sorted by line: whole blocks of one
 * colour). Groups (flow, vessel, POD, weight) still decide where a box stacks; the line does not.
 */
describe.each(BIG)('yard line mix: %s', (name) => {
  const config = presets[name]()
  const cargo = planCargo(config, config.seed)
  const plan = prefillOf(config, cargo, config.seed)
  const lineOf = new Map<string, string>([...cargo.containers.map((c) => [c.id, c.line] as const), ...(plan?.imports ?? []).map((i) => [i.id, i.line] as const)])
  const byBlock = new Map<string, Map<string, number>>()
  for (const p of plan?.placements ?? []) {
    const lines = byBlock.get(p.blockId) ?? new Map<string, number>()
    const line = lineOf.get(p.containerId) as string
    lines.set(line, (lines.get(line) ?? 0) + 1)
    byBlock.set(p.blockId, lines)
  }
  const busy = [...byBlock].filter(([, lines]) => [...lines.values()].reduce((n, c) => n + c, 0) >= 50)
  const weights = config.cargo.lines as Record<string, number>
  const totalWeight = Object.values(weights).reduce((n, w) => n + w, 0)

  it('holds at least 3 lines in every block with 50 or more boxes', () => {
    expect(busy.length).toBeGreaterThan(0)
    for (const [block, lines] of busy) expect(lines.size, block).toBeGreaterThanOrEqual(3)
  })

  it('keeps every line near its mix share in every busy block', () => {
    for (const [block, lines] of busy) {
      const total = [...lines.values()].reduce((n, c) => n + c, 0)
      // a wide margin: a line holds at most twice its share of the mix plus 10 points of a block
      for (const [line, n] of lines) expect(n / total, `${block} ${line}`).toBeLessThanOrEqual((2 * (weights[line] ?? 0)) / totalWeight + 0.1)
    }
  })
})
