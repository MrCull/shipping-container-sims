// Orchestrates Jev's "next move" and "play all" loops: builds the snapshot/state/question,
// sends the request, validates and applies the answer via the command channel (plan 03), and
// retries once or pauses on failure. Code owns legality, execution, staleness and retries; Jev
// only answers "which of these legal slots?" (see .agents/skills/jev-integration/SKILL.md).
//
// See .ai/plans/stowage-master/04-jev-ui-and-controller.md §4.5 for the pseudocode this follows.

import { onScopeDispose, toRaw, watch } from 'vue'
import { useGameStore } from '../store/gameStore'
import { useJevStore } from '../store/jevStore'
import type { GamePhase } from '../types'
import { JEV_CONFIG } from '../modules/jev/jevConfig'
import { requestDecision } from '../modules/jev/jevClient'
import { buildJevState, type JevGameSnapshot } from '../modules/jev/jevStateBuilder'
import { buildMoveQuestion } from '../modules/jev/jevQuestionBuilder'
import { buildMoveKey, isStaleResponse, shouldPauseForLowConfidence, validateDecision } from '../modules/jev/jevDecision'
import { summarizeRequest, summarizeResponse } from '../modules/jev/jevSummaries'
import {
  JevError,
  type JevErrorKind,
  type JevExchange,
  type JevGameResult,
  type JevMoveKind,
  type JevRequestBody,
  type JevResponseBody,
} from '../types/jev'

function phaseToKind(phase: GamePhase): JevMoveKind | null {
  if (phase === 'selecting') return 'load'
  if (phase === 'discharge_selecting') return 'discharge'
  if (phase === 'restow_selecting') return 'restow'
  return null
}

function isSelectingPhase(phase: GamePhase): boolean {
  return phaseToKind(phase) !== null
}

function isTerminalPhase(phase: GamePhase): boolean {
  return phase === 'complete' || phase === 'failed' || phase === 'disaster'
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export interface JevController {
  requestNextMove: () => Promise<void>
  startAutoPlay: () => Promise<void>
  stopAutoPlay: () => void
  resume: () => void
}

/**
 * Instantiate once, inside a component that only exists while `jev.enabled` (JevPanel.vue), so
 * disabled players never create these watchers, timers or in-flight requests.
 */
export function useJevController(): JevController {
  const store = useGameStore()
  const jev = useJevStore()

  let abortController: AbortController | null = null

  /** Snapshot the live game state for one move. Pure data — no Vue reactivity leaks into it. */
  function buildSnapshot(kind: JevMoveKind): JevGameSnapshot {
    const legalSlotIds =
      kind === 'load' ? store.availableSlots :
      kind === 'discharge' ? store.dischargeableSlots :
      store.availableRestowSlots

    return {
      kind,
      level: {
        id: store.currentLevel,
        name: store.levelConfig.name,
        completionMode: store.levelConfig.completionMode ?? 'standard',
      },
      preset: store.shipConfig!,
      // Vue wraps nested slot/container values in reactive proxies on access; toRaw() only
      // strips the outer grid proxy, and structuredClone() cannot clone those nested proxies
      // (throws DataCloneError as soon as any slot holds a container). A JSON round-trip
      // deep-clones the plain data underneath instead.
      grid: JSON.parse(JSON.stringify(toRaw(store.grid))),
      ports: store.currentPorts.map(p => ({ ...p })),
      physics: { list: store.shipList, trim: store.shipTrim, vcg: store.shipVCG },
      score: store.score,
      targetScore: store.targetScore,
      perfectScore: store.perfectScore,
      moveCount: store.moveCount,
      containersTotal: store.containers.length,
      currentContainerIndex: store.currentContainerIndex,
      dischargeCount: store.dischargeCount,
      dischargedCount: store.dischargedCount,
      timer: { total: store.timerTotal, remaining: store.timerRemaining },
      currentContainer: kind === 'load' ? store.currentContainer : null,
      restowContainer: kind === 'restow' ? store.restowContainer : null,
      restowFromSlotId: store.restowFromSlotId,
      upcoming: store.containers.slice(store.currentContainerIndex + 1),
      legalSlotIds: [...legalSlotIds],
      recentEvents: store.events.map(e => e.message),
    }
  }

  interface PreparedRequest {
    body: JevRequestBody
    estTokens: number
    requestSummary: string
  }

  /** Builds the request body plus the inspector's "sent" summary and token estimate in one pass. */
  function prepareRequest(snapshot: JevGameSnapshot): PreparedRequest {
    const stateResult = buildJevState(snapshot)
    const questions = buildMoveQuestion(snapshot)
    const body: JevRequestBody = { model: JEV_CONFIG.model, state: stateResult.state, questions }
    return { body, estTokens: stateResult.estimatedTokens, requestSummary: summarizeRequest(snapshot, stateResult) }
  }

  /** Reads the score/reasons/disaster/physics the game recorded for the move Jev just executed. */
  function captureGameResult(kind: JevMoveKind): JevGameResult {
    const result = kind === 'load' ? store.lastPlacement : store.lastDischarge
    return {
      points: result?.score ?? 0,
      reasons: result?.reasons.map(r => r.text) ?? [],
      disaster: store.disasterType ?? undefined,
      listAfter: store.shipList,
      trimAfter: store.shipTrim,
    }
  }

  /** Records the mapped error, moves the controller to `paused`, and stops auto-play. Auth
   *  errors also forget the key so the player is re-prompted (skill/plan rule). */
  function pause(kind: JevErrorKind, message: string): void {
    jev.recordError(kind, message)
    jev.status = 'paused'
    jev.autoPlay = false
    if (kind === 'auth') {
      jev.forgetKey()
    }
  }

  /** Resolves once `jev.lastCommandResult` matches `commandId`, or after a 2s safety timeout. */
  function waitForAck(commandId: number): Promise<boolean> {
    return new Promise(resolve => {
      let settled = false
      const timeoutId = setTimeout(() => {
        if (settled) return
        settled = true
        stop()
        resolve(false)
      }, 2000)
      const stop = watch(() => jev.lastCommandResult, (result) => {
        if (settled || !result || result.id !== commandId) return
        settled = true
        clearTimeout(timeoutId)
        stop()
        resolve(result.accepted)
      })
    })
  }

  /** Resolves once `store.phase` satisfies `predicate`, or after `timeoutMs` (default 30s — crane
   *  animations normally settle in under a second, but the first placement of a level can be slower
   *  while the browser compiles shaders/decodes geometry for the first time). */
  function waitForPhase(predicate: (phase: GamePhase) => boolean, timeoutMs = 30000): Promise<boolean> {
    return new Promise(resolve => {
      if (predicate(store.phase)) {
        resolve(true)
        return
      }
      let settled = false
      const timeoutId = setTimeout(() => {
        if (settled) return
        settled = true
        stop()
        resolve(false)
      }, timeoutMs)
      const stop = watch(() => store.phase, (phase) => {
        if (settled || !predicate(phase)) return
        settled = true
        clearTimeout(timeoutId)
        stop()
        resolve(true)
      })
    })
  }

  async function requestNextMove(): Promise<void> {
    if (!jev.hasKey) return
    const kind = phaseToKind(store.phase)
    if (!kind) return
    if (jev.status !== 'idle' && jev.status !== 'paused') return

    jev.clearError()
    jev.status = 'requesting'

    let snapshot: JevGameSnapshot
    let moveKey: string
    let prepared: PreparedRequest
    try {
      snapshot = buildSnapshot(kind)
      moveKey = buildMoveKey(snapshot)
      prepared = prepareRequest(snapshot)
    } catch (err) {
      // Any failure while snapshotting the game or building the request (e.g. state that can't
      // be cloned or serialized) must not become an unhandled rejection — that would silently
      // kill the autoplay loop and leave the panel stuck on "Thinking…" forever.
      const jevError = err instanceof JevError
        ? err
        : new JevError('bad_request', err instanceof Error ? err.message : 'Failed to build the Jev request')
      pause(jevError.kind, jevError.message)
      return
    }

    const maxAttempts = 1 + JEV_CONFIG.retriesPerMove

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      abortController = new AbortController()

      const exchangeSeq = jev.recordExchange({
        levelId: snapshot.level.id,
        kind,
        attempt,
        requestSummary: prepared.requestSummary,
        requestBody: prepared.body,
        estTokens: prepared.estTokens,
        outcome: 'pending',
      })

      let result: { response: JevResponseBody; latencyMs: number; generationId?: string }

      try {
        result = await requestDecision(prepared.body, abortController.signal)
      } catch (err) {
        const jevError = err instanceof JevError
          ? err
          : new JevError('network', err instanceof Error ? err.message : 'Jev request failed')

        if (jevError.kind === 'cancelled') {
          jev.updateExchange(exchangeSeq, { outcome: 'cancelled' })
          jev.status = 'idle'
          return
        }

        const errorPatch: Partial<JevExchange> = {
          outcome: 'error' as const,
          error: { kind: jevError.kind, message: jevError.message, status: jevError.status },
        }

        if (!jevError.retryable || attempt >= maxAttempts) {
          jev.updateExchange(exchangeSeq, errorPatch)
          pause(jevError.kind, jevError.message)
          return
        }
        jev.updateExchange(exchangeSeq, errorPatch)

        await delay(Math.min(jevError.retryAfterMs ?? 1000, JEV_CONFIG.maxRetryAfterMs))

        // Only rebuild and retry if the game hasn't moved on while we waited.
        const freshKind = phaseToKind(store.phase) ?? kind
        const freshSnapshot = buildSnapshot(freshKind)
        if (buildMoveKey(freshSnapshot) !== moveKey) {
          jev.status = 'idle'
          return
        }
        snapshot = freshSnapshot
        try {
          prepared = prepareRequest(snapshot)
        } catch (buildErr) {
          const jevBuildError = buildErr instanceof JevError
            ? buildErr
            : new JevError('bad_request', buildErr instanceof Error ? buildErr.message : 'Failed to build the Jev request')
          pause(jevBuildError.kind, jevBuildError.message)
          return
        }
        continue
      }

      // Stale guard: discard the answer if the game progressed (or left this phase) while
      // the request was in flight — the level timer keeps running during Jev requests.
      const liveKind = phaseToKind(store.phase)
      const liveSnapshot = liveKind ? buildSnapshot(liveKind) : null
      if (!liveSnapshot || isStaleResponse(moveKey, liveSnapshot)) {
        jev.updateExchange(exchangeSeq, {
          outcome: 'stale',
          responseBody: result.response,
          latencyMs: result.latencyMs,
          model: result.response.model,
          generationId: result.generationId,
          costUsd: result.response.usage?.cost,
        })
        jev.status = 'idle'
        return
      }

      const validated = validateDecision(result.response, snapshot.legalSlotIds)

      const responsePatch: Partial<JevExchange> = {
        responseBody: result.response,
        latencyMs: result.latencyMs,
        model: result.response.model,
        generationId: result.generationId,
        costUsd: result.response.usage?.cost,
      }

      if (!validated.ok) {
        jev.updateExchange(exchangeSeq, {
          ...responsePatch,
          outcome: 'error',
          error: { kind: validated.error.kind, message: validated.error.message },
        })
        if (attempt >= maxAttempts) {
          pause(validated.error.kind, validated.error.message)
          return
        }
        continue
      }

      const responseSummary = summarizeResponse({
        decision: validated.decision,
        latencyMs: result.latencyMs,
        usage: result.response.usage,
        model: result.response.model,
      })

      jev.updateExchange(exchangeSeq, {
        ...responsePatch,
        responseSummary,
        ranked: validated.decision.ranked,
        choice: validated.decision.answer.choice,
        confidence: validated.decision.answer.confidence,
        warnings: validated.decision.probabilitySumWarning ? ['Probabilities did not sum to ~1.'] : undefined,
      })

      if (
        jev.autoPlay &&
        jev.minConfidenceToAutoplay !== null &&
        shouldPauseForLowConfidence(validated.decision.answer.confidence, jev.minConfidenceToAutoplay)
      ) {
        jev.updateExchange(exchangeSeq, { outcome: 'paused_low_confidence' })
        pause(
          'invalid_answer',
          `Paused: confidence ${validated.decision.answer.confidence.toFixed(2)} is below your threshold.`,
        )
        return
      }

      jev.status = 'executing'
      const commandId = jev.issueCommand(kind, validated.decision.answer.choice)
      const accepted = await waitForAck(commandId)
      if (!accepted) {
        jev.updateExchange(exchangeSeq, { outcome: 'rejected' })
        if (attempt >= maxAttempts) {
          pause('invalid_answer', "Jev's chosen move was rejected by the game.")
          return
        }
        continue
      }

      jev.movesByJevThisLevel++
      jev.sessionCostUsd += result.response.usage?.cost ?? 0

      jev.status = 'settling'
      const settledInTime = await waitForPhase(phase => isSelectingPhase(phase) || isTerminalPhase(phase))
      if (!settledInTime) {
        jev.updateExchange(exchangeSeq, {
          outcome: 'error',
          error: { kind: 'timeout', message: 'Move animation did not finish in time.' },
        })
        pause('timeout', 'Move animation did not finish in time.')
        return
      }

      jev.updateExchange(exchangeSeq, { outcome: 'executed', gameResult: captureGameResult(kind) })

      await delay(jev.settleDelayMs)
      jev.status = 'idle'

      // Discharge → restow chaining: one "Next move" (or one play-all step) also places a
      // lifted transit container, so the game is never left with a hovering box.
      if (kind === 'discharge' && store.phase === 'restow_selecting') {
        await requestNextMove()
      }
      return
    }
  }

  function endAutoPlay(): void {
    jev.autoPlay = false
    if (jev.status !== 'paused') {
      jev.status = 'idle'
    }
  }

  async function startAutoPlay(): Promise<void> {
    if (!jev.hasKey || jev.autoPlay) return
    jev.autoPlay = true

    while (jev.autoPlay) {
      const phase = store.phase

      if (isTerminalPhase(phase) || phase === 'start' || phase === 'briefing') {
        endAutoPlay()
        break
      }

      if (!isSelectingPhase(phase)) {
        const reached = await waitForPhase(p => isSelectingPhase(p) || isTerminalPhase(p))
        if (!jev.autoPlay) break
        if (!reached) {
          pause('timeout', 'Move animation did not finish in time.')
          break
        }
        continue
      }

      await requestNextMove()

      if (!jev.autoPlay) break
      if (jev.status === 'paused') {
        jev.autoPlay = false
        break
      }
    }

    if (jev.status !== 'paused') {
      jev.autoPlay = false
      jev.status = 'idle'
    }
  }

  /** Stops play-all (or an in-flight single step) immediately: aborts the request, clears any
   *  error and returns to `idle`. Used for the Stop button and for the auto-stop watchers below. */
  function stopAutoPlay(): void {
    jev.autoPlay = false
    abortController?.abort()
    abortController = null
    jev.clearError()
    jev.status = 'idle'
  }

  /** Clears a paused state so the caller (JevPanel) can immediately retry the single step or
   *  restart play-all. Does not itself resend a request. */
  function resume(): void {
    jev.clearError()
    jev.status = 'idle'
  }

  // Auto-stop conditions that don't depend on this composable's own call stack: leaving the
  // level (phase returns to the start menu or a fresh briefing begins), the key being forgotten,
  // or Jev being disabled entirely.
  const stopPhaseWatch = watch(() => store.phase, (phase) => {
    if (jev.autoPlay && (phase === 'start' || phase === 'briefing')) {
      stopAutoPlay()
    }
  })

  const stopKeyWatch = watch(() => jev.hasKey, (hasKey) => {
    if (!hasKey && jev.autoPlay) {
      stopAutoPlay()
    }
  })

  const stopEnabledWatch = watch(() => jev.enabled, (enabled) => {
    if (!enabled) {
      stopAutoPlay()
    }
  })

  onScopeDispose(() => {
    stopPhaseWatch()
    stopKeyWatch()
    stopEnabledWatch()
    abortController?.abort()
    abortController = null
  })

  return { requestNextMove, startAutoPlay, stopAutoPlay, resume }
}
