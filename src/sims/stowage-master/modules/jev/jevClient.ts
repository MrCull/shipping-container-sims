// Pure fetch-based client for the OpenRouter Decisions API (Jev). No Vue or Pinia imports here —
// keep this module testable in isolation. See .ai/plans/stowage-master/01-jev-client-and-key.md §1.1
// for the verified provider facts (endpoint, headers, error table) this file implements.

import { JEV_CONFIG } from './jevConfig'
import { getApiKeyForRequest } from './jevKeyVault'
import { JevError, type JevErrorKind, type JevRequestBody, type JevResponseBody } from '../../types/jev'

interface JevApiErrorBody {
  error?: {
    code?: string | number
    message?: string
    metadata?: { limit_source?: string; [key: string]: unknown }
  }
}

interface KeyInfoBody {
  data?: {
    label?: string
    limit?: number | null
    limit_remaining?: number | null
    usage?: number
    [key: string]: unknown
  }
}

/** Parses a `Retry-After` header (seconds, or an HTTP date) into a millisecond delay, capped. */
function parseRetryAfterMs(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined
  const asSeconds = Number(headerValue)
  let ms: number | undefined
  if (Number.isFinite(asSeconds)) {
    ms = asSeconds * 1000
  } else {
    const asDate = Date.parse(headerValue)
    if (!Number.isNaN(asDate)) ms = asDate - Date.now()
  }
  if (ms === undefined || ms < 0) return undefined
  return Math.min(ms, JEV_CONFIG.maxRetryAfterMs)
}

/** Best-effort parse of an OpenRouter/Jev error body. Never throws. */
async function parseErrorBody(response: Response): Promise<JevApiErrorBody> {
  try {
    return (await response.json()) as JevApiErrorBody
  } catch {
    return {}
  }
}

/** Maps an HTTP status (plus parsed body) to a `JevErrorKind`, per the table in plan 01 §1.1. */
function mapStatusToErrorKind(status: number, body: JevApiErrorBody): JevErrorKind {
  switch (status) {
    case 400:
    case 413:
      return 'bad_request'
    case 401:
    case 403:
      return 'auth'
    case 402: {
      const limitSource = body.error?.metadata?.limit_source
      return limitSource === 'openrouter_in_flight_budget' ? 'rate_limited' : 'credits'
    }
    case 404:
      return 'bad_request'
    case 429:
      return 'rate_limited'
    case 500:
    case 502:
    case 503:
      return 'server'
    case 524:
      return 'timeout'
    case 529:
      return 'server'
    default:
      return status >= 500 ? 'server' : 'bad_request'
  }
}

function friendlyMessage(body: JevApiErrorBody, status: number): string {
  return body.error?.message ?? `Jev request failed with status ${status}.`
}

/**
 * Runs `fetch`, combining the caller's `signal` (user cancel) with an internal timeout so both
 * cases can be distinguished afterwards (`'cancelled'` vs `'timeout'`).
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  let timedOut = false
  let cancelled = false

  const onCallerAbort = () => {
    cancelled = true
    controller.abort()
  }

  if (signal) {
    if (signal.aborted) {
      cancelled = true
      controller.abort()
    } else {
      signal.addEventListener('abort', onCallerAbort)
    }
  }

  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    if (cancelled) {
      throw new JevError('cancelled', 'Request cancelled')
    }
    if (timedOut) {
      throw new JevError('timeout', `Jev request timed out after ${timeoutMs}ms`)
    }
    const message = err instanceof Error ? err.message : 'Network request failed'
    throw new JevError('network', message)
  } finally {
    clearTimeout(timeoutId)
    if (signal) signal.removeEventListener('abort', onCallerAbort)
  }
}

/**
 * Validates a candidate API key against `GET /api/v1/key`. The key is only passed as a
 * parameter here — it is not read from, or written to, the vault. Callers store the key
 * (via `setApiKey`) only after this resolves `ok: true`.
 */
export async function validateApiKey(
  key: string,
  signal?: AbortSignal,
): Promise<{ ok: true; limitRemaining: number | null; label?: string } | { ok: false; error: JevError }> {
  const trimmedKey = key.trim()
  if (!trimmedKey) {
    return { ok: false, error: new JevError('auth', 'No API key provided') }
  }

  try {
    const response = await fetchWithTimeout(
      JEV_CONFIG.keyInfoEndpoint,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${trimmedKey}` },
      },
      signal,
      JEV_CONFIG.requestTimeoutMs,
    )

    if (!response.ok) {
      const errorBody = await parseErrorBody(response)
      const kind = mapStatusToErrorKind(response.status, errorBody)
      return {
        ok: false,
        error: new JevError(kind, friendlyMessage(errorBody, response.status), response.status),
      }
    }

    let body: KeyInfoBody
    try {
      body = (await response.json()) as KeyInfoBody
    } catch {
      return { ok: false, error: new JevError('invalid_answer', 'Key check returned an unreadable response') }
    }

    return {
      ok: true,
      limitRemaining: body.data?.limit_remaining ?? null,
      label: body.data?.label,
    }
  } catch (err) {
    if (err instanceof JevError) return { ok: false, error: err }
    return { ok: false, error: new JevError('network', err instanceof Error ? err.message : 'Network request failed') }
  }
}

/**
 * Sends one Decisions request to Jev. Throws `JevError` on any failure (auth, credits,
 * bad request, rate limit, server error, network error, timeout, cancellation, or an
 * unparsable response).
 */
export async function requestDecision(
  body: JevRequestBody,
  signal?: AbortSignal,
): Promise<{ response: JevResponseBody; latencyMs: number; generationId?: string }> {
  const apiKey = getApiKeyForRequest()
  if (!apiKey) {
    throw new JevError('auth', 'No API key set')
  }

  const startedAt = Date.now()

  const response = await fetchWithTimeout(
    JEV_CONFIG.endpoint,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : '',
        'X-Title': JEV_CONFIG.appTitle,
      },
      body: JSON.stringify(body),
    },
    signal,
    JEV_CONFIG.requestTimeoutMs,
  )

  const latencyMs = Date.now() - startedAt

  if (!response.ok) {
    const errorBody = await parseErrorBody(response)
    const kind = mapStatusToErrorKind(response.status, errorBody)
    const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'))
    throw new JevError(kind, friendlyMessage(errorBody, response.status), response.status, retryAfterMs)
  }

  let parsed: JevResponseBody
  try {
    parsed = (await response.json()) as JevResponseBody
  } catch {
    throw new JevError('invalid_answer', 'Jev returned a response that was not valid JSON', response.status)
  }

  if (!parsed || typeof parsed !== 'object' || !parsed.answers) {
    throw new JevError('invalid_answer', 'Jev response is missing the answers field', response.status)
  }

  const generationId = response.headers.get('X-Generation-Id') ?? undefined

  return { response: parsed, latencyMs, generationId }
}
