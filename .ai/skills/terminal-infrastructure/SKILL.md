---
name: terminal-infrastructure
description: >-
  Data structures, schemas, and default values for container terminal
  infrastructure: berths, quay walls, yard blocks, road networks, gates,
  and layout archetypes. Use when building terminal layouts, yard planning,
  or procedural terminal generation.
---

# Terminal Infrastructure & Yard Layout

Comprehensive reference for container terminal data structures, realistic defaults, and factory functions. All interfaces are TypeScript-first and designed for strict mode.

---

## 1. Berth Infrastructure

### Core Interface

```ts
interface CraneRail {
  waterside_offset_m: number   // distance from quay edge to waterside rail, typically 2–4 m
  gauge_m: number              // rail-to-rail distance, ~30.48 m (100 ft standard)
  travel_limit_start_m: number // chainage where crane travel begins
  travel_limit_end_m: number   // chainage where crane travel ends
}

interface Fender {
  type: 'cell' | 'cone' | 'arch' | 'pneumatic'
  pitch_m: number              // spacing between fenders, 10–25 m
  design_energy_kNm: number    // energy absorption capacity
  peak_reaction_kN: number     // max force transmitted to structure
}

interface MooringPoint {
  point_id: string
  type: 'bollard' | 'qrh' | 'dolphin'    // quick-release hook, isolated dolphin
  chainage_m: number                       // position along berth face
  swl_t: number                            // safe working load in tonnes (50–200+)
  has_capstan: boolean
  has_load_monitoring: boolean
}

interface Berth {
  berth_id: string
  berth_length_m: number        // 250–500+ m
  design_depth_m: number        // 12–18+ m (alongside depth chart datum)
  apron_width_m: number         // 30–65 m between quay edge and first crane rail
  allowable_vessel_loa_m: number
  allowable_beam_m: number
  crane_rail: CraneRail
  fender_system: Fender
  mooring_points: MooringPoint[]
}
```

### Berth Acceptance Rule

A vessel may use a berth only when **all** of these are satisfied:

```ts
function canBerthAcceptVessel(berth: Berth, vessel: VesselProfile): boolean {
  const loa_ok    = vessel.loa_m <= berth.allowable_vessel_loa_m
  const beam_ok   = vessel.beam_m <= berth.allowable_beam_m
  const draft_ok  = vessel.max_draft_m <= berth.design_depth_m
  const crane_ok  = (berth.crane_rail.travel_limit_end_m -
                     berth.crane_rail.travel_limit_start_m) >= vessel.loa_m * 0.8
  const fender_ok = berth.fender_system.design_energy_kNm >=
                     vessel.displacement_t * 0.002 // simplified energy check
  const mooring_ok = berth.mooring_points.length >= 6

  return loa_ok && beam_ok && draft_ok && crane_ok && fender_ok && mooring_ok
}
```

### Typical Berth Dimensions by Vessel Class

| Vessel Class | LOA (m) | Beam (m) | Draft (m) | Berth Length (m) | Depth (m) | Apron (m) |
|--------------|---------|----------|-----------|------------------|-----------|-----------|
| Feeder       | 100–180 | 20–28    | 8–10      | 250              | 12        | 30        |
| Panamax      | 200–290 | 32       | 12–13     | 350              | 14        | 40        |
| Post-Panamax | 300–340 | 40–45    | 14–15     | 400              | 16        | 50        |
| Neo-Panamax  | 350–370 | 49–51    | 15–16     | 420              | 16.5      | 55        |
| ULCV 20k+    | 380–400 | 59–62    | 16–17     | 500              | 18        | 65        |

---

## 2. Yard Block Model

### Core Interface

```ts
type BlockType = 'import' | 'export' | 'reefer' | 'hazmat' | 'empty' | 'transshipment'
type Orientation = 'parallel' | 'perpendicular'
type InterchangeSide = 'one-side' | 'dual-side'

interface YardBlock {
  block_id: string
  block_type: BlockType
  bay_count: number               // 10–50
  row_count: number               // 4–10
  max_tier: number                // 3–6 (ground-stacked tiers)
  orientation: Orientation        // relative to quay line
  interchange_side: InterchangeSide
  reefer_power_points: number     // 0 for non-reefer blocks
  hazmat_allowed: boolean
}
```

### Yard Slot (Individual Stacking Position)

```ts
interface YardSlot {
  block_id: string
  bay: number         // 1-indexed
  row: number         // 1-indexed
  tier: number        // 1 = ground level
  is_occupied: boolean
  container_id: string | null
  max_weight_kg: number           // structural limit for this tier (lower tiers bear more)
  reefer_power_available: boolean
  hazmat_allowed: boolean
}
```

### Example Blocks

| Block   | Type           | Bays | Rows | Max Tier | Notes                       |
|---------|----------------|------|------|----------|-----------------------------|
| IMP-A1  | import         | 20   | 6    | 4        | Near gate, fast truck turns  |
| IMP-A2  | import         | 20   | 6    | 4        | Near gate                    |
| EXP-C1  | export         | 30   | 8    | 5        | Near quay, high throughput   |
| EXP-C3  | export         | 30   | 8    | 5        | Near quay                    |
| RF-R1   | reefer         | 15   | 4    | 4        | 60 power points              |
| RF-R2   | reefer         | 15   | 4    | 4        | 60 power points              |
| DG-D1   | hazmat         | 10   | 4    | 3        | Segregated, safety distances |
| MT-E1   | empty          | 25   | 8    | 6        | Higher stacking, less access |
| TS-T1   | transshipment  | 20   | 6    | 5        | Between quay and rail        |

### Capacity Calculation

```ts
function blockCapacity(block: YardBlock): number {
  return block.bay_count * block.row_count * block.max_tier
}

function blockOccupancy(block: YardBlock, occupied: number): number {
  return occupied / blockCapacity(block)
}
```

---

## 3. Stacking Rules

### Rehandle Model

A container is **accessible** only if it sits at the top of its stack. Otherwise, every container above it must be rehandled (moved out of the way and placed back).

```ts
function rehandlesRequired(
  targetTier: number,
  topOfStack: number
): number {
  return Math.max(0, topOfStack - targetTier)
}

function retrievalCost(targetTier: number, topOfStack: number): number {
  return 1 + rehandlesRequired(targetTier, topOfStack)
}
```

### Congestion Multiplier

| Occupancy | Multiplier | Effect                              |
|-----------|------------|-------------------------------------|
| ≤ 70%     | 1.0        | Normal operations                   |
| 70–80%    | 1.0        | Manageable, slight delays           |
| 80–90%    | 1.2        | Elevated rehandles, slower moves    |
| > 90%     | 1.5        | Severe congestion, operational risk |

```ts
function congestionMultiplier(occupancy: number): number {
  if (occupancy > 0.9) return 1.5
  if (occupancy > 0.8) return 1.2
  return 1.0
}
```

### Stacking Strategies

| Strategy        | Avg Rehandle Rate | Description                                          |
|-----------------|-------------------|------------------------------------------------------|
| Random          | ~0.80             | No logic — worst case baseline                       |
| FIFO            | ~0.60             | First-in-first-out ordering within bays              |
| POD Grouping    | ~0.40             | Group by port of discharge                           |
| Vessel Grouping | ~0.20             | Group by target vessel — strong for transshipment    |
| Tier-Aware      | ~0.15             | Weight/departure priority placed on top tiers first  |

```ts
type StackingStrategy =
  | 'random'
  | 'fifo'
  | 'pod_grouping'
  | 'vessel_grouping'
  | 'tier_aware'

const REHANDLE_RATES: Record<StackingStrategy, number> = {
  random: 0.80,
  fifo: 0.60,
  pod_grouping: 0.40,
  vessel_grouping: 0.20,
  tier_aware: 0.15,
}
```

---

## 4. Layout Archetypes

### Overview

| Archetype            | Block Orientation | Equipment        | Density | Automation | Typical Use           |
|----------------------|-------------------|------------------|---------|------------|-----------------------|
| Parallel RTG         | Parallel to quay  | RTG / eRTG       | High    | Manual/Mix | Most common worldwide |
| Perpendicular ASC    | Perpendicular     | ASC (ARMG)       | High    | Full auto  | Greenfield automated  |
| Straddle Carrier     | Parallel          | Straddle carrier | Medium  | Mixed      | Flexible, Aus/NZ      |
| U-Type Automated     | Perpendicular     | ARMG + AGV/ALV   | High    | Full auto  | Newest designs        |

### Starter Dimensions

| Parameter            | Min  | Typical | Max  | Unit   |
|----------------------|------|---------|------|--------|
| Block length (bays)  | 20   | 40      | 50   | bays   |
| Block width (rows)   | 4    | 6–8     | 10   | rows   |
| Block height (tiers) | 3    | 4–5     | 6    | tiers  |
| Inter-block gap      | 1.5  | 3       | 6    | metres |
| Truck lane width     | 3.5  | 4       | 5    | metres |
| Pass lane width      | 12   | 15      | 20   | metres |

### Archetype Interfaces

```ts
type LayoutArchetype =
  | 'parallel_rtg'
  | 'perpendicular_asc'
  | 'straddle_carrier'
  | 'u_type_automated'

interface LayoutConfig {
  archetype: LayoutArchetype
  quay_length_m: number
  yard_depth_m: number
  block_orientation: Orientation
  block_length_bays: number
  block_width_rows: number
  block_height_tiers: number
  inter_block_gap_m: number
  truck_lane_width_m: number
  pass_lane_width_m: number
  equipment_type: string
  automation_level: 'manual' | 'semi_auto' | 'fully_auto'
}
```

### Archetype Defaults

```ts
const LAYOUT_DEFAULTS: Record<LayoutArchetype, LayoutConfig> = {
  parallel_rtg: {
    archetype: 'parallel_rtg',
    quay_length_m: 1000,
    yard_depth_m: 500,
    block_orientation: 'parallel',
    block_length_bays: 40,
    block_width_rows: 6,
    block_height_tiers: 5,
    inter_block_gap_m: 3,
    truck_lane_width_m: 4,
    pass_lane_width_m: 15,
    equipment_type: 'RTG',
    automation_level: 'manual',
  },
  perpendicular_asc: {
    archetype: 'perpendicular_asc',
    quay_length_m: 1200,
    yard_depth_m: 600,
    block_orientation: 'perpendicular',
    block_length_bays: 45,
    block_width_rows: 8,
    block_height_tiers: 5,
    inter_block_gap_m: 4,
    truck_lane_width_m: 0,  // no truck lanes — ASC handles both sides
    pass_lane_width_m: 18,
    equipment_type: 'ASC',
    automation_level: 'fully_auto',
  },
  straddle_carrier: {
    archetype: 'straddle_carrier',
    quay_length_m: 800,
    yard_depth_m: 400,
    block_orientation: 'parallel',
    block_length_bays: 30,
    block_width_rows: 4,
    block_height_tiers: 3,
    inter_block_gap_m: 6,
    truck_lane_width_m: 5,
    pass_lane_width_m: 20,
    equipment_type: 'Straddle Carrier',
    automation_level: 'semi_auto',
  },
  u_type_automated: {
    archetype: 'u_type_automated',
    quay_length_m: 1400,
    yard_depth_m: 700,
    block_orientation: 'perpendicular',
    block_length_bays: 50,
    block_width_rows: 10,
    block_height_tiers: 6,
    inter_block_gap_m: 4,
    truck_lane_width_m: 0,
    pass_lane_width_m: 18,
    equipment_type: 'ARMG',
    automation_level: 'fully_auto',
  },
}
```

---

## 5. Road Network Model

### Node & Edge Interfaces

```ts
type NodeType =
  | 'junction'
  | 'crane_buffer'
  | 'block_io'
  | 'gate'
  | 'rail_io'
  | 'yard_entry'
  | 'parking'

interface RoadNode {
  node_id: string
  type: NodeType
  x: number          // metres from terminal origin
  y: number
  capacity_veh: number   // max vehicles that can queue here
}

type Directionality = 'one_way' | 'two_way'
type ControlType = 'uncontrolled' | 'stop' | 'signal' | 'reservation' | 'priority'

interface RoadEdge {
  edge_id: string
  from_node: string
  to_node: string
  length_m: number
  lane_count: number            // 1–3
  directionality: Directionality
  speed_limit_mps: number       // metres per second
  vehicle_classes: VehicleClass[]
  capacity_veh: number          // max simultaneous vehicles on this segment
  control_type: ControlType
  turn_penalty_s: number        // additional seconds for turning manoeuvres
}

type VehicleClass = 'truck' | 'agv' | 'alv' | 'straddle' | 'terminal_tractor' | 'service'
```

### Travel Time Model

```ts
interface TravelTimeComponents {
  free_flow_time_s: number
  turn_penalty_s: number
  queue_delay_s: number
  safety_penalty_s: number
  congestion_penalty_s: number
}

function totalTravelTime(c: TravelTimeComponents): number {
  return c.free_flow_time_s
    + c.turn_penalty_s
    + c.queue_delay_s
    + c.safety_penalty_s
    + c.congestion_penalty_s
}
```

### BPR Congestion Function

Based on the Bureau of Public Roads (BPR) function, adapted for terminal roads:

```
travel_time = free_flow_time * (1 + alpha * (volume / capacity)^beta)
```

```ts
interface BPRParams {
  alpha: number  // 0.5–2.0 (terminal roads are tighter than highways)
  beta: number   // 1–3
}

const BPR_DEFAULTS: Record<string, BPRParams> = {
  main_avenue:      { alpha: 0.8, beta: 2 },
  truck_lane:       { alpha: 1.2, beta: 2.5 },
  agv_corridor:     { alpha: 0.5, beta: 1.5 },
  gate_approach:    { alpha: 2.0, beta: 3 },
}

function bprTravelTime(
  freeFlowTime: number,
  volume: number,
  capacity: number,
  params: BPRParams
): number {
  const densityRatio = volume / capacity
  return freeFlowTime * (1 + params.alpha * Math.pow(densityRatio, params.beta))
}
```

### Speed Ranges

| Zone Type          | Speed Range (km/h) | Speed Range (m/s) | Notes                       |
|--------------------|---------------------|--------------------|-----------------------------|
| Mixed manned       | 15–30               | 4.2–8.3            | Trucks, tractors, personnel |
| Automated corridor | 20–35               | 5.6–9.7            | AGVs, ALVs in dedicated lane|
| Quay apron         | 5–15                | 1.4–4.2            | Crane movements, personnel  |
| Gate approach      | 10–20               | 2.8–5.6            | Stop-and-go, queuing        |

---

## 6. Gate Infrastructure

### Core Interfaces

```ts
type GateDirection = 'in' | 'out'
type GateTransactionStatus = 'approved' | 'rejected' | 'hold'
type GateType = 'manual' | 'semi_automated' | 'automated'

interface GateTransaction {
  transaction_id: string
  truck_id: string
  container_id: string | null    // null for bobtail (empty chassis)
  direction: GateDirection
  arrival_time: number           // epoch ms
  processed_time: number | null  // epoch ms, null if still queued
  status: GateTransactionStatus
  lane: string
}

interface GateLane {
  lane_id: string
  direction: GateDirection
  gate_type: GateType
  is_open: boolean
}

interface GateComplex {
  gate_id: string
  lanes: GateLane[]
  max_queue_length: number       // vehicles before overflow / diversion
}
```

### Processing Times by Gate Type

| Gate Type       | Avg Processing (s) | Range (s) | Equipment                              |
|-----------------|---------------------|-----------|----------------------------------------|
| Manual          | 150                 | 120–180   | Clerk + manual inspection              |
| Semi-automated  | 75                  | 60–90     | OCR + kiosk + manual exception         |
| Automated       | 45                  | 30–60     | Full OCR, RFID, unmanned, auto-verify  |

```ts
const GATE_PROCESSING_TIMES: Record<GateType, { mean_s: number; min_s: number; max_s: number }> = {
  manual:         { mean_s: 150, min_s: 120, max_s: 180 },
  semi_automated: { mean_s: 75,  min_s: 60,  max_s: 90 },
  automated:      { mean_s: 45,  min_s: 30,  max_s: 60 },
}
```

### Validation Checklist

Every gate transaction must pass these checks:

```ts
interface GateValidation {
  documents_ok: boolean    // booking reference, delivery order
  customs_clear: boolean   // customs release status
  vgm_present: boolean     // verified gross mass (SOLAS)
  seal_ok: boolean         // container seal intact and matches
}

function isGateApproved(v: GateValidation): boolean {
  return v.documents_ok && v.customs_clear && v.vgm_present && v.seal_ok
}
```

---

## 7. Terminal Generation Parameters

Use these YAML presets as inputs to procedural terminal generators. Each preset defines a complete terminal profile.

### Small Feeder Terminal

```yaml
preset: small_feeder
description: Coastal feeder port, 1–2 berths, manual operations
berths:
  count: 2
  berth_length_m: 250
  design_depth_m: 12
  apron_width_m: 30
  max_vessel_loa_m: 180
  max_vessel_beam_m: 28
  cranes_per_berth: 2
  crane_rail_gauge_m: 30.48
  fender_type: cone
  fender_pitch_m: 15
  mooring_points_per_berth: 8
yard:
  archetype: parallel_rtg
  total_ground_slots: 3000
  blocks:
    import: { count: 2, bays: 15, rows: 6, max_tier: 4 }
    export: { count: 2, bays: 15, rows: 6, max_tier: 4 }
    reefer: { count: 1, bays: 10, rows: 4, max_tier: 3, power_points: 40 }
    empty: { count: 1, bays: 15, rows: 6, max_tier: 5 }
  equipment: RTG
  automation_level: manual
gate:
  in_lanes: 2
  out_lanes: 2
  gate_type: manual
  processing_time_s: 150
road_network:
  main_speed_kmh: 20
  lane_count: 1
  control_type: uncontrolled
capacity:
  annual_teu: 200000
  peak_moves_per_hour: 40
```

### Medium Multi-Purpose Terminal

```yaml
preset: medium_multipurpose
description: Regional hub, 3–4 berths, semi-automated yard
berths:
  count: 4
  berth_length_m: 370
  design_depth_m: 15
  apron_width_m: 50
  max_vessel_loa_m: 340
  max_vessel_beam_m: 45
  cranes_per_berth: 3
  crane_rail_gauge_m: 30.48
  fender_type: cell
  fender_pitch_m: 12
  mooring_points_per_berth: 12
yard:
  archetype: parallel_rtg
  total_ground_slots: 15000
  blocks:
    import: { count: 4, bays: 30, rows: 6, max_tier: 5 }
    export: { count: 4, bays: 30, rows: 8, max_tier: 5 }
    reefer: { count: 2, bays: 15, rows: 4, max_tier: 4, power_points: 120 }
    hazmat: { count: 1, bays: 10, rows: 4, max_tier: 3 }
    empty: { count: 2, bays: 25, rows: 8, max_tier: 6 }
    transshipment: { count: 2, bays: 20, rows: 6, max_tier: 5 }
  equipment: eRTG
  automation_level: semi_auto
gate:
  in_lanes: 4
  out_lanes: 4
  gate_type: semi_automated
  processing_time_s: 75
road_network:
  main_speed_kmh: 25
  lane_count: 2
  control_type: signal
rail:
  tracks: 2
  max_train_length_m: 700
  rail_mounted_cranes: 2
capacity:
  annual_teu: 1500000
  peak_moves_per_hour: 120
```

### Large Automated ULCV Terminal

```yaml
preset: large_automated_ulcv
description: Deep-water mega terminal, 5+ berths, fully automated
berths:
  count: 6
  berth_length_m: 500
  design_depth_m: 18
  apron_width_m: 65
  max_vessel_loa_m: 400
  max_vessel_beam_m: 62
  cranes_per_berth: 5
  crane_rail_gauge_m: 30.48
  fender_type: cell
  fender_pitch_m: 10
  mooring_points_per_berth: 16
yard:
  archetype: perpendicular_asc
  total_ground_slots: 50000
  blocks:
    import: { count: 8, bays: 45, rows: 10, max_tier: 5 }
    export: { count: 8, bays: 45, rows: 10, max_tier: 5 }
    reefer: { count: 4, bays: 20, rows: 6, max_tier: 4, power_points: 480 }
    hazmat: { count: 2, bays: 12, rows: 4, max_tier: 3 }
    empty: { count: 4, bays: 30, rows: 10, max_tier: 6 }
    transshipment: { count: 6, bays: 40, rows: 8, max_tier: 5 }
  equipment: ASC
  automation_level: fully_auto
gate:
  in_lanes: 8
  out_lanes: 8
  gate_type: automated
  processing_time_s: 45
road_network:
  main_speed_kmh: 30
  lane_count: 2
  control_type: reservation
  agv_corridors: true
  agv_speed_kmh: 25
rail:
  tracks: 4
  max_train_length_m: 1000
  rail_mounted_cranes: 4
capacity:
  annual_teu: 5000000
  peak_moves_per_hour: 300
```

---

## 8. Factory Functions

These functions produce fully populated objects with realistic defaults. Use them for procedural generation, testing, or bootstrapping new terminal simulations.

### `createBerth`

```ts
type VesselClass = 'feeder' | 'panamax' | 'post_panamax' | 'neo_panamax' | 'ulcv'

const VESSEL_CLASS_SPECS: Record<VesselClass, {
  loa: number; beam: number; draft: number;
  berthLength: number; depth: number; apron: number;
}> = {
  feeder:       { loa: 180,  beam: 28,  draft: 10, berthLength: 250, depth: 12,   apron: 30 },
  panamax:      { loa: 290,  beam: 32,  draft: 13, berthLength: 350, depth: 14,   apron: 40 },
  post_panamax: { loa: 340,  beam: 45,  draft: 15, berthLength: 400, depth: 16,   apron: 50 },
  neo_panamax:  { loa: 370,  beam: 51,  draft: 16, berthLength: 420, depth: 16.5, apron: 55 },
  ulcv:         { loa: 400,  beam: 62,  draft: 17, berthLength: 500, depth: 18,   apron: 65 },
}

function createBerth(vesselClass: VesselClass, id?: string): Berth {
  const spec = VESSEL_CLASS_SPECS[vesselClass]
  const berthId = id ?? `B-${vesselClass.toUpperCase()}-${Math.floor(Math.random() * 1000)}`

  return {
    berth_id: berthId,
    berth_length_m: spec.berthLength,
    design_depth_m: spec.depth,
    apron_width_m: spec.apron,
    allowable_vessel_loa_m: spec.loa,
    allowable_beam_m: spec.beam,
    crane_rail: {
      waterside_offset_m: 3,
      gauge_m: 30.48,
      travel_limit_start_m: 10,
      travel_limit_end_m: spec.berthLength - 10,
    },
    fender_system: {
      type: vesselClass === 'feeder' ? 'cone' : 'cell',
      pitch_m: vesselClass === 'ulcv' ? 10 : 15,
      design_energy_kNm: spec.draft * 80,
      peak_reaction_kN: spec.draft * 50,
    },
    mooring_points: generateMooringPoints(spec.berthLength),
  }
}

function generateMooringPoints(berthLength: number): MooringPoint[] {
  const spacing = Math.min(50, berthLength / 8)
  const count = Math.max(6, Math.ceil(berthLength / spacing))
  const points: MooringPoint[] = []

  for (let i = 0; i < count; i++) {
    const chainage = (i / (count - 1)) * berthLength
    points.push({
      point_id: `MP-${String(i + 1).padStart(2, '0')}`,
      type: (i === 0 || i === count - 1) ? 'dolphin' : 'bollard',
      chainage_m: Math.round(chainage * 10) / 10,
      swl_t: berthLength >= 400 ? 200 : berthLength >= 300 ? 150 : 100,
      has_capstan: i % 2 === 0,
      has_load_monitoring: berthLength >= 350,
    })
  }
  return points
}
```

### `createYardBlock`

```ts
function createYardBlock(
  type: BlockType,
  bays: number,
  rows: number,
  maxTier: number,
  id?: string
): YardBlock {
  const prefix = {
    import: 'IMP', export: 'EXP', reefer: 'RF',
    hazmat: 'DG', empty: 'MT', transshipment: 'TS',
  }[type]

  const blockId = id ?? `${prefix}-${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`

  return {
    block_id: blockId,
    block_type: type,
    bay_count: bays,
    row_count: rows,
    max_tier: maxTier,
    orientation: 'parallel',
    interchange_side: type === 'transshipment' ? 'dual-side' : 'one-side',
    reefer_power_points: type === 'reefer' ? bays * rows : 0,
    hazmat_allowed: type === 'hazmat',
  }
}
```

### `createGate`

```ts
function createGate(
  type: GateType,
  inLanes: number = 2,
  outLanes: number = 2,
  id?: string
): GateComplex {
  const gateId = id ?? `GATE-${type.toUpperCase()}-${Math.floor(Math.random() * 100)}`

  const lanes: GateLane[] = []

  for (let i = 0; i < inLanes; i++) {
    lanes.push({
      lane_id: `${gateId}-IN-${i + 1}`,
      direction: 'in',
      gate_type: type,
      is_open: true,
    })
  }
  for (let i = 0; i < outLanes; i++) {
    lanes.push({
      lane_id: `${gateId}-OUT-${i + 1}`,
      direction: 'out',
      gate_type: type,
      is_open: true,
    })
  }

  return {
    gate_id: gateId,
    lanes,
    max_queue_length: type === 'automated' ? 30 : type === 'semi_automated' ? 20 : 15,
  }
}
```

### `createTerminalLayout`

```ts
interface TerminalLayout {
  config: LayoutConfig
  berths: Berth[]
  yard_blocks: YardBlock[]
  gate: GateComplex
  road_nodes: RoadNode[]
  road_edges: RoadEdge[]
}

function createTerminalLayout(
  archetype: LayoutArchetype,
  vesselClass: VesselClass = 'post_panamax',
  berthCount: number = 3
): TerminalLayout {
  const config = { ...LAYOUT_DEFAULTS[archetype] }

  const berths: Berth[] = []
  for (let i = 0; i < berthCount; i++) {
    berths.push(createBerth(vesselClass, `B-${i + 1}`))
  }

  const yard_blocks: YardBlock[] = [
    ...Array.from({ length: 4 }, (_, i) =>
      createYardBlock('import', config.block_length_bays, config.block_width_rows,
        config.block_height_tiers, `IMP-A${i + 1}`)
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      createYardBlock('export', config.block_length_bays, config.block_width_rows,
        config.block_height_tiers, `EXP-C${i + 1}`)
    ),
    createYardBlock('reefer', 15, 4, 4, 'RF-R1'),
    createYardBlock('reefer', 15, 4, 4, 'RF-R2'),
    createYardBlock('hazmat', 10, 4, 3, 'DG-D1'),
    createYardBlock('empty', 25, config.block_width_rows, 6, 'MT-E1'),
  ]

  const gateType: GateType =
    config.automation_level === 'fully_auto' ? 'automated'
    : config.automation_level === 'semi_auto' ? 'semi_automated'
    : 'manual'

  const gate = createGate(gateType, 4, 4, 'GATE-MAIN')

  const { road_nodes, road_edges } = generateRoadNetwork(config, yard_blocks)

  return { config, berths, yard_blocks, gate, road_nodes, road_edges }
}
```

### Road Network Generator (Skeleton)

```ts
function generateRoadNetwork(
  config: LayoutConfig,
  blocks: YardBlock[]
): { road_nodes: RoadNode[]; road_edges: RoadEdge[] } {
  const nodes: RoadNode[] = []
  const edges: RoadEdge[] = []

  // Gate entry/exit nodes
  nodes.push({ node_id: 'GATE-IN',  type: 'gate',       x: 0,                     y: 0,                     capacity_veh: 20 })
  nodes.push({ node_id: 'GATE-OUT', type: 'gate',       x: 0,                     y: config.yard_depth_m,   capacity_veh: 20 })
  nodes.push({ node_id: 'YARD-ENT', type: 'yard_entry', x: config.quay_length_m / 2, y: config.yard_depth_m / 2, capacity_veh: 10 })

  // Block I/O nodes — one per block
  blocks.forEach((block, i) => {
    const nodeId = `BLK-${block.block_id}`
    const y = 50 + i * (config.pass_lane_width_m + config.inter_block_gap_m)
    nodes.push({ node_id: nodeId, type: 'block_io', x: config.quay_length_m / 2, y, capacity_veh: 5 })

    // Connect to yard entry
    edges.push({
      edge_id: `E-YARD-${nodeId}`,
      from_node: 'YARD-ENT',
      to_node: nodeId,
      length_m: Math.abs(y - config.yard_depth_m / 2),
      lane_count: config.automation_level === 'fully_auto' ? 2 : 1,
      directionality: 'two_way',
      speed_limit_mps: config.automation_level === 'fully_auto' ? 8 : 6,
      vehicle_classes: config.automation_level === 'fully_auto'
        ? ['agv', 'service']
        : ['truck', 'terminal_tractor', 'service'],
      capacity_veh: 8,
      control_type: config.automation_level === 'fully_auto' ? 'reservation' : 'uncontrolled',
      turn_penalty_s: 5,
    })
  })

  // Quay crane buffer nodes — one per berth position
  const berthSpacing = config.quay_length_m / 3
  for (let i = 0; i < 3; i++) {
    const nodeId = `QC-BUF-${i + 1}`
    nodes.push({ node_id: nodeId, type: 'crane_buffer', x: berthSpacing * (i + 0.5), y: 10, capacity_veh: 4 })

    edges.push({
      edge_id: `E-YARD-${nodeId}`,
      from_node: 'YARD-ENT',
      to_node: nodeId,
      length_m: config.yard_depth_m / 2,
      lane_count: 2,
      directionality: 'two_way',
      speed_limit_mps: 6,
      vehicle_classes: config.automation_level === 'fully_auto'
        ? ['agv', 'alv']
        : ['terminal_tractor', 'truck'],
      capacity_veh: 10,
      control_type: 'priority',
      turn_penalty_s: 8,
    })
  }

  // Gate connections
  edges.push({
    edge_id: 'E-GATE-IN',
    from_node: 'GATE-IN',
    to_node: 'YARD-ENT',
    length_m: config.yard_depth_m / 2,
    lane_count: 2,
    directionality: 'one_way',
    speed_limit_mps: 5,
    vehicle_classes: ['truck'],
    capacity_veh: 15,
    control_type: 'signal',
    turn_penalty_s: 10,
  })

  edges.push({
    edge_id: 'E-GATE-OUT',
    from_node: 'YARD-ENT',
    to_node: 'GATE-OUT',
    length_m: config.yard_depth_m / 2,
    lane_count: 2,
    directionality: 'one_way',
    speed_limit_mps: 5,
    vehicle_classes: ['truck'],
    capacity_veh: 15,
    control_type: 'signal',
    turn_penalty_s: 10,
  })

  return { road_nodes: nodes, road_edges: edges }
}
```

---

## Quick Reference: All Exported Types

```ts
// Berth
export type { Berth, CraneRail, Fender, MooringPoint }

// Yard
export type { YardBlock, YardSlot, BlockType, Orientation, InterchangeSide }

// Stacking
export type { StackingStrategy }
export { REHANDLE_RATES, congestionMultiplier, rehandlesRequired, retrievalCost }

// Layout
export type { LayoutArchetype, LayoutConfig }
export { LAYOUT_DEFAULTS }

// Road
export type { RoadNode, RoadEdge, NodeType, Directionality, ControlType, VehicleClass }
export type { TravelTimeComponents, BPRParams }
export { BPR_DEFAULTS, bprTravelTime }

// Gate
export type { GateTransaction, GateLane, GateComplex, GateType, GateDirection, GateTransactionStatus }
export type { GateValidation }
export { GATE_PROCESSING_TIMES, isGateApproved }

// Factories
export { createBerth, createYardBlock, createGate, createTerminalLayout }
export { VESSEL_CLASS_SPECS }
```
