# 01 — Jev types, config, key vault, client and store

> Part of the **Stowage Master × Jev** plan set. Read [00-jev-overview.md](00-jev-overview.md) first.
> Depends on: nothing. Blocks: 02 (types), 03 (store), 04.

## 1.1 Provider facts (verified 2026-09-27; re-check the docs before shipping)

Sources: [OpenRouter Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request), [How to use Jev](https://openrouter.ai/blog/tutorials/how-to-use-jev/), [jev-1.13 page](https://openrouter.ai/typesafe/jev-1.13/api), [TypeSafe confidence](https://docs.typesafe.ai/confidence).

- **Endpoint:** `POST https://openrouter.ai/api/alpha/decisions`.
  - The API reference implies `/api/v1/api/alpha/decisions`, but that URL returns **404**. Use the URL above.
- **Headers:**
  - `Authorization: Bearer <key>` and `Content-Type: application/json`.
  - Optional `HTTP-Referer: <window.location.origin>` and `X-Title: Shipping Container Sims – Stowage Master` (both allowed by the CORS preflight).
- **CORS:** the preflight returns `204` with `Access-Control-Allow-Origin: *`, and POST responses carry the same header. Browser `fetch` works.
- **Request body:** `{ model, state, questions }`.
  - Optional fields: `session_id` (≤256 chars), `user` (≤256), `provider`, `trace`.
  - There is **no** `metadata` field.
- **Model:** pin `typesafe/jev-1.13`. The response `model` shows the dated build (e.g. `typesafe/jev-1.13-20260917`); record it in the inspector.
- **Choice question:** `{ type: 'choice', instructions: string, criteria: Record<optionKey, description> }`, **max 255 options**.
- **Response:**
  ```json
  { "id": "gen-dec-…", "model": "typesafe/jev-1.13-20260917", "provider": "TypeSafe",
    "answers": { "<qid>": { "type": "choice", "choice": "<optionKey>", "confidence": 0.75,
                            "probabilities": { "<optionKey>": 0.84, "…": 0.16 } } },
    "usage": { "input_tokens": 476, "output_tokens": 70, "cost": 0.000019992 } }
  ```
- **Errors:** body `{ error: { code, message, metadata? } }`.

  | Status | Meaning |
  |---|---|
  | 400 | Bad request |
  | 401 | Bad key (`"User not found."`) |
  | 402 | Insufficient credits. `error.metadata.limit_source` is `openrouter_credits`, `openrouter_key_limit` or `openrouter_in_flight_budget`; for the in-flight case, honour `Retry-After`. |
  | 403 | Forbidden |
  | 404 | Not found |
  | 413 | Payload too large |
  | 429 | Rate limited (`Retry-After` / `X-RateLimit-*` headers) |
  | 500, 502, 503 | Server error |
  | 524 | Timeout |
  | 529 | Provider error |
- **Key check:** `GET https://openrouter.ai/api/v1/key` with the Bearer key.
  - Returns `{ data: { label, limit, limit_remaining, usage, … } }` (check the exact wrapper at implementation time).
  - CORS-friendly. A bad key gives 401.
- **Limits:** Jev has a 32K-token context. State size limits are otherwise undocumented. A 413 is possible.
- **Price:** $0.042 per 1M input tokens, $0 output.
- **Confidence guidance (TypeSafe):** <0.5 low, 0.5–0.9 moderate, >0.9 high. Confidence is **not** the probability of being correct.

## 1.2 `types/jev.ts`

```ts
export type JevMoveKind = 'load' | 'discharge' | 'restow'

export interface JevChoiceQuestion {
  type: 'choice'
  instructions: string
  criteria: Record<string, string>      // optionKey (slot ID) → description
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
  answers: Record<string, unknown>      // validated into JevChoiceAnswer in 02
  usage?: { input_tokens?: number; output_tokens?: number; cost?: number }
}

export type JevErrorKind =
  | 'auth'            // 401, 403 → pause immediately, forget the key, re-prompt
  | 'credits'         // 402 (not in-flight budget) → pause immediately
  | 'bad_request'     // 400, 413 → pause immediately (bug or state too big)
  | 'rate_limited'    // 429, 402 in-flight budget → retryable (honour Retry-After, cap 10 s)
  | 'server'          // 5xx, 524, 529 → retryable
  | 'network'         // fetch threw (offline, DNS, CORS) → retryable
  | 'timeout'         // our AbortController timeout → retryable
  | 'invalid_answer'  // 2xx but answer missing, malformed or not a legal option → retryable
  | 'cancelled'       // user stopped or left the level → silent, never retried

export class JevError extends Error {
  constructor(public kind: JevErrorKind, message: string,
              public status?: number, public retryAfterMs?: number) { super(message) }
  get retryable(): boolean { return ['rate_limited','server','network','timeout','invalid_answer'].includes(this.kind) }
}

export interface JevMoveCommand { id: number; kind: JevMoveKind; slotId: string }

export type JevControllerStatus =
  | 'idle' | 'requesting' | 'executing' | 'settling' | 'paused' | 'error'

export interface JevExchange { /* defined in 05 §5.2 */ }
```

## 1.3 `modules/jev/jevConfig.ts`

Put every tunable here, never inline:

```ts
export const JEV_CONFIG = {
  endpoint: 'https://openrouter.ai/api/alpha/decisions',
  keyInfoEndpoint: 'https://openrouter.ai/api/v1/key',
  model: 'typesafe/jev-1.13',
  appTitle: 'Shipping Container Sims – Stowage Master',
  requestTimeoutMs: 20_000,
  maxRetryAfterMs: 10_000,
  retriesPerMove: 1,               // "retry once, then pause"
  defaultSettleDelayMs: 350,       // see 03 §3.4
  maxStateTokensEstimate: 24_000,  // leave headroom under the 32K context (02 §2.7)
  historyLimit: 50,                // inspector exchanges kept in memory
  stateSchemaVersion: 'sm-jev-state-v1',
  questionVersion: 'sm-jev-q-v1',
  prefsStorageKey: 'stowage-master-jev-prefs',   // prefs only, NEVER the key
} as const
```

## 1.4 `modules/jev/jevKeyVault.ts`: in-memory key holder

```ts
let apiKey: string | null = null   // module scope: not reactive, not in Pinia, not persisted

export function setApiKey(key: string): void { apiKey = key.trim() || null }
export function clearApiKey(): void { apiKey = null }
export function hasApiKey(): boolean { return apiKey !== null }
/** Only jevClient.ts should import this. */
export function getApiKeyForRequest(): string | null { return apiKey }
```

Rules (put them in a header comment in the file):

- **Never** write the key to localStorage, sessionStorage, IndexedDB, cookies, Pinia state, `console.*`, `trackEvent`, the inspector history, error messages or the URL.
- The Pinia store mirrors only a boolean `hasKey` (see 1.6), so Vue devtools never shows the key.
- Lost on full page reload. Kept across SPA route changes, since the module stays loaded; that counts as "in memory for this tab".
- `clearApiKey()` runs on "Forget key", on "Disable Jev", and automatically on a 401/403.
- The key input in the dialog is `type="password"`, `autocomplete="off"`, `spellcheck="false"`, `name` not set (so browsers don't offer to save it). Clear the input's ref as soon as the key is handed to the vault.
- A key typed on this page is visible in the tab's memory and the network panel to someone at the player's own machine. This is accepted for bring-your-own-key and disclosed in the dialog.

## 1.5 `modules/jev/jevClient.ts`

```ts
export async function validateApiKey(key: string, signal?: AbortSignal):
  Promise<{ ok: true; limitRemaining: number | null; label?: string } | { ok: false; error: JevError }>

export async function requestDecision(body: JevRequestBody, signal?: AbortSignal):
  Promise<{ response: JevResponseBody; latencyMs: number; generationId?: string }>
```

Implementation notes:

- Read the key with `getApiKeyForRequest()`. If there is no key, throw `JevError('auth', 'No API key set')`. `validateApiKey` takes the candidate key as a parameter, so a key is only stored after it validates.
- Combine the caller's `signal` (user cancel) with an internal timeout `AbortController` (`requestTimeoutMs`). Map the timeout to `'timeout'` and a caller abort to `'cancelled'`.
- Map HTTP status → `JevErrorKind` using the table in 1.1. Parse `Retry-After` (seconds or HTTP date) into `retryAfterMs`, capped at `maxRetryAfterMs`. Distinguish a 402 with `limit_source === 'openrouter_in_flight_budget'` (→ `rate_limited`) from the other 402s (→ `credits`).
- The message shown to users is `error.message` from the body, or a friendly fallback. Never include request headers in errors.
- Read `X-Generation-Id` from the exposed response headers for the inspector.
- Parse JSON defensively. Invalid JSON on a 2xx → `invalid_answer`.
- Keep this module free of Vue and Pinia imports (pure TS, testable).

## 1.6 `store/jevStore.ts` (initial shape; 03, 04 and 05 add to it)

```ts
export const useJevStore = defineStore('stowage-master-jev', () => {
  // Persisted prefs (localStorage key JEV_CONFIG.prefsStorageKey), NEVER the key
  const enabled = ref(false)
  const showInspector = ref(false)
  const settleDelayMs = ref(JEV_CONFIG.defaultSettleDelayMs)
  const minConfidenceToAutoplay = ref<number | null>(null)   // null = off (02 §2.6, 04 §4.2)

  // Session state (not persisted)
  const hasKey = ref(hasApiKey())            // boolean mirror of the vault
  const keyLimitRemaining = ref<number | null>(null)
  const status = ref<JevControllerStatus>('idle')
  const autoPlay = ref(false)
  const lastError = ref<{ kind: JevErrorKind; message: string } | null>(null)
  const movesByJevThisLevel = ref(0)
  const sessionCostUsd = ref(0)
  const isKeyDialogOpen = ref(false)
  const isBusy = computed(() => autoPlay.value || status.value === 'requesting'
                               || status.value === 'executing' || status.value === 'settling')

  // Command channel (03 §3.2) and exchange history (05) are added here

  function enable(), disable(), setKey(key, limitRemaining), forgetKey(), openKeyDialog(), …
})
```

- Load and save prefs with try/catch around `localStorage` (the store already does this for bests), and validate types on load.
- `disable()` stops auto-play, aborts any in-flight request (through the controller), calls `forgetKey()` and sets `enabled = false`.
- `forgetKey()` calls `clearApiKey()` and sets `hasKey = false`.

## Acceptance criteria

- `validateApiKey` with a real key returns `ok` with `limitRemaining`. With a junk key it returns an `auth` error. Check both manually in the browser; the network tab should show a successful CORS request.
- `requestDecision` with a tiny hand-made Choice body returns a parsed response. Try it from a dev-only console helper and remove the helper afterwards.
- Searching the source for `localStorage`/`sessionStorage` inside `modules/jev` and `store/jevStore.ts` finds only the prefs key. No code path logs or persists the key.
- `npm run lint` and `npm run build` pass.
