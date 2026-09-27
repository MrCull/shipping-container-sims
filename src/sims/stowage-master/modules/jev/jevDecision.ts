// Validates a Jev response against the legal slot set, ranks probabilities, and holds the
// application-owned policy for acting on (or rejecting) a decision. Code owns legality and
// side effects; Jev only answers "which of these legal slots?" (see the Jev skill).
//
// See .ai/plans/stowage-master/02-jev-state-and-questions.md §2.5, §2.6, §2.8.

import type { Slot } from '../../types'
import { JevError, type JevChoiceAnswer, type JevResponseBody } from '../../types/jev'
import type { JevGameSnapshot } from './jevStateBuilder'

const PROBABILITY_SUM_TOLERANCE = 0.05

export interface RankedOption {
  slotId: string
  p: number
}

export interface ValidatedDecision {
  answer: JevChoiceAnswer
  /** All legal slots, ranked by probability descending (for the inspector and manual fallback). */
  ranked: RankedOption[]
  /** True when the returned probabilities summed to something far from 1 — logged, not fatal. */
  probabilitySumWarning: boolean
}

export type ValidateDecisionResult =
  | { ok: true; decision: ValidatedDecision }
  | { ok: false; error: JevError }

/**
 * Validates `res.answers.move` against the legal slot set for this move. Checks: the answer
 * exists and is a choice, `choice` is a legal slot, `confidence` is a finite number in [0, 1],
 * and every key in `probabilities` is a legal slot with a finite value in [0, 1]. Missing keys
 * in `probabilities` count as 0. A probability sum far from 1 is a warning, not a failure.
 */
export function validateDecision(res: JevResponseBody, legalSlotIds: string[]): ValidateDecisionResult {
  const raw = res.answers?.move
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: new JevError('invalid_answer', 'Jev response is missing the "move" answer') }
  }

  const candidate = raw as Partial<JevChoiceAnswer>

  if (candidate.type !== 'choice') {
    return {
      ok: false,
      error: new JevError('invalid_answer', `Expected a choice answer for "move", got type "${String(candidate.type)}"`),
    }
  }

  if (typeof candidate.choice !== 'string' || !legalSlotIds.includes(candidate.choice)) {
    return {
      ok: false,
      error: new JevError('invalid_answer', `Jev chose "${String(candidate.choice)}", which is not one of the legal slots`),
    }
  }

  if (
    typeof candidate.confidence !== 'number' ||
    !Number.isFinite(candidate.confidence) ||
    candidate.confidence < 0 ||
    candidate.confidence > 1
  ) {
    return {
      ok: false,
      error: new JevError('invalid_answer', `Jev returned an out-of-range confidence: ${String(candidate.confidence)}`),
    }
  }

  if (!candidate.probabilities || typeof candidate.probabilities !== 'object') {
    return { ok: false, error: new JevError('invalid_answer', 'Jev response is missing "probabilities"') }
  }

  let sum = 0
  for (const [slotId, p] of Object.entries(candidate.probabilities)) {
    if (!legalSlotIds.includes(slotId)) {
      return { ok: false, error: new JevError('invalid_answer', `Probability given for unknown slot "${slotId}"`) }
    }
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) {
      return { ok: false, error: new JevError('invalid_answer', `Out-of-range probability for slot "${slotId}": ${String(p)}`) }
    }
    sum += p
  }
  const probabilitySumWarning = Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE

  const probabilities = candidate.probabilities as Record<string, number>
  const ranked: RankedOption[] = legalSlotIds
    .map(id => ({ slotId: id, p: probabilities[id] ?? 0 }))
    .sort((a, b) => b.p - a.p)

  const answer: JevChoiceAnswer = {
    type: 'choice',
    choice: candidate.choice,
    confidence: candidate.confidence,
    probabilities,
  }

  return { ok: true, decision: { answer, ranked, probabilitySumWarning } }
}

// --- Policy (application-owned; see plan 02 §2.6) ---------------------------------------------

/**
 * The user wants full autonomy, so there is no confidence gate by default (`minConfidenceToAutoplay`
 * is `null`). When set (an opt-in preference), "play all" pauses instead of acting when the
 * chosen answer's confidence is below the threshold, highlighting the suggested slot instead.
 * This never silently substitutes a runner-up or a random slot.
 */
export function shouldPauseForLowConfidence(confidence: number, minConfidenceToAutoplay: number | null): boolean {
  if (minConfidenceToAutoplay === null) return false
  return confidence < minConfidenceToAutoplay
}

// --- Stale-response guard (plan 02 §2.8) ------------------------------------------------------

function buildGridOccupancyHash(grid: Record<string, Slot>): string {
  return Object.keys(grid)
    .filter(id => !!grid[id]?.container)
    .sort()
    .join(',')
}

/**
 * A fingerprint of game progress at the moment a request is sent. Compare the key recorded at
 * send time against `buildMoveKey()` of the live snapshot when the response arrives; a mismatch
 * (or a phase no longer matching the expected `*_selecting`) means the response is stale and
 * must be discarded rather than acted on.
 */
export function buildMoveKey(snapshot: JevGameSnapshot): string {
  return [
    snapshot.level.id,
    snapshot.kind,
    snapshot.moveCount,
    snapshot.dischargedCount,
    snapshot.currentContainerIndex,
    snapshot.restowFromSlotId ?? '-',
    buildGridOccupancyHash(snapshot.grid),
  ].join('|')
}

/** True when `requestMoveKey` (captured when the request was sent) no longer matches `currentSnapshot`. */
export function isStaleResponse(requestMoveKey: string, currentSnapshot: JevGameSnapshot): boolean {
  return requestMoveKey !== buildMoveKey(currentSnapshot)
}
