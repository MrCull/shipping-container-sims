/**
 * Sound effects (TT-21): the repo's existing samples (container landed, vessel
 * horn on arrival and departure, scenario-complete chime). No music. Every sound
 * is scaled by one master gain (the shared volume and mute, `stores/audio.ts`);
 * at gain 0 nothing is created. Audio elements are created lazily, and playback
 * is throttled by speed (`modules/cues.ts`). A blocked or failing
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
  private active = new Set<{ audio: HTMLAudioElement; base: number }>()
  /** `masterGain` reads the shared volume (0 while muted). */
  constructor(private masterGain: () => number = () => 1) {}

  private throttle = new SoundThrottle()
  private log: PlayedSound[] = []
  private played = 0

  /** Play the sound of a cue unless throttled. Returns whether it played. */
  play(cue: Cue, speed: number, nowMs: number): boolean {
    if (this.masterGain() <= 0) return false
    if (!this.throttle.allow(cue.kind, speed, nowMs)) return false
    this.played++
    this.log.push({ kind: cue.kind, large: !!cue.large, simT: cue.t })
    if (this.log.length > LOG_CAP) this.log.shift()
    try {
      const url = cue.kind === 'landed' ? urls.landed : cue.kind === 'complete' ? urls.complete : cue.large ? urls.hornLarge : urls.hornSmall
      const audio = new Audio(url)
      const entry = { audio, base: cue.kind === 'landed' ? 0.35 : 0.5 }
      audio.volume = entry.base * this.clampedGain()
      this.active.add(entry)
      const done = () => this.active.delete(entry)
      audio.onended = done
      void audio.play().catch(done)
      if (cue.kind === 'horn') {
        setTimeout(() => {
          audio.pause()
          done()
        }, HORN_MS)
      }
    } catch {
      // no audio support
    }
    return true
  }

  private clampedGain(): number {
    return Math.min(1, Math.max(0, this.masterGain()))
  }

  /** The master gain changed: retune the sounds still playing. */
  applyGain(): void {
    const gain = this.clampedGain()
    for (const { audio, base } of this.active) audio.volume = base * gain
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
