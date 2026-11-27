/** Yardshift sound nodes are released when they end (no node left connected per cue). */
import { describe, expect, it, vi } from 'vitest'
import { playTone, releaseOnEnded } from './useYardAudio'
import { cuesForStep } from '../modules/audioCues'
import { createShift } from '../modules/engine'
import { TUTORIAL } from '../modules/levels'

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
    createOscillator: () => node({ type: 'sine', frequency: param(), start: vi.fn(), stop: vi.fn() }),
    createGain: () => node({ gain: param() }),
  }
  return { ac: ac as unknown as BaseAudioContext, nodes }
}

describe('Yardshift audio nodes', () => {
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
})
