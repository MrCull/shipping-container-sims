/**
 * Decision-point handlers: the TOS seams. A HandlerSet maps each decision
 * point to a handler that receives a `DecisionRequestMessage` and returns a
 * reply (sync or Promise). `createSimulation(config, handlers)` uses the given
 * handlers in place of the scenario's configured strategies, so tests can
 * swap in a scripted (or deliberately broken) handler without touching the
 * engine. The framework itself lives in `engine/decisions/`.
 */
export type {
  DecisionHandler,
  DecisionRequestMessage,
  GroundPositionReply,
  GroundPositionRequest,
  HandlerSet,
} from './decisions/types'
export { defaultHandlers } from './decisions/strategies'
