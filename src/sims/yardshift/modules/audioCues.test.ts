/**
 * Yardshift audio cues (#388): the pure mapping from engine steps (the state after a step and its events) to cues. Each
 * outcome fires its cue exactly once, never per frame: tests drive real shifts through `dispatch` and `tick` and
 * collect the cues of every step.
 */
import { describe, expect, it } from 'vitest'
import { createShift, MAX_STEP_MS } from './engine'
import { levelByNumber, TUTORIAL, truckSecondsFrom } from './levels'
import {
  COMBO_LADDER_TOP,
  comboCue,
  craneCues,
  cuesForStep,
  rejectionCue,
  SHIFT_TICK_SECONDS,
  type Cue,
  type CueName,
} from './audioCues'
import type { LevelDef, Shift, ShiftAction, ShiftEvent } from '../types/engine'

/** Four exposed-in-order collections; first truck 12 s, shift 40 s, overtime 3x. */
const timed: LevelDef = {
  ...TUTORIAL,
  number: 98,
  name: 'Timed',
  stacks: [[1], [2], [3], [4], []],
  capacity: 3,
  count: 4,
  maxRehandles: 2,
  shiftSeconds: 40,
  truckSeconds: truckSecondsFrom(12),
  overtimeMultiplier: 3,
  bonusIds: [],
}

/** A recorder that turns every `dispatch` and `tick` into its cues, the way the store does. */
function recorder(level: LevelDef): { shift: Shift; cues: Cue[]; act(a: ShiftAction): void; run(ms: number): void } {
  const shift = createShift(level)
  const cues: Cue[] = []
  let batch: ShiftEvent[] = []
  shift.onEvent((e) => batch.push(e))
  function step(f: () => void): void {
    batch = []
    f()
    cues.push(...cuesForStep(shift.state, batch))
  }
  return {
    shift,
    cues,
    act: (a) =>
      step(() => {
        const r = shift.dispatch(a)
        if (!r.ok) cues.push(rejectionCue())
      }),
    run: (ms) => {
      for (let t = 0; t < ms; t += MAX_STEP_MS) step(() => shift.tick(Math.min(MAX_STEP_MS, ms - t)))
    },
  }
}

function names(cues: readonly Cue[]): CueName[] {
  return cues.map((c) => c.name)
}

function count(cues: readonly Cue[], name: CueName): number {
  return cues.filter((c) => c.name === name).length
}

/** True when `f` is a note of C major pentatonic (C D E G A), to the nearest semitone and within 1 cent. */
function onPentatonic(f: number): boolean {
  const semis = 12 * Math.log2(f / 261.6256)
  const n = Math.round(semis)
  return Math.abs(semis - n) < 0.01 && [0, 2, 4, 7, 9].includes(((n % 12) + 12) % 12)
}

/** The largest sum of envelope peaks of a cue's tones sounding at once (checked at each tone's attack peak). */
function peakGain(cue: Cue): number {
  let peak = 0
  for (const t of cue.tones) {
    const at = t.delay + 0.008
    const sum = cue.tones.filter((o) => o.delay <= at && at < o.delay + o.dur).reduce((s, o) => s + o.vol, 0)
    peak = Math.max(peak, sum)
  }
  return peak
}

describe('Yardshift audio cues', () => {
  it('a collection fires collect once, and combo from the second in a chain', () => {
    const r = recorder(timed)
    r.act({ type: 'collect' })
    expect(names(r.cues)).toEqual(['collect'])
    r.act({ type: 'collect' })
    expect(names(r.cues)).toEqual(['collect', 'collect', 'combo'])
    r.run(500)
    expect(count(r.cues, 'collect')).toBe(2)
  })

  it('a rejected action fires invalid and nothing else', () => {
    const r = recorder(timed)
    r.act({ type: 'rehandle', from: 0, to: 0 })
    expect(names(r.cues)).toEqual(['invalid'])
  })

  it('a rehandle fires rehandle (and overtime end once when it lifts the truck clock off 0)', () => {
    const r = recorder({ ...timed, stacks: [[2, 1], [3], [4], []] })
    r.run(12_000)
    expect(count(r.cues, 'overtime-start')).toBe(1)
    r.act({ type: 'rehandle', from: 0, to: 3 })
    expect(names(r.cues).slice(-2)).toEqual(['rehandle', 'overtime-end'])
  })

  it('shift ticks fire once each at 9, 5, 3, 2 and 1 s, then timeout once', () => {
    expect(SHIFT_TICK_SECONDS).toEqual([9, 5, 3, 2, 1])
    const r = recorder({ ...timed, shiftSeconds: 12, truckSeconds: [60, 60, 60] })
    r.run(15_000)
    const ticks = r.cues.filter((c) => c.name === 'shift-tick')
    expect(ticks.map((c) => c.detail)).toEqual([9, 5, 3, 2, 1])
    expect(count(r.cues, 'timeout')).toBe(1)
    expect(r.shift.state.status).toBe('failed')
  })

  it('the next-truck clock fires low once at 35% of its allowance, then overtime start once', () => {
    const r = recorder(timed)
    r.run(4_000)
    expect(count(r.cues, 'truck-low')).toBe(0)
    r.run(4_300) // 12 s x 0.35 = 4.2 s left at 7.8 s
    expect(count(r.cues, 'truck-low')).toBe(1)
    r.run(6_000)
    expect(count(r.cues, 'truck-low')).toBe(1)
    expect(count(r.cues, 'overtime-start')).toBe(1)
    r.act({ type: 'collect' })
    expect(count(r.cues, 'overtime-end')).toBe(1)
    r.run(1_000)
    expect(count(r.cues, 'overtime-start')).toBe(1)
  })

  it('a receipt level fires arrival, deadline one and mandatory once, then receive with a truck sample', () => {
    const level = levelByNumber(4)!
    const r = recorder(level)
    // Level 4 starts with truck #8 waiting (3 moves); the start is not a step, so it fires no cue.
    expect(r.cues).toEqual([])
    const shift = r.shift
    r.act({ type: 'rehandle', from: 0, to: 4 })
    r.act({ type: 'collect', from: 0 })
    r.act({ type: 'rehandle', from: 2, to: 3 })
    expect(count(r.cues, 'invalid')).toBe(0)
    expect(shift.state.deadline).toBe(0)
    expect(count(r.cues, 'deadline-one')).toBe(1)
    expect(count(r.cues, 'deadline-zero')).toBe(1)
    r.act({ type: 'receive', to: 0 })
    const receive = r.cues.filter((c) => c.name === 'receive')
    expect(receive).toHaveLength(1)
    expect(receive[0]!.sample).toBe('truck')
    expect(count(r.cues, 'deadline-zero')).toBe(1)
  })

  it('an arrival fires the arrival alarm with the truck sample once', () => {
    const before = createShift(levelByNumber(5)!).state
    const after = { ...before, deadline: 3 }
    const cues = cuesForStep(after, [{ type: 'arrival', id: 11, moves: 3 }])
    expect(names(cues)).toEqual(['arrival'])
    expect(cues[0]!.sample).toBe('truck')
  })

  it('maps completion, blocked, bonus window, award and miss to one cue each', () => {
    const s = createShift(timed).state
    const map = (e: ShiftEvent): CueName[] => names(cuesForStep(s, [e]))
    expect(map({ type: 'completed' })).toEqual(['win'])
    expect(map({ type: 'failed', reason: 'blocked' })).toEqual(['blocked'])
    expect(map({ type: 'failed', reason: 'timeout' })).toEqual(['timeout'])
    expect(map({ type: 'bonus-window', id: 3, ms: 1200 })).toEqual(['bonus-window'])
    expect(map({ type: 'bonus-awarded', id: 3, points: 250, ms: 5000 })).toEqual(['jackpot'])
    expect(map({ type: 'bonus-missed', id: 3 })).toEqual(['bonus-missed'])
    expect(map({ type: 'undone', points: -25, ms: 3000 })).toEqual(['undo'])
    expect(map({ type: 'time-credit', ms: 1000 })).toEqual([])
  })

  it('winning a level fires the victory fanfare once', () => {
    const r = recorder(timed)
    for (let i = 0; i < 4; i++) r.act({ type: 'collect' })
    expect(count(r.cues, 'win')).toBe(1)
    expect(r.shift.state.status).toBe('complete')
  })

  it('the combo pitch ladder ascends with the combo, up to 8', () => {
    const pitch = (c: number): number => comboCue(c).tones[0]!.f0
    for (let c = 2; c < 8; c++) expect(pitch(c + 1)).toBeGreaterThan(pitch(c))
    expect(pitch(12)).toBe(pitch(8))
    expect(comboCue(3).detail).toBe(3)
  })

  it('the combo ladder steps on the major pentatonic, so a chain plays a tune', () => {
    for (let c = 2; c <= COMBO_LADDER_TOP; c++) expect(onPentatonic(comboCue(c).tones[0]!.f0)).toBe(true)
  })

  it('a bonus collect layers a rising pentatonic coin arpeggio and a high shimmer over the chord', () => {
    const [jackpot] = cuesForStep(createShift(timed).state, [{ type: 'bonus-awarded', id: 3, points: 250, ms: 5000 }])
    const coins = jackpot!.tones.filter((t) => t.role === 'coin')
    expect(coins.length).toBeGreaterThanOrEqual(4)
    expect(coins.length).toBeLessThanOrEqual(6)
    for (const t of coins) {
      expect(['triangle', 'sine']).toContain(t.type)
      expect(onPentatonic(t.f0)).toBe(true)
      expect(t.dur).toBeLessThanOrEqual(0.12)
    }
    for (let i = 1; i < coins.length; i++) {
      expect(coins[i]!.f0).toBeGreaterThan(coins[i - 1]!.f0)
      expect(coins[i]!.delay).toBeGreaterThan(coins[i - 1]!.delay)
    }
    const shimmer = jackpot!.tones.filter((t) => t.role === 'shimmer')
    expect(shimmer.length).toBeGreaterThanOrEqual(2)
    for (const t of shimmer) expect(t.f0).toBeGreaterThan(2000)
    const detuned = shimmer.some((a) => shimmer.some((b) => a !== b && Math.abs(a.f0 - b.f0) > 0 && Math.abs(a.f0 - b.f0) < 20))
    expect(detuned).toBe(true)
    // The existing fanfare chord (the character the owner likes) is still there underneath.
    expect(jackpot!.tones.filter((t) => t.role === undefined).length).toBeGreaterThanOrEqual(14)
  })

  it('a bonus window opens with a soft twinkle and a miss is a gentle short downward blip', () => {
    const s = createShift(timed).state
    const [open] = cuesForStep(s, [{ type: 'bonus-window', id: 3, ms: 1200 }])
    expect(open!.tones.length).toBeGreaterThanOrEqual(3)
    for (const t of open!.tones) {
      expect(t.type).toBe('sine')
      expect(t.f0).toBeGreaterThan(1000)
      expect(t.vol).toBeLessThanOrEqual(0.03)
    }
    const [miss] = cuesForStep(s, [{ type: 'bonus-missed', id: 3 }])
    for (const t of miss!.tones) {
      expect(t.f1).toBeLessThan(t.f0)
      expect(t.type).toBe('sine')
    }
    const end = Math.max(...miss!.tones.map((t) => t.delay + t.dur))
    expect(end).toBeLessThanOrEqual(0.25)
  })

  it('no cue sums louder than the loudest cue before the bonus sounds (the old jackpot, 0.306)', () => {
    const s = createShift(timed).state
    const events: ShiftEvent[] = [
      { type: 'completed' },
      { type: 'failed', reason: 'timeout' },
      { type: 'failed', reason: 'blocked' },
      { type: 'bonus-window', id: 3, ms: 1200 },
      { type: 'bonus-awarded', id: 3, points: 250, ms: 5000 },
      { type: 'bonus-missed', id: 3 },
    ]
    const all = [...events.flatMap((e) => cuesForStep(s, [e])), comboCue(COMBO_LADDER_TOP)]
    for (const cue of all) expect(peakGain(cue), cue.name).toBeLessThanOrEqual(0.306)
    // A bonus collect plays collect, combo and jackpot in one step: together they stay under 0.45.
    const r = recorder(timed)
    r.act({ type: 'collect' })
    const collectStep = [...cuesForStep(r.shift.state, [{ type: 'collected', id: 2, from: 1 }]), comboCue(8), all[4]!]
    expect(collectStep.reduce((sum, c) => sum + peakGain(c), 0)).toBeLessThan(0.45)
  })

  it('the bonus window chord rises', () => {
    const s = createShift(timed).state
    const [cue] = cuesForStep(s, [{ type: 'bonus-window', id: 3, ms: 1200 }])
    const pitches = cue!.tones.map((t) => t.f1)
    expect(pitches).toEqual([...pitches].sort((a, b) => a - b))
  })

  it('crane pick and land fire once each as the move progress crosses them, whatever the frame steps', () => {
    let p = 0
    const cues: Cue[] = []
    for (const dt of [0.05, 0.1, 0.1, 0.07, 0.2, 0.3, 0.05, 0.05, 0.08]) {
      const next = Math.min(1, p + dt)
      cues.push(...craneCues(p, next))
      p = next
    }
    expect(names(cues)).toEqual(['pick', 'land'])
    expect(cues.map((c) => c.sample)).toEqual(['pick', 'land'])
    expect(names(craneCues(0, 1))).toEqual(['pick', 'land'])
  })

  it('no cue carries a fixed output volume: tone levels are relative sound gains in 0..1', () => {
    const s = createShift(timed).state
    const all: Cue[] = [
      rejectionCue(),
      comboCue(5),
      ...craneCues(0, 1),
      ...cuesForStep(s, [{ type: 'completed' }, { type: 'bonus-awarded', id: 3, points: 250, ms: 5000 }]),
    ]
    for (const cue of all) for (const t of cue.tones) {
        expect(t.vol).toBeGreaterThan(0)
        expect(t.vol).toBeLessThanOrEqual(1)
      }
  })
})
