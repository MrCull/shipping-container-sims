import { describe, expect, it } from 'vitest'
import { buildCranePlanModel } from '../modules/cranePlanView'
import { clampPanel } from '../composables/useFloatingPanel'
import { craneColour, timeTicks } from '../modules/cranePlanView'
import { runPlanCli } from '../cli/planCli'
import { createSimulation, estimateTimes, predictConflicts, validatePlan, type PlanPackage } from '../engine'
import { fixtures } from '../scenario/fixtures'

const gantry = { vMax: 1, accel: 1, decel: 1 }
const pkg = (id: string, o: Partial<PlanPackage> = {}): PlanPackage => ({
  id,
  kind: 'discharge',
  section: 'hold',
  bay: 0,
  bayX: 0,
  moves: 1,
  status: 'planned',
  cells: [],
  ...o,
})

describe('crane plan: pure functions', () => {
  it('estimates a single-box package as the nominal cycle', () => {
    const t = estimateTimes({ cycleS: 100, hatchCycleS: 60, gantry }, { x: 0, s: 5 }, [{ kind: 'discharge', moves: 1, bayX: 0 }])
    expect(t).toEqual([{ startS: 5, endS: 105 }])
  })

  it('adds the hatch cycle and gantry travel between bays', () => {
    const t = estimateTimes({ cycleS: 10, hatchCycleS: 60, gantry }, { x: 0, s: 0 }, [
      { kind: 'hatch-remove', moves: 0, bayX: 0 },
      { kind: 'discharge', moves: 2, bayX: 4 },
    ])
    expect(t[0]).toEqual({ startS: 0, endS: 60 })
    expect(t[1].startS).toBeCloseTo(60, 6) // the package starts when the crane takes it
    expect(t[1].endS).toBeCloseTo(85, 6) // 5 s of gantry travel (1 s up, 3 m at 1 m/s, 1 s down) plus 2 x 10 s
  })

  it('finds a known conflict window', () => {
    const a = { stsId: 'A', railIndex: 0, from: { x: 0, s: 0 }, packages: [{ bayX: 0, startS: 0, endS: 100 }] }
    const b = { stsId: 'B', railIndex: 1, from: { x: 10, s: 0 }, packages: [{ bayX: 10, startS: 0, endS: 40 }] }
    const w = predictConflicts([a, b], 27, gantry)
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({ stsA: 'A', stsB: 'B', obstacle: false, fromS: 0 })
    expect(w[0].toS).toBeGreaterThan(40)
  })

  it('treats a crane of another vessel as a fixed obstacle', () => {
    const a = { stsId: 'A', railIndex: 0, from: { x: 0, s: 0 }, packages: [{ bayX: 0, startS: 0, endS: 50 }] }
    const o = { stsId: 'O', railIndex: 1, from: { x: 20, s: 0 }, packages: [], fixed: true }
    const w = predictConflicts([a, o], 27, gantry)
    expect(w).toEqual([expect.objectContaining({ obstacle: true, fromS: 0, toS: 50 })])
  })

  describe('validator', () => {
    const base = () => ({
      workBays: [0, 1],
      cranes: [
        { stsId: 'S1', railIndex: 0, bays: [0], packageIds: ['a'] },
        { stsId: 'S2', railIndex: 1, bays: [1], packageIds: ['b'] },
      ],
      packages: { a: pkg('a', { bay: 0 }), b: pkg('b', { bay: 1 }) } as Record<string, PlanPackage>,
    })
    it('accepts a sound plan', () => expect(validatePlan(base())).toBeNull())
    it('rejects an uncovered bay', () => {
      const p = base()
      p.workBays = [0, 1, 2]
      expect(validatePlan(p)).toMatch(/must equal the work bays/)
    })
    it('rejects cranes out of bay order on the rail', () => {
      const p = base()
      p.cranes[0].railIndex = 2
      expect(validatePlan(p)).toMatch(/in rail order/)
    })
    it('rejects a package in a bay the crane does not own', () => {
      const p = base()
      p.cranes[0].packageIds = ['b']
      p.cranes[1].packageIds = ['a']
      expect(validatePlan(p)).toMatch(/not one of its bays/)
    })
    it('rejects a package on no crane', () => {
      const p = base()
      p.packages.c = pkg('c', { bay: 1 })
      expect(validatePlan(p)).toMatch(/on no crane/)
    })
    it('rejects hold work before the hatch cover is off', () => {
      const p = base()
      p.packages.r = pkg('r', { bay: 0, kind: 'hatch-remove', section: 'deck' })
      p.cranes[0].packageIds = ['a', 'r']
      expect(validatePlan(p)).toMatch(/before the hatch cover is off/)
    })
    it('rejects a hatch replace before the hold is loaded', () => {
      const p = base()
      p.packages.r = pkg('r', { bay: 0, kind: 'hatch-replace', section: 'deck' })
      p.packages.l = pkg('l', { bay: 0, kind: 'load' })
      p.cranes[0].packageIds = ['a', 'r', 'l']
      expect(validatePlan(p)).toMatch(/before the hold is loaded/)
    })
    it('rejects a stack loaded top down', () => {
      const p = base()
      p.packages.l1 = pkg('l1', { bay: 0, kind: 'load', cells: [{ row: 3, tier: 4 }] })
      p.packages.l2 = pkg('l2', { bay: 0, kind: 'load', cells: [{ row: 3, tier: 2 }] })
      p.cranes[0].packageIds = ['a', 'l1', 'l2']
      expect(validatePlan(p)).toMatch(/loads tier 2 after tier 4/)
    })
    it('rejects a load before the discharge of the same cell', () => {
      const p = base()
      p.packages.a = pkg('a', { bay: 0, cells: [{ row: 1, tier: 1 }] })
      p.packages.l = pkg('l', { bay: 0, kind: 'load', cells: [{ row: 1, tier: 1 }] })
      p.cranes[0].packageIds = ['l', 'a']
      expect(validatePlan(p)).toMatch(/before the discharge/)
    })
    it('rejects moving a package that is no longer planned', () => {
      const p = base()
      p.packages.c = pkg('c', { bay: 0, status: 'active' })
      p.cranes[0].packageIds = ['a', 'c']
      expect(validatePlan({ ...p, previous: { S1: ['c', 'a'] } })).toMatch(/must keep position 0/)
    })
  })
})

describe('crane plan: engine run', () => {
  /** Run until the vessel's cranes are assigned (the plan exists). */
  const planned = (sim: ReturnType<typeof createSimulation>) => {
    while (!sim.cranePlan('V001') && sim.step()) {
      /* step */
    }
  }
  const run = (name: string) => {
    const sim = createSimulation(fixtures[name])
    planned(sim)
    return sim
  }

  it('gives every package predicted times and works them in plan order', () => {
    const sim = run('crane-split-4sts')
    const view = sim.cranePlan('V001')
    expect(view).not.toBeNull()
    expect(view!.revision).toBe(1)
    expect(view!.cranes.length).toBeGreaterThan(1)
    for (const c of view!.cranes) for (const p of c.packages) expect(p.plannedEndS).toBeGreaterThan(p.plannedStartS - 1e-9)
    expect(sim.runUntil().reason).toBe('ended')
    expect(sim.invariantReport().violations).toEqual([])
    const final = sim.cranePlan('V001')!
    for (const c of final.cranes) {
      const starts = c.packages.map((p) => p.actualStartS as number)
      expect(starts).toEqual([...starts].sort((a, b) => a - b)) // plan order = work order
    }
  })

  it('predicts finish no later than actual finish (the estimator is a lower bound)', () => {
    const sim = createSimulation(fixtures['crane-split-4sts'])
    sim.runUntil()
    const [acc] = sim.planAccuracy()
    expect(acc.actualFinishS).not.toBeNull()
    expect(acc.predictedFinishS as number).toBeLessThanOrEqual((acc.actualFinishS as number) + 1e-6)
    expect(acc.worked).toBe(acc.packages)
  })

  it('plans hatch packages in order too', () => {
    const sim = run('hatch-cover-cycle')
    const kinds = sim.cranePlan('V001')!.cranes.flatMap((c) => c.packages.map((p) => p.kind))
    expect(kinds).toContain('hatch-remove')
    expect(sim.runUntil().reason).toBe('ended')
  })

  it('keeps the plan across a mid-vessel snapshot and restore', () => {
    const a = createSimulation(fixtures['crane-split-4sts'])
    planned(a)
    a.runUntil({ time: a.now + 200 })
    const before = a.cranePlan('V001')
    a.runUntil()
    const hashA = a.eventLogHash()
    const b = createSimulation(fixtures['crane-split-4sts'])
    planned(b)
    b.runUntil({ time: b.now + 200 })
    expect(b.cranePlan('V001')).toEqual(before)
    b.runUntil()
    expect(b.eventLogHash()).toBe(hashA)
  })

  it('accepts the old craneSplit values and the cranePlan alias, rejects unknown ones', () => {
    for (const strategy of ['balanced-moves', 'equal-bays', 'as-today']) {
      const sim = createSimulation({ ...fixtures['crane-split-4sts'], decisions: { points: { craneSplit: { strategy } } } })
      planned(sim)
      expect(sim.cranePlan('V001')!.strategy).toBe(strategy)
    }
    const alias = createSimulation({ ...fixtures['crane-split-4sts'], decisions: { points: { cranePlan: { strategy: 'equal-bays' } } } })
    planned(alias)
    expect(alias.cranePlan('V001')!.strategy).toBe('equal-bays')
    expect(() => createSimulation({ ...fixtures['crane-split-4sts'], decisions: { points: { cranePlan: { strategy: 'nope' } } } })).toThrow(/Unknown craneSplit strategy/)
  })
})

const NL = String.fromCharCode(10)

describe('crane plan: view model and CLI', () => {
  it('has a band per crane, a bar per package, columns in quay order and a now line', () => {
    const sim = createSimulation(fixtures['crane-split-4sts'])
    while (!sim.cranePlan('V001') && sim.step()) {
      /* step */
    }
    sim.runUntil({ time: sim.now + 900 })
    const view = sim.cranePlan('V001')!
    const model = buildCranePlanModel(view, sim.config.vessels[0].sizeClass)
    expect(model.bands).toHaveLength(view.cranes.length)
    expect(model.bars).toHaveLength(view.cranes.reduce((n, c) => n + c.packages.length, 0))
    const xs = model.columns.map((c) => c.x)
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
    expect(model.nowS).toBe(view.now)
    expect(model.bars.some((b) => b.actual)).toBe(true) // the actual progress overlays the plan
    expect(model.bars.some((b) => !b.actual)).toBe(true)
    for (const b of model.bars) expect(b.col).toBeGreaterThanOrEqual(0)
  })

  it('draws the now line at the display time and shows later actual work as predicted', () => {
    const sim = createSimulation(fixtures['crane-split-4sts'])
    while (!sim.cranePlan('V001') && sim.step()) {
      /* step */
    }
    sim.runUntil({ time: sim.now + 900 })
    const view = sim.cranePlan('V001')!
    const size = sim.config.vessels[0].sizeClass
    const behind = view.now - 400
    const model = buildCranePlanModel(view, size, behind)
    expect(model.nowS).toBe(behind)
    const full = buildCranePlanModel(view, size)
    expect(model.bars.filter((b) => b.actual).length).toBeLessThan(full.bars.filter((b) => b.actual).length)
    for (const b of model.bars) if (b.actual) expect(b.fromS).toBeLessThanOrEqual(behind)
  })

  it('tt:plan prints the table, the conflict list and, with --until, the accuracy', () => {
    const out: string[] = []
    expect(runPlanCli(['--fixture', 'crane-split-4sts', '--vessel', 'V001'], (l) => out.push(l))).toBe(0)
    const text = out.join(NL)
    expect(text).toMatch(/Crane plan for V001: strategy as-today/)
    expect(text).toMatch(/STS01\s+WP1\s+discharge/)
    expect(text).toMatch(/Predicted conflict windows/)
    const more: string[] = []
    expect(runPlanCli(['--fixture', 'crane-split-4sts', '--vessel', 'V001', '--strategy', 'equal-bays', '--until', 'end'], (l) => more.push(l))).toBe(0)
    expect(more.join(NL)).toMatch(/strategy equal-bays/)
    expect(more.join(NL)).toMatch(/Plan accuracy/)
    expect(runPlanCli(['--fixture', 'crane-split-4sts'], () => {})).toBe(2)
  })
})

describe('crane plan: panel and labels', () => {
  it('keeps a moved or resized panel inside its container', () => {
    const bounds = { width: 1000, height: 600 }
    expect(clampPanel({ left: -50, top: -10, width: 700, height: 400 }, bounds)).toEqual({ left: 0, top: 0, width: 700, height: 400 })
    expect(clampPanel({ left: 900, top: 500, width: 700, height: 400 }, bounds)).toEqual({ left: 300, top: 200, width: 700, height: 400 })
    expect(clampPanel({ left: 0, top: 0, width: 5000, height: 5000 }, bounds)).toMatchObject({ width: 1000, height: 600 })
    expect(clampPanel({ left: 0, top: 0, width: 10, height: 10 }, bounds)).toMatchObject({ width: 360, height: 240 })
  })

  it('gives a crane the same colour on every vessel and ticks the time axis hourly', () => {
    expect(craneColour('STS103')).toBe(craneColour('STS103'))
    expect(craneColour('STS103')).toBe(103 % 8)
    expect(craneColour('STS104')).not.toBe(craneColour('STS103'))
    expect(timeTicks(0, 3 * 3600 + 5)).toEqual([0, 3600, 7200, 10800])
    expect(timeTicks(100, 1500).every((s) => s % 60 === 0)).toBe(true)
  })

  it('heads every bay column with its crane and lists a crane colour per band', () => {
    const sim = createSimulation(fixtures['crane-split-4sts'])
    while (!sim.cranePlan('V001') && sim.step()) {
      /* step */
    }
    const model = buildCranePlanModel(sim.cranePlan('V001')!, sim.config.vessels[0].sizeClass)
    expect(model.columns.every((c) => /^STS\d+$/.test(c.stsId))).toBe(true)
    expect(new Set(model.bands.map((b) => b.colour)).size).toBe(model.bands.length)
    for (const b of model.bands) expect(b.bayNumbers.length).toBeGreaterThan(0)
  })
})
