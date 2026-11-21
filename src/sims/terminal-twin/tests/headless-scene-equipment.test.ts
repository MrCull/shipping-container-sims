/**
 * #337 (spec #320): the equipment group's scene checks, moved from the browser smoke specs to the headless scene
 * (`cli/headlessScene.ts`). The headless scene loads no GLBs, so these read the poses the scene model hands the rigs
 * (`sceneState().ascs`, `.shcs`) and the gantry beacons (`stats().gantryBeacons`); what the rigs do with a pose is unit
 * tested on its own (`asc-rig.test.ts`, `shc-pose.test.ts`, `truck-pose.test.ts`, `spreader-mode.test.ts`,
 * `gantry-beacons.test.ts`, `positional-sound.test.ts`, `hero-equipment-selection.test.ts`). Was: the SHC spawn test of
 * `spreader-spawn.smoke.ts` and the beacon half of `gantry-alarm.smoke.ts`. The mapping is in the #337 PR body.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { headlessScene, type HeadlessScene } from '../cli/headlessScene'

const open: HeadlessScene[] = []
async function scene(name: string): Promise<HeadlessScene> {
  const s = await headlessScene(name)
  open.push(s)
  return s
}
afterEach(() => {
  for (const s of open.splice(0)) s.dispose()
})

describe('headless scene: SHC spawn (was spreader-spawn.smoke.ts)', () => {
  it('each SHC faces its first leg before it moves: no turn on the first move', async () => {
    const s = await scene('shc-1sts-2shc-1wtp')
    // run first, then sample the poses the scene draws: playback has the motion segments ahead of the display time too
    await s.runTo(300)
    const model = s.controller.model!
    const ids = Object.keys(s.sceneState().shcs)
    expect(ids).toHaveLength(2)
    let moved = 0
    for (const id of ids) {
      const travelling = (t: number) => model.shcPose(id, t).travelling
      let hi = 0.1
      while (hi <= 300 && !travelling(hi)) hi += 0.1
      if (hi > 300) continue
      // the moment it pulls away, to a microsecond
      let lo = hi - 0.1
      while (hi - lo > 1e-6) {
        const mid = (lo + hi) / 2
        if (travelling(mid)) hi = mid
        else lo = mid
      }
      moved++
      const standing = model.shcPose(id, lo)
      const off = model.shcPose(id, hi)
      // the yaw it stood at is the yaw it drives off at, and it does not steer while it pulls away
      expect(off.yaw, id).toBeCloseTo(standing.yaw, 6)
      expect(Math.abs(off.steerRad), id).toBeLessThan(1e-5)
    }
    expect(moved).toBeGreaterThan(0)
  })
})

describe('headless scene: gantry beacons (was gantry-alarm.smoke.ts)', () => {
  it('beacons are active for exactly the gantrying cranes, flash on and off, and are dark when no crane gantries', async () => {
    const s = await scene('asc-1sts-10-boxes-1block')
    expect(s.stats().gantryBeacons).toEqual({ gantrying: [], lit: [] })
    s.setLive(true) // playback running: cranes only gantry (beacons, alarm) while the clock moves
    let on = false
    let off = false
    let gantried = 0
    for (let t = 0.1; t <= 900 && !(on && off && gantried > 3); t += 0.1) {
      await s.runTo(t)
      const state = s.sceneState()
      const beacons = s.stats().gantryBeacons
      const gantrying = [...Object.entries(state.sts), ...Object.entries(state.ascs)].filter(([, v]) => v.gantrying).map(([k]) => k)
      expect([...beacons.gantrying].sort(), `t ${t}`).toEqual(gantrying.sort())
      expect(beacons.lit.every((l) => beacons.gantrying.includes(l)), `t ${t}`).toBe(true)
      if (gantrying.length > 0) {
        gantried++
        if (beacons.lit.length > 0) on = true
        else off = true
      }
    }
    expect(gantried).toBeGreaterThan(0)
    expect(on && off).toBe(true)
    // paused: no beacons, even mid-gantry
    s.setLive(false)
    expect(s.stats().gantryBeacons).toEqual({ gantrying: [], lit: [] })
  })
})
