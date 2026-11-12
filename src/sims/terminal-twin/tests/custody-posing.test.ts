/**
 * Posing by custody (#250): a box at rest is posed when its custody changes, not every frame. Paused, nothing is posed
 * and nothing is uploaded; playing, only the boxes whose custody changed, the carried ones and a moved vessel's are.
 * What is drawn is pinned by `drawn-boxes.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { makeHeadlessRenderer, overviewView, startHeadlessRun } from '../cli/headlessPose'
import { fixtures } from '../scenario/fixtures'

describe('posing by custody', async () => {
  const run = await startHeadlessRun(fixtures['two-vessels-compete-for-berth'])
  await run.runTo(6000)
  const renderer = makeHeadlessRenderer(run.model)
  const view = overviewView(run.model)
  const frame = (t: number) => {
    renderer.update(t, null, view.position, view.frustum)
    return renderer.poseCounters()
  }

  it('the first frame poses every box, a repeat at the same time poses none and uploads nothing', () => {
    const first = frame(1800)
    expect(first.boxesPosed).toBe(run.model.containerIds.length)
    expect(first.instanceBytes).toBeGreaterThan(0)
    const again = frame(1800)
    expect(again.boxesPosed).toBe(0)
    expect(again.instanceBytes).toBe(0)
  })

  it('playing poses no more than the boxes whose custody changed, the carried ones and a moved vessel boxes', () => {
    frame(1800)
    let total = 0
    for (let t = 1801; t < 3600; t += 1) {
      const changed = run.model.custodyChanges(t - 1, t, run.model.custodyLogLength()).length
      let carried = 0
      for (const id of run.model.containerIds) {
        run.model.containerPose(id, t)
        if (run.model.poseRest === 0) carried++
      }
      const posed = frame(t).boxesPosed
      total += posed
      expect(posed).toBeLessThanOrEqual(changed + carried + 1500)
    }
    expect(total).toBeLessThan(run.model.containerIds.length * 1799 * 0.1)
  })
})
