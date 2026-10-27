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
export { summarizeRun } from './summary'
export type { RunSummary } from './summary'
