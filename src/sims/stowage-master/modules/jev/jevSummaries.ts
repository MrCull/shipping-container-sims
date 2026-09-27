// Pure functions producing short human-readable strings for the Jev inspector (plan 05).
// These NEVER invent or imply a rationale for Jev's choice (skill rule) — only the evidence
// sent and the probabilities returned.
//
// See .ai/plans/stowage-master/02-jev-state-and-questions.md §2.10.

import type { Slot } from '../../types'
import { getListLevel, getTrimLevel } from '../physics'
import { round1, round2, type BuildJevStateResult, type JevGameSnapshot } from './jevStateBuilder'
import type { ValidatedDecision } from './jevDecision'

function describeMove(snapshot: JevGameSnapshot): string {
  if (snapshot.kind === 'load') {
    const c = snapshot.currentContainer
    if (!c) return 'LOAD (no container)'
    const segments = [`LOAD ${c.id}`, `${round1(c.weight)} t ${c.weightCategory}`, `${c.port} (#${c.portOrder})`]
    if (c.isHazmat) segments.push('HAZMAT')
    return segments.join(' · ')
  }

  if (snapshot.kind === 'discharge') {
    const remaining = Math.max(0, snapshot.dischargeCount - snapshot.dischargedCount)
    return `DISCHARGE · ${remaining} import${remaining === 1 ? '' : 's'} remaining`
  }

  const c = snapshot.restowContainer
  if (!c) return 'RESTOW (no container)'
  const segments = [
    `RESTOW ${c.id}`,
    `${round1(c.weight)} t ${c.weightCategory}`,
    `${c.port} (#${c.portOrder})`,
    `from ${snapshot.restowFromSlotId ?? '?'}`,
  ]
  if (c.isHazmat) segments.push('HAZMAT')
  return segments.join(' · ')
}

function combinedStabilityStatus(list: number, trim: number): 'normal' | 'warning' | 'critical' {
  const order = { normal: 0, warning: 1, critical: 2 } as const
  const listStatus = getListLevel(list)
  const trimStatus = getTrimLevel(trim)
  return order[listStatus] >= order[trimStatus] ? listStatus : trimStatus
}

function describeStability(physics: { list: number; trim: number }): string {
  const side = physics.list > 0.01 ? 'stbd' : physics.list < -0.01 ? 'port' : 'even'
  const end = physics.trim > 0.01 ? 'bow' : physics.trim < -0.01 ? 'stern' : 'even'
  const status = combinedStabilityStatus(physics.list, physics.trim)
  return `list ${round1(Math.abs(physics.list))}° ${side}, trim ${round1(Math.abs(physics.trim))}° ${end} (${status})`
}

function describeBayPlanFill(grid: Record<string, Slot>): string {
  const slots = Object.values(grid)
  const filled = slots.filter(s => s.container).length
  return `bay plan ${filled}/${slots.length} slots filled`
}

/** Summarises what was sent to Jev for one move, for the inspector's "sent" panel. */
export function summarizeRequest(snapshot: JevGameSnapshot, stateResult: BuildJevStateResult): string {
  const segments = [
    describeMove(snapshot),
    `${snapshot.legalSlotIds.length} legal slot${snapshot.legalSlotIds.length === 1 ? '' : 's'}`,
    describeStability(snapshot.physics),
    describeBayPlanFill(snapshot.grid),
  ]

  if (snapshot.kind === 'load') {
    const shown = Math.min(snapshot.upcoming.length, 12)
    segments.push(`next ${shown} of ${snapshot.upcoming.length} queued shown`)
  }

  segments.push(`≈ ${(stateResult.estimatedTokens / 1000).toFixed(1)}K tokens`)

  return segments.join(' — ')
}

/** TypeSafe's confidence bands: <0.5 low, 0.5-0.9 moderate, >0.9 high. */
export function confidenceLabel(confidence: number): 'low' | 'moderate' | 'high' {
  if (confidence > 0.9) return 'high'
  if (confidence >= 0.5) return 'moderate'
  return 'low'
}

export interface JevResponseSummaryInput {
  decision: ValidatedDecision
  latencyMs: number
  usage?: { cost?: number }
  model?: string
}

/**
 * Summarises what Jev returned for one move, for the inspector's "received" panel. Never states
 * or implies a reason for the choice — only the chosen slot, its probability/confidence, the
 * runners-up, latency, cost and model.
 */
export function summarizeResponse(input: JevResponseSummaryInput): string {
  const { decision, latencyMs, usage, model } = input
  const top = decision.ranked.find(r => r.slotId === decision.answer.choice) ?? decision.ranked[0]
  const runnersUp = decision.ranked.filter(r => r.slotId !== decision.answer.choice).slice(0, 3)
  const label = confidenceLabel(decision.answer.confidence)

  const lines: string[] = [
    `Chose ${decision.answer.choice} (p ${round2(top?.p ?? 0)}, confidence ${round2(decision.answer.confidence)} — ${label}).`,
  ]

  if (runnersUp.length > 0) {
    lines.push(`Next: ${runnersUp.map(r => `${r.slotId} ${round2(r.p)}`).join(' · ')}.`)
  }

  const tail: string[] = [`${(latencyMs / 1000).toFixed(1)} s`]
  if (usage?.cost != null) tail.push(`$${usage.cost.toFixed(5)}`)
  if (model) tail.push(model)
  lines.push(tail.join(' · '))

  return lines.join(' ')
}
