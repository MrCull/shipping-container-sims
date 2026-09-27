// Jev (TypeSafe System One, via OpenRouter Decisions API) request/response/error/command types.
// See .ai/plans/stowage-master/00-jev-overview.md and 01-jev-client-and-key.md for the design.

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

// Fully defined in plan 05 §5.2 (request/response summaries, cost, latency, outcome for the inspector).
export type JevExchange = Record<string, unknown>
