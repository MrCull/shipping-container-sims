# Invariants

Checked against ENGINE_VERSION 0.53.0.

Read this when a run fails with an invariant violation, when you add a rule the engine must never break, or when you want
to make headless runs faster (invariant checking is the largest single cost of a long run). Everything here lives in
`engine/invariants.ts` and the step loop in `engine/simulation.ts`. Terms: [GLOSSARY.md](../../../../GLOSSARY.md).

## What an invariant is

```ts
interface Invariant {            // engine/invariants.ts#Invariant
  id: string                     // stable dotted id, e.g. 'custody.single-owner'
  description: string
  reads: InvariantKind[]         // 'container' | 'yardSlot' | 'vessel' | 'equipment' | 'reservation' | 'time'
  check(state, config, scope?): string[]   // one message per violation; [] = holds
  scoped?: true                  // honours `scope`: checks only what the last event touched
}
```

All invariants are in the ordered array `INVARIANTS`. `checkInvariants(state, config)` runs every one over the whole state.
Invariants only read state; they never change it, so they cannot move the event log (a violation adds an event, see
below).

## Every invariant

`reads` decides when it runs incrementally; "scoped" means it checks only the touched entities between sweeps.

| Id | Guards | reads | Scoped |
|---|---|---|---|
| `custody.single-owner` | every container is held by exactly one custody owner and that owner is the one the box records; also catches a double-occupied ground position or WTP pad (the second box displaces the first) | container | yes: touched custody owners (`custodyScoped`) |
| `reservation.no-overlap` | no two conflict-zone reservations overlap in time | reservation | yes: only reservations made since the last check (`overlappingNewReservations`; ids ascend, others only shrink) |
| `claim.single-holder` | no container claimed by two SHCs; every claimed job names its SHC | equipment | no |
| `shc.waiting-positions` | a waiting SHC stands only on a queue spot it holds or its parking spot (never a ground position, pad or active lane); a queue spot holds one SHC | equipment | no |
| `yard.slot-bounds` | every stacked box lies inside its block (bays, rows, tiers; a 40 ft box on two bays) | yardSlot | yes: touched yard columns |
| `yard.stack-height` | no stack above the block's tier limit | yardSlot | yes |
| `yard.no-floating` | every box above tier 1 has a box directly below in each bay it covers | yardSlot | yes |
| `yard.no-double-occupied` | no stack cell holds two boxes of the same length | yardSlot | yes |
| `yard.no-mixed-length-overlap` | a 40 ft box never overlaps a 20 ft box in a cell | yardSlot | yes |
| `yard.no-mixed-length-stack` | a stack (one row x one 20 ft bay position) holds one length only: that of its bottom box | yardSlot | yes |
| `yard.reefer-powered` | every reefer in a powered row, at most `engine/yardLayout.ts#REEFER_MAX_TIERS` high (R19) | yardSlot | yes |
| `asc.wtp-handover` | an ASC never enters a WTP pad's lifting envelope (spreader below travel height within `PAD_HALF_X_M` 1.6 m / `PAD_HALF_Z_M` 6.5 m of the pad) while an SHC is on the pad | time | no |
| `asc.no-passing` | the two ASCs of a block never pass or collide: waterside stays waterside, centres at least `ASC_MIN_SEPARATION_M` apart, now and at every breakpoint (start, middle, end of each planned segment) | equipment | yes: blocks whose ASCs the event named; skipped unless `subsystems.asc` is `real` |
| `sts.rail-order` | STS cranes keep rail order: each crane inside its rail reservation, reservations on the quay and `stsMinSpacingM` apart | time | no |
| `stowage.order` | no box on board above an empty cell; a 20 ft never on a 40 ft; a 40 ft rests on a 40 ft or two filled 20 ft halves | vessel, container | yes: touched vessels |
| `stowage.no-floating` | no floating box on board (#174): every box above its stack base (`isStackBase`: hull floor or hatch cover) has a box below in the same bay and row (a half needs a half or a whole cell) | vessel, container | yes |
| `stowage.cell-free` | a box is never loaded into a cell that already holds a box, slot or ROB (#202) | vessel, container | yes |
| `hull.profile` | below deck no box outside the usable rows of its tier (`holdRows` of the vessel class; V-shaped holds, spec #116) | vessel, container | yes |
| `landside.segregation` | external trucks only on landside road nodes and never within the waterside network (now and at every breakpoint of their planned motion); SHCs only on waterside lane-graph nodes | equipment | yes: touched equipment |
| `landside.stall-exclusive` | no two trucks claim the same transfer stall or holding position; stall and truck record each other (TT-R16) | equipment | no |
| `landside.waiting-off-road` | a waiting truck (gate queue, kiosk, holding) never stands on a road or junction (TT-R16) | equipment, time | no |
| `landside.leaves-complete` | a truck leaves only after every drop and pick leg is done (TT-R16) | equipment | no |
| `landside.stranded-truck` | a truck at its stall longer than `STALL_STRAND_LIMIT_S` (1800 s) with no ASC of its block working and no open job that can start is stranded (TT-175); also an exit-slot wait over the same limit (TT-183) | equipment, time | no |
| `yard.no-progress` | a block with a claimed job, all ASCs idle, no ASC job start for more than `STALL_STRAND_LIMIT_S`, no decision or allocation in flight and no pending event that could start a job is deadlocked (TT-183) | equipment, time | no |
| `hatch.no-removal-with-boxes-on-top` | a panel lifted or in laydown has no discharge box on it | equipment | yes: panels named by the event |
| `hatch.no-lift-before-lashing-release` | a lifted, laid-down or replaced panel has a lashing release at or before its lift | equipment | yes |
| `hatch.no-hold-access-through-closed-hatch` | an STS spreader never goes below the hatch plane over a secured, unsecured or replaced panel (end of planned motion) | equipment | yes |
| `hatch.no-deck-load-on-missing-hatch` | a box is loaded on deck only onto a panel that is in place and secured | container | yes |
| `hatch.replace-own-hatch` | a panel goes back only on its own hatch (vessel, bay, place across the beam) at its home position | equipment | yes |
| `hatch.laydown-stack-limit` | a quay laydown bay holds at most the vessel class's `laydownStackLimit` panels (default 3), all of one hatch | equipment | no |
| `hatch.no-departure-open` | a vessel does not leave (work complete, unmooring, departed) with a panel off or unsecured | vessel | yes |
| `berth.no-overlap` | vessels on the quay (mooring, berthed, unmooring) lie within the quay and keep `berthGapM` apart | vessel | no |

32 invariants. The seven `hatch.*` ones are proven on tampered snapshots in `tests/hatch.test.ts`.

## When checks run

`createSimulation` options (`engine/simulation.ts`): `invariants.enabled` (default true), `invariants.failFast` (default
true), `invariants.sweepEvery` (default `DEFAULT_SWEEP_EVERY` = 1000), `invariants.perEvent` (default true; #252). In `step()`:

1. After each processed event is committed, `checkInvariants(ev, forceSweep)` runs unless:
   - the event type is in `STATE_NEUTRAL_EVENTS` (only `DecisionRequested`, #226: it changes nothing an invariant reads;
     the reply is checked at `DecisionResolved`);
   - the pre-run phase is in progress (`state.prefill` set: the yard is built box by box); the event that ends the pre-run
     forces a full sweep of the whole starting state.
2. Every `sweepEvery`-th checked event, and the event that meets an end condition, is a **full sweep**
   (`InvariantTracker#sweep`); the others are **incremental** (`InvariantTracker#check`).
3. **Time-based deadlines** (TT-183): before popping the next event, `invariantDeadline` finds the earliest time before the
   next event (or the run end) at which a time-reading invariant reaches its limit with no event in between (a truck at its
   stall `STALL_STRAND_LIMIT_S` + 1 after arriving or after its last leg; an idle queue that may hold a yard deadlock,
   `yardNoProgressDeadline`). The clock is moved there and a full sweep runs. Nothing is scheduled, so the event log and
   hash are unchanged, and the check is not counted. This is why a deadlock never ends a run as a quiet `idle`.
4. **Duration end**: a run ending on `simDurationS` sweeps once more at the end time (clock moved first, so a truck silent
   at its stall until the end is still caught). Not counted in `checks` either.

`invariants.checks` (in the run summary and every golden) counts checked events, sweeps included, deadline and closing
sweeps excluded. Changing which events are checked changes goldens even though the event log does not move.

### Sweep-only checking (#252)

`invariants.perEvent: false` skips the per-event (incremental) check: nothing is checked between sweeps, a full sweep runs
every `sweepEvery` events, at the end of the pre-run and at the end of the run (time-based deadlines still sweep). The
browser worker runs this way by default (`worker/engineHost.ts`), because the per-event check was the largest engine cost;
the setup dialog's "strict checks" switch (remembered, `modules/strictChecksSetting.ts`, sent as `strict` in the worker's
`load` and `restore` requests) restores `perEvent: true` for the next run. Headless runs, tests, goldens and CI never set it.
With no violation the event log and its hash are identical either way (`tests/sweep-only-invariants.test.ts`); `checks`
counts sweeps only, so it differs. A violation a sweep finds in this mode carries `foundBy: 'sweep'` (on the report entry
and the `InvariantViolated` payload) and its failure message says so: the event named is the last one before the sweep,
not necessarily the culprit. Re-run with strict checks (or headless) to pin the culprit event.

## Incremental checking (`InvariantTracker`, V11-18)

The tracker remembers, per container, the custody owner key (`kind:id`) and the yard columns it was last seen in, so a box
that left a place still marks that place (and the box above it) for checking. The memory is derived and self-correcting;
the first check after construction or `reset()` (a restore) is a full sweep that rebuilds it.

Per event, `check` builds the touched kinds and an `InvariantScope` from the event's subjects:

| Subjects of the event | Touched kinds | Scope field |
|---|---|---|
| always | `reservation`, `time` | `newReservationsFrom` (first reservation id since the last check) |
| `containers` | `container`, `yardSlot` | `containers`; `yardColumns` (columns before and after); `custody` (owners left and entered, with the boxes recorded there) |
| `vessels` | `vessel` | `vessels` (plus vessels whose slots a touched box left or entered) |
| `equipment` or `jobs` | `equipment` | `equipment` (ids; hatch events list their panel here) |

An invariant runs only if its `reads` overlaps the touched kinds; a `scoped` one receives the scope, the others do a full
check. Helpers that make scoped checks cheap:

- `slotsToCheck(state, columns)`: the yard slots of the touched columns via `yardIndexOf(state).byColumn`, deduplicated
  (all slots without a scope). Used by every `yard.*` invariant.
- `filledVesselSlots(state, scope)` (#234): filled slots of the touched vessels from the per-vessel slot index
  (`engine/vesselSlotIndex.ts#vesselSlotsOf`).
- `anyVesselFails(state, scope, clean)` (#237): asks the per-vessel occupied-cell map (`engine/vesselOccupancy.ts`,
  numeric cell keys kept current as slots fill and clear) whether any touched vessel fails; only then runs the original
  scan, so messages and order are unchanged. Used by `stowage.no-floating`, `stowage.cell-free`, `hull.profile`.
- `panelsToCheck(state, scope)`: hatch panels named in the event's equipment.
- `roadZonesOf(graph)` (TT-176) and `blockSpecsById(config)`: caches per landside graph and per config (WeakMap).

Invariants that read `time` (`asc.wtp-handover`, `sts.rail-order`, `landside.waiting-off-road`,
`landside.stranded-truck`, `yard.no-progress`) run after every checked event and are not scoped: positions move with the
clock.

## How violations are reported

For each message: the violation `{ invariant, message, eventId, t }` is appended to `invariantReport().violations`, and an
`InvariantViolated { invariant, message, offendingEventId }` event is committed with `causedBy` = the offending event (so
`why()` and the debugger show the chain, and the event is in the hash). With fail-fast (default) the run stops with
status `failed` and `firstError.message` = `[<id>] <message>`. Messages name the entities, e.g.
`container <id> records custody groundPosition:<gp> but is held by nobody (groundPosition:<gp> is double-occupied: <other> was set down on it)`.

- CLI: `tt:run` prints `Invariants: N checks, M violations` and `First error: event #id at hh:mm:ss: [id] message`; exit 1.
  `--no-fail-fast` keeps running and collects every violation. `tt:diff` runs both sides with `failFast: false`.
- Summary/golden: `invariants { enabled, checks, violations, first }` (`engine/summary.ts#RunSummary`).
- Log subsystem `invariants` in the structured log (`--log-level "invariants=debug"`).
- Proof of the failure path: `pnpm run tt:run --fixture <name> --handlers broken-first-lane` exits 1 with
  `custody.single-owner` at the offending event.

## Cost

Invariant checking is the largest single cost of long headless runs. The CPU profile of the 0.5 peak day (296,635 events,
263,377 checks) put it at **54 % inclusive** of wall time (47.5 % self in `engine/invariants.ts`), plus much of the 20 %
garbage collection: [reports/throughput-and-speed-report.md](reports/throughput-and-speed-report.md). Since then #226
(state-neutral `DecisionRequested`, 13 % fewer checks) and #237 (occupancy map for the stowage invariants: 32.2 s to 5.7 s
CPU) landed. The per-invariant table in that report (0.1 peak day, #233) was measured before #234 and #237; at that time the
stowage trio was 30.5 %, the unscoped time-reading landside and ASC invariants 27.8 % (`landside.waiting-off-road` alone
13 %), and the column-scoped yard invariants 15.2 %. The tracker's own scope building was about 6 %.

`Simulation#invariantStats()` returns `{ incremental, sweeps, wallMs }` (wall time is not deterministic, so it is not in
the report or snapshots). `pnpm run tt:bench --sweep-every <n>` measures with a different sweep interval; `0` disables
invariants (`cli/benchmark.ts`).

## Add an invariant

1. Append to `INVARIANTS` with a stable dotted id (`<area>.<rule>`), a `description` and `reads` (only the kinds it
   reads: an over-broad `reads` makes it run after every event).
2. If it reads a lot of state, set `scoped: true` and honour `scope`: check only the touched containers, yard columns,
   equipment or vessels, and report exactly what a full check would report for those entities. Use or add an index rather
   than scanning `Object.values(state.<big map>)`.
3. If it reads `time`, it runs after every event: give it an early exit (no truck in the relevant status, no SHC near a
   pad) and cache per-config geometry. If it has a time limit with no event at the limit, extend `invariantDeadline`.
4. A new custody owner kind: extend `CustodyKind` and add its holders to `custodyHolders()` and `heldAt()`.
5. Test it with a broken handler or reactor, or a tampered snapshot, that triggers it (`tests/invariants.test.ts`,
   `tests/invariants-incremental.test.ts`: the incremental check must find what a sweep finds).
6. Run `pnpm run tt:golden`: a new invariant does not move hashes, but if it fires on a fixture the fixture is wrong or
   the engine has a bug.

## Optimisation levers

- **Cheapest lever, no log change**: make an invariant scoped, narrow its `reads`, or add an early exit. Proof: the same
  `eventLogHash` and `invariants.checks` on the 0.1 or 0.5 peak day, wall time down (`tt:bench`, or `invariantStats()`).
- **Fewer checks**: adding an event type to `STATE_NEUTRAL_EVENTS` (only if it really changes nothing any invariant reads)
  or raising `sweepEvery` lowers the cost but changes `checks` in every golden; regenerate and explain.
- **Benchmarks with invariants off** (`--sweep-every 0` in `tt:bench`) show the engine's own speed; never ship a default
  with them off, and never make a check depend on wall time or `Math.random`.
- Deeper run-speed work: [optimising/run-speed.md](optimising/run-speed.md).
