// Jev (TypeSafe System One, via OpenRouter Decisions API) request/response/error/command types.
// See .ai/plans/stowage-master/00-jev-overview.md and 01-jev-client-and-key.md for the design.

import type { DisasterType } from './index'

export type JevMoveKind = 'load' | 'discharge' | 'restow'

export interface JevChoiceQuestion {
  type: 'choice'
  instructions: string
  criteria: Record<string, string> // optionKey (slot ID) → description
}

export interface JevRequestBody {
  model: string
  state: Record<string, unknown>
  questions: Record<string, JevChoiceQuestion>
  session_id?: string
}

export interface JevChoiceAnswer {
  type: 'choice'
  choice: string
  confidence: number
  probabilities: Record<string, number>
}

export interface JevResponseBody {
  id: string
  model: string
  provider?: string
  answers: Record<string, unknown> // validated into JevChoiceAnswer in plan 02
  usage?: { input_tokens?: number; output_tokens?: number; cost?: number }
}

export type JevErrorKind =
  | 'auth' // 401, 403 → pause immediately, forget the key, re-prompt
  | 'credits' // 402 (not in-flight budget) → pause immediately
  | 'bad_request' // 400, 413 → pause immediately (bug or state too big)
  | 'rate_limited' // 429, 402 in-flight budget → retryable (honour Retry-After, cap 10 s)
  | 'server' // 5xx, 524, 529 → retryable
  | 'network' // fetch threw (offline, DNS, CORS) → retryable
  | 'timeout' // our AbortController timeout → retryable
  | 'invalid_answer' // 2xx but answer missing, malformed or not a legal option → retryable
  | 'cancelled' // user stopped or left the level → silent, never retried

export class JevError extends Error {
  public kind: JevErrorKind
  public status?: number
  public retryAfterMs?: number

  constructor(kind: JevErrorKind, message: string, status?: number, retryAfterMs?: number) {
    super(message)
    this.name = 'JevError'
    this.kind = kind
    this.status = status
    this.retryAfterMs = retryAfterMs
  }

  get retryable(): boolean {
    return (
      this.kind === 'rate_limited' ||
      this.kind === 'server' ||
      this.kind === 'network' ||
      this.kind === 'timeout' ||
      this.kind === 'invalid_answer'
    )
  }
}

export interface JevMoveCommand {
  id: number
  kind: JevMoveKind
  slotId: string
}

export type JevControllerStatus = 'idle' | 'requesting' | 'executing' | 'settling' | 'paused' | 'error'

/** Score/reasons/disaster/physics captured from the game right after an executed Jev move. */
export interface JevGameResult {
  points: number
  reasons: string[]
  disaster?: DisasterType
  listAfter: number
  trimAfter: number
}

export type JevExchangeOutcome =
  | 'pending'
  | 'executed'
  | 'stale'
  | 'rejected'
  | 'error'
  | 'cancelled'
  | 'paused_low_confidence'

/**
 * One Jev request/response pair plus its outcome, recorded for the inspector (plan 05 §5.2).
 * Held in `jevStore.history`, newest first, capped at `JEV_CONFIG.historyLimit`. In-memory only —
 * never persisted, cleared on disable.
 */
export interface JevExchange {
  seq: number // 1-based within the session
  at: number // Date.now()
  levelId: number
  kind: JevMoveKind
  attempt: number // 1 or 2
  requestSummary: string // summarizeRequest() (02 §2.10)
  requestBody: JevRequestBody // full body (state + questions); the key is never in the body
  estTokens: number
  // filled on response
  responseSummary?: string // summarizeResponse()
  responseBody?: JevResponseBody
  ranked?: Array<{ slotId: string; p: number }>
  choice?: string
  confidence?: number
  latencyMs?: number
  costUsd?: number
  model?: string
  generationId?: string
  // outcome
  outcome: JevExchangeOutcome
  error?: { kind: JevErrorKind; message: string; status?: number }
  gameResult?: JevGameResult
  warnings?: string[] // e.g. probabilities didn't sum to ~1, budget degradation step applied
}
