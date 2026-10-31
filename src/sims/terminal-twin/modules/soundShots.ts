/**
 * Sound shots (#129): short moments (twistlock clunk, landing thud, air brake) as mixer sources. The scene model reports
 * the moments in the display-time window since the last frame; each becomes a source that stays for a wall-clock beat,
 * long enough for the mixer to start its one-shot voice, whatever the playback speed. No state beyond that, no audio.
 */
import type { SoundShot } from './sceneModel'
import type { SoundSource } from './soundMixer'

/** How long (wall ms) a moment stays a source: a few frames, so the voice is always started. */
export const SHOT_MS = 300
/** A frame spanning more display seconds than this is a seek, not playback: its moments are not heard. */
const JUMP_S = 120

interface Active {
  source: SoundSource
  until: number
}

export class ShotTracker {
  private lastT: number | null = null
  private active = new Map<string, Active>()

  /** Appends this frame's shot sources to `out`. `live` is false while the sim clock is paused. */
  update(model: { shotsBetween(t0: number, t1: number): SoundShot[] }, t: number, live: boolean, nowMs: number, out: SoundSource[]): void {
    const prev = this.lastT
    this.lastT = live ? t : null
    if (live && prev !== null && t >= prev && t - prev <= JUMP_S) {
      for (const s of model.shotsBetween(prev, t)) {
        // one voice per machine and sound (locking and unlocking are the same clunk)
        const kind = s.motion === 'landing' ? 'landing' : s.motion === 'braking' ? 'braking' : 'lock'
        this.active.set(`${kind}:${s.machine}:${s.id}`, {
          source: { id: s.id, machine: s.machine, x: s.x, y: s.y, z: s.z, motion: s.motion },
          until: nowMs + SHOT_MS,
        })
      }
    }
    for (const [key, a] of this.active) {
      if (!live || a.until < nowMs) this.active.delete(key)
      else out.push(a.source)
    }
  }
}
