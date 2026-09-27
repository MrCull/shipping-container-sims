# 03 — Move execution bridge (GameCanvas refactor)

> Part of the **Stowage Master × Jev** plan set. Read [00-jev-overview.md](00-jev-overview.md) first.
> Depends on: nothing (can be done in parallel with 01/02). Blocks: 04.

## Goal

Let non-pointer code (the Jev controller) perform **exactly the same move** a mouse click performs — same store actions, same crane animation, same trucks, same sounds, same scoring — by slot ID. No duplicate game logic.

## Why this is needed

Today every move starts in a pointer handler in `components/GameCanvas.vue`:

| Handler | Line (approx.) | Phase | Store call → animation → finalize |
|---|---|---|---|
| `handleClick` (load branch) | ~933 | `selecting` | `store.placeContainer(slotId)` → `createPlacementAnimation` → `store.finalizePlacement(slotId)` |
| `handleDischargeClick` | ~706 | `discharge_selecting` | `store.pickDischargeContainer(slotId)` → import: `createDischargeAnimation` → `store.finalizeDischarge(slotId)`; transit: lifts to `hoistMesh`, phase → `restow_selecting` |
| `handleRestowClick` | ~779 | `restow_selecting` | `store.placeRestowContainer(slotId)` → `createPlacementAnimation` → `store.finalizeRestow(slotId)` |
| `handleRestowCancel` | ~833 | `restow_selecting` | `store.cancelRestowSelection()` |

Each handler mixes two concerns: **(a)** raycast the mouse event to a slot ID via `pickIndicatorSlot(event, key)`, and **(b)** execute the move for that slot ID. The Jev controller needs (b) only.

## Steps

### 3.1 Split each handler into "pick" + "execute"

In `GameCanvas.vue`, extract the body after the `slotId` is resolved into slot-ID functions. Keep behaviour byte-for-byte identical.

```ts
/** Execute a load move for the current container. Returns false if the move was rejected. */
function executeLoadMove(slotId: string): boolean { /* body of handleClick after slotId resolved */ }

/** Pick an actionable container in the discharge phase (import → discharge, transit → lift for restow). */
function executeDischargePick(slotId: string): boolean { /* body of handleDischargeClick after slotId */ }

/** Place the currently lifted transit container. */
function executeRestowMove(slotId: string): boolean { /* body of handleRestowClick after slotId */ }

function handleClick(event: MouseEvent): void {
  if (isPointerInputLocked()) return               // see 3.3
  if (store.phase === 'discharge_selecting') {
    const id = pickIndicatorSlot(event, 'isImportContainer'); if (id) executeDischargePick(id); return
  }
  if (store.phase === 'restow_selecting') {
    const id = pickIndicatorSlot(event, 'isRestowSlot'); if (id) executeRestowMove(id); return
  }
  if (store.phase !== 'selecting') return
  const id = pickIndicatorSlot(event, 'isSlotIndicator'); if (id) executeLoadMove(id)
}
```

Each `execute*` must:

- Re-check the phase guard itself (it is now callable from outside a click).
- **Validate the slot ID against the current legal set** before calling the store:
  - load: `store.availableSlots.includes(slotId)`
  - discharge: `store.dischargeableSlots.includes(slotId)`
  - restow: `store.availableRestowSlots.includes(slotId)`

  The store actions only check "slot exists / empty". The pointer path is implicitly limited to rendered indicators, so this explicit check keeps the Jev path to the same rules. **Never bypass it**. Jev must not be able to place a container in a floating slot.
- Return `true` only when the store accepted the move and the animation was started (or, for a transit pick, the container was lifted).
- Also return `false` if `currentAnimation` is still running, so a move can never start mid-animation.

### 3.2 Command channel: Jev controller → GameCanvas

`GameCanvas` owns the Three.js scene, which must never go into Pinia (see stowage-master-AGENTS.md pitfall #1). So the Jev controller sends a **plain-data command** through the Jev store, and GameCanvas executes it.

In `store/jevStore.ts` (created in plan 01), add:

```ts
export interface JevMoveCommand {
  id: number                    // monotonically increasing
  kind: 'load' | 'discharge' | 'restow'
  slotId: string
}
const pendingCommand = ref<JevMoveCommand | null>(null)
const lastCommandResult = ref<{ id: number; accepted: boolean } | null>(null)
function issueCommand(kind, slotId): number { /* sets pendingCommand, returns id */ }
function ackCommand(id: number, accepted: boolean): void { /* clears pendingCommand, sets lastCommandResult */ }
```

In `GameCanvas.vue`:

```ts
const jev = useJevStore()
watch(() => jev.pendingCommand, (cmd) => {
  if (!cmd) return
  const accepted =
    cmd.kind === 'load'      ? executeLoadMove(cmd.slotId) :
    cmd.kind === 'discharge' ? executeDischargePick(cmd.slotId) :
                               executeRestowMove(cmd.slotId)
  jev.ackCommand(cmd.id, accepted)
})
```

The controller (plan 04) awaits `lastCommandResult` with the matching `id`, then waits for the phase to come back to a `*_selecting` phase (or a terminal phase) before its next request.

> Alternative considered: `defineExpose` the execute functions and call them through a template ref from `StowageMaster.vue`. Rejected: it couples the controller to component refs and lifecycle order. The store command keeps the controller independent of the component, and it can be tested.

### 3.3 Lock pointer input while Jev is acting

Add `isPointerInputLocked()` in GameCanvas: `jev.isBusy`, which is true while a request is in flight, a command is executing, or auto-play is running (see 04). While it is locked:

- `handleClick` and `handleRestowCancel` return early.
- `handlePointerMove` still runs hover effects. Optionally dim the hover highlight.
- This removes the race where the user clicks a slot while Jev's answer is arriving.

In single-step mode the lock only lasts for the in-flight request and the resulting animation. The user can play manually between Jev moves.

### 3.4 Settle delay before the next move

After `finalize*` returns the phase to `selecting`, some visuals update asynchronously:

- `updateHoistMesh` (async GLB/mesh creation) and `updateQueueMeshes`.
- Indicator rebuilds in the phase watcher (~line 275).

`executeLoadMove` calls `removeHoistMesh()` early. If a new move starts before the async `updateHoistMesh` resolves, a stray hoist mesh can be left behind. Mitigation: the controller waits a **settle delay** (default 350 ms, user-adjustable in 04) after the phase returns to `*_selecting` before issuing the next command. Also add a guard in `updateHoistMesh`: after its `await`, drop the mesh if `store.phase` or `store.currentContainer` changed while it was awaiting. That hardens the pointer path as well.

## Acceptance criteria

- Manual play (mouse) behaves identically before and after the refactor on levels 1, 4 (restow) and 5 (hazmat).
- From the browser console (dev only), issuing a command from the Jev store places, discharges and restows correctly, with full animation and scoring. Example: `useJevStore().issueCommand('load', store.availableSlots[0])`.
- An illegal slot ID (occupied, floating, or not in the legal set) is rejected with `accepted: false` and does not change game state.
- A command issued while an animation is running is rejected.
- `npm run lint` and `npm run build` pass.
