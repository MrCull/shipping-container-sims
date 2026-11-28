/**
 * Yardshift audio cues (#388): a pure mapping from engine steps to sounds, so every outcome fires its sound exactly
 * once (one engine event, clock thresholds included), never per frame. Tones are V20's synth cues
 * (`tone(f0, f1, dur, vol, delay, type)`); `vol` is the sound's own gain at full volume, scaled by the shared `sfx`
 * channel through `gainFor` when played (composables/useYardAudio.ts). Samples are short clips in assets/audio/.
 */
import { SHIFT_LOW_SECONDS } from './engine'
import { fixtureFor } from './fixtures'
import { starsFor, type Stars } from './stars'
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
  | 'truck-off'
  | 'truck-in'
  | 'next-ready'
  | 'deadline-two'
  | 'select'
  | 'receipt-select'
  | 'deselect'
  | 'pause'
  | 'resume'

/** Store-level UI outcomes the engine never sees (the store sends them to `onYardEvent` and plays `uiCue`). */
export type UiSoundEvent =
  | { type: 'selected'; target: number | 'receipt' }
  | { type: 'deselected' }
  | { type: 'paused' }
  | { type: 'resumed' }

export interface Cue {
  name: CueName
  tones: Tone[]
  /** A sample played with the tones, at `sampleGain` (its own gain at full volume). */
  sample?: SampleName
  sampleGain?: number
  /** The combo length for `combo`, the threshold in seconds for `shift-tick`, the stars for `win`. */
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

/** A refused move: a soft low buzz (square, two short pulses). */
export function rejectionCue(): Cue {
  return { name: 'invalid', tones: [tone(150, 120, 0.07, 0.018, 0, 'square'), tone(140, 105, 0.08, 0.016, 0.09, 'square')] }
}

/** UI sounds for the store-level outcomes: quiet clicks and two-note blips, well under the game sounds. */
export function uiCue(e: UiSoundEvent): Cue {
  switch (e.type) {
    case 'selected':
      // A container: one short high click. The receipt truck: a lower two-note click (it is a truck, not a box).
      return e.target === 'receipt'
        ? { name: 'receipt-select', tones: [tone(784, 784, 0.04, 0.02, 0, 'triangle'), tone(1046.5, 1046.5, 0.05, 0.02, 0.05, 'triangle')] }
        : { name: 'select', tones: [tone(1318.5, 1250, 0.035, 0.02)] }
    case 'deselected':
      return { name: 'deselect', tones: [tone(880, 600, 0.06, 0.015)] }
    case 'paused':
      return { name: 'pause', tones: [tone(659.25, 659.25, 0.08, 0.02, 0, 'triangle'), tone(440, 440, 0.12, 0.02, 0.09, 'triangle')] }
    case 'resumed':
      return { name: 'resume', tones: [tone(440, 440, 0.08, 0.02, 0, 'triangle'), tone(659.25, 659.25, 0.12, 0.02, 0.09, 'triangle')] }
  }
}

/** The stars a completed shift earns, or 3 for a level with no solver fixture (test levels). */
function starsOf(after: ShiftState): Stars {
  const fixture = fixtureFor(after.level.number)
  return fixture ? starsFor(after.rehandles, fixture.minRehandles) : 3
}

/**
 * The level-complete fanfare, scaled by stars: one star a short rising triad, two adds the octave and the held
 * chord, three adds the high E and a pentatonic sparkle on top.
 */
export function winCue(stars: Stars): Cue {
  const notes = [392, 523.25, 659.25, 783.99, 1046.5, 1318.5].slice(0, stars + 3)
  const tones = notes.map((f, i) => tone(f, f, 0.23, 0.05, i * 0.075, 'triangle'))
  const chordAt = notes.length * 0.075 + 0.04
  if (stars >= 2) tones.push(...[523.25, 659.25, 783.99].map((f) => tone(f, f, 0.4, 0.024, chordAt)))
  if (stars === 3) tones.push(...[12, 13, 14].map((step, i) => tone(pentatonicNote(step), pentatonicNote(step), 0.08, 0.008, chordAt + 0.05 + i * 0.06)))
  return { name: 'win', tones, detail: stars }
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

/** The low thud of a box landing on a trailer bed. */
const CLUNK = tone(150, 60, 0.07, 0.035, 0, 'triangle')

/**
 * Collect: the trailer clunk, then a positive rising blip (C5 to G5). Receive: the clunk, then a settling falling
 * pair (E5 to C5) with the truck engine sample, as the receipt truck pulls away empty.
 */
function truckOperation(name: 'collect' | 'receive', after: ShiftState): Cue {
  if (name === 'receive') {
    return { name, tones: [CLUNK, tone(659.25, 659.25, 0.08, 0.03, 0.06), tone(523.25, 523.25, 0.12, 0.03, 0.13)], sample: 'truck', sampleGain: 0.5 }
  }
  const tones = [CLUNK, tone(523.25, 523.25, 0.08, 0.03, 0.06), tone(783.99, 783.99, 0.12, 0.035, 0.13)]
  if (after.operations < 3) tones.push(tone(480, 300, 0.13, 0.025, 0.26))
  return { name, tones }
}

/**
 * The collection truck's drive-off and return, timed to its animation (`collectMotion` over `FX_MS.collect`
 * 1400 ms: pulls away from 0.25 s, back in from 0.84 s): a low engine rumble falling away, then one rising back in
 * with a brake squeak, then a very soft ding as the new next container is ready. The last collection sends the
 * truck off only.
 */
function collectionTruck(after: ShiftState): Cue[] {
  const off: Cue = { name: 'truck-off', tones: [tone(120, 70, 0.45, 0.014, 0.25, 'sawtooth')] }
  if (after.status === 'complete' || after.next > after.level.count) return [off]
  return [
    off,
    { name: 'truck-in', tones: [tone(70, 115, 0.4, 0.012, 0.84, 'sawtooth'), tone(1800, 1500, 0.06, 0.004, 1.26)] },
    { name: 'next-ready', tones: [tone(1568, 1568, 0.18, 0.01, 1.38)] },
  ]
}

/** Shift tick pitch: rises as the seconds left fall (9 s is G5, 1 s is G6). */
function tickPitch(seconds: number): number {
  return 783.99 * 2 ** ((9 - seconds) / 8)
}

function eventCues(e: ShiftEvent, after: ShiftState): Cue[] {
  switch (e.type) {
    case 'collected':
      return [truckOperation('collect', after), ...(after.combo > 1 ? [comboCue(after.combo)] : []), ...collectionTruck(after)]
    case 'received':
      return [truckOperation('receive', after)]
    case 'rehandled':
      return [{ name: 'rehandle', tones: [tone(550, 740, 0.09, 0.025)] }]
    case 'arrival':
      // A truck horn: two honks of a square-wave minor third (D#4 and F#4), with the engine sample.
      return [
        {
          name: 'arrival',
          tones: [0, 0.2].flatMap((at, i) => [tone(311.13, 311.13, i ? 0.28 : 0.14, 0.022, at, 'square'), tone(369.99, 369.99, i ? 0.28 : 0.14, 0.022, at, 'square')]),
          sample: 'truck',
          sampleGain: 0.5,
        },
      ]
    case 'deadline-one':
      return [{ name: 'deadline-one', tones: [tone(510, 390, 0.14, 0.05)] }]
    case 'truck-low':
      return [{ name: 'truck-low', tones: [tone(700, 540, 0.09, 0.03)] }]
    case 'shift-low':
      return [{ name: 'shift-tick', tones: [tone(tickPitch(e.seconds), tickPitch(e.seconds), 0.07, 0.05, 0, 'triangle')], detail: e.seconds }]
    case 'deadline-zero':
      // An alarm: four fast alternating high-low triangle pulses.
      return [{ name: 'deadline-zero', tones: [880, 660, 880, 660].map((f, i) => tone(f, f, 0.08, 0.045, i * 0.1, 'triangle')) }]
    case 'overtime-start':
      // Siren-like: a sawtooth sweeping up and back down twice.
      return [
        {
          name: 'overtime-start',
          tones: [0, 0.36].flatMap((at) => [tone(440, 660, 0.18, 0.022, at, 'sawtooth'), tone(660, 440, 0.18, 0.022, at + 0.18, 'sawtooth')]),
        },
      ]
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
      return [winCue(starsOf(after))]
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
      // A rewind swoosh: a fast falling triangle sweep, then a short rising flick.
      return [{ name: 'undo', tones: [tone(1400, 260, 0.2, 0.03, 0, 'triangle'), tone(300, 900, 0.07, 0.02, 0.19)] }]
    case 'time-credit':
      return []
  }
}

/**
 * The cues one engine step fires: `after` is the state after one `dispatch` or `tick`, `events` what that step
 * emitted, in event order. Clock and deadline warnings are engine events too (`shift-low`, `truck-low`,
 * `deadline-one`). The one exception is `deadline-two`, which has no engine event: given `before` (the state
 * before the step), it fires when a move drops the moves-left count from above 2 to 2 (not on an arrival at 2,
 * which the horn already announces).
 */
export function cuesForStep(after: ShiftState, events: readonly ShiftEvent[], before?: ShiftState): Cue[] {
  const cues = events.flatMap((e) => eventCues(e, after))
  const arrived = events.some((e) => e.type === 'arrival')
  if (before && !arrived && before.deadline !== null && before.deadline > 2 && after.deadline === 2) {
    cues.push({ name: 'deadline-two', tones: [tone(620, 620, 0.06, 0.03, 0, 'triangle'), tone(620, 560, 0.08, 0.03, 0.1, 'triangle')] })
  }
  return cues
}
