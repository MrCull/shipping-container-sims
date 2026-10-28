/**
 * Debugger breakpoints (TT-18): which events a breakpoint stops on, checked on
 * real events from a run.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, type EngineEvent } from '../engine'
import { fixtures } from '../scenario/fixtures'
import { breakpointLabel, eventMatchesBreakpoint, parseBreakpointInput, type Breakpoint } from '../modules/breakpoints'

function runLog(): readonly EngineEvent[] {
  const sim = createSimulation(fixtures['shc-1sts-2shc-1wtp'])
  sim.runUntil()
  return sim.eventLog()
}
const log = runLog()
const bp = (kind: Breakpoint['kind'], value: string): Breakpoint => ({ id: 1, kind, value })
const matches = (b: Breakpoint) => log.filter((e) => eventMatchesBreakpoint(b, e))

describe('eventMatchesBreakpoint', () => {
  it('an event-type breakpoint matches exactly the events of that type', () => {
    const hits = matches(bp('eventType', 'StsPicked'))
    expect(hits.length).toBe(log.filter((e) => e.type === 'StsPicked').length)
    expect(hits.length).toBeGreaterThan(0)
    expect(matches(bp('eventType', 'NoSuchEvent'))).toEqual([])
  })

  it('a container breakpoint matches every event that names the container', () => {
    const id = log.find((e) => e.type === 'StsPicked')!.subjects.containers![0]
    const hits = matches(bp('container', id))
    expect(hits.length).toBeGreaterThan(2)
    for (const e of hits) expect(e.subjects.containers).toContain(id)
  })

  it('an equipment breakpoint matches events of that equipment id', () => {
    const hits = matches(bp('equipment', 'SHC01'))
    expect(hits.length).toBeGreaterThan(0)
    for (const e of hits) expect(e.subjects.equipment).toContain('SHC01')
  })

  it('a decision-point breakpoint matches the request, resolution and failure of that decision point only', () => {
    const hits = matches(bp('decision', 'shcDispatch'))
    expect(hits.length).toBeGreaterThan(0)
    for (const e of hits) {
      expect(['DecisionRequested', 'DecisionResolved', 'DecisionFailed']).toContain(e.type)
      expect((e.payload as { decisionPoint: string }).decisionPoint).toBe('shcDispatch')
    }
    expect(matches(bp('decision', 'stsGroundPosition')).length).toBeGreaterThan(0)
  })
})

describe('parseBreakpointInput', () => {
  it('trims, rejects empty text and keeps the kind', () => {
    expect(parseBreakpointInput('eventType', '  StsPicked ')).toEqual({ kind: 'eventType', value: 'StsPicked' })
    expect(parseBreakpointInput('container', '   ')).toBeNull()
  })

  it('labels a breakpoint by kind and value', () => {
    expect(breakpointLabel(bp('equipment', 'SHC01'))).toBe('equipment:SHC01')
  })
})
