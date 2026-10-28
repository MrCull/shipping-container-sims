/**
 * TT-24: how the renderer drives the ASC GLB rig from the scene model (pure
 * maths, no Three.js), and that it follows the engine's motion segments
 * without clamping. Seam 3 data: the same Delta the worker sends.
 */
import { describe, expect, it } from 'vitest'
import { TIER_PITCH_M, travelHoistM } from '../engine'
import { ASC_MODEL, ascRigValues, ascScaleY } from '../modules/ascRig'
import { SceneModel } from '../modules/sceneModel'
import { fixtures } from '../scenario/fixtures'
import { createEngineHost } from '../worker/engineHost'
import type { Delta, WorkerRequest } from '../worker/protocol'

const HC = 2.896

describe('ascRigValues', () => {
  it('is at rest (hoist 0, ropes at their rest length) with the plane raised and the trolley centred', () => {
    const v = ascRigValues({ trolleyX: 0, gantryZ: 12, attachY: ASC_MODEL.restAttachY, carrying: false, scaleY: 1 })
    expect(v.hoistM).toBe(0)
    expect(v.ropeScale).toBeCloseTo(2.2, 6) // 1 m of rope mesh scaled to the 2.2 m between the drums and the head block
    expect(v.trolleyX).toBe(0)
    expect(v.gantryZ).toBe(12)
    expect(v.twistRad).toBe(0)
  })

  it('lowers the hoist to the top of a high-cube box on the ground and stretches the ropes to match', () => {
    const v = ascRigValues({ trolleyX: 10.15, gantryZ: 0, attachY: HC, carrying: true, scaleY: 1 })
    expect(v.hoistM).toBeCloseTo(HC - ASC_MODEL.restAttachY, 6)
    expect(v.hoistM).toBeCloseTo(ASC_MODEL.hoistMinM, 3)
    const ropeLen = ASC_MODEL.ropeTopY - (HC + ASC_MODEL.headblockTopAboveAttachM)
    expect(v.ropeScale).toBeCloseTo(ropeLen / ASC_MODEL.ropeUnitM, 6)
    expect(v.twistRad).toBeCloseTo(Math.PI / 2, 6) // locked while carrying
  })

  it('clamps to the sidecar travel limits', () => {
    const v = ascRigValues({ trolleyX: 99, gantryZ: 0, attachY: -5, carrying: false, scaleY: 1 })
    expect(v.trolleyX).toBe(ASC_MODEL.trolleyMaxM)
    expect(v.hoistM).toBe(ASC_MODEL.hoistMinM)
    expect(ascRigValues({ trolleyX: 0, gantryZ: 0, attachY: 99, carrying: false, scaleY: 1 }).hoistM).toBe(0)
  })
})

describe('ascScaleY (blocks taller than the model was built for)', () => {
  it('is 1 up to the design stack height and grows with the engine hoist travel above it', () => {
    for (const tiers of [1, 3, 5]) expect(ascScaleY(tiers)).toBe(1)
    expect(ASC_MODEL.designTiers).toBe(5)
    const s8 = ascScaleY(8)
    expect(s8).toBeGreaterThan(1.3)
    // The raised plane of the stretched model is the engine's top of travel plus a box.
    expect(ASC_MODEL.restAttachY * s8).toBeCloseTo(travelHoistM({ tiers: 8 }) + HC, 6)
  })

  it('a carried box over a 5-high stack stays inside the hoist range (engine travel height)', () => {
    const plane = travelHoistM({ tiers: 5 }) + HC
    expect(plane).toBeLessThanOrEqual(ASC_MODEL.restAttachY)
    expect(5 * TIER_PITCH_M + HC).toBeLessThan(ASC_MODEL.bridgeUnderY)
  })
})

describe('the rig follows the engine without clamping', () => {
  it('every sampled pose of a full ASC run maps to unclamped rig values', async () => {
    const config = fixtures['asc-1sts-10-boxes-1block']
    const h = createEngineHost()
    let rid = 0
    const call = async (req: WorkerRequest) => {
      const reply = await h.handle({ ...req, rid: ++rid })
      if (!reply.ok) throw new Error(reply.error)
      return reply.delta as Delta
    }
    await call({ op: 'load', config, seed: config.seed })
    const model = new SceneModel(config, config.seed)
    let end = 0
    // Drive in slices so the delta carries each ASC trip's motion (same path as the browser).
    for (let t = 300; t < 40000; t += 300) {
      const delta = await call({ op: 'advance', to: t })
      model.apply(delta)
      end = t
      if (delta.eventCounts && Object.keys(delta.eventCounts).length === 0 && t > 6000) break
    }
    const ascId = model.ascIds[0]
    const block = model.blockOfAsc(ascId)
    const scale = ascScaleY(block.tiers)
    let samples = 0
    let minHoist = 0
    let maxTrolley = 0
    for (let t = 0; t <= end; t += 2) {
      const pose = model.ascPose(ascId, t)
      const v = ascRigValues({ trolleyX: pose.x - block.x, gantryZ: pose.z, attachY: pose.hoistY + HC, carrying: false, scaleY: scale })
      // Unclamped: the rig value equals what the pose asks for.
      expect(v.hoistM).toBeCloseTo(Math.min(0, Math.max(ASC_MODEL.hoistMinM, (pose.hoistY + HC) / scale - ASC_MODEL.restAttachY)), 9)
      expect(v.hoistM).toBeGreaterThan(ASC_MODEL.hoistMinM - 1e-9)
      expect((pose.hoistY + HC) / scale - ASC_MODEL.restAttachY).toBeLessThanOrEqual(1e-6)
      expect(Math.abs(pose.x - block.x)).toBeLessThanOrEqual(ASC_MODEL.trolleyMaxM)
      expect(v.ropeScale).toBeGreaterThan(0)
      minHoist = Math.min(minHoist, v.hoistM)
      maxTrolley = Math.max(maxTrolley, Math.abs(v.trolleyX))
      samples++
    }
    expect(samples).toBeGreaterThan(100)
    expect(minHoist).toBeLessThan(-5) // the ASC really lowered the spreader during the run
    expect(maxTrolley).toBeGreaterThan(3) // and really traversed the rows
  })
})
