---
name: terminal-operations
description: >-
  Data structures, workflows, and default values for container terminal
  operations: vessel loading/unloading sequences, end-to-end container flows,
  gatehouse processes, staff roles, shift models, KPIs, dashboards, and EDI
  message types. Use when implementing operational logic, event systems,
  or performance tracking.
---

# Terminal Operations & KPI Tracking

This skill provides complete TypeScript interfaces, event chains, constants, factory functions, and KPI formulas for container terminal operational workflows. Use this as the canonical reference when generating operational logic, event systems, dashboards, or simulation flows — no external lookup should be needed.

---

## 1. End-to-End Container Flows

Three primary flow types define how containers move through a terminal. Each flow is an ordered chain of events that can be tracked, animated, and measured.

### Event type enum

```ts
export type ContainerFlowType = 'import' | 'export' | 'transshipment'

export type ImportEventType =
  | 'gate_pre_advised'
  | 'vessel_arrived'
  | 'discharge_planned'
  | 'discharge_started'
  | 'container_lifted_off_vessel'
  | 'placed_on_transport'
  | 'transport_to_yard'
  | 'grounded_in_yard'
  | 'customs_clearance'
  | 'available_for_collection'
  | 'gate_out_booked'
  | 'on_truck_at_gate'
  | 'gate_out_complete'

export type ExportEventType =
  | 'gate_in_booked'
  | 'gate_in_arrived'
  | 'documentation_check'
  | 'gate_in_approved'
  | 'transport_to_yard'
  | 'grounded_in_yard'
  | 'load_planned'
  | 'assigned_to_load_list'
  | 'staged_for_loading'
  | 'transport_to_quay'
  | 'loaded_on_vessel'
  | 'vessel_departed'

export type TransshipmentEventType =
  | 'discharge_from_vessel_1'
  | 'transport_to_yard'
  | 'grounded_in_yard'
  | 'dwelling'
  | 'assigned_to_load_list_vessel_2'
  | 'staged'
  | 'loaded_on_vessel_2'
  | 'departed'

export type ContainerEventType =
  | ImportEventType
  | ExportEventType
  | TransshipmentEventType
```

### Import flow

```
gate_pre_advised
  → vessel_arrived
  → discharge_planned
  → discharge_started
  → container_lifted_off_vessel
  → placed_on_transport
  → transport_to_yard
  → grounded_in_yard
  → customs_clearance
  → available_for_collection
  → gate_out_booked
  → on_truck_at_gate
  → gate_out_complete
```

| Step | Typical Duration | Notes |
|------|-----------------|-------|
| gate_pre_advised → vessel_arrived | Hours–days | EDI BAPLIE received before vessel arrival |
| vessel_arrived → discharge_started | 1–4 h | Berth allocation, crane assignment, gang readiness |
| discharge_started → grounded_in_yard | 3–8 min/box | Crane cycle + horizontal transport |
| grounded_in_yard → customs_clearance | 0–72 h | Depends on customs regime, inspections |
| customs_clearance → gate_out_complete | 1–120 h | Haulier booking, truck availability |

### Export flow

```
gate_in_booked
  → gate_in_arrived
  → documentation_check
  → gate_in_approved
  → transport_to_yard
  → grounded_in_yard
  → load_planned
  → assigned_to_load_list
  → staged_for_loading
  → transport_to_quay
  → loaded_on_vessel
  → vessel_departed
```

| Step | Typical Duration | Notes |
|------|-----------------|-------|
| gate_in_booked → gate_in_arrived | Hours–days | Haulier schedules delivery |
| gate_in_arrived → gate_in_approved | 1–3 min | Gatehouse processing |
| gate_in_approved → grounded_in_yard | 10–30 min | Internal transport to yard block |
| grounded_in_yard → assigned_to_load_list | Hours–days | Dwell until vessel cutoff approaches |
| staged_for_loading → loaded_on_vessel | 3–8 min/box | Crane cycle time |

### Transshipment flow

```
discharge_from_vessel_1
  → transport_to_yard
  → grounded_in_yard
  → dwelling
  → assigned_to_load_list_vessel_2
  → staged
  → loaded_on_vessel_2
  → departed
```

| Step | Typical Duration | Notes |
|------|-----------------|-------|
| discharge_from_vessel_1 → grounded_in_yard | 10–30 min | Horizontal transport from quay |
| dwelling | 1–14 days | Waiting for connecting vessel |
| staged → loaded_on_vessel_2 | 3–8 min/box | Crane cycle |

### Ordered event chains (for validation)

```ts
export const IMPORT_EVENT_CHAIN: ImportEventType[] = [
  'gate_pre_advised',
  'vessel_arrived',
  'discharge_planned',
  'discharge_started',
  'container_lifted_off_vessel',
  'placed_on_transport',
  'transport_to_yard',
  'grounded_in_yard',
  'customs_clearance',
  'available_for_collection',
  'gate_out_booked',
  'on_truck_at_gate',
  'gate_out_complete',
]

export const EXPORT_EVENT_CHAIN: ExportEventType[] = [
  'gate_in_booked',
  'gate_in_arrived',
  'documentation_check',
  'gate_in_approved',
  'transport_to_yard',
  'grounded_in_yard',
  'load_planned',
  'assigned_to_load_list',
  'staged_for_loading',
  'transport_to_quay',
  'loaded_on_vessel',
  'vessel_departed',
]

export const TRANSSHIPMENT_EVENT_CHAIN: TransshipmentEventType[] = [
  'discharge_from_vessel_1',
  'transport_to_yard',
  'grounded_in_yard',
  'dwelling',
  'assigned_to_load_list_vessel_2',
  'staged',
  'loaded_on_vessel_2',
  'departed',
]
```

### ContainerEvent interface

```ts
export interface ContainerEvent {
  event_id: string
  container_id: string
  event_type: ContainerEventType
  /** ISO 8601 timestamp */
  timestamp: string
  /** Terminal location code or zone identifier (e.g. 'QC-03', 'B04-R12-T3', 'GATE-IN-L2') */
  location: string
  /** Staff member or system account that triggered the event */
  operator_id: string | null
  /** Equipment ID used during the event (crane, tractor, etc.) */
  equipment_id: string | null
  /** Freeform metadata: weights, seal numbers, damage notes, etc. */
  details: Record<string, unknown>
}
```

### Event validation helper

```ts
export function isValidEventSequence(
  flowType: ContainerFlowType,
  events: ContainerEvent[],
): boolean {
  const chain =
    flowType === 'import' ? IMPORT_EVENT_CHAIN
    : flowType === 'export' ? EXPORT_EVENT_CHAIN
    : TRANSSHIPMENT_EVENT_CHAIN

  let chainIndex = 0
  for (const event of events) {
    const idx = chain.indexOf(event.event_type as never)
    if (idx < chainIndex) return false
    chainIndex = idx
  }
  return true
}
```

---

## 2. Vessel Operations

### Discharge sequence (per bay)

```
identify_bay
  → remove_hatch_covers
  → discharge_on_deck
  → discharge_under_deck
  → replace_hatch_covers
```

On-deck containers are discharged first because hatch covers sit between the on-deck and under-deck tiers. Under-deck containers cannot be accessed until hatch covers are removed and on-deck containers cleared.

### Load sequence (per bay)

```
remove_hatch_covers
  → load_under_deck
  → load_on_deck
  → replace_hatch_covers
  → lashing_check
```

Under-deck is loaded first so hatch covers can be placed, then on-deck stacks are built on top.

### Restow types

```ts
export type RestowType = 'onboard_restow' | 'quay_restow'
```

| Type | Description | Impact |
|------|-------------|--------|
| `onboard_restow` | Container stays on vessel, moved to a different slot | 2 moves (lift + set), no quay interaction |
| `quay_restow` | Offloaded to quay, then reloaded into new slot | 4 moves (discharge + reload), uses quay space |

Restows are unproductive moves — they increase the total move count without adding throughput. Minimising restows is a key planning objective.

### Crane split

When multiple quay cranes are assigned to a vessel, the vessel's bays are divided into contiguous ranges — one per crane. Cranes work their assigned ranges simultaneously, constrained by anti-collision rules (minimum one-bay gap between adjacent cranes).

```ts
export interface CraneSplit {
  crane_id: string
  bay_range_start: number  // odd bay number
  bay_range_end: number    // odd bay number
  planned_moves: number
}

export function divideBaysAmongCranes(
  totalBays: number[],
  craneIds: string[],
  movesByBay: Record<number, number>,
): CraneSplit[] {
  const totalMoves = Object.values(movesByBay).reduce((a, b) => a + b, 0)
  const targetPerCrane = totalMoves / craneIds.length
  const splits: CraneSplit[] = []
  let bayIdx = 0

  for (let c = 0; c < craneIds.length; c++) {
    const start = totalBays[bayIdx]
    let moves = 0
    while (bayIdx < totalBays.length) {
      moves += movesByBay[totalBays[bayIdx]] ?? 0
      if (moves >= targetPerCrane && c < craneIds.length - 1) {
        bayIdx++
        break
      }
      bayIdx++
    }
    splits.push({
      crane_id: craneIds[c],
      bay_range_start: start,
      bay_range_end: totalBays[Math.min(bayIdx - 1, totalBays.length - 1)],
      planned_moves: moves,
    })
  }

  return splits
}
```

### Crane cycle model

| Parameter | Value | Notes |
|-----------|-------|-------|
| Gross crane rate | 25–35 moves/hr | Depends on crane class (feeder→ULCV) |
| Net crane rate | 20–28 moves/hr | After operational delays (hatch moves, lashing, waits) |
| Hatch cover handling | 3–5 min per hatch | Per hatch cover pair; crane or shore crane |
| Lashing / unlashing | 2–4 min per bay per gang | Lashing gangs work in parallel with crane |
| Twin-lift bonus | +10–15% throughput | Two 20ft containers per move |
| Tandem-lift bonus | +5–10% throughput | Two 40ft containers (two cranes coordinated) |

```ts
export interface CraneCycleModel {
  gross_rate_moves_per_hr: number
  net_rate_moves_per_hr: number
  hatch_cover_time_min: number
  lashing_time_per_bay_min: number
  twin_lift_bonus_pct: number
  tandem_lift_bonus_pct: number
}

export const DEFAULT_CRANE_CYCLE: CraneCycleModel = {
  gross_rate_moves_per_hr: 30,
  net_rate_moves_per_hr: 25,
  hatch_cover_time_min: 4,
  lashing_time_per_bay_min: 3,
  twin_lift_bonus_pct: 12,
  tandem_lift_bonus_pct: 7,
}
```

### VesselOperation interface

```ts
export type VesselOperationType = 'load' | 'discharge'

export type VesselOperationStatus =
  | 'planned'
  | 'berthing'
  | 'in_progress'
  | 'suspended'      // weather, breakdown, labour issue
  | 'completed'
  | 'departed'

export interface VesselOperation {
  operation_id: string
  vessel_id: string
  berth_id: string
  operation_type: VesselOperationType
  /** ISO 8601 */
  start_time: string | null
  /** ISO 8601 */
  end_time: string | null
  cranes_assigned: string[]
  move_count_planned: number
  move_count_actual: number
  restow_count: number
  hatch_moves: number
  status: VesselOperationStatus
  crane_splits: CraneSplit[]
}
```

---

## 3. Gatehouse Processes

### Gate-in steps

```
truck_arrival
  → lane_assignment
  → document_scan
  → container_inspection
  → vgm_check
  → seal_check
  → weighbridge
  → system_approval
  → lane_release
```

### Gate-out steps

```
truck_arrival
  → booking_validation
  → yard_locate
  → equipment_dispatch
  → container_loaded
  → seal_applied
  → gate_release
```

### Processing times

| Mode | Gate-in (s) | Gate-out (s) | Notes |
|------|------------|-------------|-------|
| Manual | 120–180 | 120–180 | Officer inspects documents, physical check |
| Semi-automated | 60–90 | 60–90 | OCR + officer verification |
| Automated | 30–60 | 30–60 | Full OCR, RFID, automated damage detection |

### Gate rejection reasons

```ts
export type GateRejectionReason =
  | 'missing_documents'
  | 'customs_hold'
  | 'vgm_missing'
  | 'seal_broken'
  | 'overweight'
  | 'no_booking'
  | 'container_damage'
  | 'wrong_terminal'
  | 'outside_receiving_window'
  | 'failed_inspection'

export const GATE_REJECTION_DESCRIPTIONS: Record<GateRejectionReason, string> = {
  missing_documents: 'Required shipping documents not presented or incomplete',
  customs_hold: 'Container flagged by customs — cannot proceed without clearance',
  vgm_missing: 'Verified Gross Mass not submitted (SOLAS requirement)',
  seal_broken: 'Container seal broken, missing, or does not match documentation',
  overweight: 'Gross weight exceeds permitted maximum for road/terminal limits',
  no_booking: 'No valid booking reference found in the terminal system',
  container_damage: 'Structural damage detected during gate inspection',
  wrong_terminal: 'Container routed to incorrect terminal facility',
  outside_receiving_window: 'Arrival outside the published receiving window',
  failed_inspection: 'Container failed phytosanitary, radiation, or security scan',
}
```

### Gate automation levels

```ts
export type GateAutomationLevel = 'manual' | 'semi_automated' | 'automated'

export interface GateProcessingConfig {
  automation_level: GateAutomationLevel
  processing_time_min_s: number
  processing_time_max_s: number
  ocr_enabled: boolean
  rfid_enabled: boolean
  automated_damage_detection: boolean
  weighbridge_integrated: boolean
}

export const GATE_CONFIGS: Record<GateAutomationLevel, GateProcessingConfig> = {
  manual: {
    automation_level: 'manual',
    processing_time_min_s: 120,
    processing_time_max_s: 180,
    ocr_enabled: false,
    rfid_enabled: false,
    automated_damage_detection: false,
    weighbridge_integrated: false,
  },
  semi_automated: {
    automation_level: 'semi_automated',
    processing_time_min_s: 60,
    processing_time_max_s: 90,
    ocr_enabled: true,
    rfid_enabled: false,
    automated_damage_detection: false,
    weighbridge_integrated: true,
  },
  automated: {
    automation_level: 'automated',
    processing_time_min_s: 30,
    processing_time_max_s: 60,
    ocr_enabled: true,
    rfid_enabled: true,
    automated_damage_detection: true,
    weighbridge_integrated: true,
  },
}
```

### GateTransaction interface

```ts
export type GateDirection = 'in' | 'out'

export type GateTransactionStatus =
  | 'arrived'
  | 'processing'
  | 'approved'
  | 'rejected'
  | 'completed'

export interface GateTransaction {
  transaction_id: string
  direction: GateDirection
  truck_id: string
  container_id: string | null
  lane_id: string
  /** ISO 8601 */
  arrival_time: string
  /** ISO 8601 */
  release_time: string | null
  status: GateTransactionStatus
  rejection_reason: GateRejectionReason | null
  processing_time_s: number
  automation_level: GateAutomationLevel
  vgm_kg: number | null
  weighbridge_kg: number | null
  seal_numbers: string[]
  damage_photos: string[]
}
```

---

## 4. Staff Roles & Shifts

### Role definitions

```ts
export type StaffRole =
  | 'qc_operator'
  | 'yard_crane_operator'
  | 'planner_vessel'
  | 'planner_yard'
  | 'gatehouse_officer'
  | 'lashing_gang_member'
  | 'terminal_tractor_driver'
  | 'supervisor'
  | 'shift_manager'

export type CertificationType =
  | 'sts_crane_certified'
  | 'rmg_crane_certified'
  | 'rtg_crane_certified'
  | 'asc_crane_certified'
  | 'reach_stacker_certified'
  | 'hazmat_handling'
  | 'reefer_tech'
  | 'first_aid'
  | 'fire_safety'
  | 'supervisor_qualified'
```

### Staffing ratios

| Role | Ratio | Notes |
|------|-------|-------|
| QC Operator | 1 per crane | Must hold `sts_crane_certified` |
| Yard Crane Operator | 1 per crane (manual); 1 per 3–4 cranes (remote auto) | Certification per crane type |
| Planner (vessel) | 1–2 per vessel operation | Experienced senior role |
| Planner (yard) | 1–2 per vessel operation | Coordinates yard allocation |
| Gatehouse Officer | 1 per lane | Manual/semi-auto gates only |
| Lashing Gang Member | 2–4 per crane, per vessel | Deploy per active QC |
| Terminal Tractor Driver | 1 per tractor | Manual operations only |
| Supervisor | 1 per area (quay, yard, gate) | Oversees operations in zone |
| Shift Manager | 1 per shift | Overall terminal responsibility |

### Shift patterns

```ts
export type ShiftPatternCode = '3x8' | '2x12' | '4x6'

export interface ShiftPattern {
  code: ShiftPatternCode
  label: string
  shifts_per_day: number
  hours_per_shift: number
  /** Start hours (24h format) for each shift in the pattern */
  shift_starts: number[]
}

export const SHIFT_PATTERNS: Record<ShiftPatternCode, ShiftPattern> = {
  '3x8': {
    code: '3x8',
    label: '3 shifts × 8 hours',
    shifts_per_day: 3,
    hours_per_shift: 8,
    shift_starts: [6, 14, 22],
  },
  '2x12': {
    code: '2x12',
    label: '2 shifts × 12 hours',
    shifts_per_day: 2,
    hours_per_shift: 12,
    shift_starts: [6, 18],
  },
  '4x6': {
    code: '4x6',
    label: '4 shifts × 6 hours',
    shifts_per_day: 4,
    hours_per_shift: 6,
    shift_starts: [0, 6, 12, 18],
  },
}
```

### StaffMember interface

```ts
export interface StaffMember {
  staff_id: string
  name: string
  role: StaffRole
  certifications: CertificationType[]
  shift_pattern: ShiftPatternCode
  current_shift_index: number
  /** 0 = fully rested, 100 = exhausted. Above 80 triggers mandatory rest. */
  fatigue_level: number
  /** Multiplier on base task speed. 0.8 = slow/fatigued, 1.2 = fast/experienced. */
  performance_modifier: number
  available: boolean
  assigned_equipment_id: string | null
  assigned_zone: string | null
}
```

### Fatigue model

```ts
export function updateFatigue(
  staff: StaffMember,
  hoursWorked: number,
  shiftHours: number,
): number {
  const baseFatiguePerHour = 100 / shiftHours
  const newFatigue = Math.min(100, staff.fatigue_level + hoursWorked * baseFatiguePerHour)
  return Math.round(newFatigue * 10) / 10
}

export function restFatigue(
  staff: StaffMember,
  hoursRested: number,
): number {
  const recoveryPerHour = 12.5   // full recovery in ~8 h
  return Math.max(0, staff.fatigue_level - hoursRested * recoveryPerHour)
}

export function derivePerformanceModifier(fatigue: number): number {
  if (fatigue <= 30) return 1.1 + (30 - fatigue) * 0.003  // up to 1.2
  if (fatigue <= 60) return 1.0
  if (fatigue <= 80) return 1.0 - (fatigue - 60) * 0.005  // down to 0.9
  return 0.8  // exhausted
}
```

---

## 5. KPIs & Dashboard Data

### Key performance indicators

| KPI | Formula | Target Range | Unit | Warning Threshold | Critical Threshold |
|-----|---------|-------------|------|-------------------|-------------------|
| Gross crane rate | `total_moves / crane_hours` | 25–35 | moves/hr | <25 or >35 | <20 |
| Net crane rate | `total_moves / elapsed_hours` | 20–28 | moves/hr | <20 or >28 | <15 |
| Berth productivity | `total_moves / berth_hours` | 80–120 | moves/hr | <80 | <60 |
| Truck turn time | `gate_out_time - gate_in_time` | 25–45 | min | >45 | >60 |
| Yard dwell time (import) | `gate_out - vessel_discharge` | 3–5 | days | >5 | >7 |
| Yard dwell time (export) | `vessel_load - gate_in` | 2–4 | days | >4 | >6 |
| Yard occupancy | `occupied_slots / total_slots` | 60–80% | % | >80% | >90% |
| Rehandle ratio | `rehandles / productive_moves` | <10% | % | >10% | >15% |
| Gate queue length | `trucks_waiting` | <15 | per lane | >15 | >25 |
| Vessel schedule conformance | `(1 - delay_hrs / planned_hrs)` | >90% | % | <90% | <80% |

### KPI status derivation

```ts
export type KPIStatus = 'good' | 'warning' | 'critical'

export interface TerminalKPI {
  kpi_id: string
  name: string
  value: number
  unit: string
  target_min: number
  target_max: number
  warning_min: number | null
  warning_max: number | null
  critical_min: number | null
  critical_max: number | null
  status: KPIStatus
  /** ISO 8601 */
  timestamp: string
}

export function deriveKPIStatus(
  value: number,
  target_min: number,
  target_max: number,
  critical_min: number | null,
  critical_max: number | null,
): KPIStatus {
  if (critical_min !== null && value < critical_min) return 'critical'
  if (critical_max !== null && value > critical_max) return 'critical'
  if (value < target_min || value > target_max) return 'warning'
  return 'good'
}
```

### KPI definitions constant

```ts
export interface KPIDefinition {
  kpi_id: string
  name: string
  unit: string
  target_min: number
  target_max: number
  warning_min: number | null
  warning_max: number | null
  critical_min: number | null
  critical_max: number | null
  higher_is_better: boolean
}

export const KPI_DEFINITIONS: KPIDefinition[] = [
  {
    kpi_id: 'gross_crane_rate',
    name: 'Gross Crane Rate',
    unit: 'moves/hr',
    target_min: 25,
    target_max: 35,
    warning_min: 20,
    warning_max: null,
    critical_min: 15,
    critical_max: null,
    higher_is_better: true,
  },
  {
    kpi_id: 'net_crane_rate',
    name: 'Net Crane Rate',
    unit: 'moves/hr',
    target_min: 20,
    target_max: 28,
    warning_min: 15,
    warning_max: null,
    critical_min: 10,
    critical_max: null,
    higher_is_better: true,
  },
  {
    kpi_id: 'berth_productivity',
    name: 'Berth Productivity',
    unit: 'moves/hr',
    target_min: 80,
    target_max: 120,
    warning_min: 60,
    warning_max: null,
    critical_min: 40,
    critical_max: null,
    higher_is_better: true,
  },
  {
    kpi_id: 'truck_turn_time',
    name: 'Truck Turn Time',
    unit: 'min',
    target_min: 0,
    target_max: 45,
    warning_min: null,
    warning_max: 60,
    critical_min: null,
    critical_max: 90,
    higher_is_better: false,
  },
  {
    kpi_id: 'yard_dwell_import',
    name: 'Yard Dwell Time (Import)',
    unit: 'days',
    target_min: 0,
    target_max: 5,
    warning_min: null,
    warning_max: 7,
    critical_min: null,
    critical_max: 10,
    higher_is_better: false,
  },
  {
    kpi_id: 'yard_dwell_export',
    name: 'Yard Dwell Time (Export)',
    unit: 'days',
    target_min: 0,
    target_max: 4,
    warning_min: null,
    warning_max: 6,
    critical_min: null,
    critical_max: 8,
    higher_is_better: false,
  },
  {
    kpi_id: 'yard_occupancy',
    name: 'Yard Occupancy',
    unit: '%',
    target_min: 40,
    target_max: 80,
    warning_min: null,
    warning_max: 85,
    critical_min: null,
    critical_max: 90,
    higher_is_better: false,
  },
  {
    kpi_id: 'rehandle_ratio',
    name: 'Rehandle Ratio',
    unit: '%',
    target_min: 0,
    target_max: 10,
    warning_min: null,
    warning_max: 15,
    critical_min: null,
    critical_max: 20,
    higher_is_better: false,
  },
  {
    kpi_id: 'gate_queue_length',
    name: 'Gate Queue Length',
    unit: 'trucks/lane',
    target_min: 0,
    target_max: 15,
    warning_min: null,
    warning_max: 20,
    critical_min: null,
    critical_max: 25,
    higher_is_better: false,
  },
  {
    kpi_id: 'vessel_schedule_conformance',
    name: 'Vessel Schedule Conformance',
    unit: '%',
    target_min: 90,
    target_max: 100,
    warning_min: 80,
    warning_max: null,
    critical_min: 70,
    critical_max: null,
    higher_is_better: true,
  },
]
```

### Dashboard snapshot interface

```ts
export interface DashboardSnapshot {
  terminal_id: string
  /** ISO 8601 */
  snapshot_time: string
  kpis: TerminalKPI[]
  active_vessels: number
  active_cranes: number
  yard_total_slots: number
  yard_occupied_slots: number
  gate_lanes_open: number
  trucks_in_queue: number
  staff_on_shift: number
  weather_wind_mps: number
  weather_alert: boolean
}
```

---

## 6. EDI Message Types

### EDIFACT messages used in terminal operations

| Message | Code | Purpose | Direction | Timing |
|---------|------|---------|-----------|--------|
| Bayplan | BAPLIE | Vessel stowage plan — position of every container on board | Vessel → Terminal | Before arrival (6–24 h) |
| Move instructions | MOVINS | Load/discharge sequence orders per bay | Terminal → Vessel | Pre-operations |
| Container orders | COPRAR | Handling orders for specific containers | Line → Terminal | Pre-operations |
| Move confirmation | COARRI | Confirmation that a move (load/discharge) completed | Terminal → Line | Post-move (real-time) |
| Gate in/out | CODECO | Gate event notification (container entered or left terminal) | Terminal → All | Real-time |
| Booking request | COPARN | Container booking for export loading | Line → Terminal | Days before vessel |
| Release order | COREOR | Release for collection (import cleared) | Line → Terminal | Post customs clearance |
| Container status | COSCON | Container status/tracking update | Terminal → Line | Periodic / on-event |
| Customs declaration | CUSCAR | Cargo declaration for customs | Terminal → Customs | Pre-arrival |
| Dangerous goods | IFTDGN | DG manifest and details | Line → Terminal | Pre-arrival |

### EDI message interface

```ts
export type EDIMessageType =
  | 'BAPLIE'
  | 'MOVINS'
  | 'COPRAR'
  | 'COARRI'
  | 'CODECO'
  | 'COPARN'
  | 'COREOR'
  | 'COSCON'
  | 'CUSCAR'
  | 'IFTDGN'

export type EDIDirection = 'inbound' | 'outbound'

export interface EDIMessage {
  message_id: string
  message_type: EDIMessageType
  /** Organisation or system that sent the message */
  sender: string
  /** Organisation or system that receives the message */
  receiver: string
  /** ISO 8601 */
  timestamp: string
  direction: EDIDirection
  /** Related entity IDs: vessel call, booking, container, B/L, etc. */
  reference_ids: string[]
  /** Parsed message content — structure varies by message type */
  payload: Record<string, unknown>
  /** Processing status within the terminal system */
  processing_status: 'received' | 'validated' | 'applied' | 'rejected' | 'acknowledged'
}
```

### EDI timing expectations

```ts
export const EDI_TIMING: Record<EDIMessageType, { typical_lead_time: string; frequency: string }> = {
  BAPLIE:  { typical_lead_time: '6–24 hours before arrival',   frequency: 'Once per vessel call (updated versions possible)' },
  MOVINS:  { typical_lead_time: '2–6 hours before operations', frequency: 'Once per operation, amendments possible' },
  COPRAR:  { typical_lead_time: '1–7 days before vessel',      frequency: 'Per container or batch' },
  COARRI:  { typical_lead_time: 'Immediate (post-move)',        frequency: 'Per move' },
  CODECO:  { typical_lead_time: 'Immediate (at gate event)',    frequency: 'Per gate transaction' },
  COPARN:  { typical_lead_time: '3–14 days before vessel',      frequency: 'Per booking' },
  COREOR:  { typical_lead_time: 'Post customs clearance',       frequency: 'Per release' },
  COSCON:  { typical_lead_time: 'Periodic or on-event',         frequency: 'Per status change' },
  CUSCAR:  { typical_lead_time: '24–48 hours before arrival',   frequency: 'Per vessel call' },
  IFTDGN:  { typical_lead_time: '24–72 hours before arrival',   frequency: 'Per DG container/shipment' },
}
```

---

## 7. Simulation Event System

### SimulationClock

```ts
export interface SimulationClock {
  /** Current simulation time (Unix ms or ISO 8601) */
  current_time_ms: number
  /** How many simulation seconds pass per real second */
  time_scale: number
  /** Ticks per real second for fixed-tick mode (0 = event-driven only) */
  tick_rate: number
  paused: boolean
}

export function createSimulationClock(
  startTime: Date = new Date(),
  timeScale = 60,
  tickRate = 30,
): SimulationClock {
  return {
    current_time_ms: startTime.getTime(),
    time_scale: timeScale,
    tick_rate: tickRate,
    paused: false,
  }
}

export function advanceClock(clock: SimulationClock, realDeltaMs: number): void {
  if (clock.paused) return
  clock.current_time_ms += realDeltaMs * clock.time_scale
}
```

### SimulationEvent

```ts
export type SimEventPriority = 0 | 1 | 2 | 3 | 4 | 5
// 0 = lowest (background), 5 = highest (safety-critical)

export interface SimulationEvent {
  event_id: string
  /** Simulation time (ms) at which this event should fire */
  scheduled_time_ms: number
  event_type: string
  /** Higher priority events fire first when scheduled at the same time */
  priority: SimEventPriority
  /** Arbitrary payload passed to the handler */
  data: Record<string, unknown>
}
```

### EventQueue (priority queue)

```ts
export class EventQueue {
  private queue: SimulationEvent[] = []

  get length(): number {
    return this.queue.length
  }

  schedule(event: SimulationEvent): void {
    this.queue.push(event)
    this.queue.sort((a, b) => {
      if (a.scheduled_time_ms !== b.scheduled_time_ms) {
        return a.scheduled_time_ms - b.scheduled_time_ms
      }
      return b.priority - a.priority  // higher priority first at same time
    })
  }

  peek(): SimulationEvent | null {
    return this.queue[0] ?? null
  }

  dequeue(): SimulationEvent | null {
    return this.queue.shift() ?? null
  }

  cancel(eventId: string): boolean {
    const idx = this.queue.findIndex(e => e.event_id === eventId)
    if (idx >= 0) {
      this.queue.splice(idx, 1)
      return true
    }
    return false
  }

  clear(): void {
    this.queue = []
  }

  /** Drain all events up to and including the given simulation time */
  drainUntil(simTimeMs: number): SimulationEvent[] {
    const events: SimulationEvent[] = []
    while (this.queue.length > 0 && this.queue[0].scheduled_time_ms <= simTimeMs) {
      events.push(this.queue.shift()!)
    }
    return events
  }
}
```

### Event handler registry

```ts
export type EventHandler = (event: SimulationEvent, clock: SimulationClock) => void

export class EventHandlerRegistry {
  private handlers = new Map<string, EventHandler[]>()

  on(eventType: string, handler: EventHandler): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, [])
    }
    this.handlers.get(eventType)!.push(handler)
  }

  off(eventType: string, handler: EventHandler): void {
    const list = this.handlers.get(eventType)
    if (list) {
      const idx = list.indexOf(handler)
      if (idx >= 0) list.splice(idx, 1)
    }
  }

  dispatch(event: SimulationEvent, clock: SimulationClock): void {
    const list = this.handlers.get(event.event_type)
    if (list) {
      for (const handler of list) {
        handler(event, clock)
      }
    }
  }
}
```

### Time advance strategies

**Event-driven** — jump simulation time directly to the next event's scheduled time. No idle ticks. Best for fast-forward / non-visual simulations.

```ts
export function processNextEventDriven(
  queue: EventQueue,
  clock: SimulationClock,
  registry: EventHandlerRegistry,
): boolean {
  const next = queue.peek()
  if (!next) return false
  clock.current_time_ms = next.scheduled_time_ms
  const event = queue.dequeue()!
  registry.dispatch(event, clock)
  return true
}
```

**Fixed-tick** — advance time in small fixed increments, processing any events whose time has passed. Best for visual simulations (Three.js render loop).

```ts
export function processFixedTick(
  queue: EventQueue,
  clock: SimulationClock,
  registry: EventHandlerRegistry,
  realDeltaMs: number,
): void {
  advanceClock(clock, realDeltaMs)
  const events = queue.drainUntil(clock.current_time_ms)
  for (const event of events) {
    registry.dispatch(event, clock)
  }
}
```

### Convenience: schedule helper

```ts
export function scheduleEvent(
  queue: EventQueue,
  clock: SimulationClock,
  type: string,
  delayMs: number,
  data: Record<string, unknown> = {},
  priority: SimEventPriority = 2,
): string {
  const id = crypto.randomUUID()
  queue.schedule({
    event_id: id,
    scheduled_time_ms: clock.current_time_ms + delayMs,
    event_type: type,
    priority,
    data,
  })
  return id
}
```

---

## 8. Factory Functions

All factory functions return fully-populated objects with realistic defaults. Override any field via the `overrides` parameter.

```ts
function isoNow(): string {
  return new Date().toISOString()
}

/** Create a container event with sensible defaults */
export function createContainerEvent(
  type: ContainerEventType,
  containerId: string,
  overrides: Partial<ContainerEvent> = {},
): ContainerEvent {
  return {
    event_id: crypto.randomUUID(),
    container_id: containerId,
    event_type: type,
    timestamp: isoNow(),
    location: 'YARD-A01',
    operator_id: null,
    equipment_id: null,
    details: {},
    ...overrides,
  }
}

/** Create a vessel operation (load or discharge) */
export function createVesselOperation(
  vesselId: string,
  berthId: string,
  type: VesselOperationType,
  overrides: Partial<VesselOperation> = {},
): VesselOperation {
  return {
    operation_id: crypto.randomUUID(),
    vessel_id: vesselId,
    berth_id: berthId,
    operation_type: type,
    start_time: null,
    end_time: null,
    cranes_assigned: [],
    move_count_planned: type === 'discharge' ? 450 : 380,
    move_count_actual: 0,
    restow_count: 0,
    hatch_moves: 0,
    status: 'planned',
    crane_splits: [],
    ...overrides,
  }
}

/** Create a gate transaction */
export function createGateTransaction(
  direction: GateDirection,
  overrides: Partial<GateTransaction> = {},
): GateTransaction {
  return {
    transaction_id: crypto.randomUUID(),
    direction,
    truck_id: `TRK-${Math.floor(Math.random() * 90000) + 10000}`,
    container_id: null,
    lane_id: direction === 'in' ? 'GATE-IN-L1' : 'GATE-OUT-L1',
    arrival_time: isoNow(),
    release_time: null,
    status: 'arrived',
    rejection_reason: null,
    processing_time_s: 0,
    automation_level: 'semi_automated',
    vgm_kg: null,
    weighbridge_kg: null,
    seal_numbers: [],
    damage_photos: [],
    ...overrides,
  }
}

/** Create a shift assignment for a staff member */
export function createShift(
  pattern: ShiftPatternCode,
  role: StaffRole = 'terminal_tractor_driver',
  overrides: Partial<StaffMember> = {},
): StaffMember {
  const patternDef = SHIFT_PATTERNS[pattern]
  return {
    staff_id: crypto.randomUUID(),
    name: 'Unassigned',
    role,
    certifications: [],
    shift_pattern: pattern,
    current_shift_index: 0,
    fatigue_level: 0,
    performance_modifier: 1.0,
    available: true,
    assigned_equipment_id: null,
    assigned_zone: null,
    ...overrides,
  }
}

/** Create a full KPI dashboard snapshot with current metric values */
export function createKPIDashboard(
  terminalId = 'GBFXT-T1',
  overrides: Partial<DashboardSnapshot> = {},
): DashboardSnapshot {
  const now = isoNow()

  const kpis: TerminalKPI[] = KPI_DEFINITIONS.map((def) => {
    const value =
      def.kpi_id === 'gross_crane_rate' ? 28
      : def.kpi_id === 'net_crane_rate' ? 23
      : def.kpi_id === 'berth_productivity' ? 95
      : def.kpi_id === 'truck_turn_time' ? 35
      : def.kpi_id === 'yard_dwell_import' ? 4.2
      : def.kpi_id === 'yard_dwell_export' ? 3.1
      : def.kpi_id === 'yard_occupancy' ? 72
      : def.kpi_id === 'rehandle_ratio' ? 8
      : def.kpi_id === 'gate_queue_length' ? 6
      : def.kpi_id === 'vessel_schedule_conformance' ? 93
      : 0

    return {
      kpi_id: def.kpi_id,
      name: def.name,
      value,
      unit: def.unit,
      target_min: def.target_min,
      target_max: def.target_max,
      warning_min: def.warning_min,
      warning_max: def.warning_max,
      critical_min: def.critical_min,
      critical_max: def.critical_max,
      status: deriveKPIStatus(value, def.target_min, def.target_max, def.critical_min, def.critical_max),
      timestamp: now,
    }
  })

  return {
    terminal_id: terminalId,
    snapshot_time: now,
    kpis,
    active_vessels: 2,
    active_cranes: 5,
    yard_total_slots: 12000,
    yard_occupied_slots: 8640,
    gate_lanes_open: 6,
    trucks_in_queue: 12,
    staff_on_shift: 48,
    weather_wind_mps: 8.5,
    weather_alert: false,
    ...overrides,
  }
}
```

---

## Quick Reference: Container Event Flow Diagrams

### Import container lifecycle

```
                    ┌─────────────────────────────────────────────────┐
  PRE-ADVISED ──►   │  VESSEL ──► DISCHARGE ──► YARD ──► CUSTOMS     │
                    │  arrived    lift off       grounded  clearance  │
                    └────────────────────────────────────────┬────────┘
                                                             │
                    ┌────────────────────────────────────────▼────────┐
                    │  AVAILABLE ──► GATE-OUT ──► ON TRUCK ──► GONE   │
                    │  for collection  booked     at gate    complete │
                    └─────────────────────────────────────────────────┘
```

### Export container lifecycle

```
                    ┌─────────────────────────────────────────────────┐
  GATE-IN ────►     │  ARRIVED ──► DOCS ──► APPROVED ──► YARD        │
  booked            │             check                  grounded    │
                    └────────────────────────────────────────┬────────┘
                                                             │
                    ┌────────────────────────────────────────▼────────┐
                    │  PLANNED ──► LOAD LIST ──► STAGED ──► LOADED    │
                    │             assigned                  on vessel │
                    └─────────────────────────────────────────────────┘
```

### Transshipment container lifecycle

```
  VESSEL 1 ──► DISCHARGE ──► YARD ──► DWELL ──► LOAD LIST ──► STAGED ──► VESSEL 2
               from V1       grounded            assigned V2              departed
```
