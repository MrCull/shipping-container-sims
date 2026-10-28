import { describe, expect, it } from 'vitest'
import { createSimulation } from '../engine'
import { ScenarioBuilder } from '../scenario/builder'
import { fixtures } from '../scenario/fixtures'
import { cellCapacity, VESSEL_CLASSES } from '../scenario/vesselClasses'
import { generateVessels, type VesselGeneratorOptions } from '../scenario/vesselGenerator'

const twin = fixtures['twin-20-lift']

describe('twin-20 lifts', () => {
  it('one STS cycle discharges two 20 ft boxes onto two ground positions', () => {
    const sim = createSimulation(twin)
    expect(sim.runUntil().reason).toBe('ended')
    const log = sim.eventLog()
    const starts = log.filter((e) => e.type === 'StsMoveStarted')
    expect(starts).toHaveLength(2) // 4 boxes, 2 cycles
    for (const start of starts) {
      if (start.type !== 'StsMoveStarted') throw new Error()
      expect(start.payload.containerIds).toHaveLength(2)
      const [a, b] = start.payload.containerIds
      // both boxes leave the vessel at one StsPicked
      const picked = log.find((e) => e.type === 'StsPicked' && e.subjects.containers?.includes(a))
      if (picked?.type !== 'StsPicked') throw new Error('not picked')
      expect(picked.payload.containerId).toBe(a)
      expect(picked.payload.twin?.containerId).toBe(b)
      expect(sim.query.container(a).custodyHistory[1].eventId).toBe(picked.id)
      expect(sim.query.container(b).custodyHistory[1].eventId).toBe(picked.id)
      // ... and land on two different ground positions before the crane's next cycle
      const gpA = sim.query.container(a).custody
      const gpB = sim.query.container(b).custody
      expect(gpA.kind).toBe('groundPosition')
      expect(gpB.kind).toBe('groundPosition')
      expect(gpA.id).not.toBe(gpB.id)
      const groundedB = log.find((e) => e.type === 'StsGrounded' && e.subjects.containers?.[0] === b)!
      const nextStart = starts.find((s) => s.seq > start.seq)
      if (nextStart) expect(groundedB.seq).toBeLessThan(nextStart.seq)
      // the two boxes came from the two halves of one vessel cell
      const [ha, hb] = [a, b].map((id) => sim.query.vesselSlot(sim.query.container(id).custodyHistory[0].owner.id))
      expect([ha.half, hb.half]).toEqual(['aft', 'fore'])
      expect([ha.bay, ha.row, ha.tier]).toEqual([hb.bay, hb.row, hb.tier])
    }
    const k = sim.kpiReport().sts.STS01
    expect(k).toMatchObject({ moves: 4, cycles: 2, twinLifts: 2 })
    expect(sim.invariantReport().violations).toEqual([])
  })

  it('with twin lifts off, every 20 ft box takes its own cycle', () => {
    const sim = createSimulation({ ...twin, quay: { ...twin.quay, twinLift: false } })
    sim.runUntil()
    expect(sim.kpiReport().sts.STS01).toMatchObject({ moves: 4, cycles: 4, twinLifts: 0 })
  })
})

describe('vessel generator ("Generate N vessels")', () => {
  const opts: VesselGeneratorOptions = {
    count: 12,
    startS: 3600,
    intervalS: 4 * 3600,
    sizeMix: { feeder: 1, panamax: 2, ulcv: 1 },
    jitterS: 1800,
    seed: 99,
  }

  it('is deterministic for a seed and varies with the seed', () => {
    expect(generateVessels(opts)).toEqual(generateVessels(opts))
    expect(generateVessels({ ...opts, seed: 100 })).not.toEqual(generateVessels(opts))
  })

  it('fills the vessel table: ids in arrival order, arrivals within the jitter, classes from the mix', () => {
    const vessels = generateVessels(opts)
    expect(vessels).toHaveLength(12)
    expect(vessels.map((v) => v.id)).toEqual(Array.from({ length: 12 }, (_, i) => `V${String(i + 1).padStart(3, '0')}`))
    for (let i = 1; i < vessels.length; i++) expect(vessels[i].arrivalS).toBeGreaterThanOrEqual(vessels[i - 1].arrivalS)
    const nominal = Array.from({ length: 12 }, (_, i) => opts.startS + i * opts.intervalS)
    for (const v of vessels) expect(nominal.some((n) => Math.abs(v.arrivalS - n) <= opts.jitterS)).toBe(true)
    expect(new Set(vessels.map((v) => v.sizeClass))).toEqual(new Set(['feeder', 'panamax', 'ulcv']))
    for (const v of vessels) {
      expect(v.discharge + v.load + v.transshipment).toBeLessThan(cellCapacity(VESSEL_CLASSES[v.sizeClass]))
      expect(v.maxSts).toBeGreaterThan(0)
      expect(v.name).toMatch(/^[A-Za-z-]+( [A-Za-z]+)+$/)
    }
  })

  it('generated vessels run in the engine', () => {
    const vessels = generateVessels({ ...opts, count: 3, sizeMix: { feeder: 1 }, movesScale: 0.05, intervalS: 600 })
    const config = new ScenarioBuilder('generated', 'generated vessel table')
      .quay(800, { mooringS: 300, unmooringS: 300 })
      .sts('STS01', { gantryX: 50, groundPositions: 40 })
      .sts('STS02', { gantryX: 300, groundPositions: 40 })
      .sts('STS03', { gantryX: 550, groundPositions: 40 })
      .vessels(vessels)
      .build()
    const sim = createSimulation(config)
    expect(sim.runUntil().reason).toBe('ended')
    expect(sim.kpiReport().vesselsCompleted).toBe(3)
    expect(sim.invariantReport().violations).toEqual([])
  })
})
