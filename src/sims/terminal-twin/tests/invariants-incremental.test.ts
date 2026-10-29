/** V11-18: incremental invariant checking. The injected-violation tests in `invariants.test.ts` keep proving the exact-event guarantee. */
import { describe, expect, it } from 'vitest'
import { checkInvariants, createSimulation, indexYardSlotAdded, InvariantTracker, type HandlerSet } from '../engine'
import { fixtures } from '../scenario/fixtures'

const tracer = fixtures['tracer-1sts-10-boxes']
const alwaysFirstLane: Partial<HandlerSet> = {
  stsGroundPosition: (msg) => ({ groundPositionId: msg.payload.groundPositions[0].id }),
}

describe('incremental checking', () => {
  it('checks events incrementally between sweeps, with a priming sweep and a sweep at the end of the run', () => {
    const sim = createSimulation(fixtures['asc-1sts-10-boxes-1block'])
    sim.runUntil()
    const stats = sim.invariantStats()
    expect(sim.invariantReport().violations).toEqual([])
    expect(stats.sweeps).toBe(2)
    expect(stats.incremental).toBe(sim.invariantReport().checks - 1)
  })

  it('sweepEvery: 1 sweeps after every event', () => {
    const sim = createSimulation(tracer, {}, { invariants: { sweepEvery: 1 } })
    sim.runUntil()
    expect(sim.invariantStats().incremental).toBe(0)
    expect(sim.invariantStats().sweeps).toBe(sim.invariantReport().checks)
  })

  it('a double-occupied ground position is caught at its exact event by the incremental check, with no sweep due', () => {
    const sim = createSimulation(tracer, alwaysFirstLane, { invariants: { sweepEvery: 1_000_000 } })
    sim.runUntil()
    const offending = sim.eventLog().filter((e) => e.type === 'StsGrounded')[1]
    expect(sim.firstError?.eventId).toBe(offending.id)
    expect(sim.invariantStats().sweeps).toBe(1) // only the priming sweep
  })

  it('a violation in an untouched yard cell is missed by the incremental check and found by a sweep', () => {
    const sim = createSimulation(fixtures['asc-1sts-10-boxes-1block'])
    sim.runUntil({ eventType: 'AscStacked' })
    sim.runUntil({ eventType: 'AscStacked' })
    const { state } = sim.snapshot()
    const tracker = new InvariantTracker()
    expect(tracker.sweep(state, sim.config)).toEqual([])
    const filled = Object.values(state.yardSlots).filter((s) => s.containerId)
    filled[0].tier = 3 // floating, but no event mentions it
    expect(tracker.check(state, sim.config, { subjects: { equipment: ['ASC-1'] } })).toEqual([])
    expect(tracker.sweep(state, sim.config).map((v) => v.invariant)).toContain('yard.no-floating')
    // an event that does name the box catches it
    tracker.reset()
    tracker.sweep(state, sim.config)
    const named = tracker.check(state, sim.config, { subjects: { containers: [filled[0].containerId as string] } })
    expect(named.map((v) => v.invariant)).toContain('yard.no-floating')
  })

  it('removing the box below makes the box above floating at that event', () => {
    const sim = createSimulation(fixtures['asc-1sts-10-boxes-1block'])
    sim.runUntil({ eventType: 'AscStacked' })
    const { state } = sim.snapshot()
    const tracker = new InvariantTracker()
    expect(tracker.sweep(state, sim.config)).toEqual([])
    const [a] = Object.values(state.yardSlots).filter((s) => s.containerId)
    const b = Object.values(state.containers).find((c) => c.custody.kind !== 'yardSlot' && c.custody.kind !== 'external')
    if (!b) throw new Error('no free box')
    // stack another box directly on `a`, then pull `a` out from under it
    state.yardSlots[`${a.id}-up`] = { ...a, id: `${a.id}-up`, tier: a.tier + 1, containerId: b.id }
    indexYardSlotAdded(state, state.yardSlots[`${a.id}-up`])
    b.custody = { kind: 'yardSlot', id: `${a.id}-up` }
    const stackedOn = tracker.check(state, sim.config, { subjects: { containers: [b.id] } })
    expect(stackedOn.map((v) => v.invariant)).not.toContain('yard.no-floating')
    const below = a.containerId as string
    state.yardSlots[a.id].containerId = null
    const removed = tracker.check(state, sim.config, { subjects: { containers: [below] } })
    expect(removed.map((v) => v.invariant)).toContain('yard.no-floating')
    expect(checkInvariants(state, sim.config).map((v) => v.invariant)).toContain('yard.no-floating')
  })
})

describe('events declare the boxes they change (what incremental checking relies on)', () => {
  it.each([
    'asc-1sts-10-boxes-1block',
    'asc-2asc-block-conflict',
    'rehandle-random-yard',
    'load-1sts-10-boxes-1block',
    'mixed-discharge-then-load',
    'shc-1sts-2shc-1wtp',
    'truck-gate-queue',
  ])(
    '%s: every container whose custody or yard slot changed is a subject of the event',
    (name) => {
      const sim = createSimulation(fixtures[name])
      const view = () => {
        const { state } = sim.snapshot()
        const custody: Record<string, string> = {}
        for (const c of Object.values(state.containers)) custody[c.id] = `${c.custody.kind}:${c.custody.id}`
        const slotOf: Record<string, string> = {}
        for (const sl of Object.values(state.yardSlots)) if (sl.containerId) slotOf[sl.containerId] = sl.id
        return { custody, slotOf }
      }
      let before = view()
      for (let n = 0; n < 4000; n++) {
        const ev = sim.step()
        if (!ev) break
        const after = view()
        const declared = new Set(ev.subjects.containers ?? [])
        const changed = new Set<string>()
        // a box that did not exist before is new to the tracker, which learns of it from the first event that names it
        for (const id of Object.keys(before.custody)) {
          // a box that leaves the terminal on a truck is held by `external`, which is consistent by construction
          if (after.custody[id]?.startsWith('external:')) continue
          if (before.custody[id] !== after.custody[id] || before.slotOf[id] !== after.slotOf[id]) changed.add(id)
        }
        const undeclared = [...changed].filter((id) => !declared.has(id))
        expect({ event: `${ev.type}#${ev.id}`, undeclared }).toEqual({ event: `${ev.type}#${ev.id}`, undeclared: [] })
        before = after
      }
    },
    120_000,
  )
})
