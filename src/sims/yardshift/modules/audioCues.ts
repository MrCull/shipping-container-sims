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
  /** The layer a tone belongs to in a layered cue: the bonus coin arpeggio, its shimmer, or the score pop. */
  role?: 'coin' | 'shimmer' | 'pop'
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

/** Semitones of the major pentatonic (C D E G A) above its root. */
const PENTATONIC = [0, 2, 4, 7, 9]
/** C5: the root the combo ladder and the bonus sounds count pentatonic steps from. */
const PENTATONIC_ROOT = 523.2511

/** The frequency `step` notes up C major pentatonic from C5 (step 5 is C6), so ladders and arpeggios stay in key. */
export function pentatonicNote(step: number): number {
  const octave = Math.floor(step / PENTATONIC.length)
  const degree = PENTATONIC[step - octave * PENTATONIC.length]!
  return PENTATONIC_ROOT * 2 ** (octave + degree / 12)
}

/**
 * The bonus collect's coin layer, laid over the fanfare chord: a short upward pop as the +250 float appears (the
 * float is the same `bonus-awarded` event, so it has no cue of its own), a quick rising pentatonic coin arpeggio
 * (E6 to E7, 30 ms apart, alternating triangle and sine, done before the chord swells), then a shimmer of high
 * detuned sine pairs that beat gently as the chord rings.
 */
function coinLayer(): Tone[] {
  const COIN_START = 0.02
  const COIN_GAP = 0.03
  const coins = [7, 8, 9, 10, 11, 12].map((step, i) =>
    coin(pentatonicNote(step), 0.06, 0.013, COIN_START + i * COIN_GAP, i % 2 === 0 ? 'triangle' : 'sine'),
  )
  const shimmerAt = COIN_START + 6 * COIN_GAP
  const shimmer = [pentatonicNote(15), pentatonicNote(15) + 7, pentatonicNote(17), pentatonicNote(17) - 9].map(
    (f, i): Tone => ({ ...tone(f, f * 1.01, 0.36, 0.0045, shimmerAt + i * 0.03), role: 'shimmer' }),
  )
  const pop: Tone = { ...tone(pentatonicNote(10), pentatonicNote(13), 0.05, 0.012, 0.02), role: 'pop' }
  return [pop, ...coins, ...shimmer]
}

function coin(f: number, dur: number, vol: number, delay: number, type: ToneType): Tone {
  return { ...tone(f, f, dur, vol, delay, type), role: 'coin' }
}

export function rejectionCue(): Cue {
  return { name: 'invalid', tones: [tone(150, 80)] }
}

/** The crane accepted a move: a short motor whine. */
export function craneStartCue(): Cue {
  return { name: 'crane-start', tones: [tone(92, 140, 0.28, 0.02, 0, 'triangle')] }
}

/**
 * The combo ladder: one pentatonic step up per combo length, up to `COMBO_LADDER_TOP` (combo 2 is D5, 8 is E6, about the old 790 to 1180 Hz slide), so a
 * chain plays a tune instead of a slide.
 */
export function comboCue(combo: number): Cue {
  const f = pentatonicNote(Math.min(combo, COMBO_LADDER_TOP) - 1)
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
      // A soft twinkle: three high pentatonic sines rising (G6, C7, E7), each with a faint detuned twin a few hertz up.
      return [
        {
          name: 'bonus-window',
          tones: [8, 10, 12].flatMap((step, i) => {
            const f = pentatonicNote(step)
            return [tone(f, f, 0.12, 0.022, 0.08 + i * 0.07), tone(f + 4, f + 4, 0.16, 0.007, 0.08 + i * 0.07)]
          }),
        },
      ]
    case 'bonus-awarded':
      return [
        {
          name: 'jackpot',
          tones: [
            tone(160, 43, 0.19, 0.08, 0, 'triangle'),
            ...FANFARE.flatMap((f, i) => [tone(f, f, 0.24, 0.04, i * 0.052, 'triangle'), tone(2 * f, 2 * f, 0.13, 0.012, i * 0.052)]),
            ...FANFARE.slice(0, 4).map((f) => tone(f, f, 0.42, 0.024, 0.25)),
            ...coinLayer(),
          ],
        },
      ]
    case 'bonus-missed':
      // A gentle short downward blip: two soft sine drops, the second lower.
      return [{ name: 'bonus-missed', tones: [tone(660, 440, 0.07, 0.022), tone(440, 294, 0.1, 0.018, 0.07)] }]
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
