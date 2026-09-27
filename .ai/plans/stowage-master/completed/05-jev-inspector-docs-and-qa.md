# 05 — Jev inspector, documentation, QA and completion

> Part of the **Stowage Master × Jev** plan set. Read [00-jev-overview.md](00-jev-overview.md) first.
> Depends on: 04.

## 5.1 Purpose

When **Show Jev details** is on, the player can see, for each Jev move:

- a summary of **what was sent** (move, container, stability, candidate count, size), with the full raw request JSON on demand;
- a summary of **what came back** (choice, confidence, top probabilities, latency, cost, model build), with the raw response on demand;
- **what happened**: executed, and the score delta and reasons from the game, or retried, stale, rejected or errored.

Jev returns no explanation, so the inspector must not invent one (skill rule). It shows evidence and probabilities only.

## 5.2 `JevExchange` record (in `types/jev.ts`)

```ts
export interface JevExchange {
  seq: number                       // 1-based within the session
  at: number                        // Date.now()
  levelId: number
  kind: JevMoveKind
  attempt: number                   // 1 or 2
  requestSummary: string            // summarizeRequest() (02 §2.10)
  requestBody: JevRequestBody       // full body (state + questions); the key is never in the body
  estTokens: number
  // filled on response
  responseSummary?: string          // summarizeResponse()
  responseBody?: JevResponseBody
  ranked?: Array<{ slotId: string; p: number }>
  choice?: string
  confidence?: number
  latencyMs?: number
  costUsd?: number
  model?: string
  generationId?: string
  // outcome
  outcome: 'pending' | 'executed' | 'stale' | 'rejected' | 'error' | 'cancelled' | 'paused_low_confidence'
  error?: { kind: JevErrorKind; message: string; status?: number }
  gameResult?: { points: number; reasons: string[]; disaster?: DisasterType; listAfter: number; trimAfter: number }
  warnings?: string[]               // e.g. probabilities didn't sum to ~1, budget degradation step applied
}
```

- Store the history in `jevStore.history`, newest first, capped at `JEV_CONFIG.historyLimit` (50). Use `shallowRef` and replace the array on update, so Vue doesn't deep-proxy large request bodies. It lives in memory only: never persisted, cleared on disable.
- **`gameResult`:** after `executed`, the controller captures the next `gameStore.lastPlacement` / `lastDischarge` change, or `disasterType`, plus the physics after the move, and patches the exchange.

## 5.3 `components/jev/JevInspector.vue`

A collapsible drawer anchored to the right edge, opened from **Details ▸** in `JevPanel`. Default width is ~360px, max `40vw`; it's a full-width bottom sheet under 700px. It must not capture canvas clicks outside its own bounds.

- **Header:**
  - The session totals: exchanges, executed, errors, total cost (sum of `usage.cost`), and average latency.
  - A **Clear** button.
  - A reminder: "Jev returns choices and probabilities, not explanations."
- **List:** one card per exchange, newest first.
  - **Line 1:** `#14 · LOAD · 07-02-04 · conf 0.62 (moderate) · 1.8 s · $0.0004 · ✔ +75`
  - **Sent ▸:** expands to `requestSummary`, plus a compact view of `state.stability`, `state.move` and the option list (slot ID + description).
  - **Received ▸:** expands to `responseSummary` and a probability bar list of the top 8 options (a horizontal bar per option, chosen option highlighted, remaining options summed as "others").
  - **Outcome:** the score reasons from `gameResult`, or the error or stale message.
  - **Raw JSON ▸:** `<pre>` of the request and response (pretty-printed, lazily rendered only when expanded), with **Copy** buttons (`navigator.clipboard.writeText`). Before rendering or copying, confirm the object has no `Authorization` field. It shouldn't, because headers are never stored; the check is defence in depth.
- Keep rendering cheap: render only the expanded cards' details, and use `v-memo` or plain computed strings for the rows.
- Use scoped styles and design tokens. Use the existing retro/dark HUD look (compare `EventFeed.vue` / `LastPlacement.vue`).

## 5.4 Documentation updates (same change set)

1. **`src/sims/stowage-master/stowage-master-AGENTS.md`:**
   - Add a **"Jev assist (optional)"** section covering:
     - the file map (from 00);
     - the command-channel pattern (03), and a warning never to call the store's `placeContainer` etc. directly from Jev code, because the animation would be skipped;
     - the key-handling rules (in-memory vault only);
     - the raw-state boundary (no predicted outcomes);
     - versioning (`stateSchemaVersion`, `questionVersion`, `JEV_RULES_VERSION`);
     - the provider endpoint gotcha (`/api/alpha/decisions`, not `/api/v1/...`).
   - Add the `modules/jev/*`, `store/jevStore.ts`, `composables/useJevController.ts` and `components/jev/*` entries to the folder layout.
   - **Fix the physics threshold table** to match `config.PHYSICS` (list 5/8/12, trim 4/7/10). Note that `store.isWarning` / `isCritical` still hardcode older values (8/12, 6/9), and flag this to the user as a follow-up. Don't change gameplay in this plan.
   - Correct the folder layout if it's still wrong: most HUD components live in `components/`, not `components/ui/`.
2. **Root `AGENTS.md`:** under *Sim-specific agent guides → Stowage Master*, add ", optional Jev assist". No other root changes are needed; the skill is already indexed.
3. **`.agents/skills/jev-integration/`:** no change required. If implementation shows new provider facts (e.g. the endpoint 404 gotcha, the response field `choice`), consider adding a short note to `references/using-jev.md`, but only if they're provider-level facts rather than Stowage-Master specifics.

## 5.5 Manual QA checklist

Run `npm run dev` and test in Chrome (plus Firefox for the key dialog and CORS).

**Hidden by default**

- [ ] With cleared site data, the Start screen shows only the faint `Jev` link and there's no Jev UI in-game. J / Shift+J do nothing.

**Key handling**

- [ ] A junk key gives an error, and the application storage in devtools holds no key.
- [ ] A valid key enables Jev and shows the remaining credit (if limited).
- [ ] With a valid key set, the devtools Application tab (localStorage, sessionStorage, IndexedDB, cookies) and the Pinia devtools don't contain the key string.
- [ ] After a refresh, Jev is still enabled but the key is gone (`key needed`).
- [ ] Forget key and Disable both work. Disable also hides the in-game panel.

**Single step**

- [ ] L1: Next move discharges an import (full crane + truck animation, score popup).
- [ ] L4: Jev lifts a transit container and places it in one press. Also: lift one manually, then Next move places it.
- [ ] L2: a load move works, and hazmat alerts and score reasons appear as usual.

**Play all**

- [ ] L1 and L3 run to the end. L3 moves from discharge to load without intervention.
- [ ] L5 or L8: runs until complete, failed or disaster. After a disaster it stops cleanly with a "ship lost" note, and the disaster overlay and failed modal work as usual.
- [ ] L10: completes about 130–200 moves without memory growth (history capped at 50) or stray meshes (the hoist-mesh race from 03 §3.4).
- [ ] Stop mid-request: nothing moves afterwards.
- [ ] Timer expiry during a request: the answer is discarded and play-all stops.

**Failures**

- [ ] Offline gives one retry, then a pause with a message, and Resume works.
- [ ] A 401 (revoke the key on OpenRouter mid-run) pauses, forgets the key and prompts.

**Inspector**

- [ ] Summaries are readable, the probability bars sum to about 100%, raw JSON copy works, there's no `Authorization` anywhere, and the cost total matches the OpenRouter activity page.

**Budget**

- [ ] Inspector `estTokens` vs `usage.input_tokens` on L10 is under 24K. If the estimate is way off, adjust the divisor in 02 §2.7.

**Regression**

- [ ] Normal mouse play on L1, L4, L5 and L8 is unchanged with Jev disabled **and** enabled-but-idle.

**Build**

- [ ] `npm run lint` and `npm run build` pass.

## 5.6 Evaluation (optional, recommended by the skill)

Jev's play quality in raw mode is unknown, so record a baseline:

- Run play-all 3× each on L2, L5 and L8.
- Record: completion rate, disaster rate, average score % of target, average confidence, and cost.
- Keep the results in a short table in the Jev section of `stowage-master-AGENTS.md`, tagged with `stateSchemaVersion`, `questionVersion` and the model build.

Re-run the baseline after changing the rules wording, the state shape or the model. This gives evidence for whether the future assisted mode (02 §2.9) is worth building.

## 5.7 Completion

When each numbered plan is fully implemented and its acceptance criteria pass, move that file into `.ai/plans/stowage-master/completed/`. Move `00-jev-overview.md` last, once 01–05 are all done.
