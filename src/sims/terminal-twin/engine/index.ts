/**
 * Terminal Twin engine — the single public entry point.
 *
 * Everything outside `engine/` (CLI, tests, Web Worker host, dev API) imports
 * from here only. No DOM, Vue, Three.js or Node imports are allowed inside
 * `engine/` (enforced by ESLint) so it runs in Node and in a Web Worker.
 */
export * from './kinematics'
export type { EngineEvent, EventEnvelope, EventOf, EventPayloads, EventSubjects, EventType } from './events'
export type { CustodyKind, CustodyRef, CustodyRecord, ContainerState, StsState, VesselState } from './state'
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
} from './decisions/types'
export { strategies, getStrategy } from './decisions/strategies'
export type { StrategyDefinition, StrategyRegistry, DecisionPointStrategies } from './decisions/strategies'
export type { DecisionRequestedPayload, DecisionResolvedPayload } from './events'
export type { HandlerKpiReport } from './kpis'
export type { SimQuery } from './query'
export type { InvariantViolation } from './invariants'
export type { KpiReport } from './kpis'
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
