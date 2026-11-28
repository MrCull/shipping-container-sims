/** Yardshift sound nodes are released when they end (no node left connected per cue). */
import { describe, expect, it, vi } from 'vitest'
import { createSfxChain, installAudioUnlock, playTone, releaseOnEnded } from './useYardAudio'
import { cuesForStep, SFX_LIMITER, SFX_MAKEUP_GAIN } from '../modules/audioCues'
import { createShift } from '../modules/engine'
import { levelByNumber, TUTORIAL } from '../modules/levels'

function fakeNode() {
  return { disconnect: vi.fn(), onended: null as null | (() => void) }
}

/** A Web Audio stand-in that records every node it makes, where it connects, and its envelope peak. */
function fakeContext() {
  const param = () => ({ setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() })
  const nodes: Array<ReturnType<typeof fakeNode> & { to: unknown[]; gain?: ReturnType<typeof param> }> = []
  function node<T extends object>(extra: T) {
    const n = Object.assign(fakeNode(), { to: [] as unknown[] }, extra)
    Object.assign(n, { connect: (dest: unknown) => (n.to.push(dest), dest) })
    nodes.push(n)
    return n
  }
  const ac = {
    currentTime: 0,
    sampleRate: 8000,
    createOscillator: () => node({ type: 'sine', frequency: param(), start: vi.fn(), stop: vi.fn() }),
    createGain: () => node({ gain: param() }),
    createBuffer: (_channels: number, length: number) => {
      const data = new Float32Array(length)
      return { getChannelData: () => data }
    },
    createBufferSource: () => node({ buffer: null as unknown, start: vi.fn(), stop: vi.fn() }),
    createBiquadFilter: () => node({ type: 'lowpass', Q: { value: 1 }, frequency: param() }),
    createDynamicsCompressor: () =>
      node({ threshold: { value: -24 }, knee: { value: 30 }, ratio: { value: 12 }, attack: { value: 0.003 }, release: { value: 0.25 } }),
    destination: { name: 'destination' },
  }
  return { ac: ac as unknown as BaseAudioContext, nodes }
}

describe('Yardshift audio nodes', () => {
  it('the sfx bus (slider gain) feeds a 2x makeup gain and a limiter before the speakers (owner round 5)', () => {
    const { ac } = fakeContext()
    const { bus, limiter } = createSfxChain(ac, 0.4)
    expect(bus.gain.value).toBe(0.4)
    const [makeup] = (bus as unknown as { to: Array<GainNode & { to: unknown[] }> }).to
    expect(makeup!.gain.value).toBe(SFX_MAKEUP_GAIN)
    expect(SFX_MAKEUP_GAIN).toBe(2)
    expect(makeup!.to).toEqual([limiter])
    expect((limiter as unknown as { to: unknown[] }).to).toEqual([ac.destination])
    expect(limiter.threshold.value).toBe(SFX_LIMITER.threshold)
    expect(limiter.knee.value).toBe(0)
    expect(limiter.ratio.value).toBeGreaterThanOrEqual(12)
    expect(limiter.attack.value).toBeLessThanOrEqual(0.005)
    expect(SFX_LIMITER.threshold).toBeCloseTo(-10)
  })

  it('disconnects the source and its gain once the source ends', () => {
    const src = fakeNode()
    const env = fakeNode()
    releaseOnEnded(src as unknown as AudioScheduledSourceNode, env as unknown as AudioNode)
    expect(src.disconnect).not.toHaveBeenCalled()
    src.onended!()
    expect(src.disconnect).toHaveBeenCalledTimes(1)
    expect(env.disconnect).toHaveBeenCalledTimes(1)
  })

  it('a bonus collect plays every layer into the sfx bus and leaves no node connected when it ends', () => {
    const { ac, nodes } = fakeContext()
    const bus = { name: 'bus' } as unknown as AudioNode
    const [jackpot] = cuesForStep(createShift(TUTORIAL).state, [{ type: 'bonus-awarded', id: 1, points: 250, ms: 5000 }])
    for (const t of jackpot!.tones) playTone(ac, bus, t)
    const envs = nodes.filter((n) => n.gain)
    expect(envs).toHaveLength(jackpot!.tones.length)
    for (const env of envs) expect(env.to).toEqual([bus])
    // Each envelope peaks at its tone's own relative gain; the bus applies gainFor(1, 'sfx').
    envs.forEach((env, i) => expect(env.gain!.exponentialRampToValueAtTime).toHaveBeenCalledWith(jackpot!.tones[i]!.vol, expect.any(Number)))
    for (const n of nodes) if (n.onended) n.onended()
    for (const n of nodes) expect(n.disconnect).toHaveBeenCalledTimes(1)
  })

  it('the arrival hiss plays band-passed noise into the sfx bus and releases every node when it ends', () => {
    const { ac, nodes } = fakeContext()
    const bus = { name: 'bus' } as unknown as AudioNode
    const [arrival] = cuesForStep(createShift(levelByNumber(5)!).state, [{ type: 'arrival', id: 11, moves: 3 }])
    const hiss = arrival!.tones.find((t) => t.type === 'noise')!
    playTone(ac, bus, hiss)
    const filter = nodes.find((n) => 'Q' in n) as unknown as { type: string; to: unknown[] }
    expect(filter.type).toBe('bandpass')
    const env = nodes.find((n) => n.gain)!
    expect(filter.to).toEqual([env])
    expect(env.to).toEqual([bus])
    for (const n of nodes) if (n.onended) n.onended()
    for (const n of nodes) expect(n.disconnect).toHaveBeenCalledTimes(1)
  })
})

/** An AudioContext stand-in for the unlock: a state iOS keeps 'suspended' (or 'interrupted') until a gesture resumes it. */
function unlockContext(state: string) {
  const sources: Array<{ buffer: unknown; start: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> }> = []
  const ac = {
    state,
    destination: { name: 'destination' },
    resume: vi.fn(() => Promise.resolve()),
    createBuffer: vi.fn((channels: number, length: number, rate: number) => ({ channels, length, rate })),
    createBufferSource: () => {
      const s = { buffer: null as unknown, start: vi.fn(), connect: vi.fn() }
      sources.push(s)
      return s
    },
  }
  return { ac, sources }
}

describe('Yardshift audio unlock (iOS)', () => {
  it('resumes the context on every pointerdown or touchend until it runs, and plays one silent buffer on the first', () => {
    const { ac, sources } = unlockContext('suspended')
    const target = new EventTarget()
    const stop = installAudioUnlock(target, () => ac as unknown as AudioContext)
    target.dispatchEvent(new Event('pointerdown'))
    expect(ac.resume).toHaveBeenCalledTimes(1)
    expect(sources).toHaveLength(1)
    expect(ac.createBuffer).toHaveBeenCalledWith(1, 1, expect.any(Number))
    expect(sources[0]!.connect).toHaveBeenCalledWith(ac.destination)
    expect(sources[0]!.start).toHaveBeenCalledTimes(1)
    // Still suspended (iOS ignored the first resume): the next gesture tries again, with no second buffer.
    target.dispatchEvent(new Event('touchend'))
    expect(ac.resume).toHaveBeenCalledTimes(2)
    expect(sources).toHaveLength(1)
    // An interruption (a call, the app backgrounded) is resumed the same way.
    ac.state = 'interrupted'
    target.dispatchEvent(new Event('pointerdown'))
    expect(ac.resume).toHaveBeenCalledTimes(3)
    // Running: gestures do nothing.
    ac.state = 'running'
    target.dispatchEvent(new Event('touchend'))
    target.dispatchEvent(new Event('keydown'))
    expect(ac.resume).toHaveBeenCalledTimes(3)
    stop()
    ac.state = 'suspended'
    target.dispatchEvent(new Event('pointerdown'))
    expect(ac.resume).toHaveBeenCalledTimes(3)
  })

  it('waits for a context: no context yet means no buffer is spent', () => {
    const { ac, sources } = unlockContext('suspended')
    const target = new EventTarget()
    let ready: AudioContext | null = null
    installAudioUnlock(target, () => ready)
    target.dispatchEvent(new Event('pointerdown'))
    expect(sources).toHaveLength(0)
    ready = ac as unknown as AudioContext
    target.dispatchEvent(new Event('pointerdown'))
    expect(sources).toHaveLength(1)
    expect(ac.resume).toHaveBeenCalledTimes(1)
  })
})
