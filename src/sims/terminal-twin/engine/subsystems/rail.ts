/**
 * The shared STS rail. Cranes never pass each other: each crane holds a
 * reservation `[railLo, railHi]` covering every gantry position of its
 * current motion, and neighbouring reservations stay at least
 * `quay.stsMinSpacingM` apart (the `sts.rail-order` invariant).
 *
 * - A crane that wants to gantry reserves `[from, to]` first (`reserveRail`).
 *   If a neighbour is in the way it waits (`waiting-for-rail`) with a
 *   `railTargetX`, and `wakeRail` retries after every rail change.
 * - A reservation shrinks to the crane's position when the gantry move is
 *   over (STS picked / reposition completed).
 * - A free, idle crane in the way of a waiting crane is asked to step aside
 *   (it waits for the rail itself, with the position it must reach); a chain
 *   of free cranes moves one after another. A busy crane that waits empty-handed and stationary may also step aside (#174,
 *   bounded yield): it repositions to the edge the blocked neighbour needs and then resumes its work, so two busy cranes
 *   whose targets lie on each other's side can never wait for each other forever.
 */
import type { EngineContext } from '../context'
import { planSegment, positionAt } from '../kinematics'
import type { SimState, StsState } from '../state'
import type { ScenarioConfig } from '../../scenario/types'

const EPS = 1e-6

/** Cranes in rail order. */
export function railOrder(state: SimState): StsState[] {
  return Object.values(state.sts).sort((a, b) => a.railIndex - b.railIndex)
}

/** Gantry position of a crane at sim time `t` (from its current motion plan). */
export function gantryPositionAt(sts: StsState, t: number): number {
  const seg = sts.motion.find((m) => m.axis === 'gantry')
  return seg ? positionAt(seg, t) : sts.gantryX
}

/**
 * Reserve the rail for a gantry move of a stationary crane to `targetX` (and on to `alsoX` for a hatch move that visits
 * the laydown, TT-R09).
 * Returns null on success, else the id of the crane in the way (or 'quay-end').
 */
export function reserveRail(state: SimState, config: ScenarioConfig, sts: StsState, targetX: number, alsoX?: number | null): string | null {
  const lo = Math.min(sts.gantryX, targetX, alsoX ?? Infinity)
  const hi = Math.max(sts.gantryX, targetX, alsoX ?? -Infinity)
  if (lo < -EPS || hi > config.quay.lengthM + EPS) return 'quay-end'
  const order = railOrder(state)
  const left = order[sts.railIndex - 1]
  const right = order[sts.railIndex + 1]
  const spacing = config.quay.stsMinSpacingM
  if (left && left.railHi + spacing > lo + EPS) return left.id
  if (right && hi + spacing > right.railLo + EPS) return right.id
  sts.railLo = lo
  sts.railHi = hi
  return null
}

/** The gantry move is over: the reservation shrinks to where the crane stands. */
export function releaseRail(sts: StsState): void {
  sts.railLo = sts.gantryX
  sts.railHi = sts.gantryX
}

/**
 * Start a planned reposition (StsRepositionStarted reactor): gantry to `toX`,
 * holding `[from, to]` of the rail until StsRepositionCompleted. Trusts the
 * caller's reservation; a bad one surfaces as an `sts.rail-order` violation.
 */
export function startReposition(ctx: EngineContext, sts: StsState, toX: number): void {
  const seg = planSegment(sts.id, 'gantry', sts.gantryX, toX, ctx.state.now, ctx.config.kinematics.sts.gantry)
  if (ctx.state.subsystems.quay === 'instant') seg.t1 = seg.t0 // quay mode instant: no travel time
  sts.railLo = Math.min(sts.gantryX, toX)
  sts.railHi = Math.max(sts.gantryX, toX)
  sts.gantryX = toX
  sts.motion = [seg]
  sts.status = 'repositioning'
  ctx.schedule('StsRepositionCompleted', seg.t1, { equipment: [sts.id] }, { stsId: sts.id, gantryX: toX, segments: [seg] })
}

/**
 * A crane that stands still may be asked to step aside: a free crane (no vessel work), or a crane with vessel work that
 * waits for the rail empty-handed (#174). The second case is what breaks a mutual wait: two cranes whose targets lie on
 * each other's side of the spacing would otherwise wait for each other forever (the `crane-split` stall).
 */
function yieldable(sts: StsState): boolean {
  if (sts.railLo !== sts.railHi) return false
  if (sts.vesselId === null) return sts.status === 'idle' || sts.status === 'waiting-for-rail'
  return sts.status === 'waiting-for-rail' && sts.carrying.length === 0
}

/** Ask the free crane `blocker` to clear the way for `waiter`, which wants to reach `targetX`. */
function askToYield(ctx: EngineContext, blocker: StsState, waiter: StsState, targetX: number): boolean {
  if (!yieldable(blocker)) return false
  const spacing = ctx.config.quay.stsMinSpacingM
  const lengthM = ctx.config.quay.lengthM
  const goRight = blocker.railIndex > waiter.railIndex
  const edge = goRight ? Math.max(waiter.gantryX, targetX) + spacing : Math.min(waiter.gantryX, targetX) - spacing
  if (edge < 0 || edge > lengthM) return false
  const current = blocker.railTargetX
  const target = current === null ? edge : goRight ? Math.max(current, edge) : Math.min(current, edge)
  if (blocker.status === 'waiting-for-rail' && current === target) return false
  blocker.status = 'waiting-for-rail'
  blocker.railTargetX = target
  // a busy blocker steps aside by repositioning (not by moving to its pick); it resumes its work afterwards
  blocker.railYield = blocker.vesselId !== null
  return true
}

/**
 * Retry every crane waiting for the rail (rail order, repeated until nothing
 * changes). A crane with vessel work starts its move (StsMoveStarted); a free
 * crane starts its reposition (StsRepositionStarted). Blocked cranes ask a
 * free blocker to step aside.
 */
export function wakeRail(ctx: EngineContext, startMove: (sts: StsState) => void): void {
  const { state, config } = ctx
  for (let pass = 0; pass < 2 * Object.keys(state.sts).length + 2; pass++) {
    let changed = false
    for (const sts of railOrder(state)) {
      if (sts.status !== 'waiting-for-rail' || sts.railTargetX === null) continue
      const target = sts.railTargetX
      const also = sts.railAlsoX ?? null
      const blockedBy = reserveRail(state, config, sts, target, also)
      if (blockedBy === null) {
        sts.railTargetX = null
        sts.railAlsoX = null
        changed = true
        if (sts.vesselId !== null && !sts.railYield) {
          sts.status = 'moving-to-pick'
          startMove(sts)
        } else {
          sts.status = 'repositioning'
          ctx.schedule('StsRepositionStarted', state.now, { equipment: [sts.id] }, { stsId: sts.id, toX: target })
        }
      } else if (blockedBy !== 'quay-end') {
        const blocker = state.sts[blockedBy]
        const reach = also === null ? target : blocker.railIndex > sts.railIndex ? Math.max(target, also) : Math.min(target, also)
        if (askToYield(ctx, blocker, sts, reach)) changed = true
      }
    }
    if (!changed) return
  }
}
