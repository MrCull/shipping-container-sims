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
 * Work order per crane (`workPackages.ts`): packages bay by bay (ascending), deck before hold,
 * top tier first, then row; a 20 ft cell aft half before fore half; then the load packages.
 * Berthing, the crane split and vessel departure live in `berth.ts`; the rail in `rail.ts`.
 *
 * Load cycle (export boxes): StsLoadStarted → (StsWaitingForBox → StsBoxWaitEnded while the
 * box has not reached its ground position) → rail reserved, gantry, trolley, hoist down, lock
 * → StsLoadPicked (ground position → STS) → hoist up, trolley over the slot, hoist down, unlock
 * → StsLoaded (STS → vessel slot) → hoist up → next box.
 */
import type { EngineContext, ReactorMap } from '../context'
import { planSegment, type Axis, type AxisProfile, type MotionSegment } from '../kinematics'
import type { StsDrop, StsState } from '../state'
import {
  CONTAINER_HEIGHT_M,
  HALF_OFFSET_M,
  slotX,
  slotZ,
  tierBaseY,
  vesselClass,
} from '../../scenario/vesselClasses'
import { releaseRail, reserveRail, startReposition, wakeRail } from './rail'
import type { PredictedReady } from '../predictions'
import { stsCycleGeometry, stsNominalCycle } from '../cycleTime'
import { hatchEnabled, hatchSettings } from '../hatch'
import { pumpLoadPrep, slotGantryX } from './loadPrep'
import { prepareNextPackage } from './workPackages'
import { deckBoxChanged } from './hatch'
import { laneGraphOf, laneZonesAt } from '../laneGraph'
import { earliestStart, reserve } from '../reservations'

/** [A] Container lengths (m), for the lane sections a set-down covers. */
const CONTAINER_LENGTH_M = { '20': 6.058, '40': 12.192, '40HC': 12.192 } as const

/** Random duration factor for one move phase (1 ± moveVariationPct %). */
export function variation(ctx: EngineContext): number {
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
export function planSequence(
  sts: StsState,
  t0: number,
  f: number,
  moves: { axis: Axis; to: number; profile: AxisProfile }[],
  instant = false,
): { segments: MotionSegment[]; end: number } {
  const segments: MotionSegment[] = []
  let t = t0
  for (const m of moves) {
    const key = m.axis === 'gantry' ? 'gantryX' : m.axis === 'trolley' ? 'trolleyZ' : 'hoistY'
    if (sts[key] === m.to) continue
    const seg = planSegment(sts.id, m.axis, sts[key], m.to, t, scaled(m.profile, f))
    if (instant) seg.t1 = seg.t0 // quay mode instant: the move happens at once
    segments.push(seg)
    sts[key] = m.to
    t = seg.t1
  }
  sts.motion = segments
  return { segments, end: t }
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

/**
 * Continue a crane's work at `at`: the next move of its active work package
 * (starting the next released package first if needed), or StsWorkComplete
 * when all its packages are complete. A crane whose next package is not
 * released yet idles until the release decision answers.
 */
export function continueWork(ctx: EngineContext, sts: StsState, at: number, segments: MotionSegment[] = []): void {
  if (!sts.vesselId) {
    sts.status = 'idle'
    return
  }
  const vesselId = sts.vesselId
  const step = prepareNextPackage(ctx, sts, at)
  if (step === 'waiting') {
    sts.status = 'idle'
    return
  }
  if (step === 'done') {
    sts.status = 'idle'
    ctx.schedule('StsWorkComplete', at, { equipment: [sts.id], vessels: [vesselId] }, { stsId: sts.id, vesselId })
    return
  }
  const active = ctx.state.workPackages[sts.activePackageId as string]
  if (active.hatchPanelId) {
    ctx.schedule('StsHatchStarted', at, { equipment: [sts.id, active.hatchPanelId], vessels: [vesselId] }, {
      stsId: sts.id,
      vesselId,
      packageId: active.id,
      panelId: active.hatchPanelId,
      op: active.kind === 'hatch-remove' ? 'remove' : 'replace',
      segments,
    })
    return
  }
  if (active.kind === 'load') {
    const containerId = sts.workQueue[0]
    const order = ctx.state.loadOrders[containerId]
    ctx.schedule('StsLoadStarted', at, { equipment: [sts.id], vessels: [vesselId], containers: [containerId] }, {
      stsId: sts.id,
      vesselId,
      packageId: active.id,
      containerId,
      slotId: order.slotId,
      segments,
    })
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

/** Quay mode instant: crane motions, locks and unlocks take no time (same events, zero durations). */
export const isInstant = (ctx: Pick<EngineContext, 'state'>): boolean => ctx.state.subsystems.quay === 'instant'

/** Kinematics with lock/unlock times zeroed in quay mode instant. */
export function stsKinematics(ctx: EngineContext) {
  const k = ctx.config.kinematics.sts
  return isInstant(ctx) ? { ...k, lockS: 0, unlockS: 0 } : k
}

/** Run the rail wake-up after a rail change. */
function wake(ctx: EngineContext): void {
  wakeRail(ctx, (sts) => continueWork(ctx, sts, ctx.state.now))
}

/** Default back-off (s) before a waiting STS asks for a ground position again. */
const DEFAULT_STS_GROUND_RETRY_S = 30

export function requestGroundPosition(ctx: EngineContext, sts: StsState, containerId: string, direction?: 'load'): void {
  const { state } = ctx
  const reserved = new Map(sts.drops.map((d) => [d.groundPositionId, d.containerId]))
  ctx.requestDecision(
    'stsGroundPosition',
    {
      stsId: sts.id,
      containerId,
      ...(direction ? { direction } : {}),
      groundPositions: sts.groundPositionIds.map((id) => ({
        id,
        lane: state.groundPositions[id].lane,
        occupiedBy: state.groundPositions[id].containerId ?? state.groundPositions[id].claimedBy ?? reserved.get(id) ?? null,
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
  const k = stsKinematics(ctx)
  const box = state.containers[drop.containerId]
  const gp = state.groundPositions[drop.groundPositionId]
  const f = variation(ctx)
  const moves = [
    { axis: 'hoist' as const, to: liftFirst, profile: k.hoistLoaded },
    { axis: 'trolley' as const, to: config.layout.stsGroundLaneZ0M + gp.lane * config.layout.stsGroundLaneSpacingM, profile: k.trolley },
    { axis: 'hoist' as const, to: CONTAINER_HEIGHT_M[box.size], profile: k.hoistLoaded },
  ]
  // With SHCs, the STS lane under the crane is a conflict zone: the carry starts once the lane
  // section is free for the whole carry and set-down (an SHC may still be driving out of it).
  let start = t0
  if (state.subsystems.shc !== 'off') {
    const dry = planSequence({ ...sts }, 0, f, moves, isInstant(ctx))
    const x = sts.gantryX + spreaderOffset(sts, box.id)
    const windows = laneZonesAt(laneGraphOf(config), gp.lane, x, CONTAINER_LENGTH_M[box.size] / 2).map((zone) => ({
      zone,
      from: 0,
      to: dry.end + k.unlockS,
    }))
    start = earliestStart(state, windows, t0)
    reserve(state, sts.id, windows, start)
  }
  const { segments, end } = planSequence(sts, start, f, moves, isInstant(ctx))
  drop.groundAt = end + k.unlockS
  ctx.schedule('StsGrounded', end + k.unlockS, { equipment: [sts.id], containers: [box.id] }, {
    stsId: sts.id,
    containerId: box.id,
    groundPositionId: gp.id,
    x: sts.gantryX + spreaderOffset(sts, box.id),
    segments,
  })
}

/** How many upcoming boxes per crane the quay predicts beyond those already in flight (TT-R13). */
const PREDICTED_UPCOMING = 2

/**
 * TT-R13: when boxes are expected on the STS ground positions. In flight (the carry is planned): the planned set-down
 * time, exact. Upcoming (next boxes of the work packages): the time the crane is free plus the nominal cycle per box,
 * plus the hatch cycle for each hatch package in front of them. Discharge only; load work needs no SHC at the quay.
 */
export function predictedGroundings(ctx: Pick<EngineContext, 'state' | 'config'>): PredictedReady[] {
  const { state, config } = ctx
  if (state.subsystems.quay === 'off') return []
  const out: PredictedReady[] = []
  const cycleS = isInstant(ctx) ? 0 : stsNominalCycle(config.kinematics.sts, config.layout.stsSafeHoistM, stsCycleGeometry(config)).cycleS
  for (const sts of Object.values(state.sts)) {
    if (!sts.vesselId) continue
    let t = state.now
    for (const d of sts.drops) {
      if (d.groundAt == null) continue
      out.push({ source: 'sts', ownerId: sts.id, readyAt: d.groundAt, containerId: d.containerId, exact: true })
      t = Math.max(t, d.groundAt)
    }
    const hatchS = isInstant(ctx) ? 0 : hatchSettings(config, state.vessels[sts.vesselId].sizeClass).cycleS
    const carried = new Set(sts.carrying)
    let upcoming = 0
    for (const id of sts.packageIds) {
      const pkg = state.workPackages[id]
      if (pkg.status === 'complete') continue
      if (pkg.kind === 'load') break
      if (pkg.kind !== 'discharge') {
        if (hatchEnabled(config)) t += hatchS
        continue
      }
      const boxes = pkg.id === sts.activePackageId ? sts.workQueue : pkg.containerIds
      for (const boxId of boxes) {
        if (carried.has(boxId) || upcoming >= PREDICTED_UPCOMING) continue
        t += cycleS
        upcoming++
        out.push({ source: 'sts', ownerId: sts.id, readyAt: t, containerId: boxId, exact: false })
      }
      if (upcoming >= PREDICTED_UPCOMING) break
    }
  }
  return out
}

/**
 * A ground position of `stsId` was freed (an SHC picked its box). If the
 * STS is waiting for one, it ends the wait and asks again.
 */
export function resumeStsWaitingForGroundPosition(ctx: EngineContext, stsId: string): void {
  const sts = ctx.state.sts[stsId]
  if (sts.status !== 'waiting-for-ground-position') return
  const containerId = sts.carrying.find((id) => !sts.drops.some((d) => d.containerId === id))
  if (!containerId) return
  sts.status = 'waiting-for-decision'
  ctx.schedule('StsGroundPositionWaitEnded', ctx.state.now, { equipment: [sts.id], containers: [containerId] }, {
    stsId: sts.id,
    containerId,
    waitedS: ctx.state.now - (sts.waitingSince ?? ctx.state.now),
  })
}

/** An export box reached a ground position of `stsId`: a crane waiting for it goes on. */
export function resumeStsWaitingForBox(ctx: EngineContext, stsId: string, containerId: string): void {
  const sts = ctx.state.sts[stsId]
  if (sts.status !== 'waiting-for-box' || sts.workQueue[0] !== containerId) return
  ctx.schedule('StsBoxWaitEnded', ctx.state.now, { equipment: [sts.id], containers: [containerId] }, {
    stsId: sts.id,
    containerId,
    waitedS: ctx.state.now - (sts.waitingSince ?? ctx.state.now),
  })
}

export const quayReactors: ReactorMap = {
  /** Load flow: the crane takes its next export box from its ground position (or waits for it) and plans the pick. */
  StsLoadStarted: (e, ctx) => {
    const { state, config } = ctx
    const sts = state.sts[e.payload.stsId]
    const box = state.containers[e.payload.containerId]
    const gp = box.custody.kind === 'groundPosition' ? state.groundPositions[box.custody.id] : null
    if (!gp || gp.stsId !== sts.id) {
      sts.status = 'waiting-for-box'
      sts.waitingSince ??= e.t
      ctx.schedule('StsWaitingForBox', e.t, { equipment: [sts.id], containers: [box.id] }, { stsId: sts.id, containerId: box.id })
      return
    }
    const kpi = state.kpis.perSts[sts.id]
    const targetX = slotGantryX(state, e.payload.slotId)
    const blockedBy = reserveRail(state, config, sts, targetX)
    if (blockedBy !== null) {
      sts.status = 'waiting-for-rail'
      sts.railTargetX = targetX
      kpi.railWaitSince ??= e.t
      ctx.schedule('StsWaitingForRail', e.t, { equipment: [sts.id], vessels: [e.payload.vesselId] }, {
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
    sts.workQueue.shift()
    sts.status = 'loading'
    kpi.firstMoveStartS ??= e.t
    kpi.cycles++
    const k = stsKinematics(ctx)
    const f = variation(ctx)
    const height = CONTAINER_HEIGHT_M[box.size]
    const moves = [
      { axis: 'hoist' as const, to: config.layout.stsSafeHoistM, profile: k.hoistEmpty },
      { axis: 'gantry' as const, to: targetX, profile: k.gantry },
      { axis: 'trolley' as const, to: config.layout.stsGroundLaneZ0M + gp.lane * config.layout.stsGroundLaneSpacingM, profile: k.trolley },
      { axis: 'hoist' as const, to: height, profile: k.hoistEmpty },
    ]
    // With SHCs the lane section under the box is a conflict zone: the pick starts once the SHC that put
    // the box down has driven out of it, and holds it until the box is lifted clear.
    let begin = e.t
    if (state.subsystems.shc !== 'off') {
      const dry = planSequence({ ...sts }, 0, f, moves, isInstant(ctx))
      const lift = isInstant(ctx)
        ? 0
        : planSegment(sts.id, 'hoist', height, config.layout.stsSafeHoistM, 0, k.hoistLoaded).t1 * (1 + config.moveVariationPct / 100)
      const windows = laneZonesAt(laneGraphOf(config), gp.lane, targetX, CONTAINER_LENGTH_M[box.size] / 2).map((zone) => ({
        zone,
        from: 0,
        to: dry.end + k.lockS + lift,
      }))
      begin = earliestStart(state, windows, e.t)
      reserve(state, sts.id, windows, begin)
    }
    const { segments, end } = planSequence(sts, begin, f, moves, isInstant(ctx))
    ctx.schedule('StsLoadPicked', end + k.lockS, { equipment: [sts.id], containers: [box.id] }, {
      stsId: sts.id,
      containerId: box.id,
      groundPositionId: gp.id,
      segments,
    })
  },

  StsWaitingForBox: () => undefined,

  StsBoxWaitEnded: (e, ctx) => {
    const { state } = ctx
    const sts = state.sts[e.payload.stsId]
    sts.waitingSince = null
    sts.status = 'idle'
    const waits = state.kpis.horizontal?.stsGroundPositionWaitS
    if (waits) waits[sts.id] = (waits[sts.id] ?? 0) + e.payload.waitedS
    continueWork(ctx, sts, e.t)
  },

  /** Spreader locked on the export box: lift it clear, carry it over its slot and lower it. */
  StsLoadPicked: (e, ctx) => {
    const { state, config } = ctx
    const sts = state.sts[e.payload.stsId]
    const box = state.containers[e.payload.containerId]
    const gp = state.groundPositions[e.payload.groundPositionId]
    const order = state.loadOrders[box.id]
    delete state.loadOrders[box.id]
    gp.containerId = null
    sts.carrying = [box.id]
    ctx.transferCustody(box.id, { kind: 'sts', id: sts.id })
    releaseRail(sts)
    const slot = state.vesselSlots[order.slotId]
    const spec = vesselClass(state.vessels[slot.vesselId].sizeClass)
    const k = stsKinematics(ctx)
    const { segments, end } = planSequence(sts, e.t, variation(ctx), [
      { axis: 'hoist', to: config.layout.stsSafeHoistM, profile: k.hoistLoaded },
      { axis: 'trolley', to: slotZ(spec, slot.row), profile: k.trolley },
      { axis: 'hoist', to: tierBaseY(spec, slot.tier) + CONTAINER_HEIGHT_M[box.size], profile: k.hoistLoaded },
    ], isInstant(ctx))
    ctx.schedule('StsLoaded', end + k.unlockS, { equipment: [sts.id], containers: [box.id], vessels: [slot.vesselId] }, {
      stsId: sts.id,
      vesselId: slot.vesselId,
      containerId: box.id,
      slotId: slot.id,
      segments,
    })
    pumpLoadPrep(ctx) // the ground position is free: the next export box may be staged
    resumeStsWaitingForGroundPosition(ctx, sts.id)
    wake(ctx)
  },

  /** Export box released in its vessel slot: custody STS → vessel slot. */
  StsLoaded: (e, ctx) => {
    const { state, config } = ctx
    const sts = state.sts[e.payload.stsId]
    const box = state.containers[e.payload.containerId]
    const slot = state.vesselSlots[e.payload.slotId]
    slot.containerId = box.id
    sts.carrying = []
    ctx.transferCustody(box.id, { kind: 'vesselSlot', id: slot.id })
    if (slot.deck) deckBoxChanged(ctx, slot.vesselId, slot.bay, slot.row, 1)
    state.vessels[slot.vesselId].remainingLoad--
    state.kpis.movesCompleted++
    state.kpis.workPackages.boxesLoaded++
    const kpi = state.kpis.perSts[sts.id]
    kpi.moves++
    kpi.lastMoveEndS = e.t
    sts.status = 'returning'
    const { segments, end } = planSequence(sts, e.t, variation(ctx), [
      { axis: 'hoist', to: config.layout.stsSafeHoistM, profile: config.kinematics.sts.hoistEmpty },
    ], isInstant(ctx))
    continueWork(ctx, sts, end, segments)
  },

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
    const k = stsKinematics(ctx)
    const { segments, end } = planSequence(sts, e.t, variation(ctx), [
      { axis: 'hoist', to: config.layout.stsSafeHoistM, profile: k.hoistEmpty },
      { axis: 'gantry', to: targetX, profile: k.gantry },
      { axis: 'trolley', to: slotZ(spec, slot.row), profile: k.trolley },
      { axis: 'hoist', to: tierBaseY(spec, slot.tier) + tallest, profile: k.hoistEmpty },
    ], isInstant(ctx))
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
      const pickedSlot = state.vesselSlots[p.from.id]
      pickedSlot.containerId = null
      if (pickedSlot.deck) deckBoxChanged(ctx, pickedSlot.vesselId, pickedSlot.bay, pickedSlot.row, -1)
      const vessel = state.vessels[state.vesselSlots[p.from.id].vesselId]
      vessel.remainingDischarge--
      ctx.transferCustody(p.containerId, { kind: 'sts', id: sts.id })
    }
    requestGroundPosition(ctx, sts, picks[0].containerId)
    wake(ctx)
  },

  /** Back-off elapsed: ask again unless a freed position already ended this wait. */
  StsGroundPositionWaitBackoff: (e, ctx) => {
    const sts = ctx.state.sts[e.payload.stsId]
    if (sts.waitingSince !== e.payload.waitSince) return
    resumeStsWaitingForGroundPosition(ctx, sts.id)
  },

  StsGroundPositionWaitEnded: (e, ctx) => {
    const { state } = ctx
    const sts = state.sts[e.payload.stsId]
    sts.waitingSince = null
    const waits = state.kpis.horizontal?.stsGroundPositionWaitS
    if (waits) waits[sts.id] = (waits[sts.id] ?? 0) + e.payload.waitedS
    requestGroundPosition(ctx, sts, e.payload.containerId)
  },

  /** Ground-position reply: once every carried box has a position, carry the first one there (or wait if none). */
  DecisionResolved: (e, ctx) => {
    if (e.payload.decisionPoint !== 'stsGroundPosition' || e.payload.request.direction === 'load') return
    const { state, config } = ctx
    const { request, reply } = e.payload
    const sts = state.sts[request.stsId]
    const box = state.containers[request.containerId]
    if (reply.groundPositionId === null) {
      sts.status = 'waiting-for-ground-position'
      sts.waitingSince = e.t
      ctx.schedule('StsWaitingForGroundPosition', e.t, { equipment: [sts.id], containers: [box.id] }, {
        stsId: sts.id,
        containerId: box.id,
      })
      const backoff = config.layout.stsGroundRetryS ?? DEFAULT_STS_GROUND_RETRY_S
      if (backoff > 0)
        ctx.schedule('StsGroundPositionWaitBackoff', e.t + backoff, { equipment: [sts.id], containers: [box.id] }, {
          stsId: sts.id,
          containerId: box.id,
          waitSince: e.t,
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
    ], isInstant(ctx))
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
