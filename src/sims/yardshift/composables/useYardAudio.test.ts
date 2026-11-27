/** Yardshift sound nodes are released when they end (no node left connected per cue). */
import { describe, expect, it, vi } from 'vitest'
import { releaseOnEnded } from './useYardAudio'

function fakeNode() {
  return { disconnect: vi.fn(), onended: null as null | (() => void) }
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
})
