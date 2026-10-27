/**
 * Quay subsystem: vessels at berth and STS discharge to ground positions.
 *
 * STS discharge cycle (events in order, each `segments` = motion leading up to it):
 *   StsMoveStarted → (gantry, trolley out, hoist down empty, lock) → StsPicked
 *   → DecisionRequested / DecisionResolved (stsGroundPosition; the STS waits
 *     holding the box while the decision is pending)
 *   → (hoist up loaded, trolley to lane, hoist down loaded, unlock) → StsGrounded
 *   → (hoist up empty) → StsMoveStarted … → StsWorkComplete → VesselDeparted
 */
import type { EngineContext, ReactorMap } from '../context'
import { planSegment, type Axis, type AxisProfile, type MotionSegment } from '../kinematics'
import type { StsState } from '../state'
import type { ContainerSize, VesselConfig } from '../../scenario/types'

/** [A] Container heights (m). */
const CONTAINER_HEIGHT: Record<ContainerSize, number> = { '20': 2.591, '40': 2.591, '40HC': 2.896 }
const TIER_HEIGHT_M = 2.591

function vesselConfig(ctx: EngineContext, id: string): VesselConfig {
  const v = ctx.config.vessels.find((x) => x.id === id)
  if (!v) throw new Error(`Unknown vessel ${id}`)
  return v
}

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

function startNextMove(ctx: EngineContext, sts: StsState, at: number, segments: MotionSegment[]): void {
  if (!sts.vesselId) return
  const vessel = ctx.state.vessels[sts.vesselId]
  if (vessel.dischargeQueue.length === 0) {
    sts.status = 'idle'
    ctx.schedule('StsWorkComplete', at, { equipment: [sts.id], vessels: [vessel.id] }, {
      stsId: sts.id,
      vesselId: vessel.id,
    })
    return
  }
  ctx.schedule('StsMoveStarted', at, { equipment: [sts.id], vessels: [vessel.id] }, {
    stsId: sts.id,
    vesselId: vessel.id,
    segments,
  })
}

export const quayReactors: ReactorMap = {
  ScenarioStarted: (_e, ctx) => {
    for (const v of ctx.config.vessels) {
      ctx.schedule('VesselBerthed', v.berthAtS, { vessels: [v.id] }, { vesselId: v.id, berthX: v.berthX })
    }
  },

  VesselBerthed: (e, ctx) => {
    const vessel = ctx.state.vessels[e.payload.vesselId]
    vessel.status = 'berthed'
    vessel.berthedAt = e.t
    for (const stsId of vesselConfig(ctx, vessel.id).stsIds) {
      const sts = ctx.state.sts[stsId]
      sts.vesselId = vessel.id
      startNextMove(ctx, sts, e.t, [])
    }
  },

  StsMoveStarted: (e, ctx) => {
    const { state, config } = ctx
    const sts = state.sts[e.payload.stsId]
    const vessel = state.vessels[e.payload.vesselId]
    const containerId = vessel.dischargeQueue.shift()
    if (!containerId) throw new Error(`${sts.id}: no box to discharge`)
    const box = state.containers[containerId]
    const slot = state.vesselSlots[box.custody.id]
    const vc = vesselConfig(ctx, vessel.id)
    const k = config.kinematics.sts
    sts.status = 'moving-to-pick'
    const kpi = state.kpis.perSts[sts.id]
    kpi.firstMoveStartS ??= e.t
    const { segments, end } = planSequence(sts, e.t, variation(ctx), [
      { axis: 'gantry', to: vc.berthX + (slot.bay + 0.5) * vc.bayPitchM, profile: k.gantry },
      { axis: 'trolley', to: -(vc.fenderGapM + (slot.row + 0.5) * vc.rowPitchM), profile: k.trolley },
      { axis: 'hoist', to: vc.deckHeightM + slot.tier * TIER_HEIGHT_M + CONTAINER_HEIGHT[box.size], profile: k.hoistEmpty },
    ])
    ctx.schedule('StsPicked', end + k.lockS, { equipment: [sts.id], containers: [box.id], vessels: [vessel.id] }, {
      stsId: sts.id,
      containerId: box.id,
      from: { ...box.custody },
      segments,
    })
  },

  StsPicked: (e, ctx) => {
    const { state } = ctx
    const sts = state.sts[e.payload.stsId]
    const box = state.containers[e.payload.containerId]
    state.vesselSlots[e.payload.from.id].containerId = null
    sts.carrying = box.id
    sts.status = 'waiting-for-decision'
    ctx.transferCustody(box.id, { kind: 'sts', id: sts.id })
    ctx.requestDecision(
      'stsGroundPosition',
      {
        stsId: sts.id,
        containerId: box.id,
        groundPositions: sts.groundPositionIds.map((id) => ({
          id,
          lane: state.groundPositions[id].lane,
          occupiedBy: state.groundPositions[id].containerId,
        })),
      },
      { equipment: [sts.id], containers: [box.id] },
    )
  },

  /** Ground-position reply: carry the box to the chosen lane (or wait if none). */
  DecisionResolved: (e, ctx) => {
    if (e.payload.decisionPoint !== 'stsGroundPosition') return
    const { state, config } = ctx
    const { request, reply } = e.payload
    const sts = state.sts[request.stsId]
    const box = state.containers[request.containerId]
    sts.status = 'carrying'
    if (reply.groundPositionId === null) {
      sts.status = 'waiting-for-ground-position'
      ctx.schedule('StsWaitingForGroundPosition', e.t, { equipment: [sts.id], containers: [box.id] }, {
        stsId: sts.id,
        containerId: box.id,
      })
      return
    }
    const gp = state.groundPositions[reply.groundPositionId]
    if (!gp) throw new Error(`stsGroundPosition handler returned unknown ground position ${reply.groundPositionId}`)
    const k = config.kinematics.sts
    const { segments, end } = planSequence(sts, e.t, variation(ctx), [
      { axis: 'hoist', to: config.layout.stsSafeHoistM, profile: k.hoistLoaded },
      { axis: 'trolley', to: config.layout.stsGroundLaneZ0M + gp.lane * config.layout.stsGroundLaneSpacingM, profile: k.trolley },
      { axis: 'hoist', to: CONTAINER_HEIGHT[box.size], profile: k.hoistLoaded },
    ])
    ctx.schedule('StsGrounded', end + k.unlockS, { equipment: [sts.id], containers: [box.id] }, {
      stsId: sts.id,
      containerId: box.id,
      groundPositionId: gp.id,
      segments,
    })
  },

  StsGrounded: (e, ctx) => {
    const { state, config } = ctx
    const sts = state.sts[e.payload.stsId]
    const box = state.containers[e.payload.containerId]
    // Trusts the handler's choice; the custody invariant catches a bad one.
    state.groundPositions[e.payload.groundPositionId].containerId = box.id
    sts.carrying = null
    sts.status = 'returning'
    ctx.transferCustody(box.id, { kind: 'groundPosition', id: e.payload.groundPositionId })
    state.kpis.movesCompleted++
    const kpi = state.kpis.perSts[sts.id]
    kpi.moves++
    kpi.lastMoveEndS = e.t
    const { segments, end } = planSequence(sts, e.t, variation(ctx), [
      { axis: 'hoist', to: config.layout.stsSafeHoistM, profile: config.kinematics.sts.hoistEmpty },
    ])
    startNextMove(ctx, sts, end, segments)
  },

  StsWorkComplete: (e, ctx) => {
    const { state } = ctx
    state.sts[e.payload.stsId].vesselId = null
    const vessel = state.vessels[e.payload.vesselId]
    const busy = vesselConfig(ctx, vessel.id).stsIds.some((id) => state.sts[id].vesselId === vessel.id)
    if (vessel.dischargeQueue.length === 0 && !busy) {
      ctx.schedule('VesselDeparted', e.t, { vessels: [vessel.id] }, { vesselId: vessel.id })
    }
  },

  VesselDeparted: (e, ctx) => {
    const vessel = ctx.state.vessels[e.payload.vesselId]
    vessel.status = 'departed'
    vessel.departedAt = e.t
    ctx.state.kpis.vesselsCompleted++
  },
}
