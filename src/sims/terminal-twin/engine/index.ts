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
} from './yardLayout'
export type { BlockSpec, YardCandidate, YardStacks } from './yardLayout'
export { ascPoseAt } from './subsystems/asc'
export { ascIdOf, ascIndexOf } from './state'
export { buildLaneGraph, laneGraphOf, shortestPath, wtpPadLayout, DEFAULT_APRON_LAYOUT } from './laneGraph'
export type { LaneGraph, LaneNode, LaneEdge, ConflictZone, WtpPadLayout } from './laneGraph'
export type { Reservation } from './reservations'
export type { ShcPhasePayload, AscPhasePayload } from './events'
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
  ShcDispatchJob,
  ShcDispatchPad,
  ShcDispatchReply,
  ShcDispatchRequest,
  YardAllocationReply,
  YardAllocationRequest,
} from './decisions/types'
export { strategies, getStrategy } from './decisions/strategies'
export type { StrategyDefinition, StrategyRegistry, DecisionPointStrategies } from './decisions/strategies'
export type { DecisionRequestedPayload, DecisionResolvedPayload } from './events'
export type { HandlerKpiReport } from './kpis'
export type { SimQuery } from './query'
export type { InvariantViolation } from './invariants'
export type { KpiReport, HorizontalKpiReport } from './kpis'
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
