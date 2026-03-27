---
name: terminal-equipment-entities
description: >-
  Data structures, schemas, default values, and animation parameters for
  container terminal equipment (STS cranes, RTGs, RMGs, ASCs, reach stackers,
  terminal tractors, AGVs). Use when creating equipment models, cycle
  animations, or operational logic.
---

# Terminal Equipment Entities

## 1. Four-Lens Equipment Model

Every equipment type defines four lenses: **appearance**, **movement**, **capabilities**, **stop_conditions**. All equipment shares a base interface.

```ts
interface EquipmentBase {
  equipment_id: string
  equipment_family: EquipmentFamily
  subtype: string
  manufacturer?: string
  automation_level: AutomationLevel

  appearance: EquipmentAppearance
  movement: EquipmentMovement
  capabilities: EquipmentCapabilities
  stop_conditions: StopConditions
}

type EquipmentFamily =
  | 'sts_crane'
  | 'rmg_crane'
  | 'rtg_crane'
  | 'asc_crane'
  | 'reach_stacker'
  | 'terminal_tractor'
  | 'agv'

type AutomationLevel =
  | 'manual'
  | 'remote_manual'
  | 'supervised_auto'
  | 'semi_automated'
  | 'fully_automated'

interface EquipmentAppearance {
  silhouette_tags: string[]
  key_components: string[]
  color_scheme?: string
}

interface EquipmentMovement {
  travel_axes: TravelAxis[]
  travel_speed_mps: number
  hoist_speed_mps: number
  trolley_speed_mps?: number
  turning_radius_m?: number
}

type TravelAxis = 'x_rail' | 'y_rail' | 'x_rubber' | 'y_rubber' | 'hoist_z' | 'trolley_y' | 'boom_angle' | 'rotate'

interface EquipmentCapabilities {
  can_handle_container_sizes: ContainerSize[]
  pickup_interfaces: HandlingInterface[]
  dropoff_interfaces: HandlingInterface[]
  max_lift_capacity_t: number
  twin_lift?: boolean
  tandem_lift?: boolean
}

type ContainerSize = '20ft' | '40ft' | '45ft'
type HandlingInterface = 'spreader' | 'headblock' | 'twistlock' | 'side_pick' | 'chassis_pins'

interface StopConditions {
  max_operating_wind_mps: number
  max_stowed_wind_mps: number
  lightning_stop: boolean
  storm_lock_required: boolean
  seismic_stop?: boolean
}
```

## 2. STS Quay Cranes

### Size classes

| Class | Outreach m | Lift height m | Rated load t | Trolley m/min | Hoist laden m/min | Gantry m/min |
|---|---|---|---|---|---|---|
| Feeder | 30–40 | 20–30 | 40–50 | 120–180 | 45–70 | 30–45 |
| Panamax | 40–50 | 30–35 | 50–60 | 150–210 | 60–75 | 35–45 |
| Post-Panamax | 50–60 | 35–45 | 60–65 | 180–240 | 60–90 | 35–45 |
| Super Post-Panamax | 60–70 | 40–50 | 65–75 | 180–240 | 75–90 | 35–45 |
| ULCV | 70–80+ | 45–55+ | 65–80+ | 180–240 | 75–90 | 35–45 |

### STS interface

```ts
type STSSizeClass = 'feeder' | 'panamax' | 'post_panamax' | 'super_post_panamax' | 'ulcv'

interface STSCraneParams {
  size_class: STSSizeClass
  outreach_m: number
  lift_height_m: number
  rated_load_t: number
  trolley_speed_m_per_min: number
  hoist_laden_m_per_min: number
  gantry_speed_m_per_min: number
  backreach_m: number
  rail_gauge_m: number
  boom_hinge: boolean
  dual_hoist: boolean
  single_cycle_time_s: number
}

interface STSCrane extends EquipmentBase {
  equipment_family: 'sts_crane'
  sts: STSCraneParams
  animation: STSAnimationState
}
```

### Cycle phases

1. **Trolley align** — position trolley over target bay/cell
2. **Hoist down** — lower spreader to container
3. **Lock** — engage twistlocks
4. **Hoist up** — raise loaded spreader clear of vessel stacks
5. **Trolley transfer** — move from ship-side to land-side (or reverse)
6. **Hoist down** — lower to chassis/stack/platform
7. **Unlock** — disengage twistlocks
8. **Hoist clear** — raise empty spreader
9. **Return / Next** — trolley back for next pick

**Baseline single-cycle time ≈ 62 s** (before wait/dwell penalties):

| Phase | Duration s |
|---|---|
| Trolley align | 5 |
| Hoist down (pick) | 8 |
| Lock + settle | 3 |
| Hoist up (loaded) | 10 |
| Trolley transfer | 18 |
| Hoist down (set) | 8 |
| Unlock + settle | 3 |
| Hoist clear | 7 |

### Animation variables

```ts
interface STSAnimationState {
  gantry_position_x: number
  trolley_position_y: number
  spreader_height_z: number
  spreader_lock_state: 'unlocked' | 'locking' | 'locked' | 'unlocking'
  load_attached: boolean
  boom_angle: number        // 0 = horizontal (operating), 80+ = raised (stowed)
  storm_pin_engaged: boolean
}
```

### State machine

```
Idle
 ├─► PositionToPick ─► LowerToPick ─► Lock ─► HoistLoaded
 │       ─► TrolleyTransfer ─► LowerToSet ─► Unlock
 │       ─► HoistClear ─► ReturnOrNext ─► Idle
 │
 └─► StormMode ─► Securing ─► Stowed ─► (wait) ─► Idle
```

```ts
type STSState =
  | 'idle'
  | 'position_to_pick'
  | 'lower_to_pick'
  | 'lock'
  | 'hoist_loaded'
  | 'trolley_transfer'
  | 'lower_to_set'
  | 'unlock'
  | 'hoist_clear'
  | 'return_or_next'
  | 'storm_mode'
  | 'securing'
  | 'stowed'
```

### Wind limits

| Threshold | Wind speed m/s | Action |
|---|---|---|
| Warning | ~15 | Reduce operational speed, alert operator |
| Operating stop | ~20 | Cease operations, secure spreader |
| Stowed design | ~60 | Crane survives if properly stowed with storm pins |

## 3. RMG / ASC Yard Cranes

### Parameter ranges

| Parameter | Range |
|---|---|
| Span | 25–70 m |
| Stacking width | 4–10 container slots |
| Stacking height | 1-over-3 to 1-over-8 |
| Gantry speed | 80–130 m/min |
| Trolley speed | 60–90 m/min |
| Hoist laden speed | 20–35 m/min |

### Interfaces

```ts
type HandoverLayout = 'end_only' | 'side_only' | 'dual_side' | 'end_plus_side'
type ASCBufferingMode = 'none' | 'waterside_buffered' | 'landside_buffered' | 'dual_buffered'

interface RMGCraneParams {
  span_m: number
  stacking_width_slots: number
  stacking_height: number
  gantry_speed_m_per_min: number
  trolley_speed_m_per_min: number
  hoist_laden_m_per_min: number
  rail_type: 'single_rail' | 'dual_rail'
  handover_layout: HandoverLayout
  cantilever: boolean
  electrification: 'busbar' | 'cable_reel' | 'diesel_electric'
}

interface ASCCraneParams extends RMGCraneParams {
  buffering_mode: ASCBufferingMode
  buffer_lane_count: number
  interchange_crane_required: boolean
}

interface RMGCrane extends EquipmentBase {
  equipment_family: 'rmg_crane'
  rmg: RMGCraneParams
  animation: YardCraneAnimationState
}

interface ASCCrane extends EquipmentBase {
  equipment_family: 'asc_crane'
  asc: ASCCraneParams
  animation: YardCraneAnimationState
}

interface YardCraneAnimationState {
  gantry_position_x: number
  trolley_position_y: number
  spreader_height_z: number
  spreader_lock_state: 'unlocked' | 'locking' | 'locked' | 'unlocking'
  load_attached: boolean
}

type YardCraneState =
  | 'idle'
  | 'gantry_travel'
  | 'trolley_position'
  | 'lower_to_pick'
  | 'lock'
  | 'hoist_loaded'
  | 'trolley_transfer'
  | 'lower_to_set'
  | 'unlock'
  | 'hoist_clear'
  | 'return_or_next'
  | 'storm_mode'
  | 'stowed'
```

### Automation levels for yard cranes

| Level | Description |
|---|---|
| `manual` | Operator in cab |
| `remote_manual` | Operator in remote control room, cameras only |
| `supervised_auto` | Automated cycles, operator monitors & intervenes |
| `semi_automated` | Auto stacking, manual truck handover |
| `fully_automated` | No human in loop (ASC systems) |

## 4. RTG Cranes

Rubber-tyred gantry cranes: mobile, not rail-mounted. Typical values:

```ts
interface RTGCraneParams {
  span_m: number                     // 23–25 m (6+1 wide typical)
  stacking_height: number            // 1-over-4 to 1-over-6
  travel_speed_mps: number           // ~2.5
  trolley_speed_mps: number          // ~1.8
  hoist_speed_mps: number            // ~0.9
  steering: 'front_only' | 'all_wheel'
  power_source: 'diesel' | 'diesel_electric' | 'eRTG_busbar' | 'eRTG_cable_reel'
  turning_radius_m: number           // 12–15
}

interface RTGCrane extends EquipmentBase {
  equipment_family: 'rtg_crane'
  rtg: RTGCraneParams
  animation: YardCraneAnimationState
}
```

Default RTG:

| Parameter | Value |
|---|---|
| Span | 23.6 m |
| Stacking height | 1-over-5 |
| Travel speed | 2.5 m/s |
| Trolley speed | 1.8 m/s |
| Hoist laden speed | 0.9 m/s |
| Turning radius | 14 m |
| Rated capacity | 40 t under spreader |

## 5. Reach Stackers

### Row-dependent capacity

| Row | Capacity t |
|---|---|
| 1st (adjacent) | ~45 |
| 2nd | 30–35 |
| 3rd | 15–20 |

### Interface

```ts
interface ReachStackerParams {
  max_rows: number                   // typically 3
  max_stack_height: number           // typically 5
  capacity_by_row_t: number[]        // [45, 32, 18]
  travel_speed_unladen_kmh: number   // ~25
  travel_speed_laden_kmh: number     // ~20
  boom_extend_time_s: number         // 8–12
  boom_retract_time_s: number        // 6–10
  hoist_speed_mps: number            // ~0.4
  cycle_time_s: number               // 45–90 depending on row/height
}

interface ReachStacker extends EquipmentBase {
  equipment_family: 'reach_stacker'
  rs: ReachStackerParams
  animation: ReachStackerAnimationState
}

interface ReachStackerAnimationState {
  position_x: number
  position_y: number
  heading_deg: number
  boom_extension: number             // 0 = retracted, 1 = fully extended
  boom_elevation_deg: number         // 0 = horizontal, ~60 = max
  spreader_rotation_deg: number      // for container alignment
  load_attached: boolean
}

type ReachStackerState =
  | 'idle'
  | 'travel_to_pick'
  | 'extend_boom'
  | 'lower_to_pick'
  | 'lock'
  | 'hoist_loaded'
  | 'retract_boom'
  | 'travel_to_set'
  | 'extend_boom_set'
  | 'lower_to_set'
  | 'unlock'
  | 'retract_clear'
```

## 6. Terminal Tractors

### Parameters

| Parameter | Value |
|---|---|
| Max speed | 25–40 km/h |
| Operational speed | 10–25 km/h |
| Capacity | 1 container (on chassis/trailer) |
| Coupling time | 5–20 s |
| Decoupling time | 5–15 s |

### Interface

```ts
interface TerminalTractorParams {
  max_speed_kmh: number              // 25–40
  operational_speed_kmh: number      // 10–25
  coupling_time_s: number            // 5–20
  decoupling_time_s: number          // 5–15
  fuel_type: 'diesel' | 'electric' | 'hydrogen'
  autonomous: boolean
}

interface TerminalTractor extends EquipmentBase {
  equipment_family: 'terminal_tractor'
  tractor: TerminalTractorParams
  animation: TractorAnimationState
}

interface TractorAnimationState {
  position_x: number
  position_y: number
  heading_deg: number
  speed_mps: number
  chassis_loaded: boolean
  fifth_wheel_locked: boolean
}

type TractorState =
  | 'idle'
  | 'assigned'
  | 'travel'
  | 'couple'
  | 'haul'
  | 'decouple'
  | 'next'
```

### State machine

```
IDLE ─► ASSIGNED ─► TRAVEL ─► COUPLE ─► HAUL ─► DECOUPLE ─► NEXT ─► IDLE
                                                               └──► ASSIGNED (chained job)
```

## 7. Common Stop Conditions

### Weather thresholds

Apply to all crane families:

| Condition | Threshold | Action |
|---|---|---|
| Wind warning | 15 m/s | Reduce speed, prepare to stop |
| Wind operating stop | 20 m/s | Cease operations |
| Lightning detected | Any | Immediate stop, personnel clear |
| Stowed design wind | 55–65 m/s | Crane survives if storm-locked |

### Safety

- **Exclusion zones**: No simultaneous crane travel in overlapping zones.
- **Anti-collision**: Rail-mounted cranes enforce minimum gap (typically 1 crane width + 2 m buffer).
- **Anti-sway**: Spreader must settle below sway threshold before lock/unlock.

### Maintenance states

```ts
type MaintenanceState = 'operational' | 'planned_maintenance' | 'breakdown' | 'inspection'
```

### Storm pin / tie-down logic (rail-mounted cranes)

1. Cease operations → spreader parked
2. Gantry travel to storm pin position
3. Engage storm pins (mechanical lock to rail)
4. Lower boom (STS only)
5. Apply rail clamps / tie-downs
6. State → `stowed`

## 8. Factory Functions

Use these to generate equipment with realistic defaults. All return the full entity satisfying `EquipmentBase`.

```ts
function createSTSCrane(sizeClass: STSSizeClass): STSCrane {
  const classDefaults: Record<STSSizeClass, Partial<STSCraneParams>> = {
    feeder:               { outreach_m: 35,  lift_height_m: 25, rated_load_t: 45, trolley_speed_m_per_min: 150, hoist_laden_m_per_min: 55, gantry_speed_m_per_min: 38, backreach_m: 15, rail_gauge_m: 16, boom_hinge: true,  dual_hoist: false, single_cycle_time_s: 70 },
    panamax:              { outreach_m: 45,  lift_height_m: 33, rated_load_t: 55, trolley_speed_m_per_min: 180, hoist_laden_m_per_min: 68, gantry_speed_m_per_min: 40, backreach_m: 18, rail_gauge_m: 18, boom_hinge: true,  dual_hoist: false, single_cycle_time_s: 65 },
    post_panamax:         { outreach_m: 55,  lift_height_m: 40, rated_load_t: 63, trolley_speed_m_per_min: 210, hoist_laden_m_per_min: 75, gantry_speed_m_per_min: 40, backreach_m: 20, rail_gauge_m: 30, boom_hinge: true,  dual_hoist: true,  single_cycle_time_s: 62 },
    super_post_panamax:   { outreach_m: 65,  lift_height_m: 45, rated_load_t: 70, trolley_speed_m_per_min: 220, hoist_laden_m_per_min: 82, gantry_speed_m_per_min: 42, backreach_m: 22, rail_gauge_m: 30, boom_hinge: true,  dual_hoist: true,  single_cycle_time_s: 60 },
    ulcv:                 { outreach_m: 75,  lift_height_m: 52, rated_load_t: 75, trolley_speed_m_per_min: 230, hoist_laden_m_per_min: 85, gantry_speed_m_per_min: 42, backreach_m: 25, rail_gauge_m: 35, boom_hinge: true,  dual_hoist: true,  single_cycle_time_s: 58 },
  }

  const p = classDefaults[sizeClass] as STSCraneParams

  return {
    equipment_id: `sts-${sizeClass}-${crypto.randomUUID().slice(0, 8)}`,
    equipment_family: 'sts_crane',
    subtype: sizeClass,
    automation_level: 'semi_automated',
    appearance: {
      silhouette_tags: ['gantry', 'boom', 'trolley', 'spreader', 'machinery_house', 'operator_cab'],
      key_components: ['gantry_frame', 'boom', 'trolley', 'spreader', 'hoist_ropes', 'storm_pins', 'rail_clamps'],
    },
    movement: {
      travel_axes: ['x_rail', 'trolley_y', 'hoist_z', 'boom_angle'],
      travel_speed_mps: p.gantry_speed_m_per_min / 60,
      hoist_speed_mps: p.hoist_laden_m_per_min / 60,
      trolley_speed_mps: p.trolley_speed_m_per_min / 60,
    },
    capabilities: {
      can_handle_container_sizes: ['20ft', '40ft', '45ft'],
      pickup_interfaces: ['spreader', 'twistlock'],
      dropoff_interfaces: ['spreader', 'twistlock'],
      max_lift_capacity_t: p.rated_load_t,
      twin_lift: sizeClass !== 'feeder',
      tandem_lift: sizeClass === 'ulcv' || sizeClass === 'super_post_panamax',
    },
    stop_conditions: {
      max_operating_wind_mps: 20,
      max_stowed_wind_mps: 60,
      lightning_stop: true,
      storm_lock_required: true,
    },
    sts: p,
    animation: {
      gantry_position_x: 0,
      trolley_position_y: 0,
      spreader_height_z: p.lift_height_m,
      spreader_lock_state: 'unlocked',
      load_attached: false,
      boom_angle: 0,
      storm_pin_engaged: false,
    },
  }
}

function createRMGCrane(automationLevel: AutomationLevel = 'semi_automated'): RMGCrane {
  return {
    equipment_id: `rmg-${crypto.randomUUID().slice(0, 8)}`,
    equipment_family: 'rmg_crane',
    subtype: 'standard',
    automation_level: automationLevel,
    appearance: {
      silhouette_tags: ['gantry', 'trolley', 'spreader', 'rail_wheels'],
      key_components: ['gantry_frame', 'trolley', 'spreader', 'hoist_mechanism', 'rail_bogies', 'storm_pins'],
    },
    movement: {
      travel_axes: ['x_rail', 'trolley_y', 'hoist_z'],
      travel_speed_mps: 1.67,   // ~100 m/min
      hoist_speed_mps: 0.45,    // ~27 m/min
      trolley_speed_mps: 1.17,  // ~70 m/min
    },
    capabilities: {
      can_handle_container_sizes: ['20ft', '40ft', '45ft'],
      pickup_interfaces: ['spreader', 'twistlock'],
      dropoff_interfaces: ['spreader', 'twistlock'],
      max_lift_capacity_t: 41,
      twin_lift: true,
    },
    stop_conditions: {
      max_operating_wind_mps: 20,
      max_stowed_wind_mps: 60,
      lightning_stop: true,
      storm_lock_required: true,
    },
    rmg: {
      span_m: 32,
      stacking_width_slots: 6,
      stacking_height: 5,
      gantry_speed_m_per_min: 100,
      trolley_speed_m_per_min: 70,
      hoist_laden_m_per_min: 27,
      rail_type: 'dual_rail',
      handover_layout: 'end_plus_side',
      cantilever: false,
      electrification: 'busbar',
    },
    animation: {
      gantry_position_x: 0,
      trolley_position_y: 0,
      spreader_height_z: 18,
      spreader_lock_state: 'unlocked',
      load_attached: false,
    },
  }
}

function createASCCrane(bufferingMode: ASCBufferingMode = 'waterside_buffered'): ASCCrane {
  return {
    equipment_id: `asc-${crypto.randomUUID().slice(0, 8)}`,
    equipment_family: 'asc_crane',
    subtype: bufferingMode,
    automation_level: 'fully_automated',
    appearance: {
      silhouette_tags: ['gantry', 'trolley', 'spreader', 'rail_wheels', 'sensors'],
      key_components: ['gantry_frame', 'trolley', 'spreader', 'hoist_mechanism', 'rail_bogies', 'lidar_array', 'camera_system', 'storm_pins'],
    },
    movement: {
      travel_axes: ['x_rail', 'trolley_y', 'hoist_z'],
      travel_speed_mps: 1.83,   // ~110 m/min
      hoist_speed_mps: 0.5,     // ~30 m/min
      trolley_speed_mps: 1.25,  // ~75 m/min
    },
    capabilities: {
      can_handle_container_sizes: ['20ft', '40ft', '45ft'],
      pickup_interfaces: ['spreader', 'twistlock'],
      dropoff_interfaces: ['spreader', 'twistlock'],
      max_lift_capacity_t: 41,
      twin_lift: true,
    },
    stop_conditions: {
      max_operating_wind_mps: 20,
      max_stowed_wind_mps: 60,
      lightning_stop: true,
      storm_lock_required: true,
    },
    asc: {
      span_m: 32,
      stacking_width_slots: 6,
      stacking_height: 5,
      gantry_speed_m_per_min: 110,
      trolley_speed_m_per_min: 75,
      hoist_laden_m_per_min: 30,
      rail_type: 'dual_rail',
      handover_layout: 'end_plus_side',
      cantilever: false,
      electrification: 'busbar',
      buffering_mode: bufferingMode,
      buffer_lane_count: bufferingMode === 'dual_buffered' ? 4 : 2,
      interchange_crane_required: bufferingMode !== 'none',
    },
    animation: {
      gantry_position_x: 0,
      trolley_position_y: 0,
      spreader_height_z: 18,
      spreader_lock_state: 'unlocked',
      load_attached: false,
    },
  }
}

function createRTGCrane(): RTGCrane {
  return {
    equipment_id: `rtg-${crypto.randomUUID().slice(0, 8)}`,
    equipment_family: 'rtg_crane',
    subtype: 'standard',
    automation_level: 'manual',
    appearance: {
      silhouette_tags: ['gantry', 'trolley', 'spreader', 'rubber_tyres'],
      key_components: ['gantry_frame', 'trolley', 'spreader', 'hoist_mechanism', 'tyre_bogies', 'diesel_genset'],
    },
    movement: {
      travel_axes: ['x_rubber', 'trolley_y', 'hoist_z'],
      travel_speed_mps: 2.5,
      hoist_speed_mps: 0.9,
      trolley_speed_mps: 1.8,
      turning_radius_m: 14,
    },
    capabilities: {
      can_handle_container_sizes: ['20ft', '40ft', '45ft'],
      pickup_interfaces: ['spreader', 'twistlock'],
      dropoff_interfaces: ['spreader', 'twistlock'],
      max_lift_capacity_t: 40,
    },
    stop_conditions: {
      max_operating_wind_mps: 20,
      max_stowed_wind_mps: 55,
      lightning_stop: true,
      storm_lock_required: false,
    },
    rtg: {
      span_m: 23.6,
      stacking_height: 5,
      travel_speed_mps: 2.5,
      trolley_speed_mps: 1.8,
      hoist_speed_mps: 0.9,
      steering: 'front_only',
      power_source: 'diesel_electric',
      turning_radius_m: 14,
    },
    animation: {
      gantry_position_x: 0,
      trolley_position_y: 0,
      spreader_height_z: 15,
      spreader_lock_state: 'unlocked',
      load_attached: false,
    },
  }
}

function createReachStacker(): ReachStacker {
  return {
    equipment_id: `rs-${crypto.randomUUID().slice(0, 8)}`,
    equipment_family: 'reach_stacker',
    subtype: 'standard',
    automation_level: 'manual',
    appearance: {
      silhouette_tags: ['cab', 'boom', 'spreader', 'counterweight', 'wheels'],
      key_components: ['chassis', 'telescopic_boom', 'spreader', 'cab', 'counterweight', 'stabilizers'],
    },
    movement: {
      travel_axes: ['x_rubber', 'y_rubber', 'hoist_z', 'boom_angle', 'rotate'],
      travel_speed_mps: 6.94,  // ~25 km/h unladen
      hoist_speed_mps: 0.4,
      turning_radius_m: 8,
    },
    capabilities: {
      can_handle_container_sizes: ['20ft', '40ft', '45ft'],
      pickup_interfaces: ['spreader', 'twistlock'],
      dropoff_interfaces: ['spreader', 'twistlock'],
      max_lift_capacity_t: 45,
    },
    stop_conditions: {
      max_operating_wind_mps: 25,
      max_stowed_wind_mps: 55,
      lightning_stop: true,
      storm_lock_required: false,
    },
    rs: {
      max_rows: 3,
      max_stack_height: 5,
      capacity_by_row_t: [45, 32, 18],
      travel_speed_unladen_kmh: 25,
      travel_speed_laden_kmh: 20,
      boom_extend_time_s: 10,
      boom_retract_time_s: 8,
      hoist_speed_mps: 0.4,
      cycle_time_s: 60,
    },
    animation: {
      position_x: 0,
      position_y: 0,
      heading_deg: 0,
      boom_extension: 0,
      boom_elevation_deg: 30,
      spreader_rotation_deg: 0,
      load_attached: false,
    },
  }
}

function createTerminalTractor(autonomous = false): TerminalTractor {
  return {
    equipment_id: `tt-${crypto.randomUUID().slice(0, 8)}`,
    equipment_family: 'terminal_tractor',
    subtype: autonomous ? 'agv' : 'manned',
    automation_level: autonomous ? 'fully_automated' : 'manual',
    appearance: {
      silhouette_tags: ['cab', 'fifth_wheel', 'chassis_trailer', ...(autonomous ? ['sensor_mast'] : [])],
      key_components: ['tractor_unit', 'fifth_wheel', 'chassis_trailer', ...(autonomous ? ['lidar', 'cameras', 'v2x_antenna'] : [])],
    },
    movement: {
      travel_axes: ['x_rubber', 'y_rubber'],
      travel_speed_mps: autonomous ? 5.56 : 8.33, // 20 or 30 km/h
      hoist_speed_mps: 0,
      turning_radius_m: 7,
    },
    capabilities: {
      can_handle_container_sizes: ['20ft', '40ft', '45ft'],
      pickup_interfaces: ['chassis_pins'],
      dropoff_interfaces: ['chassis_pins'],
      max_lift_capacity_t: 0,
    },
    stop_conditions: {
      max_operating_wind_mps: 30,
      max_stowed_wind_mps: 55,
      lightning_stop: false,
      storm_lock_required: false,
    },
    tractor: {
      max_speed_kmh: autonomous ? 20 : 30,
      operational_speed_kmh: autonomous ? 15 : 20,
      coupling_time_s: autonomous ? 15 : 10,
      decoupling_time_s: autonomous ? 12 : 8,
      fuel_type: autonomous ? 'electric' : 'diesel',
      autonomous,
    },
    animation: {
      position_x: 0,
      position_y: 0,
      heading_deg: 0,
      speed_mps: 0,
      chassis_loaded: false,
      fifth_wheel_locked: false,
    },
  }
}
```

## Animation Guidance

### Speed conversion

All speeds stored in **m/s** internally. Convert display/spec values:
- m/min → m/s: divide by 60
- km/h → m/s: divide by 3.6

### Per-frame updates

In a Three.js render loop with `delta` (seconds):

```ts
// Linear motion example
crane.animation.gantry_position_x += direction * crane.movement.travel_speed_mps * delta

// Hoist with accel/decel (trapezoidal profile)
const accel = 0.5 // m/s², typical crane hoist
const maxSpeed = crane.movement.hoist_speed_mps
currentSpeed = Math.min(currentSpeed + accel * delta, maxSpeed)
crane.animation.spreader_height_z += direction * currentSpeed * delta
```

### State-driven transitions

Advance to the next state when the target position is reached within a tolerance (e.g. 0.05 m). Always clamp final position to the exact target to avoid drift.

### Anti-sway simulation (optional)

For visual realism, apply pendulum sway to the spreader proportional to trolley acceleration. Damp over ~2–3 s after trolley stops before allowing lock/unlock transitions.
