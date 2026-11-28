/**
 * Yardshift audio cues (#388): a pure mapping from engine steps to sounds, so every outcome fires its sound exactly
 * once (one engine event, clock thresholds included), never per frame. Tones are V20's synth cues
 * (`tone(f0, f1, dur, vol, delay, type)`); `vol` is the sound's own gain at full volume, scaled by the shared `sfx`
 * channel through `gainFor` when played (composables/useYardAudio.ts). Samples are short clips in assets/audio/.
 * Owner round 4 asked for louder effects: every tone and sample gain is `SFX_BOOST` times its design level.
 */
import { SHIFT_LOW_SECONDS } from './engine'
import { fixtureFor } from './fixtures'
import { starsFor, type Stars } from './stars'
import type { ShiftEvent, ShiftState } from '../types/engine'

/** `noise`: white noise through a band-pass filter swept f0 to f1 (the receipt truck's air-brake hiss). */
export type ToneType = 'sine' | 'triangle' | 'square' | 'sawtooth' | 'noise'

/** One oscillator: frequency f0 ramping to f1 over `dur` s, peak gain `vol` (0..1), starting `delay` s from now. */
export interface Tone {
  f0: number
  f1: number
  dur: number
  vol: number
  delay: number
  type: ToneType
  /**
   * The layer a tone belongs to in a layered cue: the bonus coin cascade, its rising arpeggio, shimmer, power chord
   * hit and score pop; the collect reward chime and the last collection's flourish; the arrival's hiss and horn.
   */
  role?: 'coin' | 'arpeggio' | 'shimmer' | 'power' | 'pop' | 'chime' | 'flourish' | 'hiss' | 'horn'
  /** Seconds the envelope takes to swell to `vol` (default 8 ms, a click); the crane whirr fades in over the move. */
  attack?: number
  /** A low-pass filter cutoff in Hz after the source (none by default): softens the crane move sounds (owner round 6). */
  lowpass?: number
}

export type SampleName = 'truck'

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

/**
 * Owner round 4: "raise its sound effects". Every tone's `vol` and every sample's gain is its design level times
 * this, still a relative sound gain scaled by the shared `'sfx'` channel through `gainFor` (the bus).
 */
export const SFX_BOOST = 1.5
/**
 * Owner round 5: "sound effects still too quiet". The sfx bus doubles every cue after the sliders (a makeup gain,
 * composables/useYardAudio.ts) and then a limiter (`SFX_LIMITER`) keeps overlapping cues from clipping. The cue
 * levels here, and the peak caps the tests check, are measured before the makeup gain and the limiter.
 */
export const SFX_MAKEUP_GAIN = 2

/** The `DynamicsCompressorNode` settings of the limiter at the end of the sfx bus: a hard knee, fast attack. */
export const SFX_LIMITER = { threshold: -10, knee: 0, ratio: 12, attack: 0.003, release: 0.25 } as const

/** The loudest a cue's overlapping tones may sum to: the old 0.306 cap times `SFX_BOOST` (before the makeup gain). */
export const CUE_PEAK_CAP = 0.306 * SFX_BOOST

/** `vol` is the design level; the tone plays at `vol * SFX_BOOST`. */
function tone(f0: number, f1: number, dur = 0.09, vol = 0.035, delay = 0, type: ToneType = 'sine'): Tone {
  return { f0, f1, dur, vol: vol * SFX_BOOST, delay, type }
}

/** A sample's gain: its design level times `SFX_BOOST`, at most 1. */
function sampleGain(level: number): number {
  return Math.min(1, level * SFX_BOOST)
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
 * The bonus collect (owner round 4: "epically when a bonus one gets done"), the most epic cue in the game, about
 * 1.2 s, layered so each part has its own register and moment: a low thump and a short upward pop as the +250
 * float appears (the float is the same `bonus-awarded` event, so it has no cue of its own); the rising fanfare
 * arpeggio with its octave sparkle; a coin cascade (ten quick pentatonic coins rising E6 to D8, 32 ms apart,
 * alternating triangle and sine); a short power chord hit (C3, G3, C4 sawtooth and triangle) under the held chord
 * as the arpeggio lands; then a shimmer of high detuned sine pairs that beat gently as it rings out.
 */
function jackpotTones(): Tone[] {
  const thump = tone(160, 43, 0.19, 0.07, 0, 'triangle')
  const pop: Tone = { ...tone(pentatonicNote(10), pentatonicNote(13), 0.05, 0.01, 0.02), role: 'pop' }
  const arpeggio = FANFARE.flatMap((f, i): Tone[] => [
    { ...tone(f, f, 0.24, 0.03, i * 0.052, 'triangle'), role: 'arpeggio' },
    { ...tone(2 * f, 2 * f, 0.13, 0.01, i * 0.052), role: 'arpeggio' },
  ])
  const COIN_START = 0.03
  const COIN_GAP = 0.032
  const coins = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map((step, i) =>
    coin(pentatonicNote(step), 0.06, 0.01, COIN_START + i * COIN_GAP, i % 2 === 0 ? 'triangle' : 'sine'),
  )
  const HIT_AT = 0.3
  const power: Tone[] = [130.81, 196, 261.63].flatMap((f) => [
    { ...tone(f, f * 0.985, 0.3, 0.012, HIT_AT, 'sawtooth'), role: 'power' },
    { ...tone(f, f, 0.38, 0.014, HIT_AT, 'triangle'), role: 'power' },
  ])
  const chord = FANFARE.slice(0, 4).map((f) => tone(f, f, 0.5, 0.015, HIT_AT))
  const shimmerAt = COIN_START + coins.length * COIN_GAP
  const shimmer = [pentatonicNote(15), pentatonicNote(15) + 7, pentatonicNote(17), pentatonicNote(17) - 9, pentatonicNote(20), pentatonicNote(20) + 6].map(
    (f, i): Tone => ({ ...tone(f, f * 1.01, 0.62, 0.004, shimmerAt + i * 0.04), role: 'shimmer' }),
  )
  return [thump, pop, ...arpeggio, ...coins, ...power, ...chord, ...shimmer]
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

/**
 * Owner round 6: the old move sounds (a triangle whine and the `crane-pick`/`crane-land` samples) were "horrible".
 * Every move sound is now short, low and soft: a low-pass filtered motor whirr under the move that fades in and
 * out, a muffled clunk on the pick and a wooden thock on the landing, all under 2 kHz and quieter than the collect
 * chime (`audioCues.test.ts`).
 */
const MOVE_LOWPASS = 420

/** The crane accepted a move: a quiet low-passed motor whirr (sawtooth plus its octave) that swells and fades over the move. */
export function craneStartCue(): Cue {
  const whirr = (f0: number, f1: number, vol: number, type: ToneType): Tone => ({
    ...tone(f0, f1, 0.42, vol, 0, type),
    attack: 0.14,
    lowpass: MOVE_LOWPASS,
  })
  return { name: 'crane-start', tones: [whirr(78, 92, 0.007, 'sawtooth'), whirr(156, 184, 0.003, 'sine')] }
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

/** The spreader grips the box: a muffled clunk, a low sine thump near 120 Hz with a fast decay and a gentle click. */
const PICK_TONES: Tone[] = [
  tone(120, 70, 0.12, 0.012),
  tone(240, 150, 0.06, 0.005, 0, 'triangle'),
  { ...tone(1400, 900, 0.025, 0.003, 0, 'noise'), lowpass: 1800 },
]

/** The box sets down: a soft wooden thock, a short mid triangle knock over a low sine body and a muffled tick. */
const LAND_TONES: Tone[] = [
  tone(440, 310, 0.05, 0.007, 0, 'triangle'),
  tone(170, 115, 0.11, 0.011),
  { ...tone(1000, 700, 0.02, 0.003, 0, 'noise'), lowpass: 1500 },
]

/** The cues a crane move crosses between two progress values (the pick, then the landing): each fires once per move. */
export function craneCues(before: number, after: number): Cue[] {
  const cues: Cue[] = []
  if (before < PICK_AT && after >= PICK_AT) cues.push({ name: 'pick', tones: PICK_TONES })
  if (before < LAND_AT && after >= LAND_AT) cues.push({ name: 'land', tones: LAND_TONES })
  return cues
}

/** The low thud of a box landing on a trailer bed. */
const CLUNK = tone(150, 60, 0.07, 0.035, 0, 'triangle')

/** Pentatonic steps the collect chime climbs over one shift: the first collection starts on C5, the last on E6. */
export const COLLECT_LADDER_SPAN = 7

/** The collect chime's root step for the `k`th collection (1-based) of `count`, spread so every shift climbs the span. */
export function collectLadderStep(k: number, count: number): number {
  return count > 1 ? Math.round(((k - 1) * COLLECT_LADDER_SPAN) / (count - 1)) : COLLECT_LADDER_SPAN
}

/**
 * The collect reward (owner round 4: "dopamine inducing sound for each container"): a bright rising three-note
 * pentatonic chime (root, two and four steps up: a C6-type chord) whose root climbs with the collection index, so a
 * shift plays a level-up ladder. The last collection adds a flourish: a quick run up the next octave into a held
 * high bell.
 */
function collectChime(after: ShiftState): Tone[] {
  const k = Math.min(after.next - 1, after.level.count)
  const root = collectLadderStep(k, after.level.count)
  const chime = [0, 2, 4].map((up, i): Tone => {
    const f = pentatonicNote(root + up)
    return { ...tone(f, f, i === 2 ? 0.18 : 0.09, 0.024 + i * 0.004, 0.06 + i * 0.045, i === 2 ? 'triangle' : 'sine'), role: 'chime' }
  })
  if (k < after.level.count) return chime
  const RUN_AT = 0.25
  const run = [10, 11, 12, 13, 14, 15].map((step, i): Tone => {
    const f = pentatonicNote(step)
    return { ...tone(f, f, 0.08, 0.016, RUN_AT + i * 0.035, 'triangle'), role: 'flourish' }
  })
  const bellAt = RUN_AT + 6 * 0.035
  const bell = [pentatonicNote(15), pentatonicNote(15) + 5].map((f): Tone => ({ ...tone(f, f, 0.4, 0.012, bellAt), role: 'flourish' }))
  return [...chime, ...run, ...bell]
}

/**
 * Collect: the trailer clunk, then the reward chime (`collectChime`). Receive: the clunk, then a settling falling
 * pair (E5 to C5) with the truck engine sample, as the receipt truck pulls away empty.
 */
function truckOperation(name: 'collect' | 'receive', after: ShiftState): Cue {
  if (name === 'receive') {
    return { name, tones: [CLUNK, tone(659.25, 659.25, 0.08, 0.03, 0.06), tone(523.25, 523.25, 0.12, 0.03, 0.13)], sample: 'truck', sampleGain: sampleGain(0.5) }
  }
  const tones = [CLUNK, ...collectChime(after)]
  if (after.operations < 3) tones.push(tone(480, 300, 0.13, 0.02, 0.3))
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

/**
 * The receipt truck pulls in (owner round 4: "an appropriate noise when a receipt truck arrives"): the truck engine
 * sample, an air-brake hiss as it stops (band-passed noise falling 3.2 to 1.6 kHz) and a two-tone horn, a high
 * honk (F4 and A4) then a longer low one (D4 and F#4), brassy sawtooth over a triangle body.
 */
function arrivalCue(): Cue {
  const hiss: Tone = { ...tone(3200, 1600, 0.42, 0.06, 0.3, 'noise'), role: 'hiss' }
  const honk = (fs: number[], at: number, dur: number): Tone[] =>
    fs.flatMap((f) => [
      { ...tone(f, f, dur, 0.016, at, 'sawtooth'), role: 'horn' },
      { ...tone(f, f, dur, 0.012, at, 'triangle'), role: 'horn' },
    ])
  return { name: 'arrival', tones: [hiss, ...honk([349.23, 440], 0.78, 0.18), ...honk([293.66, 369.99], 1.0, 0.32)], sample: 'truck', sampleGain: sampleGain(0.5) }
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
      return [arrivalCue()]
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
          tones: jackpotTones(),
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
