# Stowage Master × Jev — Overview (read first)

> Plan set for adding **Jev** (TypeSafe System One, via OpenRouter) to Stowage Master so it can pick discharge, restow and load moves for the player.
> Written 2026-09-27. When a numbered plan is fully implemented, move its file into [`completed/`](completed/).

## Plan sequence

| # | File | Scope | Depends on |
|---|---|---|---|
| 00 | this file | Decisions, architecture, file map, glossary | — |
| 01 | [01-jev-client-and-key.md](01-jev-client-and-key.md) | Types, config, in-memory key vault, OpenRouter client, error taxonomy, Jev Pinia store | — |
| 02 | [02-jev-state-and-questions.md](02-jev-state-and-questions.md) | State builder (vessel, stability, bay plan, load list, rules), Choice question builder per phase, response validation and policy, summaries | 01 (types) |
| 03 | [03-jev-move-execution-bridge.md](03-jev-move-execution-bridge.md) | Refactor `GameCanvas.vue` so moves can run by slot ID; command channel; pointer lock | 01 (store) |
| 04 | [04-jev-ui-and-controller.md](04-jev-ui-and-controller.md) | Start-screen toggle, key dialog, in-game panel, "next move" and "play all" controller loop | 01, 02, 03 |
| 05 | [05-jev-inspector-docs-and-qa.md](05-jev-inspector-docs-and-qa.md) | Request/response inspector, doc updates, manual QA checklist, completion steps | 04 |

Plans 01, 02 and 03 can be built in parallel. 04 wires everything together. 05 finishes the work.

Required reading before implementing:

- [.agents/skills/jev-integration/SKILL.md](../../../.agents/skills/jev-integration/SKILL.md) and its [usage playbook](../../../.agents/skills/jev-integration/references/using-jev.md)
- [src/sims/stowage-master/stowage-master-AGENTS.md](../../../src/sims/stowage-master/stowage-master-AGENTS.md)

## Goal

A player can optionally enable Jev and then:

1. **Next move.** Jev picks one move for the current phase (discharge pick, restow destination, or load slot) and the sim performs it with the normal crane animation and scoring.
2. **Play all.** Jev picks and performs moves one at a time until the level ends (complete, failed or timed out) or the ship is lost to a disaster.
3. **Inspect** (optional toggle). The player can see a summary of what was sent to Jev and what came back, including probabilities, confidence, latency and cost.

Most players will never use this. When Jev is not enabled, the only visible sign of it is one small, low-contrast link on the level-select screen.

## Decisions (agreed with the user, 2026-09-27)

| Topic | Decision | Consequence |
|---|---|---|
| Provider | **OpenRouter** Decisions API, `POST https://openrouter.ai/api/alpha/decisions`, model `typesafe/jev-1.13` (pinned) | Browser `fetch` directly. CORS was verified: `Access-Control-Allow-Origin: *` on preflight and response. No backend or proxy. |
| API key storage | **In-memory only**, in a module-scoped variable | Never in localStorage, sessionStorage, Pinia state, a cookie, a file, a log or analytics. Lost on page refresh (by design). Survives in-app navigation within the tab. |
| How much code helps Jev | **Raw state only** | Jev gets the rules written out, the vessel geometry, the current stability numbers, the bay plan, the container to move and the load list. That is roughly what a human sees on screen, plus the rules. Code does **not** precompute per-candidate outcomes (resulting list/trim, disaster flags, score previews) and does **not** filter out dangerous slots. Jev can sink the ship. Code still limits the options to **rule-legal** slots (supported, empty, restow rules), exactly the slots a human could click. |
| Discovery | Small toggle on the **Start screen** | Enabling it asks for the key (validated with `GET /api/v1/key`). The in-game Jev panel is only mounted when Jev is enabled. |
| Level timer | **Keeps running** during Jev requests | Latency counts against the clock. If the timer expires mid-request, the response is discarded. |
| Progress and bests | **Count normally** | No changes to `recordLevelBest` / `markLevelCompleted`. |
| Failures in "play all" | **Retry once, then pause** | Auth, credit and bad-request errors pause immediately with a clear message. The player can resume or take over manually. |
| Plan location | `.ai/plans/stowage-master/` with `completed/` | This folder. |

## Non-goals

- No backend or proxy service, and no server-side key storage.
- No "assisted" mode with precomputed outcomes. It is noted as a possible future extension in 02 §2.9, but **not built** now.
- No generative explanations. Jev returns no rationale, and the UI must never invent one and attribute it to Jev (skill rule). The inspector shows the **evidence sent** and the **probabilities returned**, nothing more.
- No automated test runner. The repo has none. Pure modules are written so tests could be added later. See 05 for the manual QA checklist.
- No changes to scoring, physics or level content.

## Architecture

```
┌─────────────────────────── StowageMaster.vue ───────────────────────────┐
│  StartScreen ── JevStartToggle ──► JevKeyDialog                          │
│  (existing HUD…)                                                         │
│  JevPanel (v-if jev.enabled && active phase) ── JevInspector (drawer)    │
│        │ buttons / hotkeys                                               │
│        ▼                                                                 │
│  useJevController (composable, mounted once)                             │
│    1. snapshot gameStore ─► buildJevState() + buildJevQuestion()  [02]   │
│    2. requestDecision()  ─► jevClient ── fetch ──► OpenRouter    [01]    │
│         (key from jevKeyVault, never stored in Pinia)                    │
│    3. validateDecision() + stale check + policy                  [02]    │
│    4. jevStore.issueCommand(kind, slotId)                        [03]    │
│    5. await ack + phase returns to *_selecting, then settle delay        │
│    6. record exchange for inspector                              [05]    │
│        │                                                                 │
│        ▼  (plain-data command via Pinia)                                 │
│  GameCanvas.vue  watch(jev.pendingCommand) ─► executeLoadMove /          │
│                  executeDischargePick / executeRestowMove  ─► gameStore  │
│                  (same path a mouse click uses: animation, finalize*)    │
└──────────────────────────────────────────────────────────────────────────┘
```

Layering follows the skill. **Code** owns legality, execution, stale-response rejection, retries and all side effects. **Jev** answers one bounded Choice question per move: "which of these legal slots?"

## New and changed files

All new code lives inside `src/sims/stowage-master/` (sim isolation rule).

```
src/sims/stowage-master/
├── types/jev.ts                         NEW  Jev request/response/exchange/command types      [01]
├── modules/jev/
│   ├── jevConfig.ts                     NEW  Endpoint, model id, timeouts, limits, versions   [01]
│   ├── jevKeyVault.ts                   NEW  Module-scoped in-memory key holder               [01]
│   ├── jevClient.ts                     NEW  fetch wrapper, key validation, error taxonomy    [01]
│   ├── jevRules.ts                      NEW  Rules/briefing text for Jev, built from config    [02]
│   ├── jevStateBuilder.ts               NEW  Game snapshot → Jev `state` object               [02]
│   ├── jevQuestionBuilder.ts            NEW  Phase → Choice question with legal options       [02]
│   ├── jevDecision.ts                   NEW  Response validation + application policy         [02]
│   └── jevSummaries.ts                  NEW  Human-readable request/response summaries        [02/05]
├── store/jevStore.ts                    NEW  Enabled flag, prefs, status, command channel, history [01/03/04/05]
├── composables/useJevController.ts      NEW  Next-move and play-all orchestration             [04]
├── components/jev/
│   ├── JevStartToggle.vue               NEW  Low-key link + settings popover on StartScreen   [04]
│   ├── JevKeyDialog.vue                 NEW  API key entry, disclosure, validation            [04]
│   ├── JevPanel.vue                     NEW  In-game controls and status                      [04]
│   └── JevInspector.vue                 NEW  Sent/received summaries, raw JSON                [05]
├── components/GameCanvas.vue            EDIT execute* split, command watcher, pointer lock    [03]
├── components/modals/StartScreen.vue    EDIT mount JevStartToggle                             [04]
├── StowageMaster.vue                    EDIT mount JevPanel, JevKeyDialog, useJevController   [04]
└── stowage-master-AGENTS.md             EDIT add Jev section, fix stale physics thresholds    [05]
```

## Glossary

- **Move kind.** `discharge` = pick an actionable container in `discharge_selecting`. Picking a transit container lifts it and the phase becomes `restow_selecting`. `restow` = choose a destination for the lifted transit container. `load` = choose a slot for `store.currentContainer` in `selecting`.
- **Legal options.** For load: `store.availableSlots`. For discharge: `store.dischargeableSlots`. For restow: `store.availableRestowSlots`. These are the same sets whose indicators a human can click.
- **Exchange.** One Jev request/response pair plus its outcome, recorded for the inspector.
- **Move key.** A fingerprint of game progress taken when a request is sent, used to discard stale responses. See 02 §2.8.

## Cost and data notes (show these in the key dialog)

- Price when this was written: **$0.042 per 1M input tokens, $0 output** (openrouter.ai/typesafe/jev-1.13). The state for one move is expected to be about 3–10K tokens, which is **≈ $0.0001–0.0004 per move**, or roughly **$0.02–0.08 for a full level 10** (48 discharges + 72 loads + restows ≈ 130–200 moves). Show live `usage.cost` from responses rather than trusting these estimates.
- Jev's context window is **32K tokens**. The state builder enforces a budget (02 §2.7).
- Game state (no personal data) goes to OpenRouter and TypeSafe. The key goes only in the `Authorization` header to `openrouter.ai`.
- The key is visible to anyone with devtools open on the player's own machine (the network tab). That is inherent to bring-your-own-key browser apps and acceptable here. The dialog says the key stays in this tab's memory and is never saved.

## Known discrepancy to respect

`stowage-master-AGENTS.md` lists list/trim thresholds of 8/12 and 6/9/10, but `modules/config.ts` `PHYSICS` is the source of truth: **list warning 5, critical 8, disaster 12; trim warning 4, critical 7, disaster 10**. `store.isWarning` / `isCritical` hardcode 8/12 and 6/9, while `scoring.ts` uses `PHYSICS.*Warning`. The Jev rules text **must be generated from `PHYSICS` and `SCORING` imports**, never hand-typed numbers. Plan 05 fixes the AGENTS.md table. The store's hardcoded values are out of scope; note them for the user rather than silently changing gameplay.
