/**
 * Scenario config: the small, serialisable, reproducible description of a
 * run. Fixtures are JSON files of this shape, produced by the typed
 * `ScenarioBuilder`. All values are SI (metres, seconds, m/s, m/s²).
 *
 * Vessel bay plans and their containers are NOT stored here: they are
 * generated from the vessel table and the seed (`scenario/bayPlan.ts`).
 *
 * Bump SCENARIO_SCHEMA_VERSION on breaking changes and add a migration
 * (persistence ticket TT-17).
 */
import type { DecisionsConfig } from '../engine/decisions/types'
import type { AxisProfile } from '../engine/kinematics'

export const SCENARIO_SCHEMA_VERSION = 1

export type ContainerSize = '20' | '40' | '40HC'

export interface StsKinematics {
  gantry: AxisProfile
  trolley: AxisProfile
  hoistLoaded: AxisProfile
  hoistEmpty: AxisProfile
  /** Spreader twist-lock lock time (s). */
  lockS: number
  /** Spreader twist-lock unlock time (s). */
  unlockS: number
}

/** SHC (shuttle carrier) kinematics. Drive axes are along X or Z; `lift` raises the box. */
export interface ShcKinematics {
  driveEmpty: AxisProfile
  driveLoaded: AxisProfile
  lift: AxisProfile
  /** Height the box is lifted to for travel (m, box bottom above ground). */
  liftHeightM: number
  /** Spreader twist-lock lock time (s). */
  lockS: number
  /** Spreader twist-lock unlock time (s). */
  unlockS: number
  /** Assumed turn radius (m) for cornering at speed; default `DEFAULT_SHC_CORNER`; 0 = stop at every turn. */
  cornerRadiusM?: number
  /** Lateral acceleration (m/s²) the SHC tolerates in a turn; with the radius it caps the corner speed. */
  maxLateralAccel?: number
}

export interface ShcConfig {
  id: string
}

/** ASC (automated stacking crane) kinematics: gantry along the block (Z), trolley across the rows (X), hoist (Y). */
export interface AscKinematics {
  gantry: AxisProfile
  trolley: AxisProfile
  hoistLoaded: AxisProfile
  hoistEmpty: AxisProfile
  /** Spreader twist-lock lock time (s). */
  lockS: number
  /** Spreader twist-lock unlock time (s). */
  unlockS: number
}

/**
 * A yard block, perpendicular to the quay: 8 rows across X (fixed by the
 * 25.4 m ASC span), `bays` 20 ft bays along Z, `tiers` high. WTP pads sit at
 * the waterside end, transfer stalls (truck handover, TT-13) at the landside end.
 */
export interface BlockConfig {
  id: string
  /** Centre of the block along the quay (m, X axis). */
  x: number
  /** WTP pads at the block's waterside end (builder default 5). */
  wtpPads: number
  /** 20 ft bays along the block (default 20). */
  bays?: number
  /** Maximum stack height (default 5). */
  tiers?: number
  /** Transfer stalls at the landside end (default 5; used by TT-13). */
  transferStalls?: number
  /**
   * Rows (1-8, counted across X like the yard's other row numbers) with reefer plugs (R19). Reefers are only
   * allocated to these rows, at most `REEFER_MAX_TIERS` high. Default none: a block without powered rows takes no
   * reefer. The TTI preset values are unverified (`knowledge-base/dk_ops__tti_algeciras_operations.md`).
   */
  poweredRows?: number[]
}

export interface YardConfig {
  blocks: BlockConfig[]
  /**
   * ASCs per block (TT-08): 1 (default) or 2 sharing the block's rails
   * (waterside `<block>-ASC1`, landside `<block>-ASC2`).
   */
  ascsPerBlock?: 1 | 2
}

/**
 * Waterside lane-graph geometry (m). All optional; defaults in
 * `DEFAULT_APRON_LAYOUT` (engine/laneGraph.ts).
 */
export interface ApronLayout {
  /** Z of the westbound (-X) apron lane, landside of the STS backreach legs. */
  westboundZ: number
  /** Z of the eastbound (+X) apron lane. */
  eastboundZ: number
  /** Z of the clear position an SHC reverses to after a WTP drop. */
  padClearZ: number
  /** Z of the SHC parking spots. */
  parkingZ: number
  /** Z of the WTP pad centres (boxes lie along Z). */
  wtpZ: number
  /** Spacing of WTP pads across a block (m). */
  padPitchM: number
  /** Spacing along X of the spine stations where SHCs enter and leave the STS lanes. */
  stationSpacingM: number
  /** Spacing of parking spots along X. */
  parkingPitchM: number
  /** Distance either side of a conflict point that a passing vehicle reserves. */
  zoneClearanceM: number
  /** Z of the queue area spots (TT-R12), landside of the pad clear positions. */
  queueZ: number
  /** Spacing of the spots of one queue area along X. */
  queuePitchM: number
}

/**
 * SHC queue areas (TT-R12): lane-graph spots where an SHC waits when its pickup or drop-off is not ready,
 * separate from parking spots, ground positions and WTP pads. One area per STS (empty SHCs wait for work)
 * and one per block (SHCs carrying a box wait for a free WTP pad). Absent = no queue areas (the old behaviour).
 */
export interface QueueAreasConfig {
  /** Spots in the queue area near each STS (0 = none). */
  stsCapacity?: number
  /** Spots in the queue area near each block's WTP pads (0 = none). */
  blockCapacity?: number
  /**
   * Pre-dispatch lead margin (s, TT-R13; default `DEFAULT_PREDISPATCH_MARGIN_S`). With the `predispatch` strategy an SHC
   * is sent to a queue area when a box there is predicted ready within the SHC's travel time plus this margin.
   */
  predispatchMarginS?: number
}

/** Default pre-dispatch margin (s). */
export const DEFAULT_PREDISPATCH_MARGIN_S = 15

/** Subsystem modes: real behaviour, an "instant" stub raising the same events, or off. */
export type SubsystemMode = 'real' | 'instant' | 'off'

export interface SubsystemModes {
  /**
   * STS cranes (V11-10; default real when STS cranes exist). instant: every crane motion, lock and unlock takes
   * zero time and raises the same events; off: no crane work, vessels berth and leave with their cargo.
   */
  quay?: SubsystemMode
  /**
   * Berth allocation (V11-10; default real). instant: zero mooring and unmooring time; off: no `berthAllocation`
   * decision, each vessel takes the leftmost free stretch (first fit) at once.
   */
  berth?: SubsystemMode
  /**
   * The yard as a whole (V11-10; default real when blocks exist). instant: the ASC runs instant (unless set
   * explicitly); off: no yard (ASC and landside off, boxes stay on the pads).
   */
  yard?: SubsystemMode
  /** SHC horizontal transport (default real when SHCs are configured). */
  shc?: SubsystemMode
  /** ASC yard cranes (default real when SHCs and blocks exist). */
  asc?: SubsystemMode
  /** Landside: trucks, gate and transfer stalls (TT-13; default real when `landside` is configured and a block has stalls). */
  landside?: SubsystemMode
}

/** STS cranes are listed in rail order (ascending `gantryX`); they never pass each other. */
export interface StsConfig {
  id: string
  /** Initial gantry position along the quay (m, X axis). */
  gantryX: number
  /** Number of STS ground positions (lanes) under the crane. */
  groundPositions: number
}

/** Vessel size classes, smallest first (dimensions in `VESSEL_CLASSES`, `vesselClasses.ts`). */
export type VesselSizeClass = 'feeder' | 'feedermax' | 'panamax' | 'neo-panamax' | 'ulcv'

/** Relative weights (any non-negative numbers; normalised when drawn). */
export type Weights<K extends string> = Partial<Record<K, number>>

/**
 * One vessel call (a row of the setup dialog's vessel table). Its bay plan
 * (slots and discharge boxes) is generated from it and the scenario seed when
 * the simulation starts. The berth position and the STS cranes are chosen by
 * the berth-allocation and crane-split decision points.
 */
export interface VesselConfig {
  id: string
  name: string
  /**
   * Operator (a key of `LINE_OWNER_PREFIX`): picks the hull livery. Optional;
   * without it the line is read from the name's style (`vesselLine`). The engine ignores it.
   */
  line?: string
  /** Arrival at the port (s from scenario start). The vessel berths, or waits at anchorage. */
  arrivalS: number
  sizeClass: VesselSizeClass
  /** Boxes discharged here (real boxes in the bay plan). */
  discharge: number
  /** Export boxes to load here (slots reserved in the bay plan; loading comes in TT-10). */
  load: number
  /** Transshipment boxes to load here (slots reserved in the bay plan). */
  transshipment: number
  /** Maximum number of STS cranes working this vessel at once. */
  maxSts: number
  /** Size mix of this vessel's discharge boxes (default: `cargo.sizeMix`). */
  sizeMix?: Weights<ContainerSize>
  /**
   * How many of the `discharge` boxes are transshipment boxes (TT-11, default 0): the rest are
   * imports. With the load flow on, each one is linked to an onward vessel that loads it.
   */
  dischargeTransshipment?: number
  /**
   * Stow the discharge boxes on deck only, as far as the deck has room (default false: shared out between hold and
   * deck in proportion to their tiers). A vessel with nothing in its hold opens no hatch (TT-R09).
   */
  deckOnly?: boolean
  /**
   * Empty containers this vessel loads (TT-11): N empties of a size and shipping line per entry.
   * Releasing the work package that carries them raises "empties required" and asks the
   * `emptyAllocation` decision point which empties in the yard go.
   */
  empties?: EmptyRequirement[]
}

/** A load requirement for empty containers of one size and shipping line. */
export interface EmptyRequirement {
  size: ContainerSize
  /** Shipping line (a key of `LINE_OWNER_PREFIX`). */
  line: string
  count: number
  /**
   * ISO type the empties must have (e.g. `22G1`, `42G1`, `45G1`; spec #106). Default: the dry-box code of `size`.
   * The `iso-type-best-position` strategy matches on it; the older strategies match on size and line.
   */
  isoType?: string
}

/** A vessel's flow mix as shares of its box moves (percent, summing to 100). */
export interface FlowMix {
  import: number
  export: number
  transshipment: number
}

/** Dwell-time distribution (s). `lognormal`: median and the sigma of the underlying normal. */
export type DwellDistribution =
  | { kind: 'fixed'; s: number }
  | { kind: 'uniform'; minS: number; maxS: number }
  | { kind: 'lognormal'; medianS: number; sigma: number }

/** Transshipment boxes dwell in the yard before they load onto their onward vessel (TT-11). */
export interface TransshipmentConfig {
  dwell: DwellDistribution
}

/** Why a box is on the terminal (spec #106). STORAGE boxes are always empty; an allocated empty becomes EXPORT. */
export type TransitDirection = 'IMPORT' | 'EXPORT' | 'TRANSSHIPMENT' | 'STORAGE'

/** The scenario's port rotation (spec #106): the service's calls in order, as UN/LOCODEs, and which one is this terminal. */
export interface PortRotation {
  /** This terminal's UN/LOCODE; must be one of `ports`. */
  terminal: string
  /** The rotation in call order (cyclic), including `terminal`. POL and POD of every box come from it. */
  ports: string[]
}

/** Laden cargo weight of one size: a lognormal around `medianKg` (sigma of the underlying normal), clipped at `maxKg`. */
export interface CargoWeightSpec {
  medianKg: number
  sigma: number
  maxKg: number
}

/** Gross-weight band limits (kg): up to `lightMaxKg` is LIGHT, up to `mediumMaxKg` MEDIUM, above it HEAVY. */
export interface WeightClassBands {
  lightMaxKg: number
  mediumMaxKg: number
}

/** Work order within a package: `as-today` (stack geometry only) or `pod-weight` (POD- and weight-aware soft preferences). */
export type VesselOrdering = 'as-today' | 'pod-weight'

export interface VesselPlanningConfig {
  /** Default `pod-weight` (since ENGINE_VERSION 0.25.0); `as-today` is the rollback. */
  ordering?: VesselOrdering
}

/**
 * Stored container properties (spec #106). Every field optional; the defaults in `scenario/containerProps.ts`
 * apply. All draws come from their own RNG stream (keyed by seed and container id), so adding or changing these
 * never moves any other draw.
 */
export interface ContainerPropsConfig {
  portRotation?: PortRotation
  /**
   * Direction of an empty box that is discharged but not transshipment: a draw over `IMPORT` (returning empty) and
   * `STORAGE` (stays as a storage empty). Other directions are set by the box's flow, not drawn.
   */
  directionMix?: Weights<TransitDirection>
  cargoWeight?: Partial<Record<ContainerSize, CargoWeightSpec>>
  weightClassBands?: WeightClassBands
  /** Expected dwell by direction, the planned departure of a box with no outbound vessel ETD or truck appointment. */
  expectedDwell?: Partial<Record<TransitDirection, DwellDistribution>>
}

/** Empty containers standing in the yard when the scenario starts (TT-11), by size and line. */
export interface EmptyPoolConfig {
  count: number
  /** Default: `cargo.sizeMix`. */
  sizeMix?: Weights<ContainerSize>
  /** Default: `cargo.lines`. */
  lines?: Weights<string>
  /** Boxes have been in the pool for a uniform 0 to this long (s, default 7 days). */
  maxAgeS?: number
}

/** The continuous quay and its berth/crane rules. */
export interface QuayConfig {
  lengthM: number
  /** Minimum clear distance between two berthed vessels (m). */
  berthGapM: number
  /** From berth allocation to all-fast: pilotage, approach and mooring (s). */
  mooringS: number
  /** From the last move to departure: unmooring (s). */
  unmooringS: number
  /** Minimum distance between the gantry centres of two neighbouring STS (m). */
  stsMinSpacingM: number
  /** STS lift two 20 ft boxes of the same vessel cell together (twin-20). */
  twinLift: boolean
}

/** How discharge boxes are generated. */
export interface CargoConfig {
  /** Shipping lines and their weights (owner prefixes from `LINE_OWNER_PREFIX`). */
  lines: Weights<string>
  sizeMix: Weights<ContainerSize>
  /** Share of empty boxes (0–1). */
  emptyShare: number
  /**
   * Share of the full boxes that are reefers (0-1, default 0), R19. Drawn per box from its container id (a hash,
   * not an RNG stream), so a share of 0 leaves every other draw, and every golden, unchanged.
   */
  reeferShare?: number
}

/**
 * How the yard starts (TT-14).
 * - `prefilled`: filled to `targetPct` of the cells with exports and transshipment boxes booked to the scenario's
 *   vessels, an empty pool and import boxes awaiting pickup, every box placed by the selected yardAllocation strategy.
 * - `warmup`: starts empty; `warmUpS` of truck and vessel activity run first and are excluded from KPIs and end conditions.
 * - `empty`: starts empty; export boxes arrive by truck during the run (needs the landside).
 * Without `yardStart` the legacy start applies (export boxes and the empty pool stacked by `planExportYard`).
 */
export type YardStartMode = 'prefilled' | 'warmup' | 'empty'

export interface YardStartConfig {
  mode: YardStartMode
  /** Pre-fill target, % of the yard's cells (default 60). */
  targetPct?: number
  /** Warm-up length (s, default 48 h). */
  warmUpS?: number
}

export const DEFAULT_YARD_TARGET_PCT = 60
export const DEFAULT_WARM_UP_S = 48 * 3600

export interface EndConditions {
  /** End when this many vessels have departed. */
  vesselsCompleted?: number
  /** End at this sim time (s). */
  simDurationS?: number
  /** End when this many productive moves are done. */
  moves?: number
}

export interface LayoutConfig {
  /** Z of the first STS ground lane (m, yard side positive). */
  stsGroundLaneZ0M: number
  stsGroundLaneSpacingM: number
  /** Spreader travel height for trolley moves (m). */
  stsSafeHoistM: number
  /** Back-off (s) before an STS whose ground-position reply was null asks again (default 30; 0 = only wake on a freed position). */
  stsGroundRetryS?: number
}

export interface ScenarioConfig {
  schemaVersion: typeof SCENARIO_SCHEMA_VERSION
  name: string
  description: string
  seed: number
  /** ISO date-time of sim t = 0. */
  startDateTime: string
  quay: QuayConfig
  layout: LayoutConfig
  kinematics: { sts: StsKinematics; shc?: ShcKinematics; asc?: AscKinematics }
  /** ± % random variation applied to each move's duration (0 = none). */
  moveVariationPct: number
  /** STS cranes in rail order. */
  sts: StsConfig[]
  /** Vessel calls (the vessel table). */
  vessels: VesselConfig[]
  cargo: CargoConfig
  endConditions: EndConditions
  /** SHC fleet (TT-05). Absent or empty = no horizontal transport. */
  shcs?: ShcConfig[]
  /** Yard blocks: WTP pads, stacks and an ASC each (TT-05, TT-06). */
  yard?: YardConfig
  /** How the yard starts (TT-14); optional (legacy start). */
  yardStart?: YardStartConfig
  /** Waterside lane-graph geometry overrides. */
  apron?: Partial<ApronLayout>
  /** SHC queue areas near each STS and each block's WTP pads (TT-R12); optional (none). */
  queueAreas?: QueueAreasConfig
  /** ± % random variation of each SHC trip (driver variability; 0 = none). */
  driverVariabilityPct?: number
  /** Subsystem modes (overridable with `SimulationOptions.subsystems`). */
  subsystems?: SubsystemModes
  /** Decision points: async mode, strategy per decision point, latency injection (optional; defaults apply). */
  decisions?: DecisionsConfig
  /**
   * How the UI displays this scenario (optional; the engine ignores it). Units
   * are display-only: every value in this config stays SI whatever is chosen.
   */
  display?: DisplaySettings
  /** Transshipment dwell (TT-11); optional (default `DEFAULT_TRANSSHIPMENT`). */
  transshipment?: TransshipmentConfig
  /** Empty pool pre-filled into the yard (TT-11); optional. */
  emptyPool?: EmptyPoolConfig
  /** Stored container properties: port rotation, direction mix, cargo weights, weight classes, expected dwell (spec #106); optional. */
  containerProps?: ContainerPropsConfig
  /**
   * Share (0-1, default 0) of each vessel's bays set aside as ROB (remain on board) bays (spec #106): display-only
   * boxes for later ports, never worked here. Which bays come from the property RNG stream (`scenario/robBays.ts`).
   */
  robBayFraction?: number
  /** Fill level (0-1, default 0.7) of the ROB bays: share of their hold and deck cells that hold a box. */
  robFill?: number
  /**
   * Arrival stow (spec #134, #148): target share (0-1) of a vessel's cells that hold a box on arrival (discharge boxes
   * plus ROB boxes). Absent = none: the vessel carries its discharge boxes only, plus whatever `robBayFraction` adds.
   * With it, `scenario/robBays.ts` sets aside as many extra ROB bays as the vessel's own box counts leave room for,
   * so a small call still looks like a normally stowed ship. Presets set it; fixtures keep their exact boxes.
   */
  arrivalFill?: number
  /** Work packages (TT-10); optional. */
  workPackages?: { releaseAhead?: number }
  /** Vessel Planning options (spec #106); optional. */
  vesselPlanning?: VesselPlanningConfig
  /**
   * Empty allocation options (spec #106); optional. `matchLine: true` restricts the `iso-type-best-position`
   * strategy to empties of the requesting line (default false: any line's empty of the right ISO type may go).
   */
  emptyAllocation?: { matchLine?: boolean }
  /**
   * Hatch covers (TT-R09); optional. Panel counts, sizes and weights come from the vessel class
   * (`VESSEL_CLASSES[...].hatch`); these override the timings and the laydown stack limit for every class.
   * `enabled: false` leaves the hatch covers out (no hatch moves, the old discharge-then-load work order).
   */
  hatch?: HatchConfig
  /** KPI bucket clock (optional; defaults come from `startDateTime`, see `engine/kpi/clock.ts`). */
  kpi?: KpiClockConfig
  /** Landside: external trucks, gate and transfer stalls (TT-13); optional (no trucks without it). */
  landside?: LandsideConfig
}

/** Scenario-level hatch cover settings (TT-R09). All optional; the vessel class supplies the defaults. */
export interface HatchConfig {
  /** Default true. */
  enabled?: boolean
  /** Lashing release delay (s) once the deck boxes above a hatch panel are gone. */
  lashingReleaseS?: number
  /** Securing time (s) of a replaced panel. */
  lashingSecureS?: number
  /** STS cycle time of one hatch move (s). */
  cycleS?: number
  /** Panels per laydown stack. */
  laydownStackLimit?: number
}

/** A truck's transaction: one drop or pick, or `dual` (drop an export and pick an import in one visit). */
export type TruckTransactionKind = 'dropExport' | 'pickImport' | 'dropEmpty' | 'pickEmpty' | 'dual'

/** Gate: lanes and their processing times. The out-of-gauge (OOG) lane is drawn but never used. */
export interface GateConfig {
  /** Inbound lanes (default 4). */
  inLanes: number
  /** Outbound lanes (default 4). */
  outLanes: number
  /** Mean processing time of an inbound truck at its lane (s, default 40). */
  inProcessingS: number
  /** Mean processing time of an outbound truck at its lane (s, default 20). */
  outProcessingS: number
  /** ± % random variation of each processing time (default 0). */
  processingVariationPct?: number
  /** Draw the (unused) out-of-gauge lane (default true). */
  oogLane?: boolean
}

/** Truck arrivals earlier than the vessel's ETA by `minBeforeEtaS` to `maxBeforeEtaS` may deliver its exports. */
export interface ExportWindow {
  minBeforeEtaS: number
  maxBeforeEtaS: number
}

/** A truck that arrives at a fixed time (fixtures and tests), in addition to the hourly profile. */
export interface ScriptedTruck {
  atS: number
  transaction: TruckTransactionKind
}

/** Demand multiplier for the windows that overlap `[fromS, toS)` (sim seconds): how a peak is expressed. */
export interface BunchingSpan {
  fromS: number
  toS: number
  factor: number
}

/**
 * Truck appointment system (TT-R15). When present, trucks arrive against booked windows instead of the raw Poisson
 * process: demand per window follows `hourlyProfile` x `bunching`, bookings stop at the window's cap, arrivals are spread
 * uniformly inside the window. No ANPR and no early, late or invalid arrivals.
 */
export interface AppointmentConfig {
  /** Window length (s, default 1800). */
  windowS?: number
  /** Extra cap on bookings per window; the cap is also limited by gate and transfer stall capacity. */
  maxPerWindow?: number
  /** [A] Mean time a truck occupies a transfer stall (s, default 300): sets the stall capacity per window. */
  stallServiceS?: number
  /** Windows whose demand is multiplied (a peak is bunched bookings). */
  bunching?: BunchingSpan[]
  /** How long to book ahead (s; default the run's `simDurationS` plus warm-up, else 24 h). */
  horizonS?: number
  /** True when the numbers come from the TTI research and are not publicly verified. */
  unverified?: boolean
}

/** What happens to a truck at the gate when no stall can take it and every holding position is full (TT-R16). */
export type HoldingOverflowPolicy = 'wait-outside'

/**
 * Stall admission and holding (TT-R16). With this set, the gate admits the truck at the head of the queue only when a
 * transfer stall can take it (the stall is reserved before the truck is sent) or a holding position is free; an
 * admitted truck without a stall waits in a holding position; with holding full the truck waits outside the gate.
 * Absent = the truck is processed whenever a lane is free and waits at the kiosk for a stall (the older behaviour).
 */
export interface HoldingConfig {
  /** Dedicated holding positions on spurs of the inbound road, clear of roads, junctions and gate exits. */
  positions: number
  /** Overflow procedure when holding is full (default and only policy: the truck waits outside the gate). */
  overflow?: HoldingOverflowPolicy
  /** True when the numbers come from the TTI research and are not publicly verified. */
  unverified?: boolean
}

export interface LandsideConfig {
  /** Trucks arriving per hour for each clock hour 0–23 (Poisson arrivals); the clock comes from `kpi.startTimeOfDayS`. */
  hourlyProfile: number[]
  /** Transaction weights (normalised over the transactions the yard can serve when the truck arrives). */
  mix: Weights<TruckTransactionKind>
  /** How long an import box stands in the yard before a truck may collect it (default lognormal, median 3 days). */
  importDwell: DwellDistribution
  /** When a truck may deliver an export box for a vessel (default 1–5 days before its ETA). */
  exportWindow: ExportWindow
  gate: GateConfig
  /** Truck drive profile along the landside roads (default 8 m/s). */
  drive?: AxisProfile
  /** Trucks that arrive at fixed times. */
  scripted?: ScriptedTruck[]
  /** Appointment windows replace the Poisson arrivals (TT-R15); absent = Poisson. */
  appointments?: AppointmentConfig
  /** Stall admission and holding positions (TT-R16); absent = trucks wait at the gate kiosk for a stall. */
  holding?: HoldingConfig
  /**
   * An access road (spec #134, #146): trucks come along `z` from the south (`fromX`, beyond the terminal) and turn right
   * (east, -z) into the terminal road at the gate instead of appearing on the terminal road; absent = they spawn on it.
   */
  accessRoad?: AccessRoadConfig
  /** The two sharp turns at the far end of the terminal road become a teardrop loop trucks drive without stopping (#146). */
  teardropLoop?: boolean
}

/** Where the trucks' access road runs (scene metres: +x south along the quay, +z landward). */
export interface AccessRoadConfig {
  /** Z of the road's centre line. */
  z: number
  /** X where trucks enter it (south of the terminal). */
  fromX: number
}

/** Where the scenario clock sits, so hour and shift buckets line up with the clock the user sees. */
export interface KpiClockConfig {
  /** Seconds since clock midnight at sim t = 0 (default: `startDateTime`'s UTC time of day). */
  startTimeOfDayS?: number
  /** Clock hour (0-23) at which shift 1 of 3 starts (default 6: 06-14, 14-22, 22-06). */
  shiftStartHour?: number
}

export type UnitSystem = 'metric' | 'imperial'

/** Locale (Intl formatting) and unit system for the UI. */
export interface DisplaySettings {
  /** BCP 47 locale tag, e.g. "en-GB". */
  locale: string
  units: UnitSystem
}
