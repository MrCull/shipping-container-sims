/**
 * #267: a yard box rests on the boxes under it. Its bottom is the top of the taller column it covers (a standard box is
 * 2.591 m, a high cube 2.896 m), not a fixed high-cube tier grid. The ASC sets a box down at, and picks it from, that
 * height, and the scene model poses it there at any display time (the base rides on the custody change).
 */
import { describe, expect, it } from 'vitest'
import { startHeadlessRun } from '../cli/headlessPose'
import { ascPoseAt, boxSpan, createSimulation, parseYardSlotId, yardBaseHeights, yardBaseY } from '../engine'
import type { SceneModel } from '../modules/sceneModel'
import { CONTAINER_DIMS } from '../modules/sceneModel'
import { ScenarioBuilder } from '../scenario/builder'
import type { ScenarioConfig } from '../scenario/types'

const STD = 2.591
const HC = 2.896

describe('yardBaseY', () => {
  it('is 0 on tier 1 and the height of the boxes below otherwise', () => {
    expect(yardBaseY([])).toBe(0)
    expect(yardBaseY([[], []])).toBe(0)
    expect(yardBaseY([[STD]])).toBeCloseTo(2.591, 9)
    expect(yardBaseY([[HC]])).toBeCloseTo(2.896, 9)
    expect(yardBaseY([[STD, HC]])).toBeCloseTo(5.487, 9)
  })

  it('a staggered 40 rests on the taller of its two columns', () => {
    expect(yardBaseY([[HC], [STD]])).toBeCloseTo(2.896, 9)
    expect(yardBaseY([[STD], [HC]])).toBeCloseTo(2.896, 9)
  })
})

describe('yardBaseHeights', () => {
  it('gives each placed box the top of the boxes under it (mixed 40 and 40HC, one staggered 40)', () => {
    const bases = yardBaseHeights([
      // listed out of tier order on purpose
      { slotId: 'B01:01-1-3', size: '40' },
      { slotId: 'B01:01-1-2', size: '40HC' },
      { slotId: 'B01:01-1-1', size: '40' },
      { slotId: 'B01:03-1-1', size: '40HC' },
      { slotId: 'B01:05-1-1', size: '40' },
      { slotId: 'B01:04-1-2', size: '40' }, // staggered: bay 4 on the HC at 03, bay 5 on the 40 at 05
      { slotId: 'B01:07-1-1', size: '20' },
      { slotId: 'B01:07-1-2', size: '20' },
    ])
    expect(bases.get('B01:01-1-1')).toBe(0)
    expect(bases.get('B01:01-1-2')).toBeCloseTo(STD, 9)
    expect(bases.get('B01:01-1-3')).toBeCloseTo(STD + HC, 9)
    expect(bases.get('B01:04-1-2')).toBeCloseTo(HC, 9)
    expect(bases.get('B01:07-1-2')).toBeCloseTo(STD, 9)
  })

  it('a box above a staggered 40 rests on that 40s top, not on the sum of the column', () => {
    const bases = yardBaseHeights([
      { slotId: 'B01:01-1-1', size: '40HC' },
      { slotId: 'B01:03-1-1', size: '40' },
      { slotId: 'B01:05-1-1', size: '40' },
      { slotId: 'B01:02-1-2', size: '40' }, // bays 2-3: rests on the HC (2.896)
      { slotId: 'B01:04-1-2', size: '40' }, // bays 4-5: 2.591
      { slotId: 'B01:03-1-3', size: '40' }, // bays 3-4: on 2.896 + 2.591 (bay 3), not 2 x 2.591
    ])
    expect(bases.get('B01:03-1-3')).toBeCloseTo(HC + STD, 9)
  })

  it('throws on a box with nothing under it', () => {
    expect(() => yardBaseHeights([{ slotId: 'B01:01-1-2', size: '40' }])).toThrow(/no box under it/)
  })
})

/** One feeder, 40 and 40HC boxes only, a small block so stacks grow (legacy start: exports stacked by planExportYard). */
function mixedHeights(): ScenarioConfig {
  return new ScenarioBuilder('mixed-heights', '40 and 40HC boxes in one small block')
    .hatch({ enabled: false })
    .seed(11)
    .moveVariation(10)
    .driverVariability(10)
    .quay(400, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 60, groundPositions: 3 })
    .vesselCall('V001', { name: 'Mixed Height', sizeClass: 'feeder', discharge: 20, load: 30, maxSts: 1, sizeMix: { '40': 1, '40HC': 1 } })
    .shcs(3)
    .block('B01', { x: 20, bays: 4, tiers: 4 })
    .endWhen({ vesselsCompleted: 1 })
    .build()
}

describe('ASC hoist targets', () => {
  it('sets every box down at, and picks every box from, the top of the boxes under it', () => {
    const sim = createSimulation(mixedHeights())
    let stackedAbove = 0
    let checked = 0
    // pick heights are checked at AscLocking (the hoist is down over the slot), set-downs at AscStacked
    sim.runUntil({ predicate: (e) => {
      if (e.type === 'AscStacked') {
        const slot = sim.query.yardSlot(e.payload.yardSlotId)
        const pose = ascPoseAt(sim.query.asc(e.payload.ascId), e.t)
        expect(pose.hoistY).toBeCloseTo(sim.query.yardSlotBaseY(slot.id), 6)
        if (slot.tier > 1) stackedAbove++
        checked++
      }
      return false
    } })
    expect(sim.invariantReport().violations).toEqual([])
    expect(checked).toBeGreaterThan(10)
    expect(stackedAbove).toBeGreaterThan(0)
  })

  it('picks every box from a stack at the height it stands at', () => {
    const sim = createSimulation(mixedHeights())
    let picks = 0
    let picksAbove = 0
    sim.runUntil({ predicate: (e) => {
      if (e.type !== 'AscLocking') return false
      const owner = sim.query.container(e.payload.containerId).custody
      if (owner.kind !== 'yardSlot') return false // a pick from a pad or a truck
      const pose = ascPoseAt(sim.query.asc(e.payload.ascId), e.t)
      expect(pose.hoistY).toBeCloseTo(sim.query.yardSlotBaseY(owner.id), 6)
      picks++
      if (parseYardSlotId(owner.id).tier > 1) picksAbove++
      return false
    } })
    expect(picks).toBeGreaterThan(0)
    expect(picksAbove).toBeGreaterThan(0)
  })
})

interface Placed {
  id: string
  bottom: number
  top: number
  tier: number
  columns: string[]
}

/** Every yard box at `t` with the columns it covers. */
function yardBoxesAt(model: SceneModel, t: number): Placed[] {
  const out: Placed[] = []
  for (const id of model.containerIds) {
    const pose = model.containerPose(id, t)
    if (!pose?.yard) continue
    const owner = model.custodyAt(id, t)
    if (owner?.kind !== 'yardSlot') continue
    const cell = parseYardSlotId(owner.id)
    const size = model.containerSize[id]
    const h = CONTAINER_DIMS[size].height
    const columns = Array.from({ length: boxSpan(size) }, (_, k) => `${cell.blockId}|${cell.bay + k}-${cell.row}`)
    out.push({ id, bottom: pose.y - h / 2, top: pose.y + h / 2, tier: cell.tier, columns })
  }
  return out
}

/** No overlap, no gap: each box above tier 1 sits on the highest top of the boxes one tier below in its columns. Returns how many sit on a standard-height box (the case that floated). */
function expectResting(boxes: Placed[]): number {
  const byColumnTier = new Map<string, Placed>()
  for (const b of boxes) for (const c of b.columns) byColumnTier.set(`${c}|${b.tier}`, b)
  let above = 0
  for (const b of boxes) {
    if (b.tier === 1) {
      expect(b.bottom).toBeCloseTo(0, 3)
      continue
    }
    const tops = b.columns.map((c) => byColumnTier.get(`${c}|${b.tier - 1}`)?.top)
    expect(tops.every((x) => x !== undefined), `${b.id} has a box under every column`).toBe(true)
    expect(Math.abs(b.bottom - Math.max(...(tops as number[])))).toBeLessThan(0.001)
    if (b.columns.some((c) => { const u = byColumnTier.get(`${c}|${b.tier - 1}`) as Placed; return Math.abs(u.top - u.bottom - 2.591) < 1e-6 })) above++
  }
  return above
}

describe('scene model: yard boxes rest on each other', async () => {
  const config = mixedHeights()
  const run = await startHeadlessRun(config)
  await run.runTo(14_400)
  const times = [0, 1800, 3600, 5400, 7200, 9000, 10_800]

  it('at every display time, each box above tier 1 touches the box under it (no gap, no overlap)', () => {
    let onStandard = 0
    for (const t of times) onStandard += expectResting(yardBoxesAt(run.model, t))
    expect(onStandard).toBeGreaterThan(0)
  })

  it('a fresh model replayed only to an earlier time (a rewind) poses the yard the same', async () => {
    const rewound = await startHeadlessRun(config)
    await rewound.runTo(5400)
    for (const t of [0, 1800, 3600, 5400]) {
      const a = yardBoxesAt(rewound.model, t)
      expectResting(a)
      expect(a).toEqual(yardBoxesAt(run.model, t))
    }
  })

  it('a box does not jump when the ASC releases it: carried just before AscStacked, in its slot just after, same height', () => {
    const sim = createSimulation(config)
    sim.runUntil({ time: 14_400 })
    const stacked = sim.eventLog().filter((e) => e.type === 'AscStacked')
    expect(stacked.length).toBeGreaterThan(0)
    for (const e of stacked) {
      const before = run.model.containerPose(e.payload.containerId, e.t - 1e-6)
      const carriedBy = before?.carriedBy
      const after = run.model.containerPose(e.payload.containerId, e.t + 1e-6)
      expect(carriedBy).toBe(e.payload.ascId)
      expect(after?.yard).toBe(true)
      expect(Math.abs((after?.y ?? NaN) - (before?.y ?? NaN))).toBeLessThan(0.001)
    }
  })
}, 120_000)
