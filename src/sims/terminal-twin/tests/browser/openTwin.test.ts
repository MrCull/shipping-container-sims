import { describe, expect, it } from 'vitest'
import { twinUrl } from './openTwin'

describe('twinUrl: the URL openTwin boots the Terminal Twin at', () => {
  it('defaults to Low quality with drawing off', () => {
    expect(twinUrl()).toBe('/sim/terminal-twin?quality=low&render=off')
  })

  it('opts in to High quality and real drawing', () => {
    expect(twinUrl({ quality: 'high', render: true })).toBe('/sim/terminal-twin?quality=high')
  })

  it('leaves the quality switch out when the spec keeps the remembered setting', () => {
    expect(twinUrl({ quality: null, render: true })).toBe('/sim/terminal-twin')
  })

  it('keeps extra parameters such as the benchmark tour', () => {
    expect(twinUrl({ params: { benchmark: 'quick' } })).toBe('/sim/terminal-twin?quality=low&render=off&benchmark=quick')
  })
})
