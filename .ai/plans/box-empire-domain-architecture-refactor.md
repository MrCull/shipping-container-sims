# Box Empire Domain Architecture Refactor

## Summary

Refactor Box Empire so the Pinia store acts as a UI-facing facade and the terminal simulation is owned by focused domain modules.

The refactor preserves the current tutorial behavior while preparing the sim for future multiple reach stackers, multiple mobile harbor cranes, multiple vessels, and safer spatial movement.

## Implemented Architecture

- `modules/scenario/` owns tutorial setup, initial entities, and scenario counters.
- `modules/simulation/` owns the main simulation tick and runtime contracts between the store and pure domain logic.
- `modules/operations/` owns truck operations, tutorial operation planning, and job completion side effects.
- `modules/allocators/` owns yard slot reservation, shuffle target selection, and destination-specific job creation.
- `modules/movement/` owns the shared occupancy world used by moving trucks and equipment.
- `modules/economy/` owns transaction application and money event payloads.
- `store/gameStore.ts` owns Vue-facing state, UI actions, event buffering, narrator queueing, and camera cue requests.

## Behavior Preserved

- Tutorial scenario still starts with 5 imports, 5 exports, Tiny Feeder, 1 reach stacker, 1 mobile harbor crane, and the same yard dimensions.
- Import flow remains vessel to import quay buffer to yard to pickup truck to out-gate.
- Export flow remains delivery truck to yard to export quay buffer to vessel.
- Current revenue, cost, speed, gate-processing, and stack-height values remain unchanged.
- Existing UI and renderers continue to consume the same store arrays and entity fields.

## Future Extension Points

- Add more equipment by extending scenario creation and letting the scheduler choose between idle capable machines.
- Add more vessels by changing operation planners to select the relevant active vessel instead of defaulting to the first tutorial vessel.
- Expand movement safety by adding static terminal zones, route reservations, and swept collision checks to `movement/occupancyWorld.ts`.
- Add richer destination planning by extending allocator modules without growing the store.

## Verification

- `npm run lint`
- `npm run build`

