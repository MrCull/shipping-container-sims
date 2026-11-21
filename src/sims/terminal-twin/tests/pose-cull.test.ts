/**
 * Posing cull (#257): a moving box outside the view is not posed until it could have reached it, and when it is drawn
 * again it is where a fresh full pose puts it. The spreader's carried height and the box owner come from the one pose.
 */
import { describe, expect, it } from 'vitest'
import { closeView, makeHeadlessRenderer, startHeadlessRun } from '../cli/headlessPose'
import { TTI_PRESET_NAME, presets } from '../scenario/presets'
import * as THREE from 'three'
import { DEFAULT_LOD_OPTIONS } from '../modules/containerInstancer'

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
    // Key, size and matrix of every box must match. The LOD (the layer's `-lodN` suffix) is compared only outside the
    // hysteresis band (lod0DistanceM to lod0DistanceM x hysteresis): a box that came within lod0DistanceM during the live
    // loop (a box carried past the camera and set down just beyond it) keeps LOD0 there by design, which a fresh renderer
    // cannot know. #257 is about posing, not LOD.
    const { lod0DistanceM, hysteresis } = DEFAULT_LOD_OPTIONS
    const inBand = (x: (typeof a)[number]) => {
      const m = x.matrix
      const d = Math.hypot(m[12] - view.position.x, m[13] - view.position.y, m[14] - view.position.z)
      return d > lod0DistanceM && d <= lod0DistanceM * hysteresis
    }
    const shown = (x: (typeof a)[number], band: boolean) =>
      `${x.key}|${band ? x.layer.replace(/-lod\d$/, '') : x.layer}|${x.matrix.map((m) => m.toFixed(4))}`
    expect(a.map((x, i) => shown(x, inBand(x) || inBand(b[i])))).toEqual(b.map((x, i) => shown(x, inBand(a[i]) || inBand(x))))
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
