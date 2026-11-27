/**
 * Yardshift audio cues (#388): a pure mapping from engine steps to sounds, so every outcome fires its sound exactly
 * once (one engine event, clock thresholds included), never per frame. Tones are V20's synth cues
 * (`tone(f0, f1, dur, vol, delay, type)`); `vol` is the sound's own gain at full volume, scaled by the shared `sfx`
 * channel through `gainFor` when played (composables/useYardAudio.ts). Samples are short clips in assets/audio/.
 */
import { SHIFT_LOW_SECONDS } from './engine'
import type { ShiftEvent, ShiftState } from '../types/engine'

export type ToneType = 'sine' | 'triangle' | 'square' | 'sawtooth'

/** One oscillator: frequency f0 ramping to f1 over `dur` s, peak gain `vol` (0..1), starting `delay` s from now. */
export interface Tone {
  f0: number
  f1: number
  dur: number
  vol: number
  delay: number
  type: ToneType
}

export type SampleName = 'pick' | 'land' | 'truck'

export type CueName =
  | 'crane-start'
  | 'pick'
  | 'land'
  | 'invalid'
  | 'rehandle'
  | 'collect'
  | 'receive'
  | 'combo'
  | 'bonus-window'
  | 'jackpot'
  | 'bonus-missed'
  | 'arrival'
  | 'deadline-one'
  | 'deadline-zero'
  | 'truck-low'
  | 'overtime-start'
  | 'overtime-end'
  | 'shift-tick'
  | 'win'
  | 'timeout'
  | 'blocked'
  | 'undo'

export interface Cue {
  name: CueName
  tones: Tone[]
  /** A sample played with the tones, at `sampleGain` (its own gain at full volume). */
  sample?: SampleName
  sampleGain?: number
  /** The combo length for `combo`, the threshold in seconds for `shift-tick`. */
  detail?: number
}

/** Shift seconds left at which a tick sounds: the engine's `shift-low` thresholds. */
export const SHIFT_TICK_SECONDS = SHIFT_LOW_SECONDS
/** The combo ladder stops rising here. */
export const COMBO_LADDER_TOP = 8

function tone(f0: number, f1: number, dur = 0.09, vol = 0.035, delay = 0, type: ToneType = 'sine'): Tone {
  return { f0, f1, dur, vol, delay, type }
}

const FANFARE = [523.25, 659.25, 783.99, 1046.5, 1318.5]

export function rejectionCue(): Cue {
  return { name: 'invalid', tones: [tone(150, 80)] }
}

/** The crane accepted a move: a short motor whine. */
export function craneStartCue(): Cue {
  return { name: 'crane-start', tones: [tone(92, 140, 0.28, 0.02, 0, 'triangle')] }
}

/** The combo ladder: pitch rises with the combo length up to `COMBO_LADDER_TOP`. */
export function comboCue(combo: number): Cue {
  const f = 660 + Math.min(combo, COMBO_LADDER_TOP) * 65
  return { name: 'combo', tones: [tone(f, f, 0.15, 0.04, 0.13)], detail: combo }
}

/** Crane progress points (0..1 of the move) where the container is lifted and where it lands. */
export const PICK_AT = 0.3
export const LAND_AT = 0.88

/** The sample cues a crane move crosses between two progress values: each fires once per move. */
export function craneCues(before: number, after: number): Cue[] {
  const cues: Cue[] = []
  if (before < PICK_AT && after >= PICK_AT) cues.push({ name: 'pick', tones: [], sample: 'pick', sampleGain: 0.6 })
  if (before < LAND_AT && after >= LAND_AT) cues.push({ name: 'land', tones: [], sample: 'land', sampleGain: 0.7 })
  return cues
}

function truckOperation(name: 'collect' | 'receive', after: ShiftState): Cue {
  const tones = [tone(480, 480), tone(660, 660, 0.12, 0.04, 0.07)]
  if (after.operations < 3) tones.push(tone(480, 300, 0.13, 0.025, 0.24))
  return name === 'receive' ? { name, tones, sample: 'truck', sampleGain: 0.5 } : { name, tones }
}

function eventCues(e: ShiftEvent, after: ShiftState): Cue[] {
  switch (e.type) {
    case 'collected':
      return after.combo > 1 ? [truckOperation('collect', after), comboCue(after.combo)] : [truckOperation('collect', after)]
    case 'received':
      return [truckOperation('receive', after)]
    case 'rehandled':
      return [{ name: 'rehandle', tones: [tone(550, 740, 0.09, 0.025)] }]
    case 'arrival':
      return [{ name: 'arrival', tones: [tone(420, 420, 0.12, 0.05), tone(420, 420, 0.12, 0.05, 0.16)], sample: 'truck', sampleGain: 0.5 }]
    case 'deadline-one':
      return [{ name: 'deadline-one', tones: [tone(510, 390, 0.14, 0.05)] }]
    case 'truck-low':
      return [{ name: 'truck-low', tones: [tone(700, 540, 0.09, 0.03)] }]
    case 'shift-low':
      return [{ name: 'shift-tick', tones: [tone(850, 850, 0.1, 0.055)], detail: e.seconds }]
    case 'deadline-zero':
      return [
        {
          name: 'deadline-zero',
          tones: [tone(420, 420, 0.12, 0.05), tone(420, 420, 0.12, 0.05, 0.16), tone(520, 420, 0.16, 0.05, 0.32)],
        },
      ]
    case 'overtime-start':
      return [{ name: 'overtime-start', tones: [tone(320, 150, 0.18, 0.055)] }]
    case 'overtime-end':
      return [{ name: 'overtime-end', tones: [tone(300, 520, 0.12, 0.035)] }]
    case 'bonus-window':
      return [{ name: 'bonus-window', tones: [tone(880, 1108, 0.1, 0.035, 0.1), tone(1320, 1320, 0.14, 0.035, 0.2)] }]
    case 'bonus-awarded':
      return [
        {
          name: 'jackpot',
          tones: [
            tone(160, 43, 0.19, 0.09, 0, 'triangle'),
            ...FANFARE.flatMap((f, i) => [tone(f, f, 0.24, 0.045, i * 0.052, 'triangle'), tone(2 * f, 2 * f, 0.13, 0.012, i * 0.052)]),
            ...FANFARE.slice(0, 4).map((f) => tone(f, f, 0.42, 0.024, 0.25)),
          ],
        },
      ]
    case 'bonus-missed':
      return [{ name: 'bonus-missed', tones: [tone(650, 290, 0.12, 0.025)] }]
    case 'completed':
      return [
        {
          name: 'win',
          tones: [
            ...[392, 523.25, 659.25, 783.99].map((f, i) => tone(f, f, 0.23, 0.05, i * 0.075, 'triangle')),
            ...[523.25, 659.25, 783.99].map((f) => tone(f, f, 0.4, 0.024, 0.34)),
          ],
        },
      ]
    case 'failed':
      return e.reason === 'timeout'
        ? [
            {
              name: 'timeout',
              tones: [
                tone(175, 48, 0.34, 0.075, 0, 'triangle'),
                ...[440, 349.23, 261.63].map((f, i) => tone(f, f * 0.92, 0.26, 0.045, 0.11 + i * 0.16, 'triangle')),
              ],
            },
          ]
        : [
            {
              name: 'blocked',
              tones: [
                tone(185, 125, 0.18, 0.055, 0, 'sawtooth'),
                tone(185, 110, 0.23, 0.055, 0.22, 'triangle'),
                tone(92, 47, 0.34, 0.05, 0.44, 'triangle'),
              ],
            },
          ]
    case 'undone':
      return [{ name: 'undo', tones: [tone(740, 550, 0.09, 0.025), tone(550, 420, 0.1, 0.025, 0.08)] }]
    case 'time-credit':
      return []
  }
}

/**
 * The cues one engine step fires: `after` is the state after one `dispatch` or `tick`, `events` what that step
 * emitted, in event order. Clock and deadline warnings are engine events too (`shift-low`, `truck-low`,
 * `deadline-one`), so nothing here diffs states.
 */
export function cuesForStep(after: ShiftState, events: readonly ShiftEvent[]): Cue[] {
  return events.flatMap((e) => eventCues(e, after))
}
