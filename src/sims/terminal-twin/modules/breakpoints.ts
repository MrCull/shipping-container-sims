/**
 * Debugger breakpoints (TT-18). Pure TS with no DOM: the engine worker uses
 * `eventMatchesBreakpoint` as the stop predicate of every run, the UI uses the
 * rest to build and list breakpoints.
 */
import type { EngineEvent } from '../engine'

export type BreakpointKind = 'eventType' | 'container' | 'equipment' | 'decision'

export const BREAKPOINT_KINDS: readonly BreakpointKind[] = ['eventType', 'container', 'equipment', 'decision']

export interface Breakpoint {
  id: number
  kind: BreakpointKind
  /** Event type name, container id, equipment id or decision-point id. */
  value: string
}

/** Decision events carry `payload.decisionPoint`. */
function decisionPointOf(event: EngineEvent): string | null {
  if (event.type !== 'DecisionRequested' && event.type !== 'DecisionResolved' && event.type !== 'DecisionFailed') return null
  return (event.payload as { decisionPoint: string }).decisionPoint
}

/** Whether `event` (just processed) should stop the run for this breakpoint. */
export function eventMatchesBreakpoint(bp: Breakpoint, event: EngineEvent): boolean {
  switch (bp.kind) {
    case 'eventType':
      return event.type === bp.value
    case 'container':
      return event.subjects.containers?.includes(bp.value) ?? false
    case 'equipment':
      return event.subjects.equipment?.includes(bp.value) ?? false
    case 'decision':
      return decisionPointOf(event) === bp.value
  }
}

/** The first breakpoint of the list that `event` hits, or null. */
export function firstBreakpointHit(list: readonly Breakpoint[], event: EngineEvent): Breakpoint | null {
  return list.find((bp) => eventMatchesBreakpoint(bp, event)) ?? null
}

/** Text typed by the user to a breakpoint without an id; null when empty. */
export function parseBreakpointInput(kind: BreakpointKind, text: string): { kind: BreakpointKind; value: string } | null {
  const value = text.trim()
  return value ? { kind, value } : null
}

/** Short machine label, e.g. `equipment:SHC01` (list entries, tests). */
export function breakpointLabel(bp: Breakpoint): string {
  return `${bp.kind}:${bp.value}`
}
