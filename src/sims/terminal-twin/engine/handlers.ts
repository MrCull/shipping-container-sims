/**
 * Decision-point handlers: the TOS seams. A HandlerSet maps each decision
 * point to a function that receives a serialisable request and returns a
 * reply. `createSimulation(config, handlers)` merges the given handlers over
 * `defaultHandlers`, so tests can swap in a scripted (or deliberately broken)
 * handler without touching the engine.
 *
 * TT-01 has one synchronous decision point. TT-03 turns this into the full
 * request/reply framework (correlation ids, async modes, strategy registry,
 * latency injection) — keep requests and replies plain JSON.
 */
import type { SimQuery } from './query'

export interface GroundPositionRequest {
  stsId: string
  containerId: string
  /** The crane's ground positions in lane order, with current occupancy. */
  groundPositions: { id: string; lane: number; occupiedBy: string | null }[]
}

export interface GroundPositionReply {
  /** Chosen ground position, or null if none is available (STS waits). */
  groundPositionId: string | null
}

export interface HandlerSet {
  /** Choose the STS ground position to set a discharged box down on. */
  stsGroundPosition: (request: GroundPositionRequest, query: SimQuery) => GroundPositionReply
}

export const defaultHandlers: HandlerSet = {
  /** Lowest free lane. */
  stsGroundPosition: (req) => ({
    groundPositionId: req.groundPositions.find((gp) => gp.occupiedBy === null)?.id ?? null,
  }),
}
