# Yardshift, agent guide

Phone-first container yard puzzle (spec #374). Collect containers in number order into the collection truck,
rehandle the ones in the way, clear the yard. Behavioural baseline: the V20 prototype (see the spec); not its code.

## Architecture: three layers, two pure seams

1. **Engine** (`modules/engine.ts`, types in `types/engine.ts`): pure TS, no DOM, timers or `Date.now`.
   `createShift(level)` returns a `Shift` with `dispatch(action)` (next state and events, or a typed `Rejection`
   with a reason code and message; a rejection changes nothing), `tick(dtMs)` (no-op until the clocks, #383),
   read-only `state`, the `events` log and `onEvent(listener)`. `rejectionFor(state, action)` is the single
   legality rule set; the presentation layer reuses it for legal destinations. Actions so far: `collect` (with
   `from`, or without to collect the exposed next container), `rehandle(from, to)`.
2. **Presentation** (`modules/presentation.ts`, types in `types/presentation.ts`): pure TS.
   `present(state, ui, viewport)` returns the view-model (containers with labels, selection, legal destinations,
   HUD strings, hint, hit regions). Hit regions come from `layoutFor(stackCount, viewport)` only, never from
   container or animated positions. `input(ui, event, state)` returns the next UI state and at most one engine action
   (it takes the state too, to tell a collect tap from a select tap). `hitTest(regions, x, y)` maps a point to a
   target; regions never overlap, so the collection and receipt bays never resolve to each other.
3. **Renderers** (thin): `composables/useYardScene.ts` (Three.js, fixed orthographic camera pitched down and
   turned a little sideways, plain boxes with canvas number textures, two truck bays; every object is placed by
   projecting a layout point onto the ground, so it sits inside its hit region; renders only on change),
   `Yardshift.vue` and `components/ui/YardHud.vue` (Vue HUD). Pointer events go to the store's `tapAt` and from
   there to `input`; nothing else interprets them.

`store/yardshiftStore.ts` (Pinia) is glue: it holds the `Shift`, UI state and viewport.

## Levels

`modules/levels.ts` holds the tutorial (stacks `[[1],[2,4],[3],[]]`, capacity 2, max 5 rehandles). #382 ports the
other twelve V20 levels and the solver. Progress (#386) unlocks level 1 only at first.

## Dev hook

`window.__ys` (`dev/devApi.ts`), installed only when `import.meta.env.DEV || import.meta.env.MODE === 'smoke'` (as
Terminal Twin's `window.__tt`): `loadLevel(n)`, `applyActions(actions)`, `state()`, and `hitRegions()` in client
coordinates so smoke tests tap real points.

## Tests and budget

- Unit tests (vitest, node environment, no DOM or WebGL): `modules/engine.test.ts`, `modules/presentation.test.ts`.
  Run `pnpm test:sim yardshift`. **Budget: the whole Yardshift suite under 5 s, no test over 1 s** (spec #374).
- Browser smoke (`@yardshift` group, `smoke:yardshift` label, `tests/browser/`): spec 1
  `yardshift-tutorial.smoke.ts` (phone viewport, home tile to route, tutorial won by touch taps). Each spec under 10 s.
