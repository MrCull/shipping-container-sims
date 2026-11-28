/**
 * Yardshift background music (#390): the track plays only while a shift is running. The intro, pause menu, level
 * picker, a hidden tab and the end of the shift stop it; a crane move (the `animation` pause) does not.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useYardshiftStore } from '../store/yardshiftStore'
import { fixtureFor } from './fixtures'
import { MUSIC_GAIN, musicPlaying } from './music'

describe('Yardshift music', () => {
  it('sits at 60 % of its earlier level (owner round 4: quieter music under louder effects)', () => {
    expect(MUSIC_GAIN).toBeCloseTo(0.3 * 0.6)
  })

  beforeEach(() => setActivePinia(createPinia()))

  it('is silent on the intro and plays once the shift starts', () => {
    const store = useYardshiftStore()
    store.loadLevel(1, { intro: true })
    expect(musicPlaying(store.state)).toBe(false)
    store.startShift()
    expect(musicPlaying(store.state)).toBe(true)
  })

  it('keeps playing through a crane move', () => {
    const store = useYardshiftStore()
    store.loadLevel(1)
    store.frame(0)
    store.key('C')
    expect(store.move).not.toBeNull()
    expect(musicPlaying(store.state)).toBe(true)
  })

  it('pauses with the pause menu, the level picker and a hidden tab, and resumes after', () => {
    const store = useYardshiftStore()
    store.loadLevel(1)
    store.pause()
    expect(musicPlaying(store.state)).toBe(false)
    store.resume()
    expect(musicPlaying(store.state)).toBe(true)
    store.openLevels()
    expect(musicPlaying(store.state)).toBe(false)
    store.closeLevels()
    store.resume()
    expect(musicPlaying(store.state)).toBe(true)
    store.setHidden(true)
    expect(musicPlaying(store.state)).toBe(false)
    store.setHidden(false)
    expect(musicPlaying(store.state)).toBe(true)
  })

  it('stops when the shift ends', () => {
    const store = useYardshiftStore()
    store.loadLevel(1)
    for (const action of fixtureFor(1)?.actions ?? []) store.dispatch(action)
    expect(store.state.status).toBe('complete')
    expect(musicPlaying(store.state)).toBe(false)
  })
})
