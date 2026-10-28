/**
 * Sound effects (TT-21): the repo's existing samples (container landed, vessel
 * horn on arrival and departure, scenario-complete chime). No music. The player
 * is only used while the sound toggle is on, creates audio elements lazily,
 * and throttles by playback speed (`modules/cues.ts`). A blocked or failing
 * play() is swallowed: sound is never worth an error.
 */
import { SoundThrottle, type Cue, type CueKind } from './cues'

const urls = {
  landed: new URL('../assets/sounds/container-landed.mp3', import.meta.url).href,
  hornSmall: new URL('../assets/sounds/horn-small.mp3', import.meta.url).href,
  hornLarge: new URL('../assets/sounds/horn-large.mp3', import.meta.url).href,
  complete: new URL('../assets/sounds/scenario-complete.mp3', import.meta.url).href,
}

/** The samples hold three horn blasts: cut them to one short one. */
const HORN_MS = 1700
const LOG_CAP = 200

export interface PlayedSound {
  kind: CueKind
  large: boolean
  simT: number
}

export class SoundPlayer {
  private throttle = new SoundThrottle()
  private log: PlayedSound[] = []
  private played = 0

  /** Play the sound of a cue unless throttled. Returns whether it played. */
  play(cue: Cue, speed: number, nowMs: number): boolean {
    if (!this.throttle.allow(cue.kind, speed, nowMs)) return false
    this.played++
    this.log.push({ kind: cue.kind, large: !!cue.large, simT: cue.t })
    if (this.log.length > LOG_CAP) this.log.shift()
    try {
      const url = cue.kind === 'landed' ? urls.landed : cue.kind === 'complete' ? urls.complete : cue.large ? urls.hornLarge : urls.hornSmall
      const audio = new Audio(url)
      audio.volume = cue.kind === 'landed' ? 0.35 : 0.5
      void audio.play().catch(() => {})
      if (cue.kind === 'horn') setTimeout(() => audio.pause(), HORN_MS)
    } catch {
      // no audio support
    }
    return true
  }

  /** Dev/test view: how many sounds played and the most recent ones. */
  stats(): { played: number; recent: PlayedSound[] } {
    return { played: this.played, recent: [...this.log] }
  }

  reset(): void {
    this.throttle.reset()
    this.log = []
    this.played = 0
  }
}
