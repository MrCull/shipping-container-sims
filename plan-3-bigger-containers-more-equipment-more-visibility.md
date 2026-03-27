# Box Empire — Plan 3: Bigger Containers, More Equipment, More Visibility

> **Status:** Not started
> **Dependencies:** Plan 2 (purchase system, yard configuration, save/load, expanded operations)
> **Builds on:** Purchase catalog, yard block config, vessel scheduler, terminal map, economy

---

## Objective

Introduce 40ft containers (unlocked at a money milestone), RMG yard cranes for efficient stack operations, additional gatehouses for parallel truck processing, and operational dashboards that give the player visibility into terminal performance via KPIs.

---

## Prerequisites — Read Before Implementing

1. **AGENTS.md** — Project conventions, linting
2. **`src/sims/box-empire/box-empire-AGENTS.md`** — Architecture decisions from Plans 1–2
3. **Master roadmap** — `create-five-other-plans-with-combined-will-result-in-a-full-game.md` §6 (Plan 3)
4. **Skill files:**
   - `.ai/skills/container-cargo-entities/SKILL.md` — Container physical specs (40ft: 12.19m × 2.44m × 2.59m, tare 3700kg, TEU 2)
   - `.ai/skills/terminal-equipment-entities/SKILL.md` — RMG crane specs, four-lens model, animation states
   - `.ai/skills/vessel-entities/SKILL.md` — Larger vessel classes (feedermax), bay-row-tier with even bay 40ft semantics
   - `.ai/skills/terminal-operations/SKILL.md` — KPIs with target ranges, crane utilization, congestion model
   - `.ai/skills/terminal-economics/SKILL.md` — 40ft vs 20ft charge differentials
   - `.ai/skills/terminal-infrastructure/SKILL.md` — Yard block dimensions, inter-block gaps, truck lane widths
5. **Knowledge base files:**
   - `knowledge-base/dk_equipment__rmg_cranes.md` — RMG classes, spans, speeds, event sequences
   - `knowledge-base/dk_vessels__physical_classes_and_structure.md` — Vessel size classes, bay-row-tier details
   - `knowledge-base/dk_vessels__stowage_locations_and_bayplan.md` — Even/odd bay numbering for 20ft/40ft
   - `knowledge-base/dk_ops__dashboards_kpis.md` — KPI definitions, target ranges
   - `knowledge-base/dk_yard__stacking_strategies_rehandles.md` — Rehandle calculation, stacking rules

---

## Player Experience

1. Upon reaching **$50,000** balance, 40ft containers are unlocked — milestone notification appears
2. Upon reaching **$75,000** balance, RMG cranes become available for purchase
3. Player can now purchase RMG cranes to automate yard stack operations (much faster than reach stackers)
4. Player can purchase additional gatehouses for parallel truck processing
5. Dashboard screen shows operational KPIs (yard occupancy, crane utilization, truck turn time, revenue trends)
6. Vessels scale up to ~3000 TEU feeders with multiple bays

---

## New Systems

### 1. 40ft Container Support

**Physical dimensions** (from `container-cargo-entities` skill):

| Size | Length | Width | Height | Tare | Max Gross | TEU |
|------|--------|-------|--------|------|-----------|-----|
| 20ft (existing) | 6.06m | 2.44m | 2.59m | 2200kg | 30480kg | 1 |
| 40ft (new) | 12.19m | 2.44m | 2.59m | 3700kg | 30480kg | 2 |

**Container entity extension:**

```typescript
type ContainerSize = '20ft' | '40ft'  // Extended from Plan 1's '20ft' only

interface Container {
  // ... existing fields ...
  size: ContainerSize  // Now includes '40ft'
}
```

**Yard slot changes for 40ft:**
- A 40ft container in bay N occupies bay N **and** bay N+1
- When placing a 40ft container, both bays must be free at the target tier
- When checking accessibility, both bays' tiers must be clear above
- Mixed stacking rules: 20ft containers **can** stack on top of 40ft (overhang supported by cell guides), but 40ft **cannot** stack on 20ft

```typescript
// Yard manager must check:
function canPlace40ft(block: YardBlock, bay: number, row: number, tier: number): boolean {
  // Bay N and bay N+1 must both be free at this tier
  // No 40ft on top of 20ft at same bay position
  // Bay N must be even-numbered (convention from vessel-entities skill)
  return slotFree(block, bay, row, tier) && slotFree(block, bay + 1, row, tier)
}
```

**Vessel stowage for 40ft** (from `vessel-entities` skill):
- Bay numbering: odd bays (01, 03, 05…) = 20ft slots; even bays (02, 04, 06…) = 40ft slots spanning adjacent odd bays
- A 40ft container at even bay 02 spans odd bays 01 and 03

**Rendering:**
- 40ft container mesh is approximately double the length of 20ft (12.19m vs 6.06m)
- Use distinct `InstancedMesh` or size attribute for 40ft containers
- Different container generation may use 40ft color palette

**Economics:**
- 40ft handling charges are higher than 20ft (from `terminal-economics` skill):
  - Vessel load/discharge: $275 (40ft) vs $185 (20ft)
  - Truck gate in/out: $105 (40ft) vs $70 (20ft)
  - Yard shift: $85 (40ft) vs $55 (20ft)

### 2. Milestone Unlock System

```typescript
interface Milestone {
  id: string
  title: string
  description: string
  condition: (state: BoxEmpireState) => boolean
  reward: MilestoneReward
  achieved: boolean
  achievedAt: number | null  // sim time
}

interface MilestoneReward {
  type: 'unlock_container_size' | 'unlock_equipment' | 'unlock_feature'
  unlockId: string
}
```

**Plan 3 milestones:**

| Milestone | Condition | Reward |
|-----------|-----------|--------|
| "Going Global" | Balance ≥ $50,000 | Unlock 40ft containers |
| "Industrial Scale" | Balance ≥ $75,000 | Unlock RMG crane in purchase catalog |
| "Multi-Gate" | Handle 200 containers | Unlock additional gatehouses |

**Notification:** When a milestone is achieved, show a toast notification with fanfare sound (`level-up.mp3`), and update the purchase catalog to include the newly unlocked items.

### 3. RMG Yard Crane

From `terminal-equipment-entities` skill — standard yard RMG:

| Parameter | Value | Source |
|-----------|-------|--------|
| Gantry speed | ~1.67 m/s (100 m/min) | Skill: 80–130 m/min range |
| Trolley speed | ~1.17 m/s (70 m/min) | Skill: 60–90 m/min range |
| Hoist speed (laden) | ~0.45 m/s (27 m/min) | Skill: 20–35 m/min range |
| Hoist speed (empty) | ~0.67 m/s (40 m/min) | Faster when empty |
| Span | 32 m | Covers ~6 rows + truck lane |
| Stacking width | 6 rows | Standard yard RMG |
| Stacking height | 1-over-5 (5 tiers) | From skill defaults |
| Rated capacity | 40 t | Under spreader |
| Cycle time | ~45 s | From master roadmap quick reference |

**RMG behavior:**
- An RMG is assigned to a **specific yard block** when purchased
- It handles all container movements within that block (place, retrieve, restack)
- Much faster than reach stacker for dense storage operations
- The reach stacker still handles horizontal transport to/from the block I/O point
- RMG and reach stacker work in tandem: RS delivers to block I/O → RMG places in stack

**RMG animation state sequence** (from `dk_equipment__rmg_cranes.md`):
```
RMG_JOB_ASSIGNED → RMG_GANTRY_MOVING → RMG_TROLLEY_POSITIONING
→ RMG_HOIST_LOWERING_TO_PICK → RMG_LOCKING → RMG_PICK_CONFIRMED
→ RMG_HOIST_LIFTING → RMG_TRANSFER_POSITIONING → RMG_HOIST_LOWERING_TO_SET
→ RMG_UNLOCKING → RMG_SET_CONFIRMED → RMG_JOB_COMPLETED
```

**RMG Three.js rendering:**
- Gantry frame (portal shape spanning the block)
- Trolley (moves along the gantry beam, perpendicular to gantry travel)
- Hoist/spreader (moves vertically from trolley)
- Gantry travels along block length (X or Z axis depending on orientation)
- Animate each component independently based on current phase

**Purchase details:**

| Item | Price | Daily Maintenance |
|------|-------|-------------------|
| RMG Crane (standard) | $20,000 | $200/day |

When purchasing an RMG:
1. Player selects which yard block to assign it to
2. Block must have ≥ 4 rows (RMG needs minimum span)
3. Block's max tier is upgraded to 5 if currently lower
4. RMG mesh appears over the block

### 4. Multiple Gatehouses

Each gatehouse:
- Processes one truck at a time
- Has its own queue with queue capacity
- Can be opened/closed independently by the player
- Gate processing time: 15s per truck

**Gate assignment logic:**
- When a new truck arrives, assign it to the gatehouse with the shortest queue
- If all gatehouses are closed, truck waits at the terminal entrance

**Gatehouse node in terminal map:**
- Each gatehouse is a separate node in the path graph
- Trucks are routed to their assigned gatehouse node
- Multiple gate nodes connect to the main road network

**Purchase details:**

| Item | Price | Daily Maintenance |
|------|-------|-------------------|
| Additional Gatehouse | $1,500 | $25/day |

Maximum gatehouses: 4 (sufficient for Plan 3 volumes)

### 5. Operational Dashboards

KPIs drawn from `terminal-operations` skill and `dk_ops__dashboards_kpis.md`:

| KPI | Formula | Target Range | Display |
|-----|---------|-------------|---------|
| Yard occupancy | `occupied_slots / total_slots × 100` | 60–80% | Gauge + percentage |
| Crane utilization | `busy_time / total_time × 100` per crane | 70–90% | Bar per crane |
| Truck turn time | `gate_out_time - gate_in_time` (average) | 25–45 min sim-time | Average + trend |
| Revenue per day | `daily_revenue` (rolling 24h sim-time) | Growing | Line chart |
| Containers handled | Total containers completed (import out + export loaded) | — | Counter |
| Rehandle rate | `rehandles / total_moves` | < 0.40 | Percentage |

**Congestion multiplier** (from `terminal-operations` skill):

| Yard Occupancy | Multiplier on move times |
|---------------|-------------------------|
| ≤ 70% | 1.0× |
| 70–80% | 1.0× |
| 80–90% | 1.2× |
| > 90% | 1.5× |

When yard occupancy exceeds thresholds, all yard move times increase by the multiplier. This creates tangible pressure to manage yard space.

**Dashboard UI:**
- Accessible via a "Dashboard" button in the top bar
- Overlay panel (doesn't pause the game)
- Real-time updates every 5 sim-seconds
- Charts use simple Canvas 2D or HTML/CSS (no chart library dependency needed)

### 6. Larger Vessels

Scale up to feedermax class (from `vessel-entities` skill):

| Parameter | Feeder (Plan 2) | Feedermax (Plan 3) |
|-----------|-----------------|-------------------|
| TEU | 500–1,800 | 1,800–4,000 |
| Length | 100–200 m | 180–250 m |
| Beam | 20–30 m | 30–35 m |
| Bays | 10–20 | 20–30 |
| Rows | ~10 | ~13 |
| Max tiers | ~10 | ~12 |
| Cranes needed | 1–2 | 2–3 |

**For gameplay purposes, simplify to:**
- Vessels carry 30–100 containers (mix of 20ft and 40ft)
- Multiple bays visible on vessel (bay-row-tier rendering)
- Multiple mobile harbor cranes can work different bays simultaneously

**Vessel generation** (from skill):
```
bay_count = round(length_m / 6.1)
row_count = floor(beam_m / 2.5)
cranes_required = ceil(bay_count / 10)
```

---

## Store Additions (Pinia)

```typescript
interface BoxEmpireState {
  // ... Plans 1-2 fields ...

  // Plan 3 additions
  milestones: Milestone[]
  unlockedContainerSizes: ContainerSize[]  // starts with ['20ft'], adds '40ft'
  unlockedEquipmentTypes: string[]  // starts with ['reach_stacker', 'mobile_harbor_crane'], adds 'rmg'
  dashboardVisible: boolean
  kpiHistory: KPISnapshot[]  // rolling history for charts
}

interface KPISnapshot {
  simTime: number
  yardOccupancy: number
  craneUtilizations: Record<string, number>
  avgTruckTurnTime: number
  revenueLastDay: number
  rehandleRate: number
  containersHandled: number
}
```

---

## File Structure (New/Modified)

```
src/sims/box-empire/
├── components/
│   ├── Dashboard.vue                 # KPI dashboard overlay (NEW)
│   ├── MilestoneNotification.vue     # Toast notification for milestones (NEW)
│   ├── ui/
│   │   ├── KPIGauge.vue             # Gauge widget for occupancy etc. (NEW)
│   │   ├── KPIChart.vue             # Simple line/bar chart (NEW)
│   │   └── CraneUtilization.vue     # Per-crane utilization bars (NEW)
│   └── modals/
│       └── MilestoneUnlock.vue       # Milestone achieved celebration (NEW)
├── modules/
│   ├── milestones.ts                 # Milestone definitions and check logic (NEW)
│   ├── kpiTracker.ts                 # KPI computation and history (NEW)
│   ├── rmgController.ts             # RMG crane state machine and movement (NEW)
│   ├── rmgRenderer.ts               # RMG Three.js mesh and animation (NEW)
│   ├── containerRenderer.ts          # MODIFIED — 40ft InstancedMesh support
│   ├── vesselRenderer.ts             # MODIFIED — multi-bay vessel rendering
│   ├── yardManager.ts                # MODIFIED — 40ft double-bay placement, mixed stacking rules
│   ├── vesselManager.ts              # MODIFIED — bay-row-tier stowage with even/odd bay logic
│   ├── vesselScheduler.ts            # MODIFIED — larger vessels, scaling frequency
│   ├── jobScheduler.ts               # MODIFIED — RMG job assignment (yard-internal moves)
│   ├── equipmentController.ts        # MODIFIED — add RMG equipment type
│   ├── economy.ts                    # MODIFIED — 40ft charge rates
│   ├── purchaseSystem.ts             # MODIFIED — RMG in catalog, milestone-gated items
│   ├── terminalMap.ts                # MODIFIED — multiple gatehouse nodes
│   └── config.ts                     # MODIFIED — RMG specs, 40ft dimensions, milestone thresholds
├── store/
│   └── gameStore.ts                  # MODIFIED — milestones, KPI history, unlock state
├── types/
│   └── index.ts                      # MODIFIED — Milestone, KPISnapshot, RMG interfaces
```

---

## Implementation Order (Recommended)

### Phase A — 40ft Container Foundation
1. Extend `ContainerSize` type to include `'40ft'`
2. Add 40ft physical specs to `config.ts`
3. Update `yardManager.ts` for double-bay placement and mixed stacking rules
4. Update `vesselManager.ts` for even/odd bay 40ft stowage
5. Update `containerRenderer.ts` for 40ft mesh (double-length box)
6. Update `economy.ts` with 40ft charge rates

### Phase B — Milestone System
7. Implement `modules/milestones.ts` (definitions, condition checks, reward application)
8. Add milestone state to store
9. Implement `components/MilestoneNotification.vue` and `components/modals/MilestoneUnlock.vue`
10. Wire milestone checks into game loop (check every sim-minute)

### Phase C — RMG Crane
11. Implement `modules/rmgController.ts` (state machine, gantry/trolley/hoist movement)
12. Implement `modules/rmgRenderer.ts` (portal frame, trolley, hoist, spreader meshes)
13. Update `jobScheduler.ts` to assign yard-internal moves to RMG when available
14. Update `purchaseSystem.ts` to add RMG to catalog (milestone-gated)
15. Update `equipmentController.ts` to handle RMG equipment type

### Phase D — Multiple Gatehouses
16. Update `purchaseSystem.ts` for gatehouse purchasing (milestone-gated)
17. Update `terminalMap.ts` for multiple gate nodes
18. Update `truckManager.ts` for multi-gatehouse queue assignment (shortest queue)
19. Update gate rendering to show multiple gatehouses

### Phase E — Larger Vessels
20. Update `vesselScheduler.ts` for feedermax-class vessels (30–100 containers)
21. Update `vesselRenderer.ts` for multi-bay vessel rendering
22. Update `vesselManager.ts` for multi-crane simultaneous operations

### Phase F — Dashboard
23. Implement `modules/kpiTracker.ts` (computation, rolling history)
24. Implement `components/Dashboard.vue` (overlay panel)
25. Implement `components/ui/KPIGauge.vue`, `KPIChart.vue`, `CraneUtilization.vue`
26. Add congestion multiplier to yard move times based on occupancy

### Phase G — Integration and Testing
27. Test 40ft placement in yard (double-bay, mixed stacking)
28. Test 40ft on vessel (even bay stowage)
29. Test milestone triggers and unlocks
30. Test RMG crane operation (assign to block, handle moves, animation)
31. Test multi-gatehouse with queue balancing
32. Test dashboard KPIs against actual values
33. Test save/load still works with new state
34. Lint and build

---

## Acceptance Criteria

- [ ] 40ft containers appear after reaching $50K milestone
- [ ] 40ft containers occupy double bay width in yard and vessel
- [ ] Mixed stacking rules enforced (20ft on 40ft OK, 40ft on 20ft not OK)
- [ ] 40ft charge rates are applied correctly (higher than 20ft)
- [ ] Milestone notification appears with sound when $50K and $75K thresholds are reached
- [ ] RMG crane can be purchased after $75K milestone
- [ ] RMG crane is assigned to a specific yard block
- [ ] RMG handles all container movements within its assigned block
- [ ] RMG animation shows gantry, trolley, and hoist movement
- [ ] RMG is significantly faster than reach stacker for yard operations
- [ ] Additional gatehouses can be purchased (up to 4 total)
- [ ] Trucks are assigned to gatehouse with shortest queue
- [ ] Each gatehouse can be opened/closed independently
- [ ] Dashboard shows accurate KPIs: occupancy, utilization, turn time, revenue, rehandle rate
- [ ] Yard congestion multiplier applies when occupancy > 80%
- [ ] Larger vessels (30–100 containers) arrive and are handled correctly
- [ ] Multiple mobile harbor cranes can work different bays simultaneously
- [ ] Save/load works correctly with all new state
- [ ] No lint errors (`npm run lint`)
- [ ] Build succeeds (`npm run build`)

---

## Out of Scope for Plan 3

- STS gantry cranes
- Reefer containers
- Hazardous containers
- Multiple berths
- Hatch cover logic
- ASC (automated stacking cranes)

---

*End of Plan 3*
