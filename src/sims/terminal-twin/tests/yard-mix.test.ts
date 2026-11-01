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

  // direction and group key of every placed box
  const placed = (plan?.placements ?? []).map((p) => {
    const c = byId.get(p.containerId)
    const f = fillers.get(p.containerId)
    const props = (c?.props ?? f?.props) as NonNullable<typeof f>['props']
    const view = yardViewOfProps((c?.line ?? f?.line) as string, p.size, props)
    return { p, direction: props.direction, key: yardGroupKey(view) }
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
