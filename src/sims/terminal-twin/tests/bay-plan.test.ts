import { describe, expect, it } from 'vitest'
import { createSimulation } from '../engine'
import { ScenarioBuilder, LINE_OWNER_PREFIX } from '../scenario/builder'
import { isValidIso6346 } from '../scenario/iso6346'
import { VESSEL_CLASSES } from '../scenario/vesselClasses'

function scenario(seed = 3) {
  return new ScenarioBuilder('bay-plan', 'bay plans of three vessel calls')
    .seed(seed)
    .quay(1200)
    .sts('STS01', { gantryX: 100, groundPositions: 3 })
    .vesselCall('V001', { sizeClass: 'panamax', discharge: 400, load: 150, transshipment: 100 })
    .vesselCall('V002', { sizeClass: 'feeder', discharge: 60, load: 40, transshipment: 0, sizeMix: { '20': 1 } })
    .vesselCall('V003', { sizeClass: 'ulcv', discharge: 900, load: 0, transshipment: 300 })
    .build()
}

describe('bay plans and containers', () => {
  it('every generated container has a valid ISO 6346 id with a real owner prefix of its line, and ids are unique', () => {
    const sim = createSimulation(scenario())
    const boxes = sim.query.containers()
    expect(boxes).toHaveLength(400 + 60 + 900)
    for (const b of boxes) {
      expect(isValidIso6346(b.id), b.id).toBe(true)
      expect(b.id.slice(0, 4)).toBe(LINE_OWNER_PREFIX[b.line])
      expect(['20', '40', '40HC']).toContain(b.size)
    }
    expect(new Set(boxes.map((b) => b.id)).size).toBe(boxes.length)
    // the default line mix is weighted towards HMM and uses several lines
    const lines = new Map<string, number>()
    for (const b of boxes) lines.set(b.line, (lines.get(b.line) ?? 0) + 1)
    expect(lines.size).toBeGreaterThanOrEqual(6)
    expect(Math.max(...lines.values())).toBe(lines.get('HMM'))
  })

  it('each discharge box sits in its own real slot of its vessel; load and transshipment slots are reserved empty', () => {
    const config = scenario()
    const sim = createSimulation(config)
    for (const v of config.vessels) {
      const spec = VESSEL_CLASSES[v.sizeClass]
      const slots = sim.query.vesselSlots(v.id)
      const discharge = slots.filter((s) => s.purpose === 'discharge')
      expect(discharge.every((s) => s.containerId !== null)).toBe(true)
      expect(slots.filter((s) => s.purpose === 'load')).toHaveLength(v.load)
      expect(slots.filter((s) => s.purpose === 'transshipment')).toHaveLength(v.transshipment)
      expect(slots.filter((s) => s.purpose !== 'discharge').every((s) => s.containerId === null)).toBe(true)
      for (const s of slots) {
        expect(s.bay).toBeLessThan(spec.bays)
        expect(s.row).toBeLessThan(spec.rows)
        expect(s.tier).toBeLessThan(spec.holdTiers + spec.deckTiers)
        expect(s.deck).toBe(s.tier >= spec.holdTiers)
      }
      expect(new Set(slots.map((s) => s.id)).size).toBe(slots.length)
    }
    for (const b of sim.query.containers()) {
      expect(b.custody.kind).toBe('vesselSlot')
      expect(sim.query.vesselSlot(b.custody.id).containerId).toBe(b.id)
    }
  })

  it('boxes are stacked without floating: a box in tier n has a box (or the hold floor / hatch cover) below it', () => {
    const config = scenario()
    const sim = createSimulation(config)
    for (const v of config.vessels) {
      const spec = VESSEL_CLASSES[v.sizeClass]
      const full = new Set(
        sim.query
          .vesselSlots(v.id)
          .filter((s) => s.containerId)
          .map((s) => `${s.bay}:${s.row}:${s.tier}`),
      )
      for (const key of full) {
        const [bay, row, tier] = key.split(':').map(Number)
        if (tier === 0 || tier === spec.holdTiers) continue
        expect(full.has(`${bay}:${row}:${tier - 1}`), `${v.id} ${key} floats`).toBe(true)
      }
    }
  })

  it('20 ft boxes are paired fore and aft in a cell; 40 ft boxes fill a whole cell', () => {
    const sim = createSimulation(scenario())
    const slots = sim.query.vesselSlots('V002')
    expect(slots.filter((s) => s.purpose === 'discharge').every((s) => s.half !== null)).toBe(true)
    const halves = new Map<string, string[]>()
    for (const s of slots.filter((x) => x.half)) {
      const key = `${s.bay}:${s.row}:${s.tier}`
      halves.set(key, [...(halves.get(key) ?? []), s.half as string])
    }
    expect([...halves.values()].every((h) => h.sort().join() === 'aft,fore')).toBe(true)
    for (const s of sim.query.vesselSlots('V001')) {
      const box = s.containerId ? sim.query.container(s.containerId) : null
      if (box && box.size !== '20') expect(s.half).toBeNull()
    }
  })

  it('the bay plan is deterministic for a seed and changes with the seed', () => {
    const ids = (seed: number) =>
      createSimulation(scenario(seed))
        .query.containers()
        .map((b) => `${b.id}@${b.custody.id}`)
    expect(ids(3)).toEqual(ids(3))
    expect(ids(4)).not.toEqual(ids(3))
  })

  it('rejects a vessel call that does not fit its size class', () => {
    const cells = VESSEL_CLASSES.feeder.bays * VESSEL_CLASSES.feeder.rows * 7
    const config = new ScenarioBuilder('too-big', 'x')
      .sts('STS01', { gantryX: 50, groundPositions: 3 })
      .vesselCall('V001', { sizeClass: 'feeder', discharge: cells, load: 1, transshipment: 0, sizeMix: { '40': 1 } })
      .build()
    expect(() => createSimulation(config)).toThrow(/V001.*not fit/)
  })
})
