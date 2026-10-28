/**
 * Terminal Twin engine — the single public entry point.
 *
 * Everything outside `engine/` (CLI, tests, Web Worker host, dev API) imports
 * from here only. No DOM, Vue, Three.js or Node imports are allowed inside
 * `engine/` (enforced by ESLint) so it runs in Node and in a Web Worker.
 */
export * from './kinematics'
export type { EngineEvent, EventEnvelope, EventOf, EventPayloads, EventSubjects, EventType } from './events'
export type {
  CustodyKind,
  CustodyRef,
  CustodyRecord,
  ContainerState,
  StsState,
  VesselState,
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
  TransferStallState,
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
export { ascIdOf, ascIndexOf } from './state'
export { buildLaneGraph, laneGraphOf, shortestPath, wtpPadLayout, DEFAULT_APRON_LAYOUT } from './laneGraph'
export type { LaneGraph, LaneNode, LaneEdge, ConflictZone, WtpPadLayout } from './laneGraph'
export { buildLandsideGraph, landsideGraphOf, hasLandside, queueSlotZ, QUEUE_PITCH_M, GATE_LANE_W_M } from './landsideGraph'
export type { LandsideGraph, LandsideNode, LandsideEdge, LandsideZone, GateLaneLayout } from './landsideGraph'
export { truckPositionAt } from './subsystems/landside'
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
  RehandleCandidate,
  RehandleTargetReply,
  RehandleTargetRequest,
  WorkPackageInfo,
  WorkPackageReleaseReply,
  WorkPackageReleaseRequest,
  YardAllocationReply,
  YardAllocationRequest,
} from './decisions/types'
export { strategies, getStrategy } from './decisions/strategies'
export type { StrategyDefinition, StrategyRegistry, DecisionPointStrategies } from './decisions/strategies'
export type { DecisionRequestedPayload, DecisionResolvedPayload } from './events'
export type { HandlerKpiReport } from './kpis'
export type { SimQuery } from './query'
export type { InvariantViolation } from './invariants'
export type { KpiReport, HorizontalKpiReport, WorkPackageKpiReport, LandsideKpiReport } from './kpis'
export type { WorkPackage, WorkPackageKind, WorkPackageStatus, LoadOrder } from './state'
export {
  createSimulation,
  restoreSimulation,
  ENGINE_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} from './simulation'
export type {
  Simulation,
  SimulationOptions,
  SimSnapshot,
  SimStatus,
  SimError,
  RunCondition,
  RunResult,
  StopReason,
  InvariantReport,
  EventListener,
} from './simulation'
export { parseLogVerbosity, toLogRecord, eventSubsystem, eventLogLevel, LOG_LEVELS } from './logging'
export type { LogLevel, LogRecord, LogOptions, LogVerbosity } from './logging'
export { diffEventLogs, jsonDifferences } from './runDiff'
export type { RunDiff, RunDiffOptions } from './runDiff'
export { summarizeRun } from './summary'
export type { RunSummary } from './summary'
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
export { yardCapacityCells, planPrefill, yardPlacerOf } from './prefill'
export type { PrefillPlan, PrefillImport, YardPlacer } from './prefill'
