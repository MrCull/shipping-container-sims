/**
 * Posing cull (#257): a moving box outside the view is not posed until it could have reached it, and when it is drawn
 * again it is where a fresh full pose puts it. The spreader's carried height and the box owner come from the one pose.
 */
import { describe, expect, it } from 'vitest'
import { closeView, makeHeadlessRenderer, startHeadlessRun } from '../cli/headlessPose'
import { TTI_PRESET_NAME, presets } from '../scenario/presets'
import * as THREE from 'three'

describe('pose cull', () => {
  it('skips moving boxes out of view and draws them correctly once they enter it', async () => {
    const run = await startHeadlessRun(presets[TTI_PRESET_NAME]())
    const T0 = 4 * 3600
    await run.runTo(T0 + 1200)
    const model = run.model
    // a box moving at T0
    const moving: string[] = []
    for (const id of model.containerIds) {
      model.containerPose(id, T0)
      if (model.poseRest === 0) moving.push(id)
    }
    expect(moving.length).toBeGreaterThan(3)
    // look at the box that moves the least: the other moving boxes are mostly out of this view
    const first = model.containerCentre(moving[0], T0)!
    const view = closeView(new THREE.Vector3(first.x, first.y, first.z), 60)
    const live = makeHeadlessRenderer(model)
    live.recordDrawnBoxes(true)
    let posedMax = 0
    for (let t = T0; t <= T0 + 1200; t += 10) {
      live.update(t, null, view.position, view.frustum)
      if (t > T0) posedMax = Math.max(posedMax, live.poseCounters().boxesPosed)
    }
    expect(posedMax).toBeLessThan(moving.length)
    const fresh = makeHeadlessRenderer(model)
    fresh.recordDrawnBoxes(true)
    fresh.update(T0 + 1200, null, view.position, view.frustum)
    fresh.update(T0 + 1200, null, view.position, view.frustum)
    live.update(T0 + 1200, null, view.position, view.frustum)
    const key = (b: { key: number }) => b.key
    const a = [...live.drawnBoxes()].sort((x, y) => key(x) - key(y))
    const b = [...fresh.drawnBoxes()].sort((x, y) => key(x) - key(y))
    expect(a.length).toBe(b.length)
    expect(a.map((x) => `${x.key}|${x.layer}|${x.matrix.map((m) => m.toFixed(4))}`)).toEqual(b.map((x) => `${x.key}|${x.layer}|${x.matrix.map((m) => m.toFixed(4))}`))
    live.dispose()
    fresh.dispose()
  }, 120000)

  it('records the custody owner from the pose lookup', async () => {
    const run = await startHeadlessRun(presets[TTI_PRESET_NAME]())
    await run.runTo(4 * 3600)
    const model = run.model
    let checked = 0
    for (const id of model.containerIds) {
      model.containerPose(id, 4 * 3600)
      expect(model.poseOwner).toEqual(model.custodyAt(id, 4 * 3600))
      if (++checked > 2000) break
    }
  }, 120000)
})
