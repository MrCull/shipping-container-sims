---
name: container-cargo-entities
description: >-
  Data structures, schemas, and default values for shipping containers and cargo
  entities in terminal simulations. Use when creating or modifying container models,
  cargo attributes, hazardous goods handling, or container lifecycle state machines.
---

# Container & Cargo Entity Data Structures

This skill provides complete TypeScript interfaces, enums, constants, factory functions, and state-machine rules for shipping containers and their cargo in terminal simulations. Use this as the canonical reference when generating container-related code — no external lookup should be needed.

---

## 1. Container Physical Types

### Physical dimensions constant table

```ts
export type ContainerSizeCode = '20ST' | '40ST' | '40HC' | '45HC'

export interface ContainerPhysicalSpec {
  sizeCode: ContainerSizeCode
  label: string
  lengthM: number
  widthM: number
  heightM: number
  /** Internal volume in cubic metres (approximate) */
  internalVolM3: number
  tareKg: number
  maxGrossKg: number
  maxPayloadKg: number
  /** TEU (twenty-foot equivalent units) */
  teu: number
}

export const CONTAINER_SPECS: Record<ContainerSizeCode, ContainerPhysicalSpec> = {
  '20ST': {
    sizeCode: '20ST',
    label: "20' Standard",
    lengthM: 6.06,
    widthM: 2.44,
    heightM: 2.59,
    internalVolM3: 33.2,
    tareKg: 2200,
    maxGrossKg: 30480,
    maxPayloadKg: 28280,
    teu: 1,
  },
  '40ST': {
    sizeCode: '40ST',
    label: "40' Standard",
    lengthM: 12.19,
    widthM: 2.44,
    heightM: 2.59,
    internalVolM3: 67.7,
    tareKg: 3700,
    maxGrossKg: 30480,
    maxPayloadKg: 26780,
    teu: 2,
  },
  '40HC': {
    sizeCode: '40HC',
    label: "40' High Cube",
    lengthM: 12.19,
    widthM: 2.44,
    heightM: 2.90,
    internalVolM3: 76.3,
    tareKg: 3900,
    maxGrossKg: 30480,
    maxPayloadKg: 26580,
    teu: 2,
  },
  '45HC': {
    sizeCode: '45HC',
    label: "45' High Cube",
    lengthM: 13.72,
    widthM: 2.44,
    heightM: 2.90,
    internalVolM3: 86.1,
    tareKg: 4800,
    maxGrossKg: 30480,
    maxPayloadKg: 25680,
    teu: 2.25,
  },
}
```

### Visual variant type

```ts
export type ContainerVisualVariant =
  | 'dry_van'
  | 'high_cube'
  | 'reefer'
  | 'open_top'
  | 'flat_rack'
  | 'tank'

export interface ContainerVisualProfile {
  variant: ContainerVisualVariant
  sizeCode: ContainerSizeCode
  colorHex: string
  logoText?: string
}
```

### Container colour palette

Common shipping-line colours for realistic rendering:

```ts
export const CONTAINER_COLORS = {
  maersk:          '#2E86C1',   // Maersk blue
  evergreen:       '#006747',   // Evergreen green
  cosco:           '#004B87',   // COSCO dark blue
  msc:             '#FFD700',   // MSC gold-yellow
  cma_cgm:        '#003DA5',   // CMA CGM blue
  hapagLloyd:     '#FF6600',   // Hapag-Lloyd orange
  one:             '#FF00FF',   // ONE magenta/pink
  hmm:             '#00BFFF',   // HMM sky blue
  yangMing:        '#F5A623',   // Yang Ming orange-amber
  zim:             '#C0C0C0',   // ZIM silver/grey
  generic_red:     '#CC2200',
  generic_blue:    '#1A5276',
  generic_green:   '#1E8449',
  generic_grey:    '#707B7C',
  generic_white:   '#F0F0F0',
  generic_brown:   '#6E4B3A',
  reefer_white:    '#FAFAFA',
  tank_silver:     '#C0C0C0',
} as const satisfies Record<string, string>
```

---

## 2. Container Logical Attributes

### Core identity

```ts
/**
 * ISO 6346 container ID: 4-letter owner code (3 alpha + 1 equipment category)
 * followed by 6 digits and 1 check digit.  Example: MSKU1234567
 */
export interface ContainerIdentity {
  containerId: string        // ISO 6346 e.g. 'MSKU1234567'
  ownerCode: string          // 3 uppercase alpha e.g. 'MSK'
  operatorCode: string       // carrier SCAC e.g. 'MAEU'
  equipmentCategory: 'U' | 'J' | 'Z'  // U = freight, J = detachable, Z = trailer
  sizeCode: ContainerSizeCode
  visualVariant: ContainerVisualVariant
}
```

### Commercial routing

```ts
export interface CommercialRouting {
  shipmentId: string | null
  bookingReference: string | null
  billOfLadingReference: string | null
  /** UN/LOCODE 5-char port codes */
  pol: string                // port of loading e.g. 'GBFXT'
  pod: string                // port of discharge e.g. 'SGSIN'
  transshipmentPorts: string[]  // e.g. ['NLRTM', 'LKCMB']
  finalDestination: string | null  // e.g. 'CNSHA'
  serviceCode: string | null       // liner service e.g. 'AE7'
}
```

### Terminal visit

```ts
export type VisitType =
  | 'import'
  | 'export'
  | 'transshipment'
  | 'empty_reposition'
  | 'restow'

export type TransportMode = 'truck' | 'rail' | 'barge' | 'vessel'

export interface TerminalVisit {
  visitId: string
  terminalId: string
  visitType: VisitType
  arrivalMode: TransportMode
  departureMode: TransportMode
  /** ISO 8601 timestamps */
  arrivalTimestamp: string | null
  departureTimestamp: string | null
}
```

### Lifecycle state

```ts
export type ContainerLifecycleState =
  | 'expected'
  | 'pre_advised'
  | 'arrived_terminal'
  | 'received'
  | 'grounded_in_yard'
  | 'held'
  | 'available_for_planning'
  | 'assigned_to_transport_leg'
  | 'staged_for_loading'
  | 'loaded'
  | 'departed_terminal'
  | 'rolled'
  | 'misrouted'
  | 'cancelled'
```

### Transport leg

```ts
export interface TransportLeg {
  mode: TransportMode | 'yard' | 'gate'
  legId: string
  voyageId: string | null
  callId: string | null
  vehicleOrVesselId: string | null
}
```

### Planning windows & priority

```ts
export interface PlanningInfo {
  receivingWindowOpen: string | null   // ISO 8601
  receivingWindowClose: string | null
  documentationCutoff: string | null
  vgmCutoff: string | null
  dgCutoff: string | null
  readyToLoad: boolean
  /** 0 = lowest, 100 = highest */
  priorityScore: number
}
```

### Hold flags

```ts
export interface ContainerHolds {
  customsHold: boolean
  documentationHold: boolean
  dgHold: boolean
  inspectionHold: boolean
  paymentHold: boolean
  terminalHold: boolean
  lineHold: boolean
  missingVgm: boolean
  damageHold: boolean
}

export function noHolds(): ContainerHolds {
  return {
    customsHold: false,
    documentationHold: false,
    dgHold: false,
    inspectionHold: false,
    paymentHold: false,
    terminalHold: false,
    lineHold: false,
    missingVgm: false,
    damageHold: false,
  }
}

export function hasAnyHold(h: ContainerHolds): boolean {
  return Object.values(h).some(Boolean)
}
```

### Stowage position

```ts
/**
 * Bay/Row/Tier format for vessel stowage.
 * Bay: 3-digit odd (on-deck grouping), Row: 2-digit, Tier: 2-digit.
 * Example: '034/10/84'  → Bay 034, Row 10, Tier 84 (high on-deck).
 */
export interface StowageInfo {
  actualSlot: string | null
  plannedSlot: string | null
  loadListReference: string | null
  restowRequired: boolean
}
```

### Unified container entity

```ts
export interface ContainerEntity {
  identity: ContainerIdentity
  physicalSpec: ContainerPhysicalSpec
  routing: CommercialRouting
  visit: TerminalVisit
  state: ContainerLifecycleState
  transportLeg: TransportLeg | null
  planning: PlanningInfo
  holds: ContainerHolds
  stowage: StowageInfo
  hazmat: HazmatInfo | null            // see §3
  /** Verified gross mass in kg (SOLAS requirement) */
  vgmKg: number | null
  /** Actual gross weight in kg */
  grossWeightKg: number
  sealNumbers: string[]
  /** Human-readable notes from planners or inspectors */
  remarks: string[]
  createdAt: string                    // ISO 8601
  updatedAt: string                    // ISO 8601
}
```

---

## 3. Hazardous Cargo Model

### IMDG class enum

```ts
export type ImdgClass =
  | '1'     // Explosives
  | '1.1' | '1.2' | '1.3' | '1.4' | '1.5' | '1.6'
  | '2.1'   // Flammable gases
  | '2.2'   // Non-flammable, non-toxic gases
  | '2.3'   // Toxic gases
  | '3'     // Flammable liquids
  | '4.1'   // Flammable solids
  | '4.2'   // Spontaneously combustible
  | '4.3'   // Dangerous when wet
  | '5.1'   // Oxidising substances
  | '5.2'   // Organic peroxides
  | '6.1'   // Toxic substances
  | '6.2'   // Infectious substances
  | '7'     // Radioactive
  | '8'     // Corrosive
  | '9'     // Miscellaneous dangerous goods
```

### Segregation profiles

```ts
export type SegregationProfile =
  | 'general_dg'
  | 'fire_risk_dg'
  | 'oxidizer_dg'
  | 'toxic_dg'
  | 'explosive_dg'
  | 'reactive_dg'
  | 'corrosive_dg'
  | 'marine_pollutant_only'

/** Map from IMDG class to default segregation profile */
export const IMDG_SEGREGATION_MAP: Record<string, SegregationProfile> = {
  '1':   'explosive_dg',
  '1.1': 'explosive_dg',
  '1.2': 'explosive_dg',
  '1.3': 'explosive_dg',
  '1.4': 'explosive_dg',
  '1.5': 'explosive_dg',
  '1.6': 'explosive_dg',
  '2.1': 'fire_risk_dg',
  '2.2': 'general_dg',
  '2.3': 'toxic_dg',
  '3':   'fire_risk_dg',
  '4.1': 'fire_risk_dg',
  '4.2': 'reactive_dg',
  '4.3': 'reactive_dg',
  '5.1': 'oxidizer_dg',
  '5.2': 'oxidizer_dg',
  '6.1': 'toxic_dg',
  '6.2': 'toxic_dg',
  '7':   'general_dg',
  '8':   'corrosive_dg',
  '9':   'general_dg',
}
```

### Packing group

```ts
export type PackingGroup = 'I' | 'II' | 'III'
// I   = high danger
// II  = medium danger
// III = low danger
```

### Hazmat incident state

```ts
export type HazmatIncidentState =
  | 'normal'
  | 'under_review'
  | 'suspect_damage'
  | 'suspect_leak'
  | 'confirmed_leak'
  | 'fire_or_smoke_detected'
  | 'evacuation_zone_active'
```

### Hazmat info interface

```ts
export interface HazmatFault {
  faultId: string
  description: string
  reportedAt: string            // ISO 8601
  resolvedAt: string | null
}

export interface HazmatInfo {
  isHazardous: true
  unNumber: string                 // UN four-digit code e.g. 'UN1203'
  properShippingName: string       // e.g. 'GASOLINE' or 'PETROL'
  imdgClass: ImdgClass
  subsidiaryRisks: ImdgClass[]
  packingGroup: PackingGroup | null
  marinePollutant: boolean
  flashpointC: number | null       // degrees Celsius; null if not applicable
  segregationProfile: SegregationProfile
  requiresDedicatedZone: boolean
  dgDeclarationReceived: boolean
  acceptanceStatus: 'pending' | 'accepted' | 'rejected' | 'conditional'
  faults: HazmatFault[]
  incidentState: HazmatIncidentState
}
```

---

## 4. Container Lifecycle State Machine

### State transition rules

```
expected
  → pre_advised            (EDI/booking received)
  → cancelled              (booking cancelled before arrival)

pre_advised
  → arrived_terminal       (vessel/truck/rail/barge arrives at terminal)
  → cancelled

arrived_terminal
  → received               (container physically discharged / gate-in completed)

received
  → grounded_in_yard       (placed in yard block by RTG/straddle)

grounded_in_yard
  → held                   (any hold flag set to true)
  → available_for_planning (no holds, documentation complete, VGM present)
  → misrouted              (wrong terminal or wrong visit detected)

held
  → grounded_in_yard       (all holds released → re-evaluate)
  → cancelled              (terminal/line decides to reject)

available_for_planning
  → assigned_to_transport_leg  (planner assigns to outbound voyage/truck/rail)
  → held                       (new hold applied)
  → rolled                     (missed cutoff or vessel full)

assigned_to_transport_leg
  → staged_for_loading     (moved to quay transfer zone or gate staging)
  → rolled                 (bumped from load list)
  → held                   (late hold)

staged_for_loading
  → loaded                 (QC picks and places on vessel / loaded on truck-rail)
  → rolled                 (last-minute bump)

loaded
  → departed_terminal      (vessel sails / truck gates out / train departs)

rolled
  → available_for_planning (re-enter planning pool for next opportunity)
  → cancelled

departed_terminal
  (terminal state — no further transitions within this terminal visit)

misrouted
  → expected               (new visit created at correct terminal)
  → cancelled

cancelled
  (terminal state)
```

### Visit type inference

```ts
export function inferVisitType(
  arrivalMode: TransportMode,
  departureMode: TransportMode,
): VisitType {
  if (arrivalMode === 'vessel' && departureMode !== 'vessel') return 'import'
  if (arrivalMode !== 'vessel' && departureMode === 'vessel') return 'export'
  if (arrivalMode === 'vessel' && departureMode === 'vessel') return 'transshipment'
  return 'empty_reposition'
}
```

### Hold/release evaluation

```ts
export function evaluateHoldsAndTransition(
  container: ContainerEntity,
): ContainerLifecycleState {
  if (container.state !== 'grounded_in_yard' && container.state !== 'held') {
    return container.state
  }
  if (hasAnyHold(container.holds)) {
    return 'held'
  }
  if (container.holds.missingVgm || container.vgmKg === null) {
    return 'held'
  }
  return 'available_for_planning'
}
```

### Priority scoring formula

```ts
/**
 * Compute a planning priority score (0–100).
 * Higher = should be planned sooner.
 */
export function computePriorityScore(
  container: ContainerEntity,
  now: Date,
): number {
  let score = 50 // baseline

  // Urgency: closer to cutoff → higher score
  if (container.planning.documentationCutoff) {
    const hoursUntilCutoff =
      (new Date(container.planning.documentationCutoff).getTime() - now.getTime()) / 3_600_000
    if (hoursUntilCutoff < 6) score += 20
    else if (hoursUntilCutoff < 12) score += 15
    else if (hoursUntilCutoff < 24) score += 10
    else if (hoursUntilCutoff < 48) score += 5
  }

  // Hazmat gets slight bump
  if (container.hazmat) score += 5

  // Reefer gets slight bump (perishables)
  if (container.identity.visualVariant === 'reefer') score += 5

  // Transshipment gets priority (tight connections)
  if (container.visit.visitType === 'transshipment') score += 10

  // Previously rolled containers get priority
  if (container.state === 'rolled') score += 15

  return Math.min(100, Math.max(0, score))
}
```

---

## 5. Example Factory Functions

```ts
let _seq = 1000000

function nextContainerId(prefix = 'MSKU'): string {
  _seq++
  const digits = String(_seq).padStart(7, '0').slice(0, 7)
  return `${prefix}${digits}`
}

function isoNow(): string {
  return new Date().toISOString()
}

export function createDefaultContainer(
  overrides: Partial<ContainerEntity> = {},
): ContainerEntity {
  const now = isoNow()
  const base: ContainerEntity = {
    identity: {
      containerId: nextContainerId(),
      ownerCode: 'MSK',
      operatorCode: 'MAEU',
      equipmentCategory: 'U',
      sizeCode: '40HC',
      visualVariant: 'dry_van',
    },
    physicalSpec: { ...CONTAINER_SPECS['40HC'] },
    routing: {
      shipmentId: null,
      bookingReference: null,
      billOfLadingReference: null,
      pol: 'GBFXT',
      pod: 'NLRTM',
      transshipmentPorts: [],
      finalDestination: null,
      serviceCode: null,
    },
    visit: {
      visitId: crypto.randomUUID(),
      terminalId: 'GBFXT-T1',
      visitType: 'export',
      arrivalMode: 'truck',
      departureMode: 'vessel',
      arrivalTimestamp: null,
      departureTimestamp: null,
    },
    state: 'expected',
    transportLeg: null,
    planning: {
      receivingWindowOpen: null,
      receivingWindowClose: null,
      documentationCutoff: null,
      vgmCutoff: null,
      dgCutoff: null,
      readyToLoad: false,
      priorityScore: 50,
    },
    holds: noHolds(),
    stowage: {
      actualSlot: null,
      plannedSlot: null,
      loadListReference: null,
      restowRequired: false,
    },
    hazmat: null,
    vgmKg: null,
    grossWeightKg: 14500,
    sealNumbers: [],
    remarks: [],
    createdAt: now,
    updatedAt: now,
  }

  return { ...base, ...overrides }
}

export function createImportContainer(
  overrides: Partial<ContainerEntity> = {},
): ContainerEntity {
  return createDefaultContainer({
    identity: {
      containerId: nextContainerId('EGLV'),
      ownerCode: 'EGL',
      operatorCode: 'EGLV',
      equipmentCategory: 'U',
      sizeCode: '40HC',
      visualVariant: 'dry_van',
    },
    routing: {
      shipmentId: 'SHP-2026-04821',
      bookingReference: 'BKG9938271',
      billOfLadingReference: 'EGLV-BOL-11234',
      pol: 'SGSIN',
      pod: 'GBFXT',
      transshipmentPorts: [],
      finalDestination: 'GBLIV',
      serviceCode: 'AEX1',
    },
    visit: {
      visitId: crypto.randomUUID(),
      terminalId: 'GBFXT-T1',
      visitType: 'import',
      arrivalMode: 'vessel',
      departureMode: 'truck',
      arrivalTimestamp: '2026-04-02T06:30:00Z',
      departureTimestamp: null,
    },
    state: 'arrived_terminal',
    vgmKg: 28400,
    grossWeightKg: 28400,
    sealNumbers: ['SL90482'],
    ...overrides,
  })
}

export function createExportContainer(
  overrides: Partial<ContainerEntity> = {},
): ContainerEntity {
  return createDefaultContainer({
    identity: {
      containerId: nextContainerId('MSKU'),
      ownerCode: 'MSK',
      operatorCode: 'MAEU',
      equipmentCategory: 'U',
      sizeCode: '40ST',
      visualVariant: 'dry_van',
    },
    physicalSpec: { ...CONTAINER_SPECS['40ST'] },
    routing: {
      shipmentId: 'SHP-2026-07710',
      bookingReference: 'BKG5501984',
      billOfLadingReference: null,
      pol: 'GBFXT',
      pod: 'USNYC',
      transshipmentPorts: ['NLRTM'],
      finalDestination: 'USCHI',
      serviceCode: 'TA2',
    },
    visit: {
      visitId: crypto.randomUUID(),
      terminalId: 'GBFXT-T1',
      visitType: 'export',
      arrivalMode: 'truck',
      departureMode: 'vessel',
      arrivalTimestamp: '2026-03-28T14:15:00Z',
      departureTimestamp: null,
    },
    state: 'grounded_in_yard',
    planning: {
      receivingWindowOpen: '2026-03-26T00:00:00Z',
      receivingWindowClose: '2026-03-30T18:00:00Z',
      documentationCutoff: '2026-03-30T12:00:00Z',
      vgmCutoff: '2026-03-30T12:00:00Z',
      dgCutoff: null,
      readyToLoad: false,
      priorityScore: 55,
    },
    vgmKg: 18200,
    grossWeightKg: 18200,
    sealNumbers: ['MSK-8847123'],
    ...overrides,
  })
}

export function createTransshipmentContainer(
  overrides: Partial<ContainerEntity> = {},
): ContainerEntity {
  return createDefaultContainer({
    identity: {
      containerId: nextContainerId('CMAU'),
      ownerCode: 'CMA',
      operatorCode: 'CMAU',
      equipmentCategory: 'U',
      sizeCode: '20ST',
      visualVariant: 'dry_van',
    },
    physicalSpec: { ...CONTAINER_SPECS['20ST'] },
    routing: {
      shipmentId: 'SHP-2026-33102',
      bookingReference: 'BKG7761032',
      billOfLadingReference: 'CMAU-BOL-89921',
      pol: 'CNSHA',
      pod: 'DEHAM',
      transshipmentPorts: ['SGSIN', 'GBFXT'],
      finalDestination: 'DEHAM',
      serviceCode: 'FAL1',
    },
    visit: {
      visitId: crypto.randomUUID(),
      terminalId: 'GBFXT-T1',
      visitType: 'transshipment',
      arrivalMode: 'vessel',
      departureMode: 'vessel',
      arrivalTimestamp: '2026-04-01T03:00:00Z',
      departureTimestamp: null,
    },
    state: 'received',
    transportLeg: {
      mode: 'vessel',
      legId: 'LEG-FAL1-GBFXT-DEHAM',
      voyageId: 'FAL1-2026-W14',
      callId: 'GBFXT-FAL1-0401',
      vehicleOrVesselId: 'CMA CGM MARCO POLO',
    },
    vgmKg: 22100,
    grossWeightKg: 22100,
    sealNumbers: ['CMA-TT-44810'],
    ...overrides,
  })
}

export function createHazardousContainer(
  overrides: Partial<ContainerEntity> = {},
): ContainerEntity {
  return createDefaultContainer({
    identity: {
      containerId: nextContainerId('HLCU'),
      ownerCode: 'HLC',
      operatorCode: 'HLCU',
      equipmentCategory: 'U',
      sizeCode: '20ST',
      visualVariant: 'dry_van',
    },
    physicalSpec: { ...CONTAINER_SPECS['20ST'] },
    routing: {
      shipmentId: 'SHP-2026-DG-0091',
      bookingReference: 'BKG-DG-22871',
      billOfLadingReference: 'HLCU-BOL-DG-4410',
      pol: 'GBFXT',
      pod: 'NLRTM',
      transshipmentPorts: [],
      finalDestination: 'DEHAM',
      serviceCode: 'NE2',
    },
    visit: {
      visitId: crypto.randomUUID(),
      terminalId: 'GBFXT-T1',
      visitType: 'export',
      arrivalMode: 'truck',
      departureMode: 'vessel',
      arrivalTimestamp: '2026-03-29T09:00:00Z',
      departureTimestamp: null,
    },
    state: 'grounded_in_yard',
    planning: {
      receivingWindowOpen: '2026-03-27T00:00:00Z',
      receivingWindowClose: '2026-03-31T12:00:00Z',
      documentationCutoff: '2026-03-31T06:00:00Z',
      vgmCutoff: '2026-03-31T06:00:00Z',
      dgCutoff: '2026-03-30T18:00:00Z',
      readyToLoad: false,
      priorityScore: 65,
    },
    hazmat: {
      isHazardous: true,
      unNumber: 'UN1203',
      properShippingName: 'GASOLINE / PETROL',
      imdgClass: '3',
      subsidiaryRisks: [],
      packingGroup: 'II',
      marinePollutant: true,
      flashpointC: -43,
      segregationProfile: 'fire_risk_dg',
      requiresDedicatedZone: true,
      dgDeclarationReceived: true,
      acceptanceStatus: 'accepted',
      faults: [],
      incidentState: 'normal',
    },
    vgmKg: 24000,
    grossWeightKg: 24000,
    sealNumbers: ['HLC-DG-88712', 'HLC-DG-88713'],
    remarks: ['DG Class 3 — dedicated hazmat zone required', 'Marine pollutant placard applied'],
    ...overrides,
  })
}
```

---

## 6. Yard Grouping Heuristic

When deciding which containers to ground near each other in the yard, use this scoring function. Higher scores mean the containers should be grouped together.

### Score formula

| Factor                    | Weight |
|---------------------------|--------|
| Same outbound voyage      | 5      |
| Same port of discharge    | 3      |
| Same liner service        | 2      |
| Same cutoff time bucket   | 4      |
| Same hazard zone          | 4      |
| Same departure mode       | 3      |

**Maximum pair score: 21**

### Implementation

```ts
export interface YardGroupingFactors {
  outboundVoyageId: string | null
  pod: string
  serviceCode: string | null
  cutoffBucket: string | null   // e.g. '2026-03-30-AM', '2026-03-30-PM'
  hazardZone: string | null     // segregation profile or null
  departureMode: TransportMode
}

export function computeYardGroupingScore(
  a: YardGroupingFactors,
  b: YardGroupingFactors,
): number {
  let score = 0

  if (a.outboundVoyageId && a.outboundVoyageId === b.outboundVoyageId) score += 5
  if (a.pod === b.pod) score += 3
  if (a.serviceCode && a.serviceCode === b.serviceCode) score += 2
  if (a.cutoffBucket && a.cutoffBucket === b.cutoffBucket) score += 4
  if (a.hazardZone && a.hazardZone === b.hazardZone) score += 4
  if (a.departureMode === b.departureMode) score += 3

  return score
}

/**
 * Derive a cutoff bucket string from a cutoff ISO timestamp.
 * Buckets are half-day: YYYY-MM-DD-AM or YYYY-MM-DD-PM.
 */
export function cutoffToBucket(cutoffIso: string | null): string | null {
  if (!cutoffIso) return null
  const d = new Date(cutoffIso)
  const date = d.toISOString().slice(0, 10) // 'YYYY-MM-DD'
  const half = d.getUTCHours() < 12 ? 'AM' : 'PM'
  return `${date}-${half}`
}

/**
 * Extract yard grouping factors from a ContainerEntity for pairwise comparison.
 */
export function extractGroupingFactors(c: ContainerEntity): YardGroupingFactors {
  return {
    outboundVoyageId: c.transportLeg?.voyageId ?? null,
    pod: c.routing.pod,
    serviceCode: c.routing.serviceCode,
    cutoffBucket: cutoffToBucket(c.planning.documentationCutoff),
    hazardZone: c.hazmat?.segregationProfile ?? null,
    departureMode: c.visit.departureMode,
  }
}
```

### Usage example

```ts
const containers: ContainerEntity[] = [
  createExportContainer(),
  createExportContainer({ routing: { ...createExportContainer().routing, pod: 'USNYC' } }),
  createHazardousContainer(),
]

// Find best grouping partner for the first container
const factors = containers.map(extractGroupingFactors)
const scores = factors.slice(1).map((f, i) => ({
  index: i + 1,
  score: computeYardGroupingScore(factors[0], f),
}))
scores.sort((a, b) => b.score - a.score)
// scores[0] is the best grouping partner
```

---

## Quick Reference: Common Port Codes

| Code    | Port                     |
|---------|--------------------------|
| GBFXT   | Felixstowe, UK           |
| GBSOU   | Southampton, UK          |
| GBLGP   | London Gateway, UK       |
| NLRTM   | Rotterdam, Netherlands   |
| DEHAM   | Hamburg, Germany          |
| BEANR   | Antwerp, Belgium         |
| SGSIN   | Singapore                |
| CNSHA   | Shanghai, China          |
| CNYTN   | Yantian, China           |
| HKHKG   | Hong Kong                |
| USNYC   | New York, USA            |
| USLAX   | Los Angeles, USA         |
| USCHI   | Chicago, USA (rail)      |
| USSAV   | Savannah, USA            |
| AEJEA   | Jebel Ali, UAE           |
| LKCMB   | Colombo, Sri Lanka       |

## Quick Reference: Example Container ID Prefixes

| Prefix | Line              |
|--------|-------------------|
| MSKU   | Maersk            |
| EGLV   | Evergreen          |
| CMAU   | CMA CGM           |
| HLCU   | Hapag-Lloyd        |
| MEDU   | MSC                |
| ONEY   | ONE                |
| YMLU   | Yang Ming          |
| ZIMU   | ZIM                |
| COSCO  | COSCO              |
| HMMU   | HMM                |
