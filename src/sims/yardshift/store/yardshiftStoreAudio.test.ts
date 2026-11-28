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
    expect(heard).toEqual(['crane-start', 'pick', 'land', 'collect', 'truck-off', 'truck-in', 'next-ready'])
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

  /** A stack whose top is not the next container, so a tap selects it instead of collecting. */
  function buried(store: ReturnType<typeof useYardshiftStore>): number {
    const j = store.state.stacks.findIndex((s) => s.length > 0 && s.at(-1) !== store.state.next)
    expect(j).toBeGreaterThanOrEqual(0)
    return j
  }

  /** A store on `level` with every cue and yard event recorded. */
  function listening(level: number): { store: ReturnType<typeof useYardshiftStore>; heard: CueName[]; events: string[] } {
    const store = useYardshiftStore()
    store.loadLevel(level)
    const heard: CueName[] = []
    const events: string[] = []
    store.onCue((c) => heard.push(c.name))
    store.onYardEvent((e) => events.push(e.type))
    return { store, heard, events }
  }

  it('selecting a container fires select once, tapping it again fires deselect once', () => {
    const { store, heard, events } = listening(1)
    store.tapTarget({ kind: 'stack', index: buried(store) })
    expect(heard).toEqual(['select'])
    expect(events).toEqual(['selected'])
    store.tapTarget({ kind: 'stack', index: buried(store) })
    expect(heard).toEqual(['select', 'deselect'])
    expect(events).toEqual(['selected', 'deselected'])
    // A tap on nothing with nothing selected changes nothing: no sound.
    store.tapTarget(null)
    expect(heard).toEqual(['select', 'deselect'])
  })

  it('a move from a selection plays the crane, not a deselect', () => {
    const { store, heard } = listening(1)
    store.tapTarget({ kind: 'stack', index: buried(store) })
    store.tapTarget({ kind: 'stack', index: buried(store) === 0 ? 1 : 0 })
    expect(heard[0]).toBe('select')
    expect(heard).not.toContain('deselect')
    expect(heard.slice(1)).toEqual(store.move ? ['crane-start'] : ['invalid'])
  })

  it('selecting the waiting receipt truck fires receipt-select once', () => {
    const { store, heard, events } = listening(4)
    store.tapTarget({ kind: 'receipt' })
    expect(store.ui.selection).toBe('receipt')
    expect(heard).toEqual(['receipt-select'])
    expect(events).toEqual(['selected'])
  })

  it('pause and resume fire one cue and one yard event each', () => {
    const { store, heard, events } = listening(1)
    store.pause()
    store.pause()
    expect(heard).toEqual(['pause'])
    store.resume()
    expect(heard).toEqual(['pause', 'resume'])
    expect(events).toEqual(['paused', 'resumed'])
  })

  it('the moves-left count dropping to 2 fires deadline-two once through the store', () => {
    const { store, heard } = listening(4)
    store.dispatch({ type: 'rehandle', from: 0, to: 4 })
    store.dispatch({ type: 'collect', from: 0 })
    store.dispatch({ type: 'rehandle', from: 2, to: 3 })
    expect(heard.filter((n) => n.startsWith('deadline'))).toEqual(['deadline-two', 'deadline-one', 'deadline-zero'])
  })
})
