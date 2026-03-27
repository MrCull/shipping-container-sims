---
name: vessel-entities
description: >-
  Data structures, schemas, and default values for container vessels in terminal
  simulations. Use when creating vessel models, bay plans, voyage schedules,
  stability calculations, or stowage planning logic.
---

# Vessel Entities — Agent Skill

This skill defines the canonical data structures, defaults, generation algorithms, and factory functions for container vessels used across terminal simulations. All code is TypeScript. Follow these schemas exactly when generating vessel-related entities.

---

## 1. Vessel Classes & Physical Dimensions

### Reference Table

| Class | TEU Range | Length (m) | Beam (m) | Bays | Cranes Required |
|---|---|---|---|---|---|
| Feeder | 500–3,000 | 100–200 | 20–30 | 10–20 | 1–2 |
| Feedermax | 3,000–5,000 | 180–250 | 30–35 | 20–30 | 2–3 |
| Panamax | 3,000–5,000 | ~294 | 32.2 | 25–30 | 3–4 |
| Post-Panamax | 5,000–10,000 | 250–300 | 40–45 | 30–40 | 4–6 |
| New Panamax | 10,000–14,500 | 300–366 | 49 | 40–50 | 5–7 |
| ULCV | 14,500–24,000+ | 350–400 | 50–61 | 50–65 | 6–8 |

### TypeScript Types & Interfaces

```typescript
type VesselClass =
  | 'feeder'
  | 'feedermax'
  | 'panamax'
  | 'post_panamax'
  | 'new_panamax'
  | 'ulcv';

interface Vessel {
  vessel_id: string;           // e.g. "VESSEL-MSK-ALPHA"
  name: string;                // e.g. "Maersk Alpha"
  class: VesselClass;
  imo_number: string;          // 7-digit IMO number, e.g. "9839012"
  flag_state: string;          // ISO 3166-1 alpha-2, e.g. "DK"
  length_m: number;            // length overall (LOA)
  beam_m: number;              // moulded breadth
  draft_m: number;             // maximum summer draft
  depth_m: number;             // moulded depth (keel to top of uppermost deck)
  teu_capacity: number;        // nominal TEU capacity
  bay_count: number;           // total number of bay positions (odd-numbered 20ft bays)
  row_count_max: number;       // widest row count across any bay
  tier_count_max: number;      // total tiers (under-deck + on-deck)
  max_underdeck_tiers: number; // tiers below the hatch cover
  max_ondeck_tiers: number;    // tiers above the hatch cover
  has_cell_guides: boolean;    // true for under-deck cell-guide slots
  hatch_count: number;         // number of hatch covers
  lashing_bridges: number;     // number of lashing-bridge rows
  cranes_required: number;     // quay cranes needed for efficient operations
  max_deadweight_t: number;    // maximum deadweight tonnage
  service_speed_kn: number;    // design service speed in knots
}
```

### Default Values by Class

```typescript
const VESSEL_CLASS_DEFAULTS: Record<VesselClass, Omit<Vessel, 'vessel_id' | 'name' | 'imo_number' | 'flag_state'>> = {
  feeder: {
    class: 'feeder',
    length_m: 150,
    beam_m: 25,
    draft_m: 8.5,
    depth_m: 12,
    teu_capacity: 1800,
    bay_count: 15,
    row_count_max: 10,
    tier_count_max: 14,
    max_underdeck_tiers: 8,
    max_ondeck_tiers: 6,
    has_cell_guides: true,
    hatch_count: 4,
    lashing_bridges: 3,
    cranes_required: 2,
    max_deadweight_t: 23000,
    service_speed_kn: 18,
  },
  feedermax: {
    class: 'feedermax',
    length_m: 215,
    beam_m: 32,
    draft_m: 10.5,
    depth_m: 16,
    teu_capacity: 4000,
    bay_count: 25,
    row_count_max: 13,
    tier_count_max: 17,
    max_underdeck_tiers: 10,
    max_ondeck_tiers: 7,
    has_cell_guides: true,
    hatch_count: 6,
    lashing_bridges: 5,
    cranes_required: 3,
    max_deadweight_t: 50000,
    service_speed_kn: 20,
  },
  panamax: {
    class: 'panamax',
    length_m: 294,
    beam_m: 32.2,
    draft_m: 12.04,
    depth_m: 21.5,
    teu_capacity: 4500,
    bay_count: 28,
    row_count_max: 13,
    tier_count_max: 18,
    max_underdeck_tiers: 10,
    max_ondeck_tiers: 8,
    has_cell_guides: true,
    hatch_count: 7,
    lashing_bridges: 6,
    cranes_required: 4,
    max_deadweight_t: 65000,
    service_speed_kn: 22,
  },
  post_panamax: {
    class: 'post_panamax',
    length_m: 280,
    beam_m: 42,
    draft_m: 14.0,
    depth_m: 24.5,
    teu_capacity: 8000,
    bay_count: 35,
    row_count_max: 17,
    tier_count_max: 20,
    max_underdeck_tiers: 10,
    max_ondeck_tiers: 10,
    has_cell_guides: true,
    hatch_count: 9,
    lashing_bridges: 8,
    cranes_required: 5,
    max_deadweight_t: 100000,
    service_speed_kn: 24,
  },
  new_panamax: {
    class: 'new_panamax',
    length_m: 366,
    beam_m: 49,
    draft_m: 15.2,
    depth_m: 27.5,
    teu_capacity: 13000,
    bay_count: 45,
    row_count_max: 20,
    tier_count_max: 22,
    max_underdeck_tiers: 12,
    max_ondeck_tiers: 10,
    has_cell_guides: true,
    hatch_count: 11,
    lashing_bridges: 10,
    cranes_required: 6,
    max_deadweight_t: 145000,
    service_speed_kn: 23,
  },
  ulcv: {
    class: 'ulcv',
    length_m: 400,
    beam_m: 61,
    draft_m: 16.0,
    depth_m: 30.2,
    teu_capacity: 23000,
    bay_count: 60,
    row_count_max: 24,
    tier_count_max: 24,
    max_underdeck_tiers: 12,
    max_ondeck_tiers: 12,
    has_cell_guides: true,
    hatch_count: 15,
    lashing_bridges: 14,
    cranes_required: 8,
    max_deadweight_t: 220000,
    service_speed_kn: 22,
  },
};
```

---

## 2. Bay-Row-Tier Coordinate System

Container positions on a vessel follow a three-part addressing scheme: **Bay / Row / Tier**.

### Bay Numbering

- **Odd bay numbers** (01, 03, 05, …) designate 20-foot container slots.
- **Even bay numbers** (02, 04, 06, …) designate 40-foot spanning slots. A 40ft container placed in bay 02 occupies the physical space of bays 01 and 03.
- Bays are numbered **bow to stern** (forward = low numbers).
- The total bay label count = `bay_count * 2 - 1` (interleaved odd and even numbers).

### Row Numbering

- **Row 00** is the **centreline** of the vessel.
- **Even rows** (00, 02, 04, 06, …) extend to **port** (left when facing forward).
- **Odd rows** (01, 03, 05, 07, …) extend to **starboard** (right when facing forward).
- Maximum row number depends on vessel beam. Typical: feeder 10, ULCV 24.

### Tier Numbering

- **Under-deck tiers**: 02, 04, 06, 08, … up to 20 (even numbers, bottom-up from the tank top).
- **On-deck tiers**: 80, 82, 84, 86, … up to 100 (even numbers, bottom-up from the hatch cover).
- The gap between 20 and 80 represents the hatch cover.

### Slot Format

A stowage position is expressed as a three-part string:

```
"BBB/RR/TT"
```

Examples:

| Slot | Meaning |
|---|---|
| `"034/10/84"` | Bay 34, Row 10, Tier 84 (on-deck, port side) |
| `"007/00/06"` | Bay 07, Row 00, Tier 06 (under-deck, centreline) |
| `"052/03/92"` | Bay 52, Row 03, Tier 92 (on-deck, starboard) |

### Coordinate Parser & Formatter

```typescript
interface SlotCoordinate {
  bay: number;
  row: number;
  tier: number;
}

function parseSlot(slot: string): SlotCoordinate {
  const [bayStr, rowStr, tierStr] = slot.split('/');
  return {
    bay: parseInt(bayStr, 10),
    row: parseInt(rowStr, 10),
    tier: parseInt(tierStr, 10),
  };
}

function formatSlot(coord: SlotCoordinate): string {
  const bay = String(coord.bay).padStart(3, '0');
  const row = String(coord.row).padStart(2, '0');
  const tier = String(coord.tier).padStart(2, '0');
  return `${bay}/${row}/${tier}`;
}

function is40ftBay(bay: number): boolean {
  return bay % 2 === 0;
}

function isUnderDeck(tier: number): boolean {
  return tier >= 2 && tier <= 20;
}

function isOnDeck(tier: number): boolean {
  return tier >= 80 && tier <= 100;
}

function getDeckZone(tier: number): 'under_deck' | 'on_deck' {
  return isUnderDeck(tier) ? 'under_deck' : 'on_deck';
}
```

---

## 3. Stowage Slot Model

Each physical cell on a vessel where a container can be placed.

### Interface

```typescript
type DeckZone = 'under_deck' | 'on_deck';

interface StowageSlot {
  bay: number;
  row: number;
  tier: number;
  slot_id: string;              // formatted "BBB/RR/TT"
  deck_zone: DeckZone;
  cell_guides: boolean;         // under-deck = true, on-deck = false (unless lashed)
  max_weight_kg: number;        // per-slot weight limit — default 30,480 kg (30t gross)
  reefer_power: boolean;        // true if reefer plug available
  hazmat_allowed: boolean;      // false near accommodation/engine room
  max_height_mm: number;        // standard 2,591 mm (8'6"); high-cube 2,896 mm (9'6")
  stack_weight_limit_kg: number;// cumulative stack weight — default 120,000 kg
  lashing_required: boolean;    // true for on-deck tiers above tier 82
  container_ref: string | null; // container_id currently occupying slot, null if empty
}
```

### Default Factory

```typescript
function createStowageSlot(
  bay: number,
  row: number,
  tier: number,
  overrides: Partial<StowageSlot> = {},
): StowageSlot {
  const deck_zone = getDeckZone(tier);
  return {
    bay,
    row,
    tier,
    slot_id: formatSlot({ bay, row, tier }),
    deck_zone,
    cell_guides: deck_zone === 'under_deck',
    max_weight_kg: 30480,
    reefer_power: false,
    hazmat_allowed: true,
    max_height_mm: 2591,
    stack_weight_limit_kg: 120000,
    lashing_required: deck_zone === 'on_deck' && tier > 82,
    container_ref: null,
    ...overrides,
  };
}
```

### Generating All Slots for a Vessel

```typescript
function generateVesselSlots(vessel: Vessel): StowageSlot[] {
  const slots: StowageSlot[] = [];
  for (let b = 1; b <= vessel.bay_count * 2 - 1; b += 2) {
    for (let r = 0; r <= vessel.row_count_max; r++) {
      // Under-deck tiers
      for (let t = 2; t <= vessel.max_underdeck_tiers * 2; t += 2) {
        slots.push(createStowageSlot(b, r, t));
      }
      // On-deck tiers
      for (let t = 80; t < 80 + vessel.max_ondeck_tiers * 2; t += 2) {
        slots.push(createStowageSlot(b, r, t));
      }
    }
  }
  return slots;
}
```

---

## 4. Vessel Stability (Simplified)

Terminal simulations use simplified centre-of-gravity-based stability checks rather than full hydrostatic calculations.

### Core Stability Interface

```typescript
interface VesselStability {
  displacement_t: number;       // total weight (vessel + cargo + ballast)
  base_gm_m: number;            // metacentric height with no cargo — class-dependent
  cog_x: number;                // centre of gravity longitudinal (m from midship, +ve forward)
  cog_y: number;                // centre of gravity transverse (m from centreline, +ve port)
  cog_z: number;                // centre of gravity vertical (m above keel)
  stability_factor: number;     // divisor for GM reduction — higher = more stable hull
  list_factor: number;          // degrees list per metre of transverse COG offset
  trim_factor: number;          // metres trim per metre of longitudinal COG offset
}
```

### Default Stability Parameters by Class

```typescript
const STABILITY_DEFAULTS: Record<VesselClass, Pick<VesselStability, 'base_gm_m' | 'stability_factor' | 'list_factor' | 'trim_factor'>> = {
  feeder:       { base_gm_m: 1.8, stability_factor: 18, list_factor: 2.0, trim_factor: 0.05 },
  feedermax:    { base_gm_m: 2.0, stability_factor: 22, list_factor: 1.6, trim_factor: 0.04 },
  panamax:      { base_gm_m: 2.2, stability_factor: 28, list_factor: 1.3, trim_factor: 0.035 },
  post_panamax: { base_gm_m: 2.5, stability_factor: 32, list_factor: 1.1, trim_factor: 0.03 },
  new_panamax:  { base_gm_m: 3.0, stability_factor: 38, list_factor: 0.9, trim_factor: 0.025 },
  ulcv:         { base_gm_m: 3.5, stability_factor: 45, list_factor: 0.7, trim_factor: 0.02 },
};
```

### Calculation Functions

```typescript
function calculateGM(stability: VesselStability): number {
  return stability.base_gm_m - (stability.cog_z / stability.stability_factor);
}

function calculateListAngle(stability: VesselStability): number {
  return stability.cog_y * stability.list_factor;
}

function calculateTrim(stability: VesselStability): number {
  return stability.cog_x * stability.trim_factor;
}

interface StabilityResult {
  gm_m: number;
  list_degrees: number;
  trim_m: number;
  score: number;
  status: 'safe' | 'acceptable' | 'unsafe';
}

function evaluateStability(stability: VesselStability): StabilityResult {
  const gm = calculateGM(stability);
  const list = calculateListAngle(stability);
  const trim = calculateTrim(stability);

  let score = 100;
  // GM penalty: lose 30 points per metre below 1.0 m
  if (gm < 1.0) score -= (1.0 - gm) * 30;
  // List penalty: lose 5 points per degree
  score -= Math.abs(list) * 5;
  // Trim penalty: lose 3 points per metre of trim
  score -= Math.abs(trim) * 3;

  score = Math.max(0, Math.min(100, score));

  let status: StabilityResult['status'];
  if (score >= 80) status = 'safe';
  else if (score >= 50) status = 'acceptable';
  else status = 'unsafe';

  return { gm_m: gm, list_degrees: list, trim_m: trim, score, status };
}
```

### Weight Balance Check

```typescript
interface WeightBalance {
  port_weight_kg: number;
  starboard_weight_kg: number;
  fore_weight_kg: number;
  aft_weight_kg: number;
}

function checkWeightBalance(
  balance: WeightBalance,
  lateral_tolerance_kg: number = 50000,
  longitudinal_tolerance_kg: number = 100000,
): { balanced: boolean; lateral_diff_kg: number; longitudinal_diff_kg: number } {
  const lateral_diff_kg = Math.abs(balance.port_weight_kg - balance.starboard_weight_kg);
  const longitudinal_diff_kg = Math.abs(balance.fore_weight_kg - balance.aft_weight_kg);
  return {
    balanced: lateral_diff_kg < lateral_tolerance_kg && longitudinal_diff_kg < longitudinal_tolerance_kg,
    lateral_diff_kg,
    longitudinal_diff_kg,
  };
}
```

### Stability Scoring Summary

| Score Range | Status | Meaning |
|---|---|---|
| 80–100 | `safe` | Vessel within all operational limits |
| 50–79 | `acceptable` | Minor imbalance; planner should review |
| 0–49 | `unsafe` | Exceeds safe thresholds; re-stow required |

---

## 5. Voyage & Manifest Model

### Voyage Interface

```typescript
interface PortCutoffs {
  gate: string;            // ISO 8601 datetime — last acceptance at gate
  documentation: string;   // ISO 8601 — shipping instruction deadline
  vgm: string;             // ISO 8601 — verified gross mass submission deadline
}

interface PortCall {
  port_code: string;       // UN/LOCODE 5-char, e.g. "GBFXT"
  terminal_id: string;     // terminal identifier, e.g. "FXT-T1"
  eta: string;             // ISO 8601 datetime
  etd: string;             // ISO 8601 datetime
  cutoffs: PortCutoffs;
  sequence: number;        // 1-indexed position in rotation
}

interface Voyage {
  voyage_id: string;       // e.g. "VOY-MSK-118W"
  vessel_id: string;       // references Vessel.vessel_id
  service_code: string;    // liner service identifier, e.g. "AE7"
  direction: 'westbound' | 'eastbound' | 'northbound' | 'southbound';
  rotation: PortCall[];
}
```

### Manifest Entry Interface

```typescript
type ManifestStatus =
  | 'booked'          // cargo reserved
  | 'gate_in'         // container received at terminal
  | 'loaded'          // on vessel
  | 'in_transit'      // vessel sailing
  | 'discharged'      // removed from vessel at POD
  | 'delivered'       // collected by consignee
  | 'rolled'          // bumped to next sailing
  | 'short_shipped';  // failed to load

interface ManifestEntry {
  container_id: string;       // e.g. "MSCU1234567"
  voyage_id: string;
  pol: string;                // port of loading (UN/LOCODE)
  pod: string;                // port of discharge (UN/LOCODE)
  current_slot: string | null;// current stowage position "BBB/RR/TT" or null if not loaded
  planned_slot: string | null;// planned stowage position
  weight_kg: number;
  is_reefer: boolean;
  is_hazmat: boolean;
  hazmat_class: string | null;// IMO hazmat class, e.g. "3" (flammable liquids)
  is_oog: boolean;            // out-of-gauge
  height_mm: number;          // 2591 for standard, 2896 for high-cube
  length_ft: 20 | 40 | 45;
  status: ManifestStatus;
}
```

### Delay Propagation

When a port ETA is delayed, all subsequent ports in the rotation must be updated:

```typescript
function propagateDelay(voyage: Voyage, fromSequence: number, delayMinutes: number): Voyage {
  const updatedRotation = voyage.rotation.map((portCall) => {
    if (portCall.sequence < fromSequence) return portCall;
    const addMs = delayMinutes * 60 * 1000;
    return {
      ...portCall,
      eta: new Date(new Date(portCall.eta).getTime() + addMs).toISOString(),
      etd: new Date(new Date(portCall.etd).getTime() + addMs).toISOString(),
      cutoffs: {
        gate: new Date(new Date(portCall.cutoffs.gate).getTime() + addMs).toISOString(),
        documentation: new Date(new Date(portCall.cutoffs.documentation).getTime() + addMs).toISOString(),
        vgm: new Date(new Date(portCall.cutoffs.vgm).getTime() + addMs).toISOString(),
      },
    };
  });
  return { ...voyage, rotation: updatedRotation };
}
```

---

## 6. Vessel Generation Algorithms

Use these formulas to derive vessel geometry from physical dimensions. They give realistic values for simulation purposes.

```typescript
function deriveVesselGeometry(length_m: number, beam_m: number) {
  const bay_count = Math.round(length_m / 6.1);
  const row_count = Math.floor(beam_m / 2.5);
  const underdeck_tiers = randomBetween(8, 12);
  const ondeck_tiers = randomBetween(4, 10);
  const hatch_count = Math.round(bay_count / 4);
  const cranes_required = Math.ceil(bay_count / 10);
  const tier_count_max = underdeck_tiers + ondeck_tiers;
  const teu_estimate = bay_count * row_count * tier_count_max * 0.65; // ~65% utilisation factor

  return {
    bay_count,
    row_count_max: row_count,
    tier_count_max,
    max_underdeck_tiers: underdeck_tiers,
    max_ondeck_tiers: ondeck_tiers,
    hatch_count,
    cranes_required,
    teu_capacity: Math.round(teu_estimate),
  };
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
```

### Draft & Depth Approximations

```typescript
function estimateDraft(length_m: number): number {
  // Rough linear fit from real-world vessel data
  return Math.round((length_m * 0.042 + 2.0) * 10) / 10;
}

function estimateDepth(draft_m: number): number {
  return Math.round(draft_m * 1.7 * 10) / 10;
}

function estimateDeadweight(teu_capacity: number): number {
  return Math.round(teu_capacity * 10.5);
}
```

---

## 7. Factory Functions

### Vessel Factories

```typescript
let vesselCounter = 0;
function nextVesselId(prefix: string): string {
  vesselCounter++;
  return `VESSEL-${prefix}-${String(vesselCounter).padStart(3, '0')}`;
}

function createVessel(vesselClass: VesselClass, overrides: Partial<Vessel> = {}): Vessel {
  const defaults = VESSEL_CLASS_DEFAULTS[vesselClass];
  const id = overrides.vessel_id ?? nextVesselId(vesselClass.toUpperCase().replace('_', ''));
  return {
    vessel_id: id,
    name: overrides.name ?? `Vessel ${id}`,
    imo_number: overrides.imo_number ?? String(9000000 + Math.floor(Math.random() * 999999)),
    flag_state: overrides.flag_state ?? 'PA',
    ...defaults,
    ...overrides,
    class: vesselClass,
  };
}

function createFeederVessel(overrides: Partial<Vessel> = {}): Vessel {
  return createVessel('feeder', overrides);
}

function createPanamaxVessel(overrides: Partial<Vessel> = {}): Vessel {
  return createVessel('panamax', overrides);
}

function createULCVVessel(overrides: Partial<Vessel> = {}): Vessel {
  return createVessel('ulcv', overrides);
}
```

### Voyage Factory

```typescript
let voyageCounter = 0;
function nextVoyageId(carrier: string): string {
  voyageCounter++;
  return `VOY-${carrier}-${String(voyageCounter).padStart(3, '0')}W`;
}

function createPortCall(
  port_code: string,
  terminal_id: string,
  eta: Date,
  dwell_hours: number,
  sequence: number,
): PortCall {
  const etd = new Date(eta.getTime() + dwell_hours * 60 * 60 * 1000);
  const gateOffset = -24 * 60 * 60 * 1000;   // 24 h before ETD
  const docOffset = -48 * 60 * 60 * 1000;    // 48 h before ETD
  const vgmOffset = -72 * 60 * 60 * 1000;    // 72 h before ETD
  return {
    port_code,
    terminal_id,
    eta: eta.toISOString(),
    etd: etd.toISOString(),
    cutoffs: {
      gate: new Date(etd.getTime() + gateOffset).toISOString(),
      documentation: new Date(etd.getTime() + docOffset).toISOString(),
      vgm: new Date(etd.getTime() + vgmOffset).toISOString(),
    },
    sequence,
  };
}

function createVoyage(
  vessel_id: string,
  service_code: string,
  portSpecs: Array<{ port_code: string; terminal_id: string; dwell_hours: number }>,
  firstEta: Date,
  transitHours: number = 48,
  overrides: Partial<Voyage> = {},
): Voyage {
  const rotation: PortCall[] = [];
  let currentTime = firstEta;

  for (let i = 0; i < portSpecs.length; i++) {
    const spec = portSpecs[i];
    rotation.push(createPortCall(spec.port_code, spec.terminal_id, currentTime, spec.dwell_hours, i + 1));
    const etd = new Date(currentTime.getTime() + spec.dwell_hours * 60 * 60 * 1000);
    currentTime = new Date(etd.getTime() + transitHours * 60 * 60 * 1000);
  }

  return {
    voyage_id: overrides.voyage_id ?? nextVoyageId('MSK'),
    vessel_id,
    service_code,
    direction: overrides.direction ?? 'westbound',
    rotation,
    ...overrides,
  };
}
```

### Stowage Slot Factory

See `createStowageSlot()` in Section 3 and `generateVesselSlots()` for bulk generation.

---

## 8. Sample Data

Use these identifiers and structures as reference when generating test fixtures.

```typescript
// ---- Sample Vessels ----

const sampleFeeder = createFeederVessel({
  vessel_id: 'VESSEL-MSK-ALPHA',
  name: 'Maersk Alpha',
  imo_number: '9839012',
  flag_state: 'DK',
  teu_capacity: 1800,
});

const samplePanamax = createPanamaxVessel({
  vessel_id: 'VESSEL-MSK-BRAVO',
  name: 'Maersk Bravo',
  imo_number: '9841055',
  flag_state: 'SG',
  teu_capacity: 4500,
});

const sampleULCV = createULCVVessel({
  vessel_id: 'VESSEL-MSK-CHARLIE',
  name: 'Maersk Charlie',
  imo_number: '9900123',
  flag_state: 'DK',
  teu_capacity: 23112,
});

// ---- Sample Voyage ----

const sampleVoyage = createVoyage(
  'VESSEL-MSK-ALPHA',
  'AE7',
  [
    { port_code: 'GBFXT', terminal_id: 'FXT-T1', dwell_hours: 18 },
    { port_code: 'NLRTM', terminal_id: 'RTM-ECT', dwell_hours: 24 },
    { port_code: 'DEHAM', terminal_id: 'HAM-CTB', dwell_hours: 20 },
    { port_code: 'SGSIN', terminal_id: 'SIN-PPT', dwell_hours: 30 },
    { port_code: 'CNSHA', terminal_id: 'SHA-YST', dwell_hours: 36 },
  ],
  new Date('2026-04-10T06:00:00Z'),
  72,
  { voyage_id: 'VOY-MSK-118W', direction: 'eastbound' },
);

// ---- Sample Manifest Entries ----

const sampleManifest: ManifestEntry[] = [
  {
    container_id: 'MSCU1234567',
    voyage_id: 'VOY-MSK-118W',
    pol: 'GBFXT',
    pod: 'SGSIN',
    current_slot: '034/10/84',
    planned_slot: '034/10/84',
    weight_kg: 24500,
    is_reefer: false,
    is_hazmat: false,
    hazmat_class: null,
    is_oog: false,
    height_mm: 2591,
    length_ft: 40,
    status: 'loaded',
  },
  {
    container_id: 'MSCU7654321',
    voyage_id: 'VOY-MSK-118W',
    pol: 'GBFXT',
    pod: 'CNSHA',
    current_slot: '007/00/06',
    planned_slot: '007/00/06',
    weight_kg: 28000,
    is_reefer: true,
    is_hazmat: false,
    hazmat_class: null,
    is_oog: false,
    height_mm: 2896,
    length_ft: 40,
    status: 'loaded',
  },
  {
    container_id: 'HLCU9988776',
    voyage_id: 'VOY-MSK-118W',
    pol: 'NLRTM',
    pod: 'SGSIN',
    current_slot: null,
    planned_slot: '052/03/92',
    weight_kg: 18200,
    is_reefer: false,
    is_hazmat: true,
    hazmat_class: '3',
    is_oog: false,
    height_mm: 2591,
    length_ft: 20,
    status: 'booked',
  },
];

// ---- Sample Stowage Slots ----

const sampleSlots: StowageSlot[] = [
  createStowageSlot(34, 10, 84, { reefer_power: false }),
  createStowageSlot(7, 0, 6, { reefer_power: true }),
  createStowageSlot(52, 3, 92, { hazmat_allowed: true, lashing_required: true }),
];
```

---

## Quick Reference: Key Constants

| Constant | Value | Notes |
|---|---|---|
| Bay spacing | 6.1 m | Distance between 20ft bay centres |
| Row spacing | 2.5 m | Distance between cell centres athwartships |
| Standard container height | 2,591 mm | 8'6" |
| High-cube container height | 2,896 mm | 9'6" |
| Max slot weight | 30,480 kg | ISO gross weight for 40ft container |
| Max stack weight | 120,000 kg | Cumulative weight of a single stack |
| Under-deck tier range | 02–20 | Even numbers |
| On-deck tier range | 80–100 | Even numbers |
| 20ft TEU factor | 1 | One 20ft = 1 TEU |
| 40ft TEU factor | 2 | One 40ft = 2 TEU |
| 45ft TEU factor | 2.25 | One 45ft = 2.25 TEU |
