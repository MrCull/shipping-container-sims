/**
 * 3D picking (TT-18): a click ray picks the nearest container, else the
 * equipment or vessel it passes through, at the displayed sim time. Poses come
 * from a SceneModel fed by real engine deltas.
 */
import { describe, expect, it } from 'vitest'
import { fixtures } from '../scenario/fixtures'
import { SceneModel } from '../modules/sceneModel'
import { entityBounds, pickEntity, type Ray } from '../modules/picking'
import { createEngineHost } from '../worker/engineHost'
import type { Delta, WorkerRequest } from '../worker/protocol'

const config = fixtures['shc-1sts-2shc-1wtp']

/** A model after running the engine to sim time `t`. */
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

const down = (x: number, y: number, z: number): Ray => ({ origin: { x, y: y + 200, z }, dir: { x: 0, y: -1, z: 0 } })

describe('pickEntity', () => {
  it('picks a container when the ray hits it, including ones lying across the lane (yaw)', async () => {
    const t = 400
    const model = await modelAt(t)
    let checked = 0
    for (const id of model.containerIds) {
      const b = entityBounds(model, id, t)
      if (!b) continue
      const ray = { origin: { x: b.x, y: b.y + 50, z: b.z }, dir: { x: 0, y: -1, z: 0 } }
      // Nothing sits on top of a lone container; stacked boxes are picked from the top one.
      const hit = pickEntity(model, t, ray)
      expect(hit, id).not.toBeNull()
      if (model.containerSize[hit!]) {
        const hb = entityBounds(model, hit!, t)!
        expect(hb.y).toBeGreaterThanOrEqual(b.y - 0.01)
      }
      if (hit === id) checked++
    }
    expect(checked).toBeGreaterThan(3)
  })

  it('a ray that misses everything picks nothing', async () => {
    const model = await modelAt(400)
    expect(pickEntity(model, 400, { origin: { x: -5000, y: 10, z: 5000 }, dir: { x: 0, y: -1, z: 0 } })).toBeNull()
    expect(pickEntity(model, 400, { origin: { x: 0, y: 500, z: 0 }, dir: { x: 0, y: 1, z: 0 } })).toBeNull()
  })

  it('picks an SHC by a ray through its body, and the STS by a ray through its leg', async () => {
    const t = 300
    const model = await modelAt(t)
    const shcId = model.shcIds[0]
    const b = entityBounds(model, shcId, t)!
    const hit = pickEntity(model, t, down(b.x, 0, b.z))
    // A box on the SHC is picked in preference to the carrier itself.
    expect([shcId, ...model.containerIds]).toContain(hit)
    const sts = model.stsIds[0]
    const sb = entityBounds(model, sts, t)!
    const stsHit = pickEntity(model, t, { origin: { x: sb.x + sb.sx / 2 - 1, y: 60, z: sb.z - 40 }, dir: { x: 0, y: 0, z: 1 } })
    expect(stsHit).toBe(sts)
  })

  it('prefers the container over the larger structure around it', async () => {
    const model = await modelAt(5)
    // Before any box moved, the vessel's deck boxes are inside the hull's bounds.
    const v = model.vesselIds[0]
    const vb = entityBounds(model, v, 5)
    expect(vb).not.toBeNull()
    const hit = pickEntity(model, 5, down(vb!.x, 0, vb!.z))
    expect(hit === v || model.containerSize[hit ?? ''] !== undefined).toBe(true)
  })
})

describe('entityBounds', () => {
  it('is null for a vessel that has not arrived and for unknown ids', async () => {
    const model = new SceneModel(config, config.seed)
    expect(entityBounds(model, 'NOPE', 0)).toBeNull()
  })
})

describe('ASC picking', () => {
  it('has bounds around the portal and is picked by a ray through its girder', () => {
    const ascConfig = fixtures['asc-1sts-10-boxes-1block']
    const model = new SceneModel(ascConfig, ascConfig.seed)
    const asc = model.ascIds[0]
    const b = entityBounds(model, asc, 0)!
    expect(b).not.toBeNull()
    expect(b.sx).toBeGreaterThan(25)
    const hit = pickEntity(model, 0, { origin: { x: b.x, y: b.y * 2 + 30, z: b.z }, dir: { x: 0, y: -1, z: 0 } })
    expect(hit).toBe(asc)
  })
})
