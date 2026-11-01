/**
 * Terminal Twin engine, the single public entry point.
 *
 * Everything outside `engine/` (CLI, tests, Web Worker host, dev API) imports
 * from here only. No DOM, Vue, Three.js or Node imports are allowed inside
 * `engine/` (enforced by ESLint) so it runs in Node and in a Web Worker.
 */
export * from './kinematics'
export * from './transit'
export type { EngineEvent, EventEnvelope, EventOf, EventPayloads, EventSubjects, EventType } from './events'
export type {
  CustodyKind,
  CustodyRef,
  CustodyRecord,
  ContainerState,
  StsState,
  VesselState,
  VesselSlotState,
  ShcState,
  ShcStatus,
  ShcJob,
  WtpPadState,
  AscState,
  AscStatus,
  AscJob,
  TruckState,
  TruckLeg,
  TruckStatus,
  VesselStatus,
  TransferStallState,
  HoldingPositionState,
  LandsideState,
  YardBlockState,
  YardSlotState,
} from './state'
export {
  BLOCK_ROWS,
  ROW_PITCH_M,
  BAY_PITCH_M,
  TIER_PITCH_M,
  blockSpec,
  blockSpecs,
  boxSpan,
  candidateSlots,
  REEFER_MAX_TIERS,
  parseYardSlotId,
  yardSlotId,
  rowX,
  bayZ,
  slotZ,
  tierBaseY,
  travelHoistM,
  ASC_MIN_SEPARATION_M,
  RAIL_SEGMENT_M,
  ascStartZ,
  railEndZ,
  railSegmentIds,
  railSegmentSpan,
  railStartZ,
  transferStallLayout,
  transferStallId,
  transferStallZ,
  STALL_PITCH_M,
  STALL_LENGTH_M,
  TRUCK_DECK_M,
} from './yardLayout'
export type { BlockSpec, YardCandidate, YardStacks, TransferStallLayout } from './yardLayout'
export { ascPoseAt } from './subsystems/asc'
export { ascIdOf, ascIndexOf, resolveSubsystemModes } from './state'
export { buildLaneGraph, laneGraphOf, shortestPath, wtpPadLayout, apronLayout, DEFAULT_APRON_LAYOUT } from './laneGraph'
export type { LaneGraph, LaneNode, LaneEdge, ConflictZone, WtpPadLayout } from './laneGraph'
export { buildLandsideGraph, landsideGraphOf, hasLandside, queueSlotZ, queueSlotAt, QUEUE_PITCH_M, GATE_LANE_W_M, GATE_OOG_LANE_W_M, GATE_ISLAND_W_M, HOLDING_PITCH_M } from './landsideGraph'
export type { LandsideGraph, LandsideNode, LandsideEdge, LandsideZone, GateLaneLayout, HoldingLayout } from './landsideGraph'
export { truckPositionAt } from './subsystems/landside'
export { appointmentCap, planAppointments } from './appointments'
export type { Reservation } from './reservations'
export type { ShcPhasePayload, AscPhasePayload, TruckLegInfo } from './events'
export { defaultHandlers } from './handlers'
export type { HandlerSet, GroundPositionRequest, GroundPositionReply } from './handlers'
export {
  DECISION_CONTRACT_VERSIONS,
  DECISION_POINT_IDS,
  DEFAULT_DECISION_TIMEOUT_MS,
} from './decisions/types'
export type {
  AsyncMode,
  DecisionHandler,
  DecisionPointConfig,
  DecisionPointId,
  DecisionReplies,
  DecisionRequestMessage,
  DecisionRequests,
  DecisionsConfig,
  LatencyDelay,
  LatencySpec,
  AscDispatchCandidate,
  AscDispatchReply,
  AscDispatchRequest,
  GateLaneAssignmentReply,
  GateLaneAssignmentRequest,
  GateLaneOption,
  TransferStallOption,
  TransferStallSelectionReply,
  TransferStallSelectionRequest,
  ShcDispatchJob,
  ShcDispatchPad,
  ShcDispatchReply,
  ShcDispatchRequest,
  WtpPadSelectionReply,
  WtpPadSelectionRequest,
  RehandleCandidate,
  RehandleTargetReply,
  RehandleTargetRequest,
  WorkPackageInfo,
  WorkPackageReleaseReply,
  WorkPackageReleaseRequest,
  YardAllocationReply,
  YardAllocationRequest,
  YardBoxView,
} from './decisions/types'
export { yardGroupKey, yardGroupBreak, yardGroupingOn, yardViewOfProps } from './decisions/yardGrouping'
export type { YardGroupBreak } from './decisions/yardGrouping'
export { strategies, getStrategy } from './decisions/strategies'
export type { StrategyDefinition, StrategyRegistry, DecisionPointStrategies } from './decisions/strategies'
export type { DecisionRequestedPayload, DecisionResolvedPayload } from './events'
export type { HandlerKpiReport } from './kpis'
export type { SimQuery } from './query'
export type { InvariantViolation } from './invariants'
export type { PredictedReady } from './predictions'
export { checkInvariants, DEFAULT_SWEEP_EVERY, InvariantTracker } from './invariants'
export type { KpiReport, HorizontalKpiReport, WorkPackageKpiReport, OrderingKpiReport, LandsideKpiReport } from './kpis'
export type { WorkPackage, WorkPackageKind, WorkPackageStatus, LoadOrder } from './state'
export type { HatchPanelState, HatchPanelStatus, HatchLaydownSite } from './state'
export type { HatchKpiReport } from './kpis'
export { hatchEnabled, hatchSettings, hatchLaydownProblems, laydownSites, laydownRect, laydownCentreZ, laydownTopY } from './hatch'
export { hashDigest } from './hash'
export {
  createSimulation,
  restoreSimulation,
  ENGINE_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  checkSnapshotCompat,
  SnapshotCompatError,
} from './simulation'
export type {
  Simulation,
  SimulationOptions,
  SimSnapshot,
  SnapshotCompat,
  SimStatus,
  SimError,
  RunCondition,
  RunResult,
  StopReason,
  InvariantReport,
  InvariantStats,
  EventListener,
} from './simulation'
export { parseLogVerbosity, toLogRecord, eventSubsystem, eventLogLevel, LOG_LEVELS } from './logging'
export type { LogLevel, LogRecord, LogOptions, LogVerbosity } from './logging'
export { diffEventLogs, jsonDifferences } from './runDiff'
export type { RunDiff, RunDiffOptions } from './runDiff'
export { stsProductivity, formatStsProductivity, STS_TIME_BUCKETS } from './stsProductivity'
export type { StsProductivityReport, StsTimeRow, StsTimeBucket } from './stsProductivity'
export { boxWaits, BOX_WAIT_PATHS, BOX_WAIT_STAGES } from './boxWaits'
export type { BoxWait, BoxWaitOptions, BoxWaitPath, BoxWaitPathRow, BoxWaitReport, BoxWaitStage } from './boxWaits'
export { summarizeRun } from './summary'
export type { RunSummary } from './summary'
export { SHC_OPERATIONAL_STATES, SHC_STATUSES, shcOperationalState } from './shcStates'
export type { ShcOperationalState } from './shcStates'
export { createKpiCollector, KPI_DEFS } from './kpi/collector'
export type { KpiSeries, KpiSeriesEntity, KpiSeriesReport, KpiCollector, KpiUnit, KpiEntityKind } from './kpi/collector'
export { hourBuckets, shiftBuckets, hourIndexOf, kpiClockOf, HOUR_S, SHIFT_S } from './kpi/clock'
export type { HourBucket, ShiftBucket, KpiClock } from './kpi/clock'
export { headlineKpis, highlightsOf } from './kpi/headline'
export type { HeadlineKpis, Highlight } from './kpi/headline'
export { exportRun, kpiReportJson, kpiReportCsv, eventLogJson, eventLogCsv, EXPORT_FILES, KPI_REPORT_FORMAT } from './export'
export type { ExportKind } from './export'
export { buildTimeline } from './kpi/timeline'
export type { TimelineReport, VesselTimelineRow, TimelinePackage, TimelineWorkPackage, TimelineWindow } from './kpi/timeline'
export { yardCapacityCells, planPrefill, prefillOf, yardPlacerOf } from './prefill'
export { yardIndexOf, indexYardSlotAdded, indexYardSlotRemoved } from './yardIndex'
export { blockersOf, boxesAbove } from './subsystems/rehandle'
export type { PrefillPlan, PrefillImport, YardPlacer } from './prefill'
export { validateScenario, validateSubsystemModes, assertValidScenario, ScenarioValidationError, peakTrucksPerHour } from '../scenario/validate'
export type { ScenarioCheck } from '../scenario/validate'
export { stsCycleGeometry, stsNominalCycle, shcNominalCycle, ascNominalCycle, profileValid } from './cycleTime'
export type { CycleReadout, StsCycleGeometry } from './cycleTime'
export { orderDischarge, orderLoad, countDischargeSplits, DEFAULT_VESSEL_ORDERING, vesselOrderingOf, type OrderBox, type OrderCell, type OrderEntry } from './vesselOrdering'
