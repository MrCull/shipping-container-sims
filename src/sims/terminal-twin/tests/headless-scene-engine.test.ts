/**
 * #333 (spec #320): the engine group's scene checks, moved from the browser smoke specs to the headless scene
 * (`cli/headlessScene.ts`). Engine facts (golden hash, KPIs, custody chains, invariants) are covered by `golden.test.ts`,
 * `asc-yard.test.ts`, `export-load.test.ts`, `shc-transport.test.ts`, `asc-paired.test.ts` and `rehandle*.test.ts`; the
 * browser keeps one worker round trip (`terminal-twin-asc.smoke.ts`). Was: `terminal-twin-asc.smoke.ts`,
 * `terminal-twin-paired-asc.smoke.ts`, `terminal-twin-load.smoke.ts`, `terminal-twin-rehandle.smoke.ts`,
 * `terminal-twin-shc.smoke.ts`, `terminal-twin-landside.smoke.ts`. The mapping is in the #333 PR body.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { ContainerState } from '../engine'
import { headlessScene, type HeadlessScene } from '../cli/headlessScene'
import { NO_OVERLAYS } from '../modules/overlays'

const open: HeadlessScene[] = []
async function scene(name: string): Promise<HeadlessScene> {
  const s = await headlessScene(name)
  open.push(s)
  return s
}
afterEach(() => {
  for (const s of open.splice(0)) s.dispose()
})

type Box = { id: string; custody: { kind: string; id: string } }
type Crane = { id: string; status: string; carrying: string | null }
const containers = (s: HeadlessScene) => s.controller.query<Box[]>('containers')

describe('headless scene: ASC import fixture (was terminal-twin-asc.smoke.ts)', () => {
  it('draws one ASC and, at the end, every box in a yard slot', async () => {
    const s = await scene('asc-1sts-10-boxes-1block')
    expect((await s.runUntil({})).reason).toBe('ended')
    expect(s.stats().ascs).toBe(1)
    const boxes = await containers(s)
    expect(boxes).toHaveLength(10)
    const state = s.sceneState()
    for (const { id } of boxes) expect(state.containers[id]!.kind, id).toBe('yardSlot')
  })

  it('paused mid-cycle, the scene shows the ASC where the engine has it and the box in its spreader', async () => {
    const s = await scene('asc-1sts-10-boxes-1block')
    await s.runUntil({ eventType: 'AscRoutingToSlot' })
    const ascs = await s.controller.query<Crane[]>('ascList')
    expect(ascs).toHaveLength(1)
    const state = s.sceneState()
    expect(state.ascs[ascs[0].id].status).toBe(ascs[0].status)
    expect(state.containers[ascs[0].carrying as string]).toEqual({ kind: 'asc', id: ascs[0].id })
  })

  it('the spreader follows the planned hoist: it is down at the pad and raised in travel', async () => {
    const s = await scene('asc-1sts-10-boxes-1block')
    await s.runUntil({ eventType: 'AscPicked' })
    expect(s.sceneState().ascs['B01-ASC1'].hoistY).toBeCloseTo(0, 3)
    await s.runUntil({ eventType: 'AscPositioningAtSlot' })
    expect(s.sceneState().ascs['B01-ASC1'].hoistY).toBeGreaterThan(5) // travel height over the stacks
  })
})

describe('headless scene: two ASCs per block (was terminal-twin-paired-asc.smoke.ts)', () => {
  const gap = (s: HeadlessScene) => {
    const a = s.sceneState().ascs
    return a['B01-ASC2'].z - a['B01-ASC1'].z
  }

  it('draws both ASCs of the block, 12 m apart at the end', async () => {
    const s = await scene('asc-2asc-block-conflict')
    expect((await s.runUntil({})).reason).toBe('ended')
    expect(s.stats().ascs).toBe(2)
    expect(Object.keys(s.sceneState().ascs)).toEqual(['B01-ASC1', 'B01-ASC2'])
    expect(gap(s)).toBeGreaterThanOrEqual(12 - 1e-6)
  })

  it('keeps the two ASCs 12 m apart at every step, also after a yield', async () => {
    const s = await scene('asc-2asc-block-conflict')
    for (let i = 0; i < 25; i++) {
      await s.step()
      expect(gap(s), `step ${i}`).toBeGreaterThanOrEqual(12 - 1e-6)
    }
    await s.runUntil({ eventType: 'AscYieldAssigned' })
    for (let i = 0; i < 15; i++) {
      await s.step()
      expect(gap(s), `after yield ${i}`).toBeGreaterThanOrEqual(12 - 1e-6)
    }
  })

  it('the ASC rail overlay draws the reserved segments and follows the display time', async () => {
    const s = await scene('asc-2asc-block-conflict')
    await s.runUntil({ eventType: 'AscJobAssigned' })
    s.setOverlays({ ...NO_OVERLAYS })
    expect(s.stats().reservedRailSegments).toBe(0)
    s.setOverlays({ ...NO_OVERLAYS, ascRail: true })
    const rail = (): string[] => Object.keys(s.sceneState().reservations).filter((z) => /^B01:R\d+$/.test(z))
    const heldEarly = rail()
    expect(heldEarly.length).toBeGreaterThan(0)
    expect(s.stats().reservedRailSegments).toBe(heldEarly.length)

    await s.runUntil({ eventType: 'AscYieldAssigned' })
    await s.runUntil({ eventType: 'AscReady' })
    const heldLater = rail()
    expect(heldLater.join()).not.toBe(heldEarly.join())
    expect(s.stats().reservedRailSegments).toBe(heldLater.length)
  })
})

describe('headless scene: export load (was terminal-twin-load.smoke.ts)', () => {
  it('export boxes start in the stacks and end in their vessel slots', async () => {
    const s = await scene('load-1sts-10-boxes-1block')
    const boxes = await containers(s)
    expect(boxes).toHaveLength(10)
    const start = s.sceneState()
    for (const { id } of boxes) expect(start.containers[id]!.kind, id).toBe('yardSlot')
    expect((await s.runUntil({})).reason).toBe('ended')
    const end = s.sceneState()
    for (const { id } of boxes) expect(end.containers[id]!.kind, id).toBe('vesselSlot')
  })

  it('paused mid-load, the scene shows an SHC carrying an export box and the engine agrees', async () => {
    const s = await scene('load-1sts-10-boxes-1block')
    await s.runUntil({ eventType: 'ShcPickedAtWtp' })
    const carrier = (await s.controller.query<Crane[]>('shcList')).find((c) => c.carrying)
    expect(carrier).toBeDefined()
    expect(s.sceneState().containers[carrier!.carrying as string]).toEqual({ kind: 'shc', id: carrier!.id })
  })
})

describe('headless scene: rehandle (was terminal-twin-rehandle.smoke.ts)', () => {
  it('the ASC lifts a blocker out of its stack, carries it and sets it down in another slot', async () => {
    const s = await scene('rehandle-random-yard')
    await s.runUntil({ eventType: 'RehandleRequired' })
    // the next lift is the rehandle's (the block's ASC was idle when the decision was asked)
    await s.runUntil({ eventType: 'AscRetrieved' })
    const asc = (await s.controller.query<Crane[]>('ascList')).find((a) => a.carrying)
    expect(asc).toBeDefined()
    const box = asc!.carrying as string
    expect(s.sceneState().containers[box]).toEqual({ kind: 'asc', id: asc!.id })
    const history = (await s.controller.query<ContainerState>('container', box)).custodyHistory
    const oldSlot = history[history.length - 2].owner
    expect(oldSlot.kind).toBe('yardSlot')

    await s.runUntil({ eventType: 'AscStacked' })
    const set = s.sceneState().containers[box]!
    expect(set.kind).toBe('yardSlot')
    expect(set.id).not.toBe(oldSlot.id)
  })
})

describe('headless scene: SHC fixture (was terminal-twin-shc.smoke.ts)', () => {
  it('draws one SHC per engine SHC, every box, and each SHC in its engine status', async () => {
    const s = await scene('shc-1sts-2shc-1wtp')
    expect((await s.runUntil({})).reason).toBe('ended')
    const shcs = await s.controller.query<Crane[]>('shcList')
    const stats = s.stats()
    expect(stats.shcs).toBe(shcs.length)
    expect(stats.shcs).toBe(2)
    expect(stats.containers).toBe((await containers(s)).length)
    const state = s.sceneState()
    for (const shc of shcs) expect(state.shcs[shc.id].status).toBe(shc.status)
  })

  it('paused mid-trip, the scene shows each SHC and box where the engine has them', async () => {
    const s = await scene('shc-1sts-2shc-1wtp')
    await s.runUntil({ eventType: 'ShcRoutingLoaded' })
    const state = s.sceneState()
    const boxes = await containers(s)
    for (const box of boxes) expect(state.containers[box.id], box.id).toEqual(box.custody)
    for (const shc of await s.controller.query<Crane[]>('shcList')) expect(state.shcs[shc.id].status).toBe(shc.status)
    expect(boxes.some((b) => b.custody.kind === 'shc')).toBe(true)
  })
})

describe('headless scene: landside (was terminal-twin-landside.smoke.ts)', () => {
  it('trucks are drawn, queue at the gate, stand in stalls and exit', async () => {
    const s = await scene('truck-gate-queue')
    await s.runTo(3300)
    const queued = s.stats().landside
    expect(queued.trucks).toBeGreaterThan(5)
    expect(queued.queued).toBeGreaterThan(3) // a visible queue at the gate

    await s.runUntil({ eventType: 'TruckAtStall' })
    const stalled = Object.values(s.sceneState().trucks).find((t) => t.status === 'at-stall')
    expect(stalled?.visible).toBe(true)

    await s.runUntil({ eventType: 'TruckDeparted' })
    expect(Object.values(s.sceneState().trucks).some((t) => !t.visible || t.status === 'gone')).toBe(true)
  })

  it('holding positions are drawn and admitted trucks wait in them off the roads (TT-R16)', async () => {
    const s = await scene('truck-holding-overflow')
    expect(s.stats().landside.holdingPositions).toBe(2)
    await s.runUntil({ eventType: 'TruckHeldOutside' })
    await s.runUntil({ eventType: 'TruckAtHolding' })
    expect(s.stats().landside.holding).toBeGreaterThanOrEqual(1)
    const trucks = Object.values(s.sceneState().trucks)
    const waiting = trucks.filter((t) => t.status === 'holding')
    expect(waiting.length).toBeGreaterThan(0)
    expect(waiting.every((t) => t.visible)).toBe(true)
    expect(trucks.some((t) => t.status === 'queued')).toBe(true) // the overflow waits at the gate
    expect((await s.runUntil({ eventType: 'TruckDeparted' })).reason).toBe('condition')
  })
})
