/**
 * One RNG stream per source (#310): every STS draws its move variation and every SHC its driver variability from
 * its own stream, and decision requests draw their `random` field from another, so changing one decision point's
 * strategy no longer reshuffles crane cycle times or driver variability on the same seed.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { createSimulation, nextRandom, type Simulation } from '../engine'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig } from '../scenario/types'

const base = fixtures['asc-1sts-10-boxes-1block']

function withYard(strategy: string): ScenarioConfig {
  return { ...base, decisions: { ...base.decisions, points: { ...base.decisions?.points, yardAllocation: { strategy } } } }
}

/** The uniform draws `from` gave to reach `to` (both mulberry32 states). */
function drawsBetween(from: number, to: number): number[] {
  const out: number[] = []
  let s = from
  while (s !== to) {
    const [v, next] = nextRandom(s)
    out.push(v)
    s = next
    if (out.length > 1000) throw new Error('stream states are not on one sequence')
  }
  return out
}

/** Run to the end, step by step, and collect each equipment stream's draws in order (read after every logged event). */
function drawsPerEquipment(config: ScenarioConfig): { sim: Simulation; draws: Map<string, number[]> } {
  const sim = createSimulation(config)
  const draws = new Map<string, number[]>()
  const last = new Map<string, number>(Object.entries(sim.query.rngStreams()))
  while (sim.step()) {
    for (const [name, value] of Object.entries(sim.query.rngStreams())) {
      if (!name.startsWith('sts:') && !name.startsWith('shc:')) continue
      const prev = last.get(name)
      if (prev === value) continue
      const list = draws.get(name) ?? []
      // A stream first used in this event starts from its seeded state.
      list.push(...drawsBetween(prev ?? sim.query.rngStreamSeedState(name), value))
      draws.set(name, list)
      last.set(name, value)
    }
  }
  expect(sim.status).toBe('ended')
  return { sim, draws }
}

describe('RNG streams', () => {
  let a: ReturnType<typeof drawsPerEquipment>
  let b: ReturnType<typeof drawsPerEquipment>
  beforeAll(() => {
    expect(base.moveVariationPct).toBeGreaterThan(0)
    expect(base.driverVariabilityPct).toBeGreaterThan(0)
    a = drawsPerEquipment(withYard('grouped'))
    b = drawsPerEquipment(withYard('random'))
  })

  it('a different yard strategy changes the event log', () => {
    expect(b.sim.eventLogHash()).not.toBe(a.sim.eventLogHash())
  })

  it('each STS and SHC draws the same Nth variation factor under either strategy', () => {
    const names = [...a.draws.keys()].sort()
    expect(names.some((n) => n.startsWith('sts:'))).toBe(true)
    expect(names.some((n) => n.startsWith('shc:'))).toBe(true)
    for (const name of names) {
      const da = a.draws.get(name) ?? []
      const db = b.draws.get(name) ?? []
      const n = Math.min(da.length, db.length)
      expect(n, name).toBeGreaterThan(0)
      expect(db.slice(0, n), name).toEqual(da.slice(0, n))
    }
  })

  it('every equipment stream starts from its own seed', () => {
    const seeds = Object.keys(a.sim.query.rngStreams()).map((n) => a.sim.query.rngStreamSeedState(n))
    expect(new Set(seeds).size).toBe(seeds.length)
  })

  it('the landside and decision-latency streams start from different salts', () => {
    const config = fixtures['truck-gate-queue']
    const sim = createSimulation(config)
    const fresh = createSimulation(config)
    // The decision runtime's latency stream and the landside stream are both seeded from the scenario seed.
    expect(fresh.query.rngStreamSeedState('latency')).not.toBe(fresh.query.rngStreamSeedState('landside'))
    expect(sim.query.rngStreamSeedState('latency')).toBe(fresh.query.rngStreamSeedState('latency'))
  })
})
