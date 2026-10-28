/**
 * Dashboard Gantt data (seam: `buildTimeline(sim.eventLog())`), checked against the
 * engine's own vessel state (an independent source of the same windows).
 */
import { describe, expect, it } from 'vitest'
import { buildTimeline, createSimulation } from '../engine'
import { fixtures } from '../scenario/fixtures'

const FIXTURE = 'two-vessels-compete-for-berth'

describe('buildTimeline on two-vessels-compete-for-berth', () => {
  const sim = createSimulation(fixtures[FIXTURE])
  sim.runUntil()
  const timeline = buildTimeline(sim.eventLog(), sim.now)
  const vessels = sim.config.vessels.map((v) => sim.query.vessel(v.id))

  it("has one row per vessel with the engine's anchorage, berth and departure times", () => {
    expect(timeline.vessels.map((v) => v.vesselId).sort()).toEqual(vessels.map((v) => v.id).sort())
    for (const row of timeline.vessels) {
      const v = sim.query.vessel(row.vesselId)
      expect(row.arrivedAt).toBe(v.arrivedAt)
      expect(row.berthAllocatedAt).toBe(v.berthAllocatedAt)
      expect(row.berthedAt).toBe(v.berthedAt)
      expect(row.workCompletedAt).toBe(v.workCompletedAt)
      expect(row.departedAt).toBe(v.departedAt)
      expect(row.anchorage.endS - row.anchorage.startS).toBeCloseTo(v.anchorageWaitS ?? 0, 6)
      expect(row.berthX).toBe(v.berthX)
      expect(row.berth.startS).toBe(v.berthAllocatedAt)
      expect(row.berth.endS).toBe(v.departedAt)
    }
  })

  it('shows that exactly the vessel which waited has an anchorage window', () => {
    const waited = timeline.vessels.filter((v) => v.anchorage.endS > v.anchorage.startS)
    expect(waited.map((v) => v.vesselId)).toEqual(vessels.filter((v) => v.anchored).map((v) => v.id))
    expect(waited).toHaveLength(1)
  })

  it('lists each crane work package with its bays inside the vessel berth window', () => {
    for (const row of timeline.vessels) {
      const v = sim.query.vessel(row.vesselId)
      expect([...new Set(row.packages.map((p) => p.stsId))].sort()).toEqual([...v.stsHistory].sort())
      for (const p of row.packages) {
        expect(p.bays.length).toBeGreaterThan(0)
        expect(p.startS).toBeGreaterThanOrEqual(row.berthedAt!)
        expect(p.endS).toBeLessThanOrEqual(row.workCompletedAt!)
        expect(p.endS).toBeGreaterThan(p.startS)
      }
    }
  })

  it('closes open windows at the current time for a run cut short', () => {
    const partial = createSimulation(fixtures[FIXTURE])
    partial.runUntil({ time: 1000 })
    const t = buildTimeline(partial.eventLog(), partial.now)
    for (const row of t.vessels) {
      expect(row.departedAt).toBeNull()
      expect(row.berth.endS).toBeLessThanOrEqual(partial.now)
    }
  })
})
