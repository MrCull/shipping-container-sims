# Box Empire — Plan 4: Special Cargo and Ship-to-Shore Cranes

> **Status:** Not started
> **Dependencies:** Plan 3 (40ft support, RMG cranes, dashboards, milestone system)
> **Builds on:** Container type system, equipment controller, yard zoning, purchase catalog, KPI tracker

---

## Objective

Add reefer (refrigerated) and hazardous (DG) containers with their specialized handling requirements, introduce STS gantry cranes for efficient quayside operations, support medium-sized vessels (Panamax class), and implement hatch cover logic for under-deck access. This plan significantly deepens the simulation's operational complexity and creates new revenue streams through surcharges.

---

## Prerequisites — Read Before Implementing

1. **AGENTS.md** — Project conventions, linting
2. **`src/sims/box-empire/box-empire-AGENTS.md`** — Architecture decisions from Plans 1–3
3. **Master roadmap** — `create-five-other-plans-with-combined-will-result-in-a-full-game.md` §7 (Plan 4)
4. **Skill files:**
   - `.ai/skills/container-cargo-entities/SKILL.md` — Reefer fields, hazmat model (IMDG classes, segregation profiles, incident states), `createHazardousContainer` factory
   - `.ai/skills/terminal-equipment-entities/SKILL.md` — STS crane specs (5 size classes), cycle phases, stop conditions, `createSTSCrane` factory
   - `.ai/skills/vessel-entities/SKILL.md` — Panamax class defaults (LOA 294m, beam 32.2m, 4500 TEU), stability model, hatch cover logic
   - `.ai/skills/terminal-economics/SKILL.md` — Reefer surcharge ($50/day monitoring + $65/day power), hazmat surcharge (+75%), overweight surcharge (+35%)
   - `.ai/skills/terminal-infrastructure/SKILL.md` — Reefer power points per block, hazmat-allowed block designation
   - `.ai/skills/terminal-operations/SKILL.md` — DG cutoff times, crane cycle model (30 gross moves/hr, 25 net), hatch cover time (4 min)
5. **Knowledge base files:**
   - `knowledge-base/dk_sse__hazardous_containers_imdg.md` — Full IMDG class hierarchy, segregation table, stowage categories, DG yard rules
   - `knowledge-base/dk_equipment__quay_cranes_sts.md` — STS size classes, reach/height/speed specs, cycle breakdown, stop conditions, weather thresholds
   - `knowledge-base/dk_vessels__physical_classes_and_structure.md` — Panamax dimensions, bay counts, hatch structure
   - `knowledge-base/dk_vessels__stowage_locations_and_bayplan.md` — On-deck vs under-deck tiers, hatch cover positions
   - `knowledge-base/dk_vessels__stability_and_loading_rules.md` — Weight distribution, GM stability

---

## Player Experience

1. New container types start appearing in vessel manifests:
   - **Reefer containers** — visually distinct (with power cable icon), need powered yard slots, temperature monitoring
   - **Hazardous containers** — visually distinct (hazmat diamond icons), need segregation, DG-designated yard zones
2. Player must designate reefer and DG yard zones:
   - Existing blocks can be upgraded with reefer power points ($500 per point)
   - New blocks can be designated as DG zones during purchase
3. Player can purchase **STS gantry cranes** for dramatically faster quayside operations
4. **Panamax-class vessels** (~5000 TEU) can now arrive — requiring STS cranes to service efficiently
5. Hatch covers must be managed — under-deck containers only accessible after hatch removal
6. New revenue streams: reefer power surcharges and DG handling surcharges

---

## New Systems

### 1. Reefer Container Support

**Container entity extension** (from `container-cargo-entities` skill):

```typescript
interface Container {
  // ... existing fields ...
  isReefer: boolean
  reeferSetPoint?: number  // target temperature in °C (e.g., -18 for frozen, +2 for chilled)
  reeferActualTemp?: number  // current temperature — drifts if not powered
  reeferPowered?: boolean  // currently connected to power
}
```

**Reefer temperature ranges** (for random generation):

| Category | Set Point Range | Example Cargo |
|----------|----------------|---------------|
| Frozen | -25°C to -18°C | Meat, seafood, ice cream |
| Chilled | -2°C to +4°C | Dairy, produce, pharmaceuticals |
| Controlled | +10°C to +15°C | Bananas, chocolate |

**Reefer handling rules:**
- Must be placed in yard slots with reefer power points
- On placement: `reeferPowered = true`, temperature holds at set point
- If no powered slot available: placed in regular slot, `reeferPowered = false`, temperature drifts +0.5°C per sim-minute
- Temperature alarm if `actualTemp > setPoint + 5°C`
- Critical alarm if `actualTemp > setPoint + 10°C` — container at risk, negative event sound

**Reefer yard block upgrade:**
```typescript
interface YardBlockConfig {
  // ... existing fields ...
  reeferPowerPoints: number  // 0 for non-reefer blocks, up to bay_count for fully powered
}
```

- Upgrade cost: $500 per reefer power point
- Each power point serves one slot position (all tiers in that bay/row share one point)
- Reefer blocks are visually distinct (blue-tinted ground, visible power cables)

**Reefer economics** (from `terminal-economics` skill):

| Charge | Rate | Trigger |
|--------|------|---------|
| Reefer monitoring | $50/day | While in yard |
| Reefer power | $65/day | While plugged in |

### 2. Hazardous Container Support

**Simplified IMDG model** (from `dk_sse__hazardous_containers_imdg.md` — simplified for gameplay):

```typescript
type HazmatClass = 'flammable' | 'toxic' | 'corrosive' | 'general_dg'

interface Container {
  // ... existing fields ...
  isHazardous: boolean
  hazmatClass?: HazmatClass
  unNumber?: string  // UN identification number (e.g., "UN1203")
}
```

**Mapping from real IMDG to game classes:**

| Game Class | IMDG Classes | Visual | Color |
|------------|-------------|--------|-------|
| `flammable` | 2.1, 3, 4.1, 4.2 | Flame diamond | Red |
| `toxic` | 2.3, 6.1 | Skull diamond | White |
| `corrosive` | 8 | Corrosion diamond | Black/White |
| `general_dg` | 9 and others | Exclamation diamond | White |

**Segregation rules (simplified):**
- Flammable containers must be ≥ 2 bays from corrosive containers in the same block
- Toxic containers must be in isolated bays (no other hazmat class in same bay)
- General DG can be placed adjacent to any class
- All DG must be in DG-designated yard blocks

**DG yard block designation:**
```typescript
interface YardBlockConfig {
  // ... existing fields ...
  hazmatAllowed: boolean  // false by default
  hazmatCapacity?: number  // max DG containers in this block
}
```

- Existing blocks can be designated as DG zones: $1,000 upgrade cost
- DG blocks are visually distinct (yellow warning striping, hazmat signs)
- DG blocks have a safety perimeter (no other blocks within 5m)

**DG economics** (from `terminal-economics` skill):

| Charge | Rate |
|--------|------|
| DG handling surcharge | +75% of base handling fee |

So a 20ft DG import gate-out: $100 base + $75 surcharge = $175 total.

**DG alarm events:**
- If a DG container is placed in a non-DG zone → immediate warning event + negative sound
- If segregation rule is violated → warning event, player notified, container must be relocated
- If DG container dwell time > 7 days → inspection required event

### 3. STS Gantry Crane

From `terminal-equipment-entities` skill — Panamax class STS:

| Parameter | Value | Source |
|-----------|-------|--------|
| Gantry speed | ~0.6 m/s (35 m/min) | Skill: 35–45 m/min |
| Trolley speed | ~3.0 m/s (180 m/min) | Skill: 150–210 m/min |
| Hoist speed (laden) | ~1.0 m/s (60 m/min) | Skill: 60–75 m/min |
| Hoist speed (empty) | ~1.5 m/s (90 m/min) | Faster when empty |
| Cycle time (baseline) | ~62 s | From skill |
| Outreach | 50 m | Panamax class |
| Backreach | 15 m | Landside for truck/AGV handoff |
| Lift height above rail | 35 m | Panamax class |
| Rated load | 60 t | Under spreader |
| Rail gauge | ~30.48 m (100 ft) | Standard |
| Max operating wind | 20 m/s | From skill stop conditions |

**STS cycle phases** (from skill — 62s baseline):

| Phase | Duration | Description |
|-------|----------|-------------|
| `trolley_align` | 5s | Position trolley over target |
| `hoist_down_pick` | 8s | Lower spreader to container |
| `lock_settle` | 3s | Lock spreader, settle load |
| `hoist_up_loaded` | 10s | Lift container clear |
| `trolley_transfer` | 18s | Move trolley vessel→land or land→vessel |
| `hoist_down_set` | 8s | Lower to set position |
| `unlock_settle` | 3s | Unlock spreader, release |
| `hoist_clear` | 7s | Lift spreader clear |

**STS animation state machine:**
```typescript
type STSPhase =
  | 'idle'
  | 'gantry_travel'     // Moving along rail to target bay
  | 'trolley_out'        // Trolley moving toward vessel (waterside)
  | 'hoist_down'         // Spreader lowering to pick
  | 'lock'               // Spreader locking onto container
  | 'hoist_up'           // Lifting container
  | 'trolley_in'         // Trolley moving toward land (backreach)
  | 'hoist_set'          // Lowering container to set position
  | 'unlock'             // Releasing container
  | 'hoist_clear'        // Lifting spreader clear
```

**STS Three.js rendering — 4 articulated parts:**

1. **Gantry base/legs** — Travels along quay rail (X axis). Two portal legs connected by horizontal boom.
2. **Boom/girder** — Fixed to gantry, extends waterside (outreach) and landside (backreach)
3. **Trolley** — Moves along boom (Z axis, toward/away from water)
4. **Spreader + hoist** — Hangs from trolley, moves vertically (Y axis). Spreader locks/unlocks on containers.

Each part animates independently based on current `STSPhase`.

**STS vs Mobile Harbor Crane comparison:**

| Metric | Mobile Harbor Crane | STS Panamax |
|--------|-------------------|-------------|
| Cycle time | 90s | 62s |
| Moves per hour | ~40 | ~58 (gross 30 net 25 with delays) |
| Multi-bay | No (1 bay) | Yes (gantry travels to any bay) |
| Simultaneous cranes | Yes | Yes (with crane split planning) |

**Purchase details:**

| Item | Price | Daily Maintenance |
|------|-------|-------------------|
| STS Gantry Crane (Panamax) | $100,000 | $500/day |

**STS purchase requirements:**
- Requires berth infrastructure (berth length ≥ 250m for Panamax vessels)
- STS crane operates on shared rail along the quay
- Rail position tracked (for Plan 5 multi-crane contention)

### 4. Hatch Cover Logic

Vessel bays are divided into on-deck and under-deck:

```typescript
interface VesselBay {
  bayNumber: number
  onDeckSlots: VesselSlot[]
  underDeckSlots: VesselSlot[]
  hatchCoverState: 'closed' | 'open' | 'removing' | 'replacing'
}
```

**Hatch cover rules** (from `vessel-entities` skill):
- **On-deck containers**: Accessible without hatch removal (tiers 80–100, even)
- **Under-deck containers**: Requires hatch cover removal first (tiers 02–20, even)
- Hatch cover removal time: **4 minutes** (from `terminal-operations` skill crane cycle model)
- Hatch cover replacement time: **4 minutes**
- Hatch covers are stored on deck during operations (occupy temporary space)

**Discharge/load sequence with hatches:**
1. Crane works on-deck containers first (no hatch delay)
2. When all on-deck containers in a bay are handled, initiate hatch removal (~4 min)
3. Crane works under-deck containers
4. When under-deck is complete, replace hatch cover (~4 min)
5. Move to next bay

**Visual rendering:**
- Hatch covers visible as flat panels on vessel between on-deck stacks
- Animation: hatch cover slides/lifts off during removal
- Open hatch reveals under-deck container positions

### 5. Panamax Vessels

From `vessel-entities` skill — Panamax class:

| Parameter | Value |
|-----------|-------|
| LOA | ~294 m |
| Beam | 32.2 m |
| TEU capacity | ~4,500 |
| Bay count | 25–30 |
| Row count | ~13 |
| Max underdeck tiers | 10 |
| Max ondeck tiers | 8 |
| Draft | 12.04 m |
| Cranes needed | 3–4 |

**For gameplay, simplify to:**
- Vessels carry 100–300 containers (mix of 20ft, 40ft, reefer, DG)
- ~5–10% reefer, ~3–5% DG
- Multiple bays with full bay-row-tier stowage
- Require 2–3 cranes working simultaneously for efficient turnaround

**Vessel stability** (simplified from skill):
- Base GM: 2.2m for Panamax
- Weight distribution must be monitored during loading
- Visual indicator: stability gauge (green/yellow/red)
- If loading creates excessive list (weight imbalance port/starboard), warning event
- Player can pause loading and adjust load plan

---

## Store Additions (Pinia)

```typescript
interface BoxEmpireState {
  // ... Plans 1-3 fields ...

  // Plan 4 additions
  reeferAlarms: ReeferAlarm[]
  dgViolations: DGViolation[]
  stsCranes: STSCraneState[]
  vesselStabilityWarnings: string[]  // vessel IDs with stability issues
}

interface ReeferAlarm {
  containerId: string
  alarmType: 'temperature_warning' | 'temperature_critical'
  actualTemp: number
  setPoint: number
  simTime: number
}

interface DGViolation {
  containerId: string
  violationType: 'wrong_zone' | 'segregation' | 'dwell_exceeded'
  details: string
  simTime: number
}

interface STSCraneState {
  equipmentId: string
  currentPhase: STSPhase
  currentBay: number | null
  trolleyPosition: number  // 0 = landside, 1 = waterside
  hoistHeight: number  // meters
  attachedContainerId: string | null
  railPosition: number  // X position on rail
}
```

---

## UI Scope

### New UI Elements

| Element | Component | Description |
|---------|-----------|-------------|
| Reefer indicators | Update `ContainerInfo.vue` | Snowflake icon, temperature display, power status |
| DG indicators | Update `ContainerInfo.vue` | Hazmat diamond icons colored by class |
| Reefer alarm panel | `ReeferAlarmPanel.vue` | List of active reefer alarms |
| DG violation panel | `DGViolationPanel.vue` | List of segregation violations |
| STS crane info | Update `EquipmentInfo.vue` | Current phase, speed, bay assignment |
| Reefer/DG block upgrade | Update `YardBlockConfigurator.vue` | Options to add reefer power or DG designation |
| Hatch cover indicator | Update vessel rendering | Visual state of hatch covers per bay |
| Stability gauge | `VesselStability.vue` | Green/yellow/red gauge during loading |
| Cargo manifest view | `CargoManifest.vue` | Vessel's container breakdown by type |

### Updated Dashboard

Add new KPIs:

| KPI | Formula | Target |
|-----|---------|--------|
| Reefer containers in yard | Count of powered reefer containers | — |
| Reefer alarm count | Active temperature alarms | 0 |
| DG containers in yard | Count of DG containers | — |
| DG violations | Active segregation violations | 0 |
| STS utilization | STS busy time / total time | 70–90% |
| Vessel turnaround time | Vessel depart time - arrive time | Decreasing with STS |

---

## File Structure (New/Modified)

```
src/sims/box-empire/
├── components/
│   ├── ReeferAlarmPanel.vue          # Reefer temperature alarms (NEW)
│   ├── DGViolationPanel.vue          # DG segregation violations (NEW)
│   ├── VesselStability.vue           # Stability gauge during loading (NEW)
│   ├── CargoManifest.vue             # Vessel container breakdown (NEW)
│   ├── ContainerInfo.vue             # MODIFIED — reefer/DG indicators
│   ├── EquipmentInfo.vue             # MODIFIED — STS crane info
│   ├── Dashboard.vue                 # MODIFIED — new KPIs
│   ├── YardBlockConfigurator.vue     # MODIFIED — reefer/DG upgrades
│   └── PurchaseMenu.vue              # MODIFIED — STS crane, reefer/DG block upgrades
├── modules/
│   ├── stsController.ts              # STS crane state machine, cycle phases (NEW)
│   ├── stsRenderer.ts                # STS Three.js mesh — gantry, boom, trolley, spreader (NEW)
│   ├── reeferManager.ts              # Temperature monitoring, power tracking, alarms (NEW)
│   ├── hazmatManager.ts              # DG zone enforcement, segregation checks (NEW)
│   ├── hatchCoverManager.ts          # Hatch cover state, removal/replacement timing (NEW)
│   ├── vesselStability.ts            # Simplified stability model, weight balance (NEW)
│   ├── containerRenderer.ts          # MODIFIED — reefer/DG visual variants
│   ├── vesselRenderer.ts             # MODIFIED — hatch covers, larger vessel, bay-row-tier
│   ├── vesselManager.ts              # MODIFIED — hatch cover sequencing, Panamax support
│   ├── yardManager.ts                # MODIFIED — reefer power slot tracking, DG zone enforcement
│   ├── jobScheduler.ts               # MODIFIED — STS job assignment, hatch cover jobs
│   ├── equipmentController.ts        # MODIFIED — STS equipment type
│   ├── economy.ts                    # MODIFIED — reefer/DG surcharges
│   ├── purchaseSystem.ts             # MODIFIED — STS crane, reefer/DG upgrades in catalog
│   └── config.ts                     # MODIFIED — STS specs, reefer/DG parameters, Panamax vessel
├── store/
│   └── gameStore.ts                  # MODIFIED — reefer alarms, DG violations, STS state
├── types/
│   └── index.ts                      # MODIFIED — reefer/DG/STS/hatch cover interfaces
```

---

## Implementation Order (Recommended)

### Phase A — Reefer Containers
1. Extend `Container` interface with reefer fields
2. Implement `modules/reeferManager.ts` (temperature drift, power tracking, alarms)
3. Extend `YardBlockConfig` with `reeferPowerPoints`
4. Update `yardManager.ts` for reefer slot assignment (prefer powered slots)
5. Update `containerRenderer.ts` for reefer visual variant (blue tint, snowflake)
6. Update `economy.ts` with reefer surcharges ($50/day monitoring + $65/day power)
7. Implement `components/ReeferAlarmPanel.vue`

### Phase B — Hazardous Containers
8. Extend `Container` interface with hazmat fields
9. Implement `modules/hazmatManager.ts` (zone enforcement, segregation checks)
10. Extend `YardBlockConfig` with `hazmatAllowed`
11. Update `yardManager.ts` for DG zone enforcement and segregation rules
12. Update `containerRenderer.ts` for DG visual variant (hazmat diamond decals)
13. Update `economy.ts` with DG surcharge (+75%)
14. Implement `components/DGViolationPanel.vue`

### Phase C — STS Gantry Crane
15. Define STS interfaces and specs in `types/index.ts` and `config.ts`
16. Implement `modules/stsController.ts` (full state machine with cycle phases)
17. Implement `modules/stsRenderer.ts` (4-part articulated mesh: gantry, boom, trolley, spreader)
18. Update `jobScheduler.ts` for STS job assignment (quay-side operations)
19. Update `equipmentController.ts` to handle STS equipment type
20. Add STS to purchase catalog ($100,000)

### Phase D — Hatch Covers and Panamax Vessels
21. Implement `modules/hatchCoverManager.ts` (state machine, timing)
22. Implement `modules/vesselStability.ts` (simplified weight balance)
23. Update `vesselManager.ts` for Panamax support and hatch cover sequencing
24. Update `vesselRenderer.ts` for hatch cover visualization and larger vessel rendering
25. Update `vesselScheduler.ts` to generate Panamax vessels (100–300 containers)
26. Implement `components/VesselStability.vue` and `components/CargoManifest.vue`

### Phase E — Yard Configuration Updates
27. Update `YardBlockConfigurator.vue` for reefer power point and DG zone upgrades
28. Update `PurchaseMenu.vue` with new items (STS, reefer upgrade, DG upgrade)
29. Update `sceneBuilder.ts` for reefer/DG block visual styling

### Phase F — Dashboard and KPI Updates
30. Update `kpiTracker.ts` with reefer/DG/STS KPIs
31. Update `Dashboard.vue` with new KPI widgets

### Phase G — Integration and Testing
32. Test reefer temperature drift and alarms
33. Test DG zone enforcement and segregation
34. Test STS crane full cycle (pick from vessel, set on buffer)
35. Test hatch cover removal/replacement timing
36. Test Panamax vessel with mixed cargo (regular + reefer + DG)
37. Test vessel stability warnings
38. Test save/load with all new state
39. Lint and build

---

## Acceptance Criteria

- [ ] Reefer containers appear in vessel manifests and require powered yard slots
- [ ] Reefer temperature drifts when not powered; alarms trigger at thresholds
- [ ] Reefer power costs are tracked and charged ($50/day + $65/day)
- [ ] DG containers appear and require DG-designated yard zones
- [ ] Segregation rules enforced (flammable away from corrosive, toxic isolated)
- [ ] DG surcharges applied (+75% of base handling fee)
- [ ] STS gantry crane can be purchased ($100,000) and operates
- [ ] STS animation shows all 4 articulated parts (gantry, boom, trolley, spreader)
- [ ] STS cycle follows correct phase sequence with correct timing (~62s)
- [ ] STS is dramatically faster than mobile harbor crane
- [ ] Panamax vessels (~5000 TEU, 100–300 containers) arrive and are handled
- [ ] Hatch covers must be removed before accessing under-deck containers (~4 min)
- [ ] Hatch covers are visually rendered on vessel
- [ ] Vessel stability gauge works during loading (green/yellow/red)
- [ ] Cargo manifest view shows container type breakdown
- [ ] Dashboard shows reefer/DG/STS KPIs
- [ ] Save/load works with all new state
- [ ] No lint errors (`npm run lint`)
- [ ] Build succeeds (`npm run build`)

---

## Out of Scope for Plan 4

- Multiple berths
- Multiple simultaneous vessels at different berths
- Advanced automation (ASC)
- Crane rail contention (STS cranes don't share rails yet — only 1 STS per berth)
- Rail intermodal
- Barge operations

---

*End of Plan 4*
