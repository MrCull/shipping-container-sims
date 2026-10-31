/**
 * #129: the shot tracker turns the model's sound moments into short-lived mixer sources. A moment between two frames
 * sounds once for a wall-clock beat (so it is heard at any playback speed), and nothing sounds after a jump or a pause.
 */
import { describe, expect, it } from 'vitest'
import type { SoundShot } from '../modules/sceneModel'
import { SHOT_MS, ShotTracker } from '../modules/soundShots'
import type { SoundSource } from '../modules/soundMixer'

const shot = (t: number, motion: SoundShot['motion'], id = 'S1', machine: SoundShot['machine'] = 'sts'): SoundShot => ({ t, machine, id, motion, x: 1, y: 2, z: 3 })
const model = (shots: SoundShot[]) => ({ shotsBetween: (t0: number, t1: number) => shots.filter((s) => s.t > t0 && s.t <= t1) })
const run = (tr: ShotTracker, m: ReturnType<typeof model>, t: number, now: number, live = true) => {
  const out: SoundSource[] = []
  tr.update(m, t, live, now, out)
  return out
}

describe('ShotTracker', () => {
  it('turns a moment in the frame window into a source that lasts a wall-clock beat', () => {
    const tr = new ShotTracker()
    const m = model([shot(10.5, 'locking')])
    expect(run(tr, m, 10, 0)).toEqual([]) // first frame: nothing before it
    const out = run(tr, m, 11, 16)
    expect(out).toEqual([{ id: 'S1', machine: 'sts', x: 1, y: 2, z: 3, motion: 'locking' }])
    expect(run(tr, m, 11.02, 16 + SHOT_MS - 1)).toHaveLength(1)
    expect(run(tr, m, 11.04, 16 + SHOT_MS + 1)).toEqual([])
  })

  it('does not repeat a moment on later frames, and finds one inside a long frame (fast playback)', () => {
    const tr = new ShotTracker()
    const m = model([shot(30, 'landing')])
    run(tr, m, 10, 0)
    expect(run(tr, m, 40, 16).map((s) => s.motion)).toEqual(['landing'])
    expect(run(tr, m, 41, SHOT_MS + 100)).toEqual([])
  })

  it('keeps one source per machine and sound, the latest, so voice keys never collide', () => {
    const tr = new ShotTracker()
    const m = model([shot(11, 'locking'), shot(11.5, 'unlocking'), shot(11.5, 'landing')])
    run(tr, m, 10, 0)
    const out = run(tr, m, 12, 16)
    expect(out.map((s) => s.motion).sort()).toEqual(['landing', 'unlocking'])
  })

  it('stays silent on a jump, a rewind, or while the clock is paused, and resumes after', () => {
    const tr = new ShotTracker()
    const m = model([shot(500, 'locking'), shot(1000.5, 'locking', 'S2')])
    run(tr, m, 10, 0)
    expect(run(tr, m, 900, 16)).toEqual([]) // seek forward
    expect(run(tr, m, 5, 32)).toEqual([]) // rewind
    expect(run(tr, m, 1000, 48, false)).toEqual([]) // paused
    expect(run(tr, m, 1001, 64).map((s) => s.id)).toEqual([]) // first live frame after the pause has no window
    const m2 = model([shot(1001.5, 'locking', 'S3')])
    expect(run(tr, m2, 1002, 80).map((s) => s.id)).toEqual(['S3'])
  })
})
