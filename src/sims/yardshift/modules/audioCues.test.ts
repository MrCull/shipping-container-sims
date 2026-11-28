/**
 * Yardshift audio cues (#388): the pure mapping from engine steps (the state after a step and its events) to cues. Each
 * outcome fires its cue exactly once, never per frame: tests drive real shifts through `dispatch` and `tick` and
 * collect the cues of every step.
 */
import { describe, expect, it } from 'vitest'
import { createShift, MAX_STEP_MS } from './engine'
import { levelByNumber, TUTORIAL, truckSecondsFrom } from './levels'
import {
  COLLECT_LADDER_SPAN,
  collectLadderStep,
  COMBO_LADDER_TOP,
  CUE_PEAK_CAP,
  comboCue,
  craneCues,
  craneStartCue,
  cuesForStep,
  rejectionCue,
  SFX_BOOST,
  SHIFT_TICK_SECONDS,
  uiCue,
  winCue,
  type Cue,
  type CueName,
  type UiSoundEvent,
} from './audioCues'
import type { LevelDef, Shift, ShiftAction, ShiftEvent, ShiftState } from '../types/engine'

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
    const before = shift.state
    f()
    cues.push(...cuesForStep(shift.state, batch, before))
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
    expect(names(r.cues).filter((n) => n === 'collect' || n === 'combo')).toEqual(['collect'])
    r.act({ type: 'collect' })
    expect(names(r.cues).filter((n) => n === 'collect' || n === 'combo')).toEqual(['collect', 'collect', 'combo'])
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

  it('a bonus collect layers a rising pentatonic coin cascade and a high shimmer over the chord', () => {
    const [jackpot] = cuesForStep(createShift(timed).state, [{ type: 'bonus-awarded', id: 3, points: 250, ms: 5000 }])
    const coins = jackpot!.tones.filter((t) => t.role === 'coin')
    expect(coins.length).toBeGreaterThanOrEqual(8)
    expect(coins.length).toBeLessThanOrEqual(12)
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
    // The fanfare arpeggio and chord (the character the owner likes) are still there underneath.
    expect(jackpot!.tones.filter((t) => t.role === 'arpeggio')).toHaveLength(10)
    expect(jackpot!.tones.filter((t) => t.role === undefined).length).toBeGreaterThanOrEqual(4)
  })

  it('a bonus collect is the most epic cue: 0.8 to 1.2 s, a rising arpeggio, a power chord hit, the most layers', () => {
    const s = createShift(timed).state
    const [jackpot] = cuesForStep(s, [{ type: 'bonus-awarded', id: 3, points: 250, ms: 5000 }])
    const end = (c: Cue) => Math.max(...c.tones.map((t) => t.delay + t.dur))
    expect(end(jackpot!)).toBeGreaterThanOrEqual(0.8)
    expect(end(jackpot!)).toBeLessThanOrEqual(1.2)
    const arp = jackpot!.tones.filter((t) => t.role === 'arpeggio' && t.type === 'triangle')
    for (let i = 1; i < arp.length; i++) expect(arp[i]!.f0).toBeGreaterThan(arp[i - 1]!.f0)
    const power = jackpot!.tones.filter((t) => t.role === 'power')
    expect(power.length).toBeGreaterThanOrEqual(3)
    for (const t of power) expect(t.f0).toBeLessThan(300)
    // It lands after the arpeggio starts and before the shimmer rings out.
    expect(Math.min(...power.map((t) => t.delay))).toBeGreaterThan(0.15)
    const others = [...allCues(), lastCollect(timed)].filter((c) => c.name !== 'jackpot')
    for (const c of others) expect(jackpot!.tones.length, c.name).toBeGreaterThan(c.tones.length)
    for (const c of others) expect(peakGain(jackpot!), c.name).toBeGreaterThanOrEqual(peakGain(c) - 1e-9)
  })

  it('each collect plays a rising three-note chime whose pitch climbs with the collection index (a level-up ladder)', () => {
    const r = recorder(timed)
    for (let i = 0; i < 4; i++) r.act({ type: 'collect' })
    const roots = r.cues.filter((c) => c.name === 'collect').map((c) => c.tones.filter((t) => t.role === 'chime'))
    expect(roots).toHaveLength(4)
    for (const chime of roots) {
      expect(chime).toHaveLength(3)
      for (let i = 1; i < 3; i++) {
        expect(chime[i]!.f0).toBeGreaterThan(chime[i - 1]!.f0)
        expect(chime[i]!.delay).toBeGreaterThan(chime[i - 1]!.delay)
      }
      for (const t of chime) expect(onPentatonic(t.f0)).toBe(true)
    }
    for (let i = 1; i < roots.length; i++) expect(roots[i]![0]!.f0).toBeGreaterThan(roots[i - 1]![0]!.f0)
    // Every shift climbs the whole span: the first collection starts at step 0, the last on the top.
    for (const count of [4, 9, 16]) {
      expect(collectLadderStep(1, count)).toBe(0)
      expect(collectLadderStep(count, count)).toBe(COLLECT_LADDER_SPAN)
      for (let k = 2; k <= count; k++) expect(collectLadderStep(k, count)).toBeGreaterThanOrEqual(collectLadderStep(k - 1, count))
    }
  })

  it('the last collection of a shift adds a flourish: a quick rising run into a held high bell', () => {
    const r = recorder(timed)
    for (let i = 0; i < 3; i++) r.act({ type: 'collect' })
    for (const c of r.cues) expect(c.tones.some((t) => t.role === 'flourish')).toBe(false)
    const flourish = lastCollect(timed).tones.filter((t) => t.role === 'flourish')
    expect(flourish.length).toBeGreaterThanOrEqual(5)
    const run = flourish.slice(0, -2)
    for (let i = 1; i < run.length; i++) expect(run[i]!.f0).toBeGreaterThan(run[i - 1]!.f0)
    expect(Math.max(...flourish.map((t) => t.dur))).toBeGreaterThanOrEqual(0.3)
  })

  it('the receipt truck arrives with the truck sample, an air-brake hiss and a two-tone horn', () => {
    const [arrival] = cuesForStep(levelState(5), [{ type: 'arrival', id: 11, moves: 3 }])
    expect(arrival!.sample).toBe('truck')
    const hiss = arrival!.tones.filter((t) => t.role === 'hiss')
    expect(hiss).toHaveLength(1)
    expect(hiss[0]!.type).toBe('noise')
    expect(hiss[0]!.f1).toBeLessThan(hiss[0]!.f0)
    const horn = arrival!.tones.filter((t) => t.role === 'horn')
    const honks = [...new Set(horn.map((t) => t.delay))].sort((a, b) => a - b)
    expect(honks).toHaveLength(2)
    expect(honks[0]!).toBeGreaterThan(hiss[0]!.delay) // the brakes hiss as it stops, then it honks
    const top = (at: number) => Math.max(...horn.filter((t) => t.delay === at).map((t) => t.f0))
    expect(top(honks[1]!)).toBeLessThan(top(honks[0]!)) // high then low: two tones
  })

  it('a bonus window opens with a soft twinkle and a miss is a gentle short downward blip', () => {
    const s = createShift(timed).state
    const [open] = cuesForStep(s, [{ type: 'bonus-window', id: 3, ms: 1200 }])
    expect(open!.tones.length).toBeGreaterThanOrEqual(3)
    for (const t of open!.tones) {
      expect(t.type).toBe('sine')
      expect(t.f0).toBeGreaterThan(1000)
      expect(t.vol).toBeLessThanOrEqual(0.03 * SFX_BOOST)
    }
    const [miss] = cuesForStep(s, [{ type: 'bonus-missed', id: 3 }])
    for (const t of miss!.tones) {
      expect(t.f1).toBeLessThan(t.f0)
      expect(t.type).toBe('sine')
    }
    const end = Math.max(...miss!.tones.map((t) => t.delay + t.dur))
    expect(end).toBeLessThanOrEqual(0.25)
  })

  it('the effects are 1.5x louder (owner round 4) and the peak cap rose with them', () => {
    expect(SFX_BOOST).toBe(1.5)
    expect(CUE_PEAK_CAP).toBeCloseTo(0.306 * 1.5)
    expect(comboCue(3).tones[0]!.vol).toBeCloseTo(0.04 * SFX_BOOST)
  })

  // The cap was 0.306 (the old jackpot); owner round 4 asked for louder effects, so it is 0.306 x SFX_BOOST now.
  it('no cue sums louder than the peak cap (0.306 x SFX_BOOST)', () => {
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
    for (const cue of all) expect(peakGain(cue), cue.name).toBeLessThanOrEqual(CUE_PEAK_CAP)
    // A bonus collect plays collect, combo and jackpot in one step: together they stay under 0.45 x SFX_BOOST.
    const r = recorder(timed)
    r.act({ type: 'collect' })
    const collectStep = [...cuesForStep(r.shift.state, [{ type: 'collected', id: 2, from: 1 }]), comboCue(8), all[4]!]
    expect(collectStep.reduce((sum, c) => sum + peakGain(c), 0)).toBeLessThan(0.45 * SFX_BOOST)
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

/** A cue's sound, for telling cues apart: every tone's pitches, timbre and timing, plus its sample. */
function signature(cue: Cue): string {
  const tones = cue.tones.map((t) => `${t.type}:${Math.round(t.f0)}>${Math.round(t.f1)}@${t.delay.toFixed(2)}/${t.dur.toFixed(2)}`)
  return `${cue.sample ?? ''}|${[...tones].sort().join(',')}`
}

function levelState(n: number): ShiftState {
  return createShift(levelByNumber(n)!).state
}

/** One of every cue: a first collection's step, every engine outcome, the combo, crane, deadline-two, win and UI cues. */
function allCues(): Cue[] {
  const s = createShift(timed).state
  const r = recorder(timed)
  r.act({ type: 'collect' })
  const events: ShiftEvent[] = [
    { type: 'received', id: 8, to: 0 },
    { type: 'rehandled', id: 1, from: 0, to: 1 },
    { type: 'arrival', id: 8, moves: 3 },
    { type: 'deadline-one', id: 8 },
    { type: 'deadline-zero', id: 8 },
    { type: 'truck-low' },
    { type: 'overtime-start' },
    { type: 'overtime-end' },
    { type: 'shift-low', seconds: 9 },
    { type: 'bonus-window', id: 3, ms: 1200 },
    { type: 'bonus-awarded', id: 3, points: 250, ms: 5000 },
    { type: 'bonus-missed', id: 3 },
    { type: 'undone', points: -25, ms: 3000 },
    { type: 'failed', reason: 'timeout' },
    { type: 'failed', reason: 'blocked' },
  ]
  const ui: UiSoundEvent[] = [
    { type: 'selected', target: 1 },
    { type: 'selected', target: 'receipt' },
    { type: 'deselected' },
    { type: 'paused' },
    { type: 'resumed' },
  ]
  return [
    ...r.cues,
    rejectionCue(),
    craneStartCue(),
    comboCue(3),
    ...craneCues(0, 1),
    ...cuesForStep({ ...s, deadline: 2 }, [], { ...s, deadline: 3 }),
    ...events.flatMap((e) => cuesForStep(s, [e])),
    winCue(1),
    winCue(2),
    winCue(3),
    ...ui.map(uiCue),
  ]
}

/** The collect cue of a shift's last collection (it carries the flourish). */
function lastCollect(level: LevelDef): Cue {
  const r = recorder(level)
  for (let i = 0; i < level.count; i++) r.act({ type: 'collect' })
  return r.cues.filter((c) => c.name === 'collect').at(-1)!
}

describe('Yardshift sound coverage (art pass 3)', () => {
  const s = createShift(timed).state

  it('a collection plays the load clunk and blip, the truck driving off, the new truck pulling in and a soft next ding', () => {
    const r = recorder(timed)
    r.act({ type: 'collect' })
    expect(names(r.cues)).toEqual(['collect', 'truck-off', 'truck-in', 'next-ready'])
    const [collect, off, arrive, ding] = r.cues
    expect(collect!.tones.some((t) => t.f0 < 200 && t.f1 < t.f0)).toBe(true) // the clunk
    expect(off!.tones[0]!.delay).toBeGreaterThan(0.2) // after the bounce, as the truck pulls away
    expect(arrive!.tones[0]!.delay).toBeGreaterThan(off!.tones[0]!.delay)
    expect(Math.min(...ding!.tones.map((t) => t.delay))).toBeGreaterThan(Math.min(...arrive!.tones.map((t) => t.delay)))
    for (const t of ding!.tones) expect(t.vol).toBeLessThanOrEqual(0.015 * SFX_BOOST)
  })

  it('the last collection sends the truck off with no new truck or ding, then the fanfare', () => {
    const r = recorder(timed)
    for (let i = 0; i < 4; i++) r.act({ type: 'collect' })
    expect(count(r.cues, 'truck-off')).toBe(4)
    expect(count(r.cues, 'truck-in')).toBe(3)
    expect(count(r.cues, 'next-ready')).toBe(3)
    expect(names(r.cues).at(-1)).toBe('win')
  })

  it('the moves-left count fires deadline-two once when it drops to 2, not on an arrival at 2', () => {
    const before = { ...s, deadline: 3 }
    const after = { ...s, deadline: 2 }
    expect(names(cuesForStep(after, [{ type: 'rehandled', id: 1, from: 0, to: 1 }], before))).toEqual(['rehandle', 'deadline-two'])
    expect(names(cuesForStep(after, [{ type: 'arrival', id: 9, moves: 2 }], { ...s, deadline: null }))).toEqual(['arrival'])
    expect(names(cuesForStep(after, [], after))).toEqual([])
    expect(names(cuesForStep({ ...s, deadline: 1 }, [{ type: 'deadline-one', id: 9 }], after))).toEqual(['deadline-one'])
  })

  it('a receipt level fires deadline-two once on the way to mandatory', () => {
    const r = recorder(levelByNumber(4)!)
    r.act({ type: 'rehandle', from: 0, to: 4 })
    r.act({ type: 'collect', from: 0 })
    r.act({ type: 'rehandle', from: 2, to: 3 })
    expect(count(r.cues, 'deadline-two')).toBe(1)
    expect(names(r.cues).filter((n) => n.startsWith('deadline'))).toEqual(['deadline-two', 'deadline-one', 'deadline-zero'])
  })

  it('shift ticks rise in pitch as the shift runs out', () => {
    const pitch = (seconds: number) => cuesForStep(s, [{ type: 'shift-low', seconds }])[0]!.tones[0]!.f0
    for (let i = 1; i < SHIFT_TICK_SECONDS.length; i++) expect(pitch(SHIFT_TICK_SECONDS[i]!)).toBeGreaterThan(pitch(SHIFT_TICK_SECONDS[i - 1]!))
  })

  it('the level-complete fanfare grows with the stars', () => {
    const at = (rehandles: number) => cuesForStep({ ...levelState(1), rehandles }, [{ type: 'completed' }])[0]!
    const [one, two, three] = [winCue(1), winCue(2), winCue(3)]
    expect(three.tones.length).toBeGreaterThan(two.tones.length)
    expect(two.tones.length).toBeGreaterThan(one.tones.length)
    expect([one.detail, two.detail, three.detail]).toEqual([1, 2, 3])
    expect(at(0).detail).toBe(3)
    expect(at(50).detail).toBe(1)
    // A level with no solver fixture (a test level) plays the full fanfare.
    expect(cuesForStep(s, [{ type: 'completed' }])[0]!.detail).toBe(3)
  })

  it('UI sounds: select, receipt selected, deselect, pause and resume map to one cue each', () => {
    expect(uiCue({ type: 'selected', target: 2 }).name).toBe('select')
    expect(uiCue({ type: 'selected', target: 'receipt' }).name).toBe('receipt-select')
    expect(uiCue({ type: 'deselected' }).name).toBe('deselect')
    expect(uiCue({ type: 'paused' }).name).toBe('pause')
    expect(uiCue({ type: 'resumed' }).name).toBe('resume')
  })

  it('every outcome has its own sound (the last collection flourish too), and none sums louder than the cap', () => {
    const all = [...allCues(), lastCollect(timed)]
    const seen = new Map<string, string>()
    for (const cue of all) {
      const sig = signature(cue)
      expect(seen.get(sig), `${cue.name} sounds like ${seen.get(sig)}`).toBeUndefined()
      seen.set(sig, `${cue.name}${cue.detail ?? ''}`)
    }
    expect(new Set(all.map((c) => c.name)).size).toBe(31) // every CueName
    for (const cue of all) expect(peakGain(cue), cue.name).toBeLessThanOrEqual(CUE_PEAK_CAP)
  })

  it('a collection step with combo and bonus stays under the step budget with the truck sounds added', () => {
    const r = recorder(timed)
    r.act({ type: 'collect' })
    const jackpot = cuesForStep(s, [{ type: 'bonus-awarded', id: 3, points: 250, ms: 5000 }])
    const step = [...cuesForStep(r.shift.state, [{ type: 'collected', id: 2, from: 1 }]), comboCue(8), ...jackpot]
    expect(step.reduce((sum, c) => sum + peakGain(c), 0)).toBeLessThan(0.45 * SFX_BOOST)
    // The last collection as a bonus (level 1's #4): flourish, truck off, jackpot and the fanfare in one step.
    const last = [lastCollect(timed), comboCue(4), ...jackpot, winCue(3)]
    expect(last.reduce((sum, c) => sum + peakGain(c), 0)).toBeLessThan(0.6 * SFX_BOOST)
  })
})
