/**
 * Yardshift store audio cues (#388): a crane move played frame by frame fires its start, pick, land and outcome cues
 * once each, however many frames it takes; idle frames fire nothing.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useYardshiftStore } from './yardshiftStore'
import type { CueName } from '../modules/audioCues'

describe('Yardshift store audio cues', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('one animated collection fires crane-start, pick, land and collect once each', () => {
    const store = useYardshiftStore()
    store.loadLevel(1)
    const heard: CueName[] = []
    store.onCue((c) => heard.push(c.name))
    let now = 0
    store.frame(now)
    store.key('C')
    expect(store.move).not.toBeNull()
    for (let i = 0; i < 120; i++) store.frame((now += 16))
    expect(store.move).toBeNull()
    expect(store.state.collected).toBe(1)
    expect(heard).toEqual(['crane-start', 'pick', 'land', 'collect'])
  })

  it('a rejected move fires invalid once and idle frames fire nothing', () => {
    const store = useYardshiftStore()
    store.loadLevel(1)
    const heard: CueName[] = []
    store.onCue((c) => heard.push(c.name))
    store.dispatch({ type: 'rehandle', from: 0, to: 0 })
    let now = 0
    for (let i = 0; i < 60; i++) store.frame((now += 16))
    expect(heard).toEqual(['invalid'])
  })
})
