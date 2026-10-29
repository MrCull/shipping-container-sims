/**
 * V11-06: "Follow next truck". The scene model answers which truck arrives next at or after a time, and a truck's phase
 * (waiting for its arrival, present, gone), which the follow camera uses to wait for an arrival and to release on exit.
 */
import { describe, expect, it } from 'vitest'
import { SceneModel } from '../modules/sceneModel'
import { fixtures } from '../scenario/fixtures'
import { shortcutFor, SHORTCUT_HELP } from '../modules/shortcuts'
import { emptyDelta } from './delta'

function model(): SceneModel {
  const m = new SceneModel(fixtures['landside-morning-peak'])
  m.apply(
    emptyDelta({
      entities: [
        { kind: 'truck', id: 'T1', t: 100, status: 'queued' },
        { kind: 'truck', id: 'T2', t: 250, status: 'queued' },
        { kind: 'truck', id: 'T1', t: 400, status: 'gone' },
      ],
    }),
  )
  return m
}

describe('next truck arrival', () => {
  it('picks the earliest arrival at or after the time, even once the engine has run ahead', () => {
    const m = model()
    expect(m.nextTruckArrival(0)).toEqual({ id: 'T1', t: 100 })
    expect(m.nextTruckArrival(100)).toEqual({ id: 'T1', t: 100 })
    expect(m.nextTruckArrival(101)).toEqual({ id: 'T2', t: 250 })
    expect(m.nextTruckArrival(251)).toBeNull() // nothing known yet: wait for the engine to run on
  })

  it('keeps the arrival time after the history before the display time is pruned', () => {
    const m = model()
    m.prune(500)
    expect(m.nextTruckArrival(0)).toEqual({ id: 'T2', t: 250 }) // T1 is gone and forgotten
    expect(m.nextTruckArrival(251)).toBeNull()
  })
})

describe('truck phase', () => {
  it('waits before the arrival, is present after it and gone after it leaves', () => {
    const m = model()
    expect(m.truckPhase('T2', 100)).toBe('waiting')
    expect(m.entityCentre('T2', 100)).toBeNull()
    expect(m.truckPhase('T2', 250)).toBe('present')
    expect(m.truckPhase('T1', 399)).toBe('present')
    expect(m.truckPhase('T1', 400)).toBe('gone')
    expect(m.truckPhase('NOPE', 0)).toBe('gone')
  })
})

describe('shortcut', () => {
  it('N follows the next truck and the help lists it', () => {
    const key = { key: 'n', ctrlKey: false, metaKey: false, altKey: false, target: null }
    expect(shortcutFor(key)).toEqual({ kind: 'followNextTruck' })
    expect(shortcutFor({ ...key, ctrlKey: true })).toBeNull()
    expect(SHORTCUT_HELP.some((r) => r.action === 'shortcuts.followNextTruck')).toBe(true)
  })
})
