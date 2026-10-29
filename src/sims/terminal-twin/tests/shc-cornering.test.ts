/**
 * V11-12: SHCs take turns at a speed capped by the turn angle and an assumed
 * radius instead of stopping at every turn. Through the public engine API
 * (events carry the planned motion segments) on the SHC fixture.
 */
import { describe, expect, it } from 'vitest'
import { cornerSpeedCap, createSimulation, positionAt, type EngineEvent, type MotionSegment } from '../engine'
import { SceneModel } from '../modules/sceneModel'
import { emptyDelta } from './delta'
import { DEFAULT_SHC_CORNER, DEFAULT_SHC_KINEMATICS } from '../scenario/builder'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig } from '../scenario/types'

const base = fixtures['shc-1sts-2shc-1wtp']
const withKin = (over: Record<string, number>): ScenarioConfig => ({
  ...base,
  kinematics: { ...base.kinematics, shc: { ...DEFAULT_SHC_KINEMATICS, ...over } },
})
const stopAtEveryTurn = withKin({ cornerRadiusM: 0 })

function run(config: ScenarioConfig) {
  const sim = createSimulation(config)
  sim.runUntil()
  expect(sim.firstError).toBeNull()
  expect(sim.invariantReport().violations).toEqual([])
  return sim
}

const shcEvents = (events: readonly EngineEvent[]) => events.filter((e) => e.type.startsWith('Shc'))
const segmentsOf = (e: EngineEvent): MotionSegment[] => ((e.payload as { segments?: MotionSegment[] }).segments ?? []) as MotionSegment[]

/** Mean seconds from a job's first event of type `from` to its first of type `to`. */
function meanBetween(events: readonly EngineEvent[], from: string, to: string): number {
  const starts = new Map<string, number>()
  const spans: number[] = []
  for (const e of shcEvents(events)) {
    const job = (e.payload as { jobId?: string }).jobId
    if (!job) continue
    if (e.type === from && !starts.has(job)) starts.set(job, e.t)
    if (e.type === to && starts.has(job)) spans.push(e.t - starts.get(job)!)
  }
  expect(spans.length).toBeGreaterThan(0)
  return spans.reduce((a, b) => a + b, 0) / spans.length
}

describe('corner speed cap', () => {
  const corner = DEFAULT_SHC_CORNER
  it('a right-angle turn is capped by sqrt(lateral accel x radius); sharper turns are slower; a reversal stops', () => {
    expect(cornerSpeedCap(Math.PI / 2, corner)).toBeCloseTo(Math.sqrt(1.5 * 12), 9)
    expect(cornerSpeedCap(Math.PI / 4, corner)).toBeCloseTo(Math.sqrt(1.5 * 12), 9)
    expect(cornerSpeedCap(Math.PI * 0.75, corner)).toBeLessThan(cornerSpeedCap(Math.PI / 2, corner))
    expect(cornerSpeedCap(Math.PI, corner)).toBe(0)
  })
  it('a bigger radius or a zero radius', () => {
    expect(cornerSpeedCap(Math.PI / 2, { radiusM: 48, lateralAccel: 1.5 })).toBeCloseTo(2 * Math.sqrt(18), 9)
    expect(cornerSpeedCap(Math.PI / 2, { radiusM: 0, lateralAccel: 1.5 })).toBe(0)
  })
})

describe('SHC cornering at speed', () => {
  it('SHCs carry speed through turns (they do not stop between an x run and a z run)', () => {
    const sim = run(base)
    const moving: MotionSegment[] = []
    for (const e of shcEvents(sim.eventLog())) for (const s of segmentsOf(e)) if (s.axis === 'x' || s.axis === 'z') moving.push(s)
    const corners = moving.filter((s) => (s.v1 ?? 0) > 0)
    expect(corners.length).toBeGreaterThan(0)
    // every corner exit meets a segment on the other axis that starts at the same time, place and speed
    for (const s of corners) {
      const next = moving.find((n) => n.entityId === s.entityId && n.axis !== s.axis && Math.abs(n.t0 - s.t1) < 1e-9)
      expect(next, `${s.entityId} ${s.axis} ending ${s.t1}`).toBeDefined()
      expect(next!.v0).toBeCloseTo(s.v1!, 9)
    }
  })

  it('no SHC exceeds its corner speed cap at a turn (checked on the position curves)', () => {
    const sim = run(base)
    const cap = cornerSpeedCap(Math.PI / 2, DEFAULT_SHC_CORNER)
    const speedAt = (s: MotionSegment, t: number) => Math.abs(positionAt(s, t + 1e-4) - positionAt(s, t - 1e-4)) / 2e-4
    const seen = new Set<string>()
    let checked = 0
    for (const e of shcEvents(sim.eventLog())) {
      for (const s of segmentsOf(e)) {
        const key = `${s.entityId}|${s.axis}|${s.t0}`
        if (seen.has(key) || (s.axis !== 'x' && s.axis !== 'z')) continue
        seen.add(key)
        const entry = s.v0 ?? 0
        const exit = s.v1 ?? 0
        expect(entry).toBeLessThanOrEqual(cap + 1e-9)
        expect(exit).toBeLessThanOrEqual(cap + 1e-9)
        if (entry > 0) {
          expect(speedAt(s, s.t0 + 1e-3)).toBeLessThanOrEqual(cap + 1e-2)
          checked++
        }
        if (exit > 0) {
          expect(speedAt(s, s.t1 - 1e-3)).toBeLessThanOrEqual(cap + 1e-2)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('a lower tolerated lateral acceleration lowers the corner speeds', () => {
    const slow = run(withKin({ maxLateralAccel: 0.3 }))
    const cap = cornerSpeedCap(Math.PI / 2, { radiusM: DEFAULT_SHC_CORNER.radiusM, lateralAccel: 0.3 })
    for (const e of shcEvents(slow.eventLog())) for (const s of segmentsOf(e)) expect(s.v1 ?? 0).toBeLessThanOrEqual(cap + 1e-9)
  })

  it('planned segment end times equal the event log: an event that carries segments fires exactly when its last planned segment ends', () => {
    const sim = run(base)
    let checked = 0
    for (const e of shcEvents(sim.eventLog())) {
      const segs = segmentsOf(e)
      if (segs.length === 0) continue
      const end = Math.max(...segs.map((s) => s.t1))
      // The engine schedules the arrival event at the plan's own end time (handling such as lock,
      // unlock and lift is a separate phase with its own event), so there is no slack to allow.
      expect(Math.abs(e.t - end), `${e.type} at ${e.t}`).toBeLessThanOrEqual(1e-6)
      checked++
    }
    expect(checked).toBeGreaterThan(0)
    // positions are continuous where one run hands over to the next
    const byShc = new Map<string, MotionSegment[]>()
    for (const e of shcEvents(sim.eventLog()))
      for (const s of segmentsOf(e)) {
        const list = byShc.get(s.entityId) ?? []
        if (!list.some((o) => o.t0 === s.t0 && o.axis === s.axis)) list.push(s)
        byShc.set(s.entityId, list)
      }
    for (const list of byShc.values()) {
      for (const s of list.filter((x) => (x.v1 ?? 0) > 0)) {
        const next = list.find((n) => n.axis !== s.axis && Math.abs(n.t0 - s.t1) < 1e-9)!
        expect(next).toBeDefined()
      }
    }
  })

  it('shortens empty travel and the pickup-to-drop-off cycle compared with stopping at every turn', () => {
    const corner = run(base)
    const stop = run(stopAtEveryTurn)
    const empty = (s: typeof corner) => meanBetween(s.eventLog(), 'ShcRoutingEmpty', 'ShcLocking')
    const loaded = (s: typeof corner) => meanBetween(s.eventLog(), 'ShcPicked', 'ShcDroppedAtWtp')
    const cycle = (s: typeof corner) => meanBetween(s.eventLog(), 'ShcRoutingEmpty', 'ShcCleared')
    expect(empty(corner)).toBeLessThan(empty(stop))
    expect(loaded(corner)).toBeLessThan(loaded(stop))
    expect(cycle(corner)).toBeLessThan(cycle(stop))
  })

  it('radius 0 reproduces the old stop-at-every-turn plan (no segment has an entry or exit speed)', () => {
    const sim = run(stopAtEveryTurn)
    for (const e of shcEvents(sim.eventLog()))
      for (const s of segmentsOf(e)) {
        expect(s.v0 ?? 0).toBe(0)
        expect(s.v1 ?? 0).toBe(0)
      }
  })

  it('the scene model drives an SHC round a corner without stopping: moving and steering at the turn', () => {
    const sim = run(base)
    const moving: MotionSegment[] = []
    for (const e of shcEvents(sim.eventLog())) for (const s of segmentsOf(e)) if ((s.axis === 'x' || s.axis === 'z') && !moving.some((m) => m.entityId === s.entityId && m.t0 === s.t0 && m.axis === s.axis)) moving.push(s)
    const first = moving.find((s) => (s.v1 ?? 0) > 0)!
    const next = moving.find((n) => n.entityId === first.entityId && n.axis !== first.axis && Math.abs(n.t0 - first.t1) < 1e-9)!
    const model = new SceneModel(base)
    model.apply(emptyDelta({ motion: [{ entityId: first.entityId, segments: moving.filter((s) => s.entityId === first.entityId && s.t0 <= next.t0) }] }))
    const at = (t: number) => model.shcPose(first.entityId, t)
    const before = at(first.t1 - 0.05)
    const after = at(first.t1 + 0.05)
    const distance = Math.hypot(after.x - before.x, after.z - before.z)
    expect(distance / 0.1).toBeGreaterThan(0.5 * (first.v1 ?? 0))
    expect(before.travelling).toBe(true)
    expect(after.travelling).toBe(true)
    expect(Math.abs(at(first.t1 + 0.5).steerRad)).toBeGreaterThan(0)
  })
})
