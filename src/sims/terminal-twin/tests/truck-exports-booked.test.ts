/**
 * V11-14: truck-delivered exports are booked against the vessel's bay plan in every yard start mode, so the load
 * flow loads them (engine API seam).
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, type EngineEvent, type Simulation } from '../engine'
import { ScenarioBuilder } from '../scenario/builder'
import type { ScenarioConfig, YardStartConfig } from '../scenario/types'

const HOUR = 3600

function scenario(start: YardStartConfig | undefined, trucks: number): ScenarioConfig {
  const b = new ScenarioBuilder('truck-exports', 'truck exports')
    .seed(11)
    .moveVariation(10)
    .quay(400, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 60, groundPositions: 3 })
    .vesselCall('V001', { name: 'Only', sizeClass: 'feeder', arrivalS: 6 * HOUR, discharge: 3, load: 4, maxSts: 1, sizeMix: { '20': 1, '40': 1 } })
    .shcs(3)
    .ascsPerBlock(2)
    .block('B01', { x: 20, bays: 12, tiers: 4 })
    .block('B02', { x: 60, bays: 12, tiers: 4 })
    .landside({
      hourlyProfile: Array.from({ length: 24 }, () => 0),
      exportWindow: { minBeforeEtaS: HOUR, maxBeforeEtaS: 30 * 86400 },
      scripted: Array.from({ length: trucks }, (_, i) => ({ atS: 60 + i * 300, transaction: 'dropExport' as const })),
    })
    .endWhen({ vesselsCompleted: 1 })
  if (start) b.yardStart(start)
  return b.build()
}

const ofType = <T extends EngineEvent['type']>(sim: Simulation, type: T) => sim.eventLog().filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type)

describe.each([
  ['legacy start', undefined],
  ['pre-filled start', { mode: 'prefilled', targetPct: 30 } as YardStartConfig],
])('truck exports with a %s', (_name, start) => {
  it('books every delivered export to a free slot of its vessel and loads it', () => {
    const sim = createSimulation(scenario(start, 5))
    sim.runUntil()
    expect(sim.firstError).toBeNull()
    expect(sim.status).toBe('ended')
    expect(sim.invariantReport().violations).toEqual([])
    const delivered = ofType(sim, 'TruckArrived').flatMap((e) => e.payload.legs.filter((l) => l.purpose === 'export'))
    expect(delivered.length).toBe(5)
    const slots = sim.query.vesselSlots('V001')
    for (const leg of delivered) {
      const slot = slots.find((s) => s.plannedContainerId === leg.containerId)
      expect(slot, leg.containerId).toBeDefined()
      expect(slot?.purpose).toBe('load')
      expect(slot?.containerId, leg.containerId).toBe(leg.containerId)
      expect(sim.query.container(leg.containerId).custody).toEqual({ kind: 'vesselSlot', id: (slot as { id: string }).id })
    }
    // the 4 booked boxes plus the 5 delivered ones all sailed, and the vessel's remaining moves end at 0
    expect(sim.kpiReport().workPackages?.boxesLoaded).toBe(4 + 5)
    expect(sim.kpiReport().landside?.boxesDropped).toBe(5)
    const remaining = sim.kpiSeries().series['vessel.remaining-moves'].entities['V001']
    expect(remaining.total).toBe(0)
    expect(Math.min(...remaining.hourly.map((v) => v ?? 0))).toBeGreaterThanOrEqual(0)
  })

  it('never stacks a booked slot where it would float above an unloaded box', () => {
    const sim = createSimulation(scenario(start, 5))
    sim.runUntil()
    const loaded = ofType(sim, 'StsLoaded')
    const order = new Map(loaded.map((e, i) => [e.payload.slotId, i]))
    for (const s of sim.query.vesselSlots('V001').filter((x) => x.purpose === 'load')) {
      const below = sim.query.vesselSlots('V001').find((x) => x.bay === s.bay && x.row === s.row && x.deck === s.deck && x.tier === s.tier - 1)
      if (below && order.has(below.id)) expect(order.get(below.id) as number).toBeLessThan(order.get(s.id) as number)
    }
  })
})
