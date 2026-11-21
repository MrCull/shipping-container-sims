import { describe, expect, it } from 'vitest'
import { parseUrlSwitches } from './urlSwitches'

describe('parseUrlSwitches', () => {
  it('no parameters: no quality override, rendering on (real users unchanged)', () => {
    expect(parseUrlSwitches('')).toEqual({ quality: null, render: true })
  })

  it.each(['low', 'medium', 'high', 'auto'] as const)('?quality=%s sets that quality setting', (q) => {
    expect(parseUrlSwitches(`?quality=${q}`).quality).toBe(q)
  })

  it('?render=off switches the final draw off', () => {
    expect(parseUrlSwitches('?render=off')).toEqual({ quality: null, render: false })
  })

  it('reads both switches together, in any order and among other parameters', () => {
    expect(parseUrlSwitches('?benchmark=quick&render=off&quality=low')).toEqual({ quality: 'low', render: false })
  })

  it.each(['?quality=ultra', '?quality=', '?quality=LOW2', '?quality'])('invalid %s falls back to no override', (search) => {
    expect(parseUrlSwitches(search).quality).toBeNull()
  })

  it.each(['?render=on', '?render=no', '?render=', '?render', '?render=0'])('anything but render=off (%s) keeps rendering on', (search) => {
    expect(parseUrlSwitches(search).render).toBe(true)
  })

  it('values are case-insensitive', () => {
    expect(parseUrlSwitches('?quality=Low&render=OFF')).toEqual({ quality: 'low', render: false })
  })
})
