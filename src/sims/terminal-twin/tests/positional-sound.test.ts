/**
 * Positional sound playback (#125): the thin Web Audio layer plays the mixer's voices through the one master gain
 * (shared volume and mute). Driven with a fake AudioContext.
 */
import { describe, expect, it } from 'vitest'
import { PositionalSound, type AudioContextLike } from '../modules/positionalSound'
import type { SoundSource } from '../modules/soundMixer'

class FakeParam {
  value = 1
  target: number | null = null
  setTargetAtTime(v: number): void {
    this.target = v
  }
}
class FakeNode {
  gain = new FakeParam()
  connected: unknown[] = []
  connect(n: unknown): void {
    this.connected.push(n)
  }
  disconnect(): void {}
}
class FakeSource extends FakeNode {
  buffer: unknown = null
  loop = false
  started: number | null = null
  stopped = false
  start(_when?: number, offset?: number): void {
    this.started = offset ?? 0
  }
  stop(): void {
    this.stopped = true
  }
}
class FakeContext {
  currentTime = 0
  state = 'running'
  destination = {}
  gains: FakeNode[] = []
  sources: FakeSource[] = []
  createGain(): FakeNode {
    const g = new FakeNode()
    this.gains.push(g)
    return g
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource()
    this.sources.push(s)
    return s
  }
  resume(): Promise<void> {
    return Promise.resolve()
  }
  close(): Promise<void> {
    return Promise.resolve()
  }
}

const cam = { x: 0, y: 10, z: 0 }
const sts = (id: string, x: number, motion: SoundSource['motion'] = 'gantrying'): SoundSource => ({ id, machine: 'sts', x, y: 10, z: 0, motion })

function make(masterGain: () => number) {
  const contexts: FakeContext[] = []
  const player = new PositionalSound(masterGain, {
    createContext: () => {
      const c = new FakeContext()
      contexts.push(c)
      return c as unknown as AudioContextLike
    },
    loadBuffer: () => Promise.resolve({ duration: 1.2 } as AudioBuffer),
  })
  return { player, contexts }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('PositionalSound', () => {
  it('creates nothing while the master gain is 0', async () => {
    const { player, contexts } = make(() => 0)
    player.update(cam, [sts('A', 30)])
    await flush()
    player.update(cam, [sts('A', 30)])
    expect(contexts).toHaveLength(0)
    expect(player.stats().voices).toEqual([])
  })

  it('starts a looping voice for a gantrying source and stops it when the gantry ends', async () => {
    const { player, contexts } = make(() => 0.4)
    player.update(cam, [sts('A', 30)]) // creates the context and starts loading
    await flush()
    player.update(cam, [sts('A', 30)])
    const ctx = contexts[0]
    expect(ctx.sources).toHaveLength(1)
    expect(ctx.sources[0].loop).toBe(true)
    expect(ctx.sources[0].started).not.toBeNull()
    expect(player.stats().voices.map((v) => v.key)).toEqual(['gantryAlarm:A'])
    player.update(cam, [sts('A', 30, 'idle')])
    expect(ctx.sources[0].stopped).toBe(true)
    expect(player.stats().voices).toEqual([])
  })

  it('routes every voice through one master gain node set from the shared gain, and retunes it live', async () => {
    let gain = 0.4
    const { player, contexts } = make(() => gain)
    player.update(cam, [sts('A', 30), sts('B', 60)])
    await flush()
    player.update(cam, [sts('A', 30), sts('B', 60)])
    const ctx = contexts[0]
    const master = ctx.gains[0]
    expect(master.gain.value).toBeCloseTo(0.4)
    expect(master.connected).toEqual([ctx.destination])
    expect(ctx.gains.slice(1).every((g) => g.connected[0] === master)).toBe(true)
    gain = 0.1
    player.applyGain()
    expect(master.gain.value).toBeCloseTo(0.1)
    expect(contexts).toHaveLength(1)
  })

  it('goes silent on mute (all voices stop) and resumes when unmuted', async () => {
    let gain = 0.4
    const { player, contexts } = make(() => gain)
    player.update(cam, [sts('A', 30)])
    await flush()
    player.update(cam, [sts('A', 30)])
    gain = 0
    player.applyGain()
    player.update(cam, [sts('A', 30)])
    expect(contexts[0].sources[0].stopped).toBe(true)
    expect(player.stats().voices).toEqual([])
    gain = 0.4
    player.applyGain()
    player.update(cam, [sts('A', 30)])
    expect(contexts[0].sources).toHaveLength(2)
    expect(player.stats().voices).toHaveLength(1)
  })

  it('makes a nearer machine louder and keeps at most 12 voices', async () => {
    const { player } = make(() => 1)
    const many = Array.from({ length: 20 }, (_, i) => sts(`S${i}`, 30 + i * 5))
    player.update(cam, many)
    await flush()
    player.update(cam, many)
    const { voices } = player.stats()
    expect(voices).toHaveLength(12)
    expect(voices[0].gain).toBeGreaterThan(voices[11].gain)
  })

  it('plays a one-shot once without looping and lets it ring out when its window ends', async () => {
    const { player, contexts } = make(() => 1)
    const lock: SoundSource = { id: 'S1', machine: 'sts', x: 10, y: 10, z: 0, motion: 'locking' }
    player.update(cam, [lock])
    await flush()
    player.update(cam, [lock])
    const ctx = contexts[0]
    const clunk = ctx.sources.at(-1)!
    expect(clunk.loop).toBe(false)
    expect(player.stats().voices.map((v) => v.key)).toEqual(['twistlock:S1'])
    player.update(cam, [])
    expect(clunk.stopped).toBe(false)
    expect(player.stats().voices).toEqual([])
    player.update(cam, [lock]) // a new shot starts again
    expect(ctx.sources.filter((s) => !s.loop)).toHaveLength(2)
  })

  it('loads every sound as soon as the audio context exists, so a short shot is not missed', async () => {
    const loaded: string[] = []
    const player = new PositionalSound(() => 1, {
      createContext: () => new FakeContext() as unknown as AudioContextLike,
      loadBuffer: (_c, sound) => {
        loaded.push(sound)
        return Promise.resolve({ duration: 1 } as AudioBuffer)
      },
    })
    player.update(cam, [sts('A', 30)])
    expect(new Set(loaded).size).toBe(8)
  })

  it('plays the non-positional harbour ambience through the master gain and silences it on mute', async () => {
    let gain = 0.5
    const { player, contexts } = make(() => gain)
    const harbour: SoundSource = { id: 'harbour', machine: 'harbour', x: 0, y: 0, z: 0, motion: 'idle' }
    player.update(cam, [harbour])
    await flush()
    player.update({ x: 9000, y: 50, z: 9000 }, [harbour])
    expect(player.stats().voices.map((v) => v.key)).toEqual(['harbourAmbience:harbour'])
    expect(contexts[0].sources.at(-1)!.loop).toBe(true)
    gain = 0
    player.update(cam, [harbour])
    expect(player.stats().voices).toEqual([])
  })
})
