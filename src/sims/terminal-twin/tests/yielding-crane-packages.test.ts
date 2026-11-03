import { describe, expect, it } from 'vitest'
import { createSimulation } from '../engine'
import { fixtures } from '../scenario/fixtures'

/**
 * #229: a crane is not started on a discharge package it cannot reach because a neighbour holds the rail there. Three
 * cranes on one vessel, parked close together: they meet on the rail at every package change.
 */
const config = () => fixtures['crane-split-4sts']

describe('work package start with a neighbour on the rail', () => {
  it('no crane starts a package and waits for the rail on its first lift', () => {
    const sim = createSimulation(config())
    expect(sim.runUntil().reason).toBe('ended')
    const log = sim.eventLog()
    const key = (e: { t: number; payload: unknown }) => `${(e.payload as { stsId: string }).stsId}@${e.t}`
    const started = new Set(log.filter((e) => e.type === 'WorkPackageStarted').map(key))
    const stalled = log.filter((e) => e.type === 'StsWaitingForRail' && started.has(key(e))).map(key)
    expect(stalled).toEqual([])
    expect(sim.invariantReport().violations).toEqual([])
    expect(sim.kpiReport().movesCompleted).toBe(60)
  })
})
