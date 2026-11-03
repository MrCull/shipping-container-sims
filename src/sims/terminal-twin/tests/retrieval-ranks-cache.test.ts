/* eslint-disable no-restricted-imports -- unit test of engine internals (the cache has no public seam) */
/**
 * #228: `retrievalRanks` is cached per block until a stack of the block changes (a box placed, lifted or rehandled) or a
 * vessel slot gets a booked box. The cache must answer exactly what a fresh computation answers after every kind of change.
 */
import { describe, expect, it } from 'vitest'
import type { SimState } from '../engine/state'
import { notePlanChanged } from '../engine/yardIndex'
import { placeInStack, removeFromStack } from '../engine/subsystems/ascStorage'
import { computeRetrievalRanks, retrievalRanks } from '../engine/subsystems/rehandle'
import type { ScenarioConfig } from '../scenario/types'

const config = { vessels: [{ id: 'V1' }, { id: 'V2' }] } as unknown as ScenarioConfig

function makeState(): SimState {
  const containers: Record<string, unknown> = {}
  const vesselSlots: Record<string, unknown> = {}
  for (const [n, vessel, bay] of [
    ['c1', 'V1', 1],
    ['c2', 'V1', 2],
    ['c3', 'V2', 3],
    ['c4', 'V2', 4],
  ] as const) {
    containers[n] = { id: n, size: '20', vesselId: vessel }
    vesselSlots[`s-${n}`] = { id: `s-${n}`, vesselId: vessel, bay, row: 1, tier: 2, half: 'hold', purpose: 'load', plannedContainerId: n }
  }
  const state = {
    containers,
    vesselSlots,
    yardSlots: {},
    yardBlocks: { B1: { bays: 8, rows: 4, heights: new Array(32).fill(0), topVessels: new Array(32).fill(null) } },
  } as unknown as SimState
  return state
}

const asObj = (m: Map<string, number>): Record<string, number> => Object.fromEntries(m)

describe('retrievalRanks cache (#228)', () => {
  it('matches a fresh computation after a box is placed, lifted and rehandled', () => {
    const state = makeState()
    const same = (): void => {
      expect(asObj(retrievalRanks(state, config, 'B1'))).toEqual(asObj(computeRetrievalRanks(state, config, 'B1')))
    }
    same() // empty block: builds the index
    expect(retrievalRanks(state, config, 'B1').size).toBe(0)

    placeInStack(state, 'B1', 'B1:1-1-1', 'c3')
    same()
    expect(retrievalRanks(state, config, 'B1').get('c3')).toBe(0)
    placeInStack(state, 'B1', 'B1:2-1-1', 'c1')
    same()
    expect(retrievalRanks(state, config, 'B1').get('c1')).toBe(0) // V1 is first in vessel order
    expect(retrievalRanks(state, config, 'B1').get('c3')).toBe(1)

    // lifted
    removeFromStack(state, 'B1:2-1-1')
    same()
    expect(retrievalRanks(state, config, 'B1').has('c1')).toBe(false)

    // rehandled: lifted from one stack and stacked in another
    removeFromStack(state, 'B1:1-1-1')
    same()
    placeInStack(state, 'B1', 'B1:5-2-1', 'c3')
    same()
    placeInStack(state, 'B1', 'B1:6-2-1', 'c4')
    same()
    expect([...retrievalRanks(state, config, 'B1').keys()].sort()).toEqual(['c3', 'c4'])
  })

  it('returns the same Map while nothing changed, a new one after a change', () => {
    const state = makeState()
    placeInStack(state, 'B1', 'B1:1-1-1', 'c1')
    const a = retrievalRanks(state, config, 'B1')
    expect(retrievalRanks(state, config, 'B1')).toBe(a)
    placeInStack(state, 'B1', 'B1:2-1-1', 'c2')
    expect(retrievalRanks(state, config, 'B1')).not.toBe(a)
  })

  it('a change in another block leaves the cache; a booking change drops it', () => {
    const state = makeState()
    ;(state.yardBlocks as Record<string, unknown>).B2 = { bays: 8, rows: 4, heights: new Array(32).fill(0), topVessels: new Array(32).fill(null) }
    placeInStack(state, 'B1', 'B1:1-1-1', 'c1')
    const a = retrievalRanks(state, config, 'B1')
    placeInStack(state, 'B2', 'B2:1-1-1', 'c2')
    expect(retrievalRanks(state, config, 'B1')).toBe(a)
    // c1's booking moves to a later vessel slot: the order of the block changes with it
    placeInStack(state, 'B1', 'B1:3-1-1', 'c3')
    expect(asObj(retrievalRanks(state, config, 'B1'))).toEqual({ c1: 0, c3: 1 })
    ;(state.vesselSlots['s-c1'] as { vesselId: string }).vesselId = 'V2'
    ;(state.vesselSlots['s-c1'] as { bay: number }).bay = 9
    notePlanChanged(state)
    expect(asObj(retrievalRanks(state, config, 'B1'))).toEqual(asObj(computeRetrievalRanks(state, config, 'B1')))
    expect(retrievalRanks(state, config, 'B1').get('c3')).toBe(0)
  })
})
