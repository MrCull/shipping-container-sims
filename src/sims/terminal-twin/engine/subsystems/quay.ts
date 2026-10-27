/**
 * Quay subsystem: the STS discharge cycle on the shared rail.
 *
 * STS discharge cycle (events in order, each `segments` = motion leading up to it):
 *   StsMoveStarted → rail reserved for the gantry move to the next bay
 *     (or StsWaitingForRail until the neighbour is clear) → (gantry, trolley
 *     out, hoist down empty, lock) → StsPicked (one box, or two for twin-20)
 *   → DecisionRequested / DecisionResolved (stsGroundPosition, once per box;
 *     the STS waits holding the box(es) while a decision is pending)
 *   → (hoist up loaded, trolley to lane, hoist down, unlock) → StsGrounded
 *     [twin-20: → (hoist clear, trolley to the 2nd lane, down, unlock) → StsGrounded]
 *   → (hoist up empty) → StsMoveStarted … → StsWorkComplete (its bays are done)
 *
 * Work order per crane: bay by bay (ascending), deck before hold, top tier
 * first, then row; a 20 ft cell aft half before fore half. Berthing, the
 * crane split and vessel departure live in `berth.ts`; the rail in `rail.ts`.
 */
import type { EngineContext, ReactorMap } from '../context'
import { planSegment, type Axis, type AxisProfile, type MotionSegment } from '../kinematics'
import type { SimState, StsDrop, StsState } from '../state'
import {
  CONTAINER_HEIGHT_M,
  HALF_OFFSET_M,
  slotX,
  slotZ,
  tierBaseY,
  vesselClass,
} from '../../scenario/vesselClasses'
import { releaseRail, reserveRail, startReposition, wakeRail } from './rail'

/** Random duration factor for one move phase (1 ± moveVariationPct %). */
function variation(ctx: EngineContext): number {
  const pct = ctx.config.moveVariationPct
  if (pct === 0) return 1
  return 1 + ((ctx.random() * 2 - 1) * pct) / 100
}

/** Scale a profile so every travel time is multiplied by `f`. */
function scaled(p: AxisProfile, f: number): AxisProfile {
  return { vMax: p.vMax / f, accel: p.accel / (f * f), decel: p.decel / (f * f) }
}

/**
 * Plan sequential axis moves starting at `t0`; updates the crane's axis
 * positions and live `motion`. Returns the segments and the end time.
 */
function planSequence(
  sts: StsState,
  t0: number,
  f: number,
  moves: { axis: Axis; to: number; profile: AxisProfile }[],
): { segments: MotionSegment[]; end: number } {
  const segments: MotionSegment[] = []
  let t = t0
  for (const m of moves) {
    const key = m.axis === 'gantry' ? 'gantryX' : m.axis === 'trolley' ? 'trolleyZ' : 'hoistY'
    if (sts[key] === m.to) continue
    const seg = planSegment(sts.id, m.axis, sts[key], m.to, t, scaled(m.profile, f))
    segments.push(seg)
    sts[key] = m.to
    t = seg.t1
  }
  sts.motion = segments
  return { segments, end: t }
}

/** Order a crane's discharge boxes: bay ↑, deck before hold, tier ↓, row ↑, aft half before fore. */
export function workOrder(state: SimState, vesselId: string, bays: number[]): string[] {
  const inBays = new Set(bays)
  return Object.values(state.vesselSlots)
    .filter((s) => s.vesselId === vesselId && s.containerId !== null && s.purpose === 'discharge' && inBays.has(s.bay))
    .sort(
      (a, b) =>
        a.bay - b.bay ||
        Number(b.deck) - Number(a.deck) ||
        b.tier - a.tier ||
        a.row - b.row ||
        (a.half === 'fore' ? 1 : 0) - (b.half === 'fore' ? 1 : 0),
    )
    .map((s) => s.containerId as string)
}

/** The next lift of a crane: its next box, plus the fore half of the same cell for a twin-20 lift. */
function nextLift(ctx: EngineContext, sts: StsState): string[] {
  const [first, second] = sts.workQueue
  if (!first) return []
  if (!ctx.config.quay.twinLift || !second) return [first]
  const a = ctx.state.vesselSlots[ctx.state.containers[first].custody.id]
  const b = ctx.state.vesselSlots[ctx.state.containers[second].custody.id]
  const sameCell = a.vesselId === b.vesselId && a.bay === b.bay && a.row === b.row && a.tier === b.tier
  return sameCell && a.half === 'aft' && b.half === 'fore' ? [first, second] : [first]
}

/** Gantry X for a lift: the half centre for a single 20 ft box, else the bay centre. */
function liftX(ctx: EngineContext, vesselId: string, containerIds: string[]): number {
  const vessel = ctx.state.vessels[vesselId]
  const slot = ctx.state.vesselSlots[ctx.state.containers[containerIds[0]].custody.id]
  const spec = vesselClass(vessel.sizeClass)
  return slotX(spec, vessel.berthX ?? 0, slot.bay, containerIds.length === 1 ? slot.half : null)
}

/** Continue a crane's work at `at`: next move, or StsWorkComplete when its bays are done. */
export function continueWork(ctx: EngineContext, sts: StsState, at: number, segments: MotionSegment[] = []): void {
  if (!sts.vesselId) {
    sts.status = 'idle'
    return
  }
  const vesselId = sts.vesselId
  if (sts.workQueue.length === 0) {
    sts.status = 'idle'
    ctx.schedule('StsWorkComplete', at, { equipment: [sts.id], vessels: [vesselId] }, { stsId: sts.id, vesselId })
    return
  }
  const containerIds = nextLift(ctx, sts)
  ctx.schedule('StsMoveStarted', at, { equipment: [sts.id], vessels: [vesselId], containers: containerIds }, {
    stsId: sts.id,
    vesselId,
    containerIds,
    segments,
  })
}

/** Run the rail wake-up after a rail change. */
function wake(ctx: EngineContext): void {
  wakeRail(ctx, (sts) => continueWork(ctx, sts, ctx.state.now))
}

function requestGroundPosition(ctx: EngineContext, sts: StsState, containerId: string): void {
  const { state } = ctx
  const reserved = new Map(sts.drops.map((d) => [d.groundPositionId, d.containerId]))
  ctx.requestDecision(
    'stsGroundPosition',
    {
      stsId: sts.id,
      containerId,
      groundPositions: sts.groundPositionIds.map((id) => ({
        id,
        lane: state.groundPositions[id].lane,
        occupiedBy: state.groundPositions[id].containerId ?? reserved.get(id) ?? null,
      })),
    },
    { equipment: [sts.id], containers: [containerId] },
  )
}

/** Spreader offset of a carried box along X (twin-20: aft −, fore +). */
function spreaderOffset(sts: StsState, containerId: string): number {
  if (sts.carrying.length < 2) return 0
  return sts.carrying[0] === containerId ? -HALF_OFFSET_M : HALF_OFFSET_M
}

/** Carry the next box to its chosen ground position and set it down. */
function planDrop(ctx: EngineContext, sts: StsState, t0: number, drop: StsDrop, liftFirst: number): void {
  const { config, state } = ctx
  const k = config.kinematics.sts
  const box = state.containers[drop.containerId]
  const gp = state.groundPositions[drop.groundPositionId]
  const { segments, end } = planSequence(sts, t0, variation(ctx), [
    { axis: 'hoist', to: liftFirst, profile: k.hoistLoaded },
    { axis: 'trolley', to: config.layout.stsGroundLaneZ0M + gp.lane * config.layout.stsGroundLaneSpacingM, profile: k.trolley },
    { axis: 'hoist', to: CONTAINER_HEIGHT_M[box.size], profile: k.hoistLoaded },
  ])
  ctx.schedule('StsGrounded', end + k.unlockS, { equipment: [sts.id], containers: [box.id] }, {
    stsId: sts.id,
    containerId: box.id,
    groundPositionId: gp.id,
    x: sts.gantryX + spreaderOffset(sts, box.id),
    segments,
  })
}

export const quayReactors: ReactorMap = {
  StsMoveStarted: (e, ctx) => {
    const { state, config } = ctx
    const sts = state.sts[e.payload.stsId]
    const vessel = state.vessels[e.payload.vesselId]
    const ids = e.payload.containerIds
    const targetX = liftX(ctx, vessel.id, ids)
    const kpi = state.kpis.perSts[sts.id]
    const blockedBy = reserveRail(state, config, sts, targetX)
    if (blockedBy !== null) {
      sts.status = 'waiting-for-rail'
      sts.railTargetX = targetX
      kpi.railWaitSince ??= e.t
      ctx.schedule('StsWaitingForRail', e.t, { equipment: [sts.id], vessels: [vessel.id] }, {
        stsId: sts.id,
        targetX,
        blockedBy,
      })
      return
    }
    if (kpi.railWaitSince !== null) {
      kpi.railWaitS += e.t - kpi.railWaitSince
      kpi.railWaitSince = null
    }
    sts.workQueue.splice(0, ids.length)
    sts.status = 'moving-to-pick'
    kpi.firstMoveStartS ??= e.t
    kpi.cycles++
    if (ids.length === 2) kpi.twinLifts++
    const spec = vesselClass(vessel.sizeClass)
    const box = state.containers[ids[0]]
    const slot = state.vesselSlots[box.custody.id]
    const tallest = Math.max(...ids.map((id) => CONTAINER_HEIGHT_M[state.containers[id].size]))
    const k = config.kinematics.sts
    const { segments, end } = planSequence(sts, e.t, variation(ctx), [
      { axis: 'hoist', to: config.layout.stsSafeHoistM, profile: k.hoistEmpty },
      { axis: 'gantry', to: targetX, profile: k.gantry },
      { axis: 'trolley', to: slotZ(spec, slot.row), profile: k.trolley },
      { axis: 'hoist', to: tierBaseY(spec, slot.tier) + tallest, profile: k.hoistEmpty },
    ])
    const twin = ids[1] ? { containerId: ids[1], from: { ...state.containers[ids[1]].custody } } : undefined
    ctx.schedule('StsPicked', end + k.lockS, { equipment: [sts.id], containers: ids, vessels: [vessel.id] }, {
      stsId: sts.id,
      containerId: box.id,
      from: { ...box.custody },
      ...(twin ? { twin } : {}),
      segments,
    })
  },

  StsPicked: (e, ctx) => {
    const { state } = ctx
    const sts = state.sts[e.payload.stsId]
    const picks = [{ containerId: e.payload.containerId, from: e.payload.from }]
    if (e.payload.twin) picks.push(e.payload.twin)
    releaseRail(sts)
    sts.carrying = picks.map((p) => p.containerId)
    sts.drops = []
    sts.status = 'waiting-for-decision'
    for (const p of picks) {
      state.vesselSlots[p.from.id].containerId = null
      const vessel = state.vessels[state.vesselSlots[p.from.id].vesselId]
      vessel.remainingDischarge--
      ctx.transferCustody(p.containerId, { kind: 'sts', id: sts.id })
    }
    requestGroundPosition(ctx, sts, picks[0].containerId)
    wake(ctx)
  },

  /** Ground-position reply: once every carried box has a position, carry the first one there (or wait if none). */
  DecisionResolved: (e, ctx) => {
    if (e.payload.decisionPoint !== 'stsGroundPosition') return
    const { state, config } = ctx
    const { request, reply } = e.payload
    const sts = state.sts[request.stsId]
    const box = state.containers[request.containerId]
    if (reply.groundPositionId === null) {
      sts.status = 'waiting-for-ground-position'
      ctx.schedule('StsWaitingForGroundPosition', e.t, { equipment: [sts.id], containers: [box.id] }, {
        stsId: sts.id,
        containerId: box.id,
      })
      return
    }
    if (!state.groundPositions[reply.groundPositionId])
      throw new Error(`stsGroundPosition handler returned unknown ground position ${reply.groundPositionId}`)
    sts.drops.push({ containerId: box.id, groundPositionId: reply.groundPositionId })
    const next = sts.carrying.find((id) => !sts.drops.some((d) => d.containerId === id))
    if (next) {
      requestGroundPosition(ctx, sts, next)
      return
    }
    sts.status = 'carrying'
    planDrop(ctx, sts, e.t, sts.drops[0], config.layout.stsSafeHoistM)
  },

  StsGrounded: (e, ctx) => {
    const { state, config } = ctx
    const sts = state.sts[e.payload.stsId]
    const box = state.containers[e.payload.containerId]
    // Trusts the handler's choice; the custody invariant catches a bad one.
    state.groundPositions[e.payload.groundPositionId].containerId = box.id
    ctx.transferCustody(box.id, { kind: 'groundPosition', id: e.payload.groundPositionId })
    sts.drops = sts.drops.filter((d) => d.containerId !== box.id)
    state.kpis.movesCompleted++
    const kpi = state.kpis.perSts[sts.id]
    kpi.moves++
    kpi.lastMoveEndS = e.t
    const rest = sts.carrying.filter((id) => id !== box.id)
    if (rest.length > 0 && sts.drops.length > 0) {
      // twin-20: the second box goes to its own ground position in the same cycle
      planDrop(ctx, sts, e.t, sts.drops[0], CONTAINER_HEIGHT_M[box.size] + 1)
      sts.carrying = rest
      return
    }
    sts.carrying = rest
    sts.status = 'returning'
    const { segments, end } = planSequence(sts, e.t, variation(ctx), [
      { axis: 'hoist', to: config.layout.stsSafeHoistM, profile: config.kinematics.sts.hoistEmpty },
    ])
    continueWork(ctx, sts, end, segments)
  },

  StsWaitingForRail: (_e, ctx) => wake(ctx),

  StsRepositionStarted: (e, ctx) => startReposition(ctx, ctx.state.sts[e.payload.stsId], e.payload.toX),

  StsRepositionCompleted: (e, ctx) => {
    const sts = ctx.state.sts[e.payload.stsId]
    releaseRail(sts)
    sts.status = 'idle'
    // assigned to a vessel while repositioning: start its work now
    if (sts.vesselId) continueWork(ctx, sts, e.t)
    wake(ctx)
  },
}

export { wake as wakeQuayRail }
