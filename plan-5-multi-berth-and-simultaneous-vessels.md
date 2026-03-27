# Box Empire — Plan 5: Multi-Berth and Simultaneous Vessels

> **Status:** Not started
> **Dependencies:** Plan 4 (STS cranes, reefer/DG containers, Panamax vessels, hatch cover logic)
> **Builds on:** STS controller, berth infrastructure, crane rail, vessel scheduler, job scheduler with priority

---

## Objective

Introduce multiple berths that can host vessels simultaneously, creating resource contention and requiring sophisticated planning. This is the **culminating plan** — it brings together every system built in Plans 1–4 and layers on the highest-complexity gameplay: berth allocation, crane sharing on shared rails, equipment prioritization across competing vessel operations, and inter-berth horizontal transport. The player's terminal becomes a full-scale port capable of handling concurrent vessel operations.

---

## Prerequisites — Read Before Implementing

1. **AGENTS.md** — Project conventions, linting
2. **`src/sims/box-empire/box-empire-AGENTS.md`** — Architecture decisions from Plans 1–4
3. **Master roadmap** — `create-five-other-plans-with-combined-will-result-in-a-full-game.md` §8 (Plan 5)
4. **Skill files:**
   - `.ai/skills/terminal-infrastructure/SKILL.md` — Berth infrastructure (berth_length_m, design_depth_m, apron_width_m, crane_rail, fender_system, mooring_points), typical berth dimensions by vessel class
   - `.ai/skills/terminal-equipment-entities/SKILL.md` — STS crane specs, stop conditions, weather thresholds (wind ≥ 20 m/s cease operations)
   - `.ai/skills/vessel-entities/SKILL.md` — Vessel classes from feeder to Panamax, berth allocation by LOA/draft
   - `.ai/skills/terminal-operations/SKILL.md` — Crane cycle model (net 25 moves/hr), congestion multiplier, vessel turnaround KPIs
   - `.ai/skills/terminal-economics/SKILL.md` — Berth-related charges, express handling surcharge (+150%)
5. **Knowledge base files:**
   - `knowledge-base/dk_infra__quay_berth_mooring.md` — Berth design, mooring, fender systems, bollard SWL
   - `knowledge-base/dk_infra__terminal_layouts_and_roads.md` — Road network model, node-graph pathfinding, congestion model, choke-point scoring
   - `knowledge-base/dk_equipment__quay_cranes_sts.md` — Crane rail sharing, anti-collision, storm locking
   - `knowledge-base/dk_ops__vessel_loading_unloading.md` — Multi-crane splits, bay assignment, sequence planning
   - `knowledge-base/dk_equipment__terminal_tractors.md` — Horizontal transport speeds, coupling/decoupling times

---

## Player Experience

1. At some point in late gameplay the player can purchase a **second berth** ($200,000)
2. Multiple vessels can now be at the terminal **simultaneously** — one at each berth
3. Player must manage:
   - **Berth allocation**: Which vessel goes to which berth (based on LOA/draft fit)
   - **Crane sharing**: STS cranes run on shared quay rails — cranes **cannot pass each other**
   - **Equipment prioritization**: Which vessel gets service first when equipment is scarce
   - **Inter-berth horizontal transport**: Reach stackers and trucks must travel between berths via road network
4. Significantly higher operational complexity creates both challenges and earning potential
5. The full terminal — multiple berths, STS cranes, RMG cranes, gatehouses, reefer/DG zones — operates as an integrated system

---

## New Systems

### 1. Multiple Berths

**Berth infrastructure** (from `terminal-infrastructure` skill):

```typescript
interface Berth {
  id: string
  name: string  // e.g., "Berth 1", "Berth 2"
  position: { x: number; z: number }  // quay position (Z ≈ 0, X varies)
  length: number  // meters — determines max vessel LOA
  depth: number  // meters — determines max vessel draft
  apronWidth: number  // meters — working area between quay edge and yard
  currentVessel: string | null  // vessel visit ID
  status: 'available' | 'occupied' | 'maintenance'
  assignedCraneIds: string[]  // STS cranes currently serving this berth
}
```

**Default berth dimensions** (from skill, Panamax-capable):

| Parameter | Berth 1 (existing) | Berth 2 (purchasable) |
|-----------|--------------------|-----------------------|
| Length | 350 m | 350 m |
| Depth | 14 m | 14 m |
| Apron width | 40 m | 40 m |
| Position (X) | 0–350 m | 360–710 m |
| Max vessel LOA | ~340 m | ~340 m |
| Max vessel draft | ~13.5 m | ~13.5 m |

**Purchase details:**

| Item | Price | Daily Maintenance |
|------|-------|-------------------|
| Second berth | $200,000 | $1,000/day |
| Berth extension (+100m) | $75,000 | $300/day |

**Berth allocation logic:**
1. When a vessel is announced, check available berths
2. Match vessel LOA ≤ berth length and vessel draft ≤ berth depth
3. If multiple berths fit, prefer the berth with the most available STS cranes nearby
4. If no berth is available, vessel waits at anchor (queue) — visible offshore
5. Player can manually override berth assignment

```typescript
interface BerthAllocation {
  vesselVisitId: string
  berthId: string
  allocatedAt: number  // sim time
  estimatedDeparture: number
  craneAssignment: CraneAssignment[]
}

interface CraneAssignment {
  craneId: string
  bayRangeStart: number
  bayRangeEnd: number
}
```

### 2. Crane Rail Sharing

**Core constraint:** STS cranes are mounted on **shared rails** that run along the entire quay. Cranes travel along these rails (X axis) but **cannot pass each other**. This creates the central logistical challenge of Plan 5.

```typescript
interface CraneRailSystem {
  railStartX: number  // typically 0
  railEndX: number  // total quay length
  cranes: CraneOnRail[]
  minimumSafeDistance: number  // 10m between cranes
}

interface CraneOnRail {
  craneId: string
  currentX: number  // current position on rail
  targetX: number  // where it needs to be
  assignedBerthId: string | null
  assignedBayRange: { startX: number; endX: number } | null
  isBlocked: boolean  // true if cannot reach target due to adjacent crane
}
```

**Crane ordering rules:**
- Cranes maintain a fixed left-to-right order — crane A is always left of crane B
- Crane A can never move past crane B's position (and vice versa)
- Minimum safe distance: **10m** between adjacent cranes
- If a crane needs to reach a bay that's behind an adjacent crane, the adjacent crane must move first

**Crane assignment algorithm:**

```
For each berth with a vessel:
  1. Determine which bays need service (discharge/load lists)
  2. Calculate bay positions along X axis
  3. Assign cranes to non-overlapping bay ranges
  4. Ensure crane positions are compatible with ordering constraint
  5. If crane A needs bays that crane B is blocking:
     a. Check if crane B can be temporarily repositioned
     b. If not, queue the work for after crane B finishes its current bay
```

**Deadlock prevention:**
- Never assign two cranes to overlapping ranges that would require crossing
- If a temporary blockage occurs, the blocked crane enters `waiting_for_clearance` state
- Timeout: if a crane is blocked for > 60s, re-plan crane splits

**Visual rendering:**
- Show crane positions on the rail with position indicators
- Highlight blocked cranes in yellow/orange
- Show crane assignment ranges as colored zones along the quay

### 3. Vessel Priority System

When multiple vessels need service simultaneously, resource contention occurs. The priority system determines which vessel gets equipment first.

```typescript
interface VesselPriority {
  vesselVisitId: string
  priority: 'high' | 'normal' | 'low'
  reason: string  // e.g., "Express service", "Late departure", "Normal schedule"
  timeAtBerth: number  // sim time since berthing
}
```

**Priority effects:**
- **Job scheduling**: Jobs for higher-priority vessels are scheduled before lower-priority
- **Crane allocation**: Higher-priority vessels get more cranes assigned
- **Equipment dispatch**: Reach stackers/trucks prioritize high-priority vessel moves
- **Express surcharge**: Player can set a vessel to "Express" priority for +150% revenue (from `terminal-economics` skill)

**Auto-priority rules:**
- Vessel waiting time > threshold → auto-escalate to `high`
- Vessel with DG containers → prefer earlier service (safety)
- Vessel with reefer containers → prefer earlier service (temperature risk)

**Player controls:**
- Click on a vessel → set priority (high/normal/low)
- Priority changes take effect immediately — job scheduler recalculates
- Express priority option: +150% surcharge on all handling charges for that vessel

### 4. Inter-Berth Horizontal Transport

With multiple berths, containers must travel between different areas of the terminal. The road network becomes critical.

**Transport routes:**
- Berth 1 quay buffer ↔ Yard blocks
- Berth 2 quay buffer ↔ Yard blocks
- Yard blocks ↔ Gatehouses
- Berth 1 area ↔ Berth 2 area (inter-berth road)

**Road network expansion** (from `terminal-infrastructure` skill):

```typescript
// Extend terminal map with new nodes and edges
interface TerminalMapExpansion {
  // New nodes for Berth 2
  berth2QuayBuffer: PathNode
  berth2CranePickup: PathNode[]  // one per STS crane at Berth 2

  // Inter-berth connecting edges
  interBerthRoad: PathEdge  // connects Berth 1 area to Berth 2 area

  // Speed limits
  mainCorridorSpeed: 6.5  // m/s (~23 km/h) — from knowledge base
  localManeuverSpeed: 3.0  // m/s (~11 km/h) — near equipment
  interBerthSpeed: 5.0  // m/s (~18 km/h) — inter-berth road
}
```

**Congestion model** (from `terminal-infrastructure` skill):

```typescript
// Effective speed decreases as traffic density increases
function effectiveSpeed(
  baseSpeed: number,
  currentVehicles: number,
  roadCapacity: number
): number {
  const densityRatio = currentVehicles / roadCapacity
  const alpha = 1.0  // congestion sensitivity
  const beta = 2.0   // congestion exponent
  return baseSpeed / (1 + alpha * Math.pow(densityRatio, beta))
}

// Choke point detection
function chokeScore(demandThroughput: number, effectiveServiceRate: number): number {
  return demandThroughput / effectiveServiceRate
  // Critical when sustained score > 1.0
}
```

**Congestion effects:**
- When both berths are active, more trucks/reach stackers use the road network
- Shared road segments become bottlenecks
- Travel times increase with congestion
- Player sees congestion indicators on affected road segments

**Congestion visualization:**
- Road segments colored green/yellow/red based on traffic density
- Bottleneck indicators at high choke-score nodes
- Dashboard shows "Transport congestion index"

### 5. Vessel Waiting Queue

When all berths are occupied, arriving vessels wait at anchor:

```typescript
interface VesselQueue {
  waitingVessels: QueuedVessel[]
}

interface QueuedVessel {
  vesselVisitId: string
  arrivalTime: number  // sim time
  preferredBerthId: string | null
  waitStartTime: number
}
```

**Queue behavior:**
- Waiting vessels are visible offshore (rendered at sea, Z < -50)
- Vessels wait in FIFO order by default
- Player can reorder the queue (drag to prioritize)
- When a berth becomes available, the next queued vessel berths automatically
- Vessels waiting too long may incur demurrage penalties (future consideration)

**Visual rendering:**
- Anchored vessels visible at sea, slightly different rendering (no crane activity)
- Queue list shown in a side panel
- Estimated wait time displayed per vessel

---

## Store Additions (Pinia)

```typescript
interface BoxEmpireState {
  // ... Plans 1-4 fields ...

  // Plan 5 additions
  berths: Berth[]
  craneRailSystem: CraneRailSystem
  vesselPriorities: Record<string, VesselPriority>
  vesselQueue: QueuedVessel[]
  berthAllocations: BerthAllocation[]
  transportCongestion: Record<string, number>  // edge ID → congestion factor
}
```

---

## UI Scope

### New UI Elements

| Element | Component | Description |
|---------|-----------|-------------|
| Berth purchase option | Update `PurchaseMenu.vue` | In infrastructure catalog |
| Multi-berth overview | `BerthOverview.vue` | See all berths, their vessels, crane assignments |
| Crane rail visualization | `CraneRailPanel.vue` | Show crane positions on shared rail, assignment zones |
| Vessel priority controls | `VesselPriorityControl.vue` | Set priority per vessel, express option |
| Vessel queue panel | `VesselQueue.vue` | Queue of waiting vessels, reorderable |
| Congestion overlay | Update 3D rendering | Road segments colored by congestion level |
| Congestion dashboard | Update `Dashboard.vue` | Transport congestion index KPI |

### Updated Dashboard

New KPIs:

| KPI | Formula | Target |
|-----|---------|--------|
| Berth utilization | `occupied_time / total_time` per berth | 70–85% |
| Vessel wait time | Average time at anchor before berthing | < 2 hours sim-time |
| Crane conflicts | Number of crane blocking events per day | Decreasing |
| Transport congestion | Average congestion factor across all edges | < 1.3× |
| Multi-vessel throughput | Containers handled per hour across all berths | Growing |
| Express revenue | Revenue from express-priority vessels | Growing |

---

## File Structure (New/Modified)

```
src/sims/box-empire/
├── components/
│   ├── BerthOverview.vue             # Multi-berth status display (NEW)
│   ├── CraneRailPanel.vue           # Crane rail positions and assignments (NEW)
│   ├── VesselPriorityControl.vue    # Per-vessel priority setting (NEW)
│   ├── VesselQueue.vue              # Vessel waiting queue (NEW)
│   ├── Dashboard.vue                # MODIFIED — new KPIs (berth util, wait time, congestion)
│   ├── PurchaseMenu.vue             # MODIFIED — berth in catalog
│   └── TopBar.vue                   # MODIFIED — berth status indicators
├── modules/
│   ├── berthManager.ts              # Berth allocation, vessel berthing/unberthing (NEW)
│   ├── craneRailManager.ts          # Rail sharing, ordering, deadlock prevention (NEW)
│   ├── vesselPriority.ts            # Priority assignment, express surcharge (NEW)
│   ├── vesselQueueManager.ts        # Anchor queue, FIFO, player reordering (NEW)
│   ├── congestionModel.ts           # Traffic density, effective speed, choke scoring (NEW)
│   ├── berthRenderer.ts             # Berth 2 quay, apron, bollards rendering (NEW)
│   ├── queuedVesselRenderer.ts      # Anchored vessels at sea rendering (NEW)
│   ├── stsController.ts             # MODIFIED — rail position tracking, blocking logic
│   ├── stsRenderer.ts               # MODIFIED — crane position on shared rail
│   ├── jobScheduler.ts              # MODIFIED — multi-vessel priority, crane assignment
│   ├── equipmentController.ts       # MODIFIED — inter-berth dispatch
│   ├── terminalMap.ts               # MODIFIED — Berth 2 nodes, inter-berth edges
│   ├── pathfinding.ts               # MODIFIED — congestion-aware edge weights
│   ├── vesselScheduler.ts           # MODIFIED — multiple concurrent vessels
│   ├── vesselManager.ts             # MODIFIED — multi-berth vessel lifecycle
│   ├── economy.ts                   # MODIFIED — express surcharge, berth maintenance
│   ├── sceneBuilder.ts              # MODIFIED — expanded terminal, Berth 2 area
│   ├── kpiTracker.ts                # MODIFIED — berth utilization, congestion, wait time KPIs
│   └── config.ts                    # MODIFIED — berth specs, rail parameters, congestion constants
├── store/
│   └── gameStore.ts                 # MODIFIED — berths, rail system, priorities, queue
├── types/
│   └── index.ts                     # MODIFIED — Berth, CraneRailSystem, VesselPriority, etc.
```

---

## Implementation Order (Recommended)

### Phase A — Berth Infrastructure
1. Define berth interfaces in `types/index.ts`
2. Add berth config to `config.ts` (dimensions, prices, Berth 1 defaults)
3. Implement `modules/berthManager.ts` (allocation logic, vessel LOA/draft check)
4. Update `terminalMap.ts` to add Berth 2 nodes when purchased
5. Add berth to purchase catalog in `purchaseSystem.ts`
6. Implement `modules/berthRenderer.ts` (quay, apron, water rendering for Berth 2)

### Phase B — Crane Rail System
7. Implement `modules/craneRailManager.ts` (rail model, ordering constraint, minimum distance)
8. Update `stsController.ts` to track rail positions and handle blocking
9. Implement crane assignment algorithm (non-overlapping bay ranges, deadlock prevention)
10. Update `stsRenderer.ts` to show crane positions on shared rail
11. Implement `components/CraneRailPanel.vue`

### Phase C — Multi-Vessel Operations
12. Update `vesselScheduler.ts` to generate concurrent vessel arrivals
13. Implement `modules/vesselQueueManager.ts` (anchor queue, FIFO, reordering)
14. Update `vesselManager.ts` for multi-berth vessel lifecycle
15. Implement `modules/queuedVesselRenderer.ts` (anchored vessels at sea)
16. Implement `components/VesselQueue.vue`

### Phase D — Priority System
17. Implement `modules/vesselPriority.ts` (priority levels, auto-escalation, express surcharge)
18. Update `jobScheduler.ts` for multi-vessel priority-based scheduling
19. Update `equipmentController.ts` for inter-berth dispatch decisions
20. Implement `components/VesselPriorityControl.vue`
21. Update `economy.ts` with express surcharge (+150%)

### Phase E — Congestion Model
22. Implement `modules/congestionModel.ts` (density ratio, effective speed, choke scoring)
23. Update `pathfinding.ts` for congestion-aware edge weights
24. Update road rendering to show congestion (green/yellow/red coloring)
25. Add congestion indicators to dashboard

### Phase F — Berth Overview UI
26. Implement `components/BerthOverview.vue`
27. Update `Dashboard.vue` with berth utilization, wait time, crane conflicts, congestion KPIs
28. Update `TopBar.vue` with berth status indicators
29. Update `PurchaseMenu.vue` with berth infrastructure

### Phase G — Integration and Testing
30. Test berth allocation (vessel fits berth length/draft)
31. Test crane rail ordering (cranes cannot pass, minimum distance)
32. Test crane blocking and re-planning
33. Test two vessels berthed simultaneously with independent crane operations
34. Test vessel queue (vessel waits at anchor, berths when available)
35. Test priority system (high-priority vessel gets equipment first)
36. Test express surcharge revenue
37. Test inter-berth transport congestion
38. Test congestion visualization (road coloring)
39. Test save/load with all new state
40. Full integration test: 2 berths, 3+ STS cranes, mixed cargo (regular + reefer + DG), both 20ft and 40ft containers
41. Lint and build

---

## Risk Notes

### Deadlock in Crane Rail Sharing

The biggest technical risk in Plan 5. Scenarios to test:

1. **Basic blocking**: Crane A at X=100 needs to reach X=400, but Crane B is at X=300. Crane B must move to X=410+ first.
2. **Mutual blocking**: Crane A needs to go right, Crane B needs to go left — both blocked. Resolution: prioritize the crane with the higher-priority vessel.
3. **Three-crane pileup**: With 3+ cranes, ensure the algorithm handles cascading repositioning.

**Mitigation**: Start with 2 cranes maximum for testing. The algorithm should work with 3+ but 2 is the common case.

### Job Scheduler Complexity

With multi-vessel priority, the job scheduler must:
- Sort jobs by vessel priority first, then by job priority
- Assign equipment considering distance to both berths
- Handle job preemption (higher-priority vessel takes equipment from lower-priority)
- Avoid starvation (lower-priority vessels still get some service)

**Mitigation**: Use a weighted scoring formula for job assignment:
```
score = vessel_priority_weight * vessel_priority
      + distance_weight * (1 / distance_to_pickup)
      + time_waiting_weight * time_in_queue
```

### Performance

With 2 berths, potentially 400+ containers, 4+ cranes, and congestion modeling, performance becomes a concern.

**Mitigation**:
- Keep InstancedMesh for all containers (single draw call)
- Limit pathfinding recalculation frequency (every 5 ticks, not every tick)
- Congestion model: update every 30 ticks, not every tick
- Profile with Chrome DevTools if fps drops below 30

---

## Acceptance Criteria

- [ ] Second berth can be purchased ($200,000)
- [ ] Berth 2 appears in the terminal with quay, apron, and water rendering
- [ ] Vessels are allocated to berths based on LOA/draft fit
- [ ] Two vessels can be berthed and serviced simultaneously
- [ ] STS cranes share rails and **cannot pass each other**
- [ ] Minimum safe distance (10m) maintained between cranes on rail
- [ ] Crane assignment respects ordering constraint (no crossing)
- [ ] Blocked cranes enter waiting state and resume when clearance is available
- [ ] Deadlock detection and resolution works (priority-based)
- [ ] Vessel priority (high/normal/low) affects job scheduling
- [ ] Express priority option charges +150% surcharge
- [ ] Vessels wait at anchor when no berth is available
- [ ] Vessel queue is visible and reorderable by the player
- [ ] Queued vessels berth automatically when a berth becomes available
- [ ] Inter-berth transport works via road network
- [ ] Congestion model affects travel times when traffic is high
- [ ] Road segments show congestion visualization (green/yellow/red)
- [ ] Dashboard shows berth utilization, vessel wait time, crane conflicts, congestion index
- [ ] Terminal can handle significantly more throughput than single-berth
- [ ] Save/load works with all new state
- [ ] No lint errors (`npm run lint`)
- [ ] Build succeeds (`npm run build`)

---

## Out of Scope for Plan 5

- More than 2 berths (future expansion)
- AGVs or automated horizontal transport
- Rail intermodal connections
- Barge operations
- Automated stacking cranes (ASC) replacing RMGs
- Weather events affecting operations (beyond crane wind stops)
- Staff management or shift scheduling

---

## Endgame Vision

After Plan 5, the player has a complete container terminal with:

| System | Capability |
|--------|-----------|
| **Berths** | 2 berths handling Panamax-class vessels simultaneously |
| **Quay cranes** | Multiple STS cranes on shared rails |
| **Yard cranes** | RMG cranes automating yard blocks |
| **Reach stackers** | Flexible horizontal transport and exception handling |
| **Gatehouses** | Multiple parallel gate lanes |
| **Container types** | 20ft, 40ft, reefer, hazardous (4 DG classes) |
| **Economy** | Base handling + surcharges + storage + express premium |
| **Visibility** | Full KPI dashboard with 15+ metrics |

This represents a fully functional container terminal management simulation. Future expansion possibilities (beyond Plan 5) include: ULCV vessels, AGV automation, rail connections, weather events, staff management, and multi-terminal competition.

---

*End of Plan 5*
