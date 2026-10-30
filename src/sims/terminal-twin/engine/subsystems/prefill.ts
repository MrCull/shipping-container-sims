/**
 * Pre-run phase of a pre-filled yard start (V11-13): the starting stacks are placed by asking `yardAllocation`
 * through the decision runtime, one box at a time, before the scenario starts. So async handlers, latency
 * injection, fallbacks and handler KPIs all apply.
 *
 * Flow (all events at sim time 0, every decision event carries `preRun: true`):
 *
 *   DecisionRequested(preRun) → DecisionResolved(preRun) → [place the box, ask for the next one] → … →
 *   ScenarioStarted (scheduled by the last DecisionResolved)
 *
 * The computation that picks the next box and checks each reply is `prefillSteps` (engine/prefill.ts), a generator
 * that is not part of `SimState`. `state.prefill.replies` records the replies so far; after a restore the generator
 * is rebuilt by replaying them, so a snapshot taken mid pre-run resumes exactly. A sync handler completes the
 * whole phase inside `createSimulation`; an async handler leaves it in flight (`waiting-for-decision`).
 */
import type { EngineContext, ReactorMap } from '../context'
import type { YardAllocationRequest } from '../decisions/types'
import { indexYardSlotAdded } from '../yardIndex'
import { prefillSteps, type PrefillImport, type PrefillPlan } from '../prefill'
import { POOL_VESSEL_ID, planCargo } from '../../scenario/bayPlan'
import { makeContainerState } from '../../scenario/containerFactory'
import { drawContainerProps } from '../../scenario/containerProps'
import type { ScenarioConfig } from '../../scenario/types'
import type { ExportPlacement } from '../../scenario/exportYard'
import type { SimState } from '../state'

type Step = IteratorResult<YardAllocationRequest, PrefillPlan>

export interface PrefillDriver {
  /** Bookkeeping: place the box a pre-run `DecisionResolved` answered, then ask for the next or start the scenario. */
  reactors: ReactorMap
  /** True while the state still has boxes to place (before the first request, or after a restore mid pre-run). */
  pending(): boolean
  /** Ask the first request (through `ctx`, a root context). Starts the scenario at once when there is nothing to place. */
  start(ctx: EngineContext): void
  /** Forget the in-memory computation (after a restore); it is rebuilt from `state.prefill.replies` on demand. */
  reset(): void
}

export function createPrefillDriver(getState: () => SimState, config: ScenarioConfig, seed: number): PrefillDriver {
  let steps: Generator<YardAllocationRequest, PrefillPlan, string | null> | null = null
  let out: PrefillPlan = { placements: [], imports: [] }
  let current: Step | null = null
  let applied = 0

  /** (Re)build the computation and replay the recorded replies. Placements already in the state are not applied again. */
  function rebuild(): void {
    const replies = getState().prefill?.replies ?? []
    out = { placements: [], imports: [] }
    steps = prefillSteps(config, planCargo(config, seed), seed, out)
    current = steps.next()
    for (const reply of replies) current = steps.next(reply)
    applied = out.placements.length
  }

  /** Put a placed box into the stacks and its custody there. */
  function place(ctx: EngineContext, p: ExportPlacement, imp: PrefillImport | undefined): void {
    const { state } = ctx
    const blk = state.yardBlocks[p.blockId]
    const slot = { id: p.slotId, blockId: p.blockId, bay: p.bay, row: p.row, tier: p.tier, span: p.span, containerId: p.containerId }
    state.yardSlots[p.slotId] = slot
    indexYardSlotAdded(state, slot)
    for (let k = 0; k < p.span; k++) {
      const i = (p.bay + k - 1) * blk.rows + (p.row - 1)
      blk.heights[i] = Math.max(blk.heights[i], p.tier)
      blk.topVessels[i] = p.vesselId
    }
    const owner = { kind: 'yardSlot' as const, id: p.slotId }
    if (state.containers[p.containerId]) {
      ctx.transferCustody(p.containerId, owner) // a booked export box or an empty: it waited outside until now
      return
    }
    if (!imp) throw new Error(`Pre-fill placed unknown box ${p.containerId}`)
    // an import box: it was discharged before the scenario starts, so it comes into being in its slot
    state.containers[imp.id] = makeContainerState({
      id: imp.id,
      size: imp.size,
      full: true,
      line: imp.line,
      vesselId: POOL_VESSEL_ID,
      owner,
      t: state.now,
      eventId: ctx.current.id,
      yardSince: -imp.ageS,
      pickupReadyAt: imp.pickupReadyAt,
      reefer: imp.reefer,
      props: drawContainerProps(ctx.config, state.propsSeed, {
        id: imp.id,
        size: imp.size,
        full: true,
        line: imp.line,
        reefer: imp.reefer === true,
        direction: 'IMPORT',
        inbound: { kind: 'vessel' }, // discharged before the scenario starts, from a vessel outside it
        arrivalS: -imp.ageS,
      }),
    })
  }

  function finish(ctx: EngineContext): void {
    const { state } = ctx
    const cells: Record<string, number> = {}
    for (const s of Object.values(state.yardSlots)) cells[s.blockId] = (cells[s.blockId] ?? 0) + s.span
    state.prefillCells = cells
    delete state.prefill
    steps = null
    current = null
    ctx.schedule('ScenarioStarted', state.now, {}, { scenario: config.name, seed })
  }

  /** Ask the next request, or finish when the computation is done. */
  function advance(ctx: EngineContext): void {
    if (!steps || !current) rebuild()
    const step = current as Step
    if (step.done) return finish(ctx)
    const box = step.value.containerId
    ctx.requestDecision('yardAllocation', step.value, { containers: [box] }, { preRun: true })
  }

  return {
    pending: () => getState().prefill !== undefined,
    start: advance,
    reset() {
      steps = null
      current = null
    },
    reactors: {
      DecisionResolved: (e, ctx) => {
        if (!e.payload.preRun || !ctx.state.prefill) return
        if (!steps || !current) rebuild()
        const reply = (e.payload.reply as { slotId: string | null }).slotId
        ctx.state.prefill.replies.push(reply)
        current = (steps as NonNullable<typeof steps>).next(reply)
        for (const p of out.placements.slice(applied)) place(ctx, p, out.imports.find((i) => i.id === p.containerId))
        applied = out.placements.length
        advance(ctx)
      },
    },
  }
}
