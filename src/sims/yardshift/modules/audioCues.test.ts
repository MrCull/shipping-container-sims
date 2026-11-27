/**
 * Yardshift audio cues (#388): the pure mapping from engine steps (the state after a step and its events) to cues. Each
 * outcome fires its cue exactly once, never per frame: tests drive real shifts through `dispatch` and `tick` and
 * collect the cues of every step.
 */
import { describe, expect, it } from 'vitest'
import { createShift, MAX_STEP_MS } from './engine'
import { levelByNumber, TUTORIAL, truckSecondsFrom } from './levels'
import { comboCue, craneCues, cuesForStep, rejectionCue, SHIFT_TICK_SECONDS, type Cue, type CueName } from './audioCues'
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
