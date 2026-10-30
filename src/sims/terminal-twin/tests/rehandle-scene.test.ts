/**
 * TT-12 rendering: a rehandle is visible in the 3D scene data. The blocking box is lifted out of
 * its stack by the ASC, travels with the spreader (above the stacks), and is set down in its new
 * slot. Driven by real engine deltas through the scene model (seam 3 data, no Three.js).
 */
import { describe, expect, it } from 'vitest'
import { createSimulation } from '../engine'
import { SceneModel } from '../modules/sceneModel'
import { fixtures } from '../scenario/fixtures'
import { createEngineHost } from '../worker/engineHost'
import type { Delta, WorkerRequest } from '../worker/protocol'

const config = fixtures['rehandle-random-yard']

async function modelAt(t: number): Promise<SceneModel> {
  const host = createEngineHost()
  const model = new SceneModel(config, config.seed)
  let rid = 0
  const call = async (req: WorkerRequest) => {
    const reply = await host.handle({ ...req, rid: ++rid })
    if (!reply.ok) throw new Error(reply.error)
    return reply.delta as Delta
  }
  model.apply(await call({ op: 'load', config, seed: config.seed }))
  model.apply(await call({ op: 'run', condition: { time: t } }))
  return model
}

describe('rehandle moves in the 3D scene', () => {
  const sim = createSimulation(config)
  sim.runUntil({ maxEvents: 500_000 })
  const lift = sim.eventLog().find((e) => e.type === 'AscRetrieved' && e.payload.rehandle)
  if (lift?.type !== 'AscRetrieved') throw new Error('the fixture has no rehandle')
  const box = lift.payload.containerId
  const set = sim.eventLog().find((e) => e.type === 'AscStacked' && e.payload.rehandle && e.payload.containerId === box)
  if (set?.type !== 'AscStacked') throw new Error('the rehandle never finished')

  it('the fixture rehandles boxes and still ends', () => {
    expect(sim.status).toBe('ended')
    expect(sim.kpiReport().yard?.rehandles.total).toBeGreaterThan(0)
    expect(set.t).toBeGreaterThan(lift.t)
  })

  it('shows the blocker in its old slot, then carried by the ASC, then in its new slot', async () => {
    const mid = (lift.t + set.t) / 2
    const before = await modelAt(lift.t - 1)
    const during = await modelAt(mid)
    const after = await modelAt(set.t + 1)
    expect(before.custodyAt(box, lift.t - 1)?.kind).toBe('yardSlot')
    expect(before.custodyAt(box, lift.t - 1)?.id).toBe(lift.payload.yardSlotId)
    const carried = during.custodyAt(box, mid)
    expect(carried?.kind).toBe('asc')
    expect(after.custodyAt(box, set.t + 1)).toEqual({ kind: 'yardSlot', id: set.payload.yardSlotId })
    expect(set.payload.yardSlotId).not.toBe(lift.payload.yardSlotId)
    // in the ASC's hands the box moves with the spreader: its pose changes between lift and set-down
    const a = during.containerPose(box, lift.t + 0.5)
    const b = during.containerPose(box, set.t - 0.5)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    const moved = Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.z ?? 0) - (b?.z ?? 0), (a?.y ?? 0) - (b?.y ?? 0))
    expect(moved).toBeGreaterThan(3)
    // it rides above the stacks while travelling
    const midPose = during.containerPose(box, mid)
    expect(midPose?.y).toBeGreaterThan(3 * 2.9)
  })
})
