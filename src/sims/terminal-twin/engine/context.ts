/**
 * EngineContext: what a reactor gets while the engine processes one event.
 *
 * Reactors (`ReactorMap`) are the engine's internal behaviour, one per event
 * type, grouped by subsystem under `engine/subsystems/`. They mutate state,
 * ask decision points, and schedule follow-up events. Anything
 * a reactor schedules automatically gets `causedBy = current.id`.
 */
import type { EngineEvent, EventOf, EventPayloads, EventSubjects, EventType } from './events'
import type { DecisionPointId, DecisionRequests } from './decisions/types'
import type { SimQuery } from './query'
import type { CustodyRef, SimState } from './state'
import type { ScenarioConfig } from '../scenario/types'

export interface EngineContext {
  readonly state: SimState
  readonly config: ScenarioConfig
  readonly query: SimQuery
  /** The event being processed. */
  readonly current: EngineEvent
  /** Schedule an event at sim time `at` (>= now). */
  schedule<K extends EventType>(type: K, at: number, subjects: EventSubjects, payload: EventPayloads[K]): EventOf<K>
  /** Uniform [0, 1) from the single seeded RNG. */
  random(): number
  /**
   * Ask a decision point. Schedules `DecisionRequested` now and returns the
   * correlation id. The reply arrives later as a `DecisionResolved` event,
   * which the asking subsystem handles in its own reactor. `subjects.equipment`
   * is the equipment that idles while waiting (for idle-time KPIs).
   */
  requestDecision<K extends DecisionPointId>(
    decisionPoint: K,
    request: DecisionRequests[K],
    subjects: EventSubjects,
    /** `preRun`: the decision belongs to the pre-run phase: its events are marked and it never advances the sim clock. */
    options?: { preRun?: boolean },
  ): string
  /** Record a custody change (holders must be updated by the caller). */
  transferCustody(containerId: string, to: CustodyRef): void
}

export type Reactor<K extends EventType> = (event: EventOf<K>, ctx: EngineContext) => void

export type ReactorMap = { [K in EventType]?: Reactor<K> }
