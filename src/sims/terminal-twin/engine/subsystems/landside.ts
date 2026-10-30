/**
 * Landside subsystem (TT-13): external trucks bring boxes into the terminal and
 * take them away.
 *
 * Arrivals: a non-homogeneous Poisson process driven by the hourly profile
 * (`config.landside.hourlyProfile`, trucks per clock hour) plus scripted
 * trucks. Each arrival (`TruckArrivalDue`) draws a transaction from the mix,
 * restricted to what the terminal can serve right now (demand consistency):
 *
 *   pickImport / pickEmpty  a box that stands in the yard and whose dwell has elapsed
 *   dropExport              a vessel inside its export window (default 1–5 days before ETA)
 *   dropEmpty               always possible; also the fallback when nothing else is
 *   dual                    drop an export and pick an import in one visit
 *
 * Truck turn (events in order):
 *   TruckArrived (the truck queues at the gate) → gateLaneAssignment decision →
 *   TruckGateStarted (drives to the kiosk of its lane) → TruckGateIn (processed) →
 *   transferStallSelection decision → TruckStallAssigned (trip planned, reserved) →
 *   TruckRoutingToStall → TruckAtStall → the landside ASC works the chassis
 *   (asc.ts: AscPickedFromTruck / AscDroppedAtStall) → TruckInterchangeDone →
 *   TruckRoutingToExit (reverses out, outbound lane) → TruckGateOut → TruckDeparted.
 *
 * Trucks drive the landside road graph only (`engine/landsideGraph.ts`), never
 * the waterside lane graph; invariant `landside.segregation` checks it.
 *
 * Modes: real (kinematics), instant (same events, zero durations), off (no trucks).
 */
import type { EngineContext, ReactorMap } from '../context'
import type { EventOf, TruckLegInfo } from '../events'
import { planSegment, positionAt, type AxisProfile, type MotionSegment } from '../kinematics'
import {
  landsideGraphOf,
  landsideRoute,
  queueSlotZ,
  type GateLaneLayout,
  type HoldingLayout,
  type LandsideGraph,
} from '../landsideGraph'
import { earliestStart, mergeWindows, reserve, type WindowSpec } from '../reservations'
import { nextRandom } from '../rng'
import type {
  AscJob,
  ContainerState,
  LandsideKpiCounters,
  LandsideState,
  SimState,
  TruckLeg,
  TruckPlannedEvent,
  TruckState,
  TruckStatus,
} from '../state'
import { blockSpecs, parseYardSlotId } from '../yardLayout'
import { kpiClockOf, HOUR_S } from '../kpi/clock'
import { makeIso6346Id } from '../../scenario/iso6346'
import { LINE_OWNER_PREFIX } from '../../scenario/lines'
import { isReefer } from '../../scenario/reefer'
import { extraLoadCell, pickWeighted, POOL_VESSEL_ID } from '../../scenario/bayPlan'
import { makeContainerState } from '../../scenario/containerFactory'
import { drawContainerProps } from '../../scenario/containerProps'
import { sampleDwell } from '../../scenario/dwell'
import { compareKeys, loadSequenceKey } from '../../scenario/exportYard'
import type { ContainerSize, LandsideConfig, TruckTransactionKind } from '../../scenario/types'
import { DEFAULT_LANDSIDE } from '../../scenario/builder'
import { vesselSlotId } from '../../scenario/vesselClasses'
import { appointmentWindowS, planAppointments } from '../appointments'
import { maybeDispatchAsc, pumpAllocation } from './asc'
import { TripBuilder, waypoints } from './shc'

type PlannedType = TruckPlannedEvent['type']

const STATUS_AFTER: Record<PlannedType, TruckStatus | null> = {
  TruckGateIn: 'waiting-for-stall',
  TruckRoutingToHolding: 'routing-to-holding',
  TruckAtHolding: 'holding',
  TruckRoutingToStall: 'routing-to-stall',
  TruckAtStall: 'at-stall',
  TruckRoutingToExit: 'routing-to-exit',
  TruckGateOut: null,
  TruckDeparted: null,
}

/** [A] Seconds between 'a truck is in the queue' and its first move: none. A truck that leaves the stall waits for no one. */
const DEFAULT_DRIVE: AxisProfile = DEFAULT_LANDSIDE.drive as AxisProfile

export const landsideOf = (config: { landside?: LandsideConfig }): LandsideConfig => config.landside as LandsideConfig

const landside = (state: SimState): LandsideState => state.landside as LandsideState
const counters = (state: SimState): LandsideKpiCounters => state.kpis.landside as LandsideKpiCounters
const driveOf = (ctx: EngineContext): AxisProfile => ctx.config.landside?.drive ?? DEFAULT_DRIVE
const isInstant = (state: SimState): boolean => state.subsystems.landside === 'instant'
const r3 = (n: number) => Math.round(n * 1000) / 1000

/** Uniform [0, 1) from the landside's own RNG stream. */
export function landsideRandom(state: SimState): number {
  const ls = landside(state)
  const [value, next] = nextRandom(ls.rngState)
  ls.rngState = next
  return value
}

/** Truck serial id: T0001, T0002, … */
const truckId = (n: number) => `T${String(n).padStart(4, '0')}`

// ── arrival process ─────────────────────────────────────────────────────────

/** Next arrival of the hourly Poisson process after `t` (null when the profile never has a positive rate). */
export function nextPoissonArrival(ctx: EngineContext, t: number): number | null {
  const cfg = landsideOf(ctx.config)
  const clock = kpiClockOf(ctx.config)
  let cur = t
  for (let guard = 0; guard < 24 * 8; guard++) {
    const abs = clock.startTimeOfDayS + cur
    const hourIndex = Math.floor(abs / HOUR_S)
    const hourEnd = (hourIndex + 1) * HOUR_S - clock.startTimeOfDayS
    const rate = (cfg.hourlyProfile[((hourIndex % 24) + 24) % 24] ?? 0) / HOUR_S
    if (rate > 0) {
      const dt = -Math.log(1 - landsideRandom(ctx.state)) / rate
      if (cur + dt < hourEnd) return cur + dt
    }
    cur = hourEnd
  }
  return null
}

// ── demand ──────────────────────────────────────────────────────────────────

/** Boxes a truck may collect now: in a stack, dwell elapsed, not claimed. `full`: imports; else empties. */
export function eligiblePickups(state: SimState, full: boolean): ContainerState[] {
  const out: ContainerState[] = []
  scanPickups(state, full, (box) => {
    out.push(box)
    return false
  })
  return out.sort((a, b) => (a.id < b.id ? -1 : 1))
}

/** Whether any box is eligible for a pickup: `eligiblePickups(...).length > 0` without listing the yard (stops at the first). */
export function hasEligiblePickup(state: SimState, full: boolean): boolean {
  return scanPickups(state, full, () => true)
}

/** Visits the eligible boxes in slot order until `visit` returns true (then true). */
function scanPickups(state: SimState, full: boolean, visit: (box: ContainerState) => boolean): boolean {
  for (const slot of Object.values(state.yardSlots)) {
    if (!slot.containerId) continue
    const box = state.containers[slot.containerId]
    if (box.full !== full) continue
    if (box.pickupReadyAt === undefined || box.pickupReadyAt > state.now) continue
    if (box.truckClaim !== undefined || box.allocatedTo !== undefined) continue
    if (box.custody.kind !== 'yardSlot' || box.custody.id !== slot.id) continue
    if (visit(box)) return true
  }
  return false
}

/** An empty or warm-up yard start (TT-14): the boxes booked to the vessels are delivered by trucks. */
export const trucksDeliverBookings = (config: { yardStart?: { mode: string } }): boolean =>
  config.yardStart?.mode === 'empty' || config.yardStart?.mode === 'warmup'

/** Boxes booked to a vessel that no truck has delivered yet, in load sequence (empty start only). */
export function undeliveredBookings(ctx: EngineContext, vesselId: string): ContainerState[] {
  if (!trucksDeliverBookings(ctx.config)) return []
  const { state } = ctx
  const found: { key: number[]; box: ContainerState }[] = []
  for (const slot of Object.values(state.vesselSlots)) {
    if (slot.vesselId !== vesselId || !slot.plannedContainerId || slot.containerId !== null) continue
    const box = state.containers[slot.plannedContainerId]
    if (box && box.custody.kind === 'external' && box.truckClaim === undefined) found.push({ key: loadSequenceKey(slot), box })
  }
  return found.sort((a, b) => compareKeys(a.key, b.key)).map((f) => f.box)
}

/**
 * Vessels a truck may deliver an export box for now, with the number of boxes to deliver (weights). Normally the
 * vessels inside their export window that load something; with an empty start, any vessel that still lacks booked
 * boxes and whose window is open (min to max before ETA), or that has arrived (its load waits for the trucks).
 */
export function exportVessels(ctx: EngineContext): { vesselId: string; weight: number }[] {
  const cfg = landsideOf(ctx.config)
  const { state } = ctx
  const out: { vesselId: string; weight: number }[] = []
  if (trucksDeliverBookings(ctx.config)) {
    for (const v of ctx.config.vessels) {
      if (state.vessels[v.id].status === 'departed') continue
      const n = undeliveredBookings(ctx, v.id).length
      const untilEta = v.arrivalS - state.now
      // inside the window; once the vessel has arrived its load waits for the remaining boxes, so late trucks still count
      const inWindow = untilEta <= cfg.exportWindow.maxBeforeEtaS && (untilEta >= cfg.exportWindow.minBeforeEtaS || untilEta <= 0)
      if (n > 0 && inWindow) out.push({ vesselId: v.id, weight: n })
    }
    return out
  }
  for (const v of ctx.config.vessels) {
    if (state.vessels[v.id].status !== 'scheduled') continue
    const untilEta = v.arrivalS - state.now
    if (v.load > 0 && untilEta >= cfg.exportWindow.minBeforeEtaS && untilEta <= cfg.exportWindow.maxBeforeEtaS && extraLoadCellOf(ctx, v.id, '40'))
      out.push({ vesselId: v.id, weight: v.load })
  }
  return out
}

/** The next free cell of a vessel's bay plan for a delivered export box (legacy or pre-filled start), or null when full. */
function extraLoadCellOf(ctx: EngineContext, vesselId: string, size: ContainerSize) {
  return extraLoadCell(ctx.state.vessels[vesselId].sizeClass, Object.values(ctx.state.vesselSlots).filter((s) => s.vesselId === vesselId), size, ctx.state.vessels[vesselId].robBays)
}

/**
 * V11-14: book a box a truck delivers (legacy or pre-filled start) against the vessel's bay plan: a new load slot
 * above the vessel's other load boxes, so the load flow fetches it like a booked one. Returns the slot id.
 */
function bookExtraExport(ctx: EngineContext, box: ContainerState, vesselId: string): string {
  const { state } = ctx
  const cell = extraLoadCellOf(ctx, vesselId, box.size) as NonNullable<ReturnType<typeof extraLoadCellOf>>
  const id = vesselSlotId(vesselId, cell.bay, cell.row, cell.tier, cell.half)
  state.vesselSlots[id] = { id, vesselId, ...cell, purpose: 'load', containerId: null, plannedContainerId: box.id }
  if (state.subsystems.shc !== 'off' && state.subsystems.asc !== 'off') state.vessels[vesselId].remainingLoad++
  return id
}

function newBox(ctx: EngineContext, owner: string, full: boolean, vesselId: string): ContainerState {
  const { state, config } = ctx
  const rng = () => landsideRandom(state)
  const size = pickWeighted<ContainerSize>(config.cargo.sizeMix, rng)
  const line = pickWeighted<string>(config.cargo.lines, rng)
  const ls = landside(state)
  let id = makeIso6346Id(LINE_OWNER_PREFIX[line], 500000 + ls.nextBox++)
  while (state.containers[id]) id = makeIso6346Id(LINE_OWNER_PREFIX[line], 500000 + ls.nextBox++)
  const custody = { kind: 'truck' as const, id: owner }
  const reefer = isReefer(config.cargo, id, full)
  const box = makeContainerState({
    id,
    size,
    full,
    line,
    vesselId,
    owner: custody,
    t: state.now,
    eventId: ctx.current.id,
    truckClaim: owner,
    reefer,
    props: drawContainerProps(config, state.propsSeed, {
      id,
      size,
      full,
      line,
      reefer,
      direction: full ? 'EXPORT' : 'STORAGE', // a truck brings either an export (booked to `vesselId`) or an empty for storage
      inbound: { kind: 'truck', id: owner },
      outboundVesselId: full ? vesselId : undefined,
      arrivalS: state.now,
    }),
  })
  state.containers[id] = box
  return box
}

interface Plan {
  transaction: TruckTransactionKind
  fallback: boolean
}

/** Which transactions the terminal can serve now. */
function feasibleKinds(ctx: EngineContext): Record<TruckTransactionKind, boolean> {
  const { state } = ctx
  const exports = exportVessels(ctx).length > 0
  const imports = hasEligiblePickup(state, true)
  const empties = hasEligiblePickup(state, false)
  return { dropExport: exports, pickImport: imports, dropEmpty: true, pickEmpty: empties, dual: exports && imports }
}

/** Draw the transaction: the mix restricted to what is feasible; an infeasible scripted request or an empty mix falls back to dropEmpty. */
function drawTransaction(ctx: EngineContext, forced: TruckTransactionKind | undefined): Plan {
  const feasible = feasibleKinds(ctx)
  const rng = () => landsideRandom(ctx.state)
  if (forced) return feasible[forced] ? { transaction: forced, fallback: false } : { transaction: 'dropEmpty', fallback: true }
  const weights: Partial<Record<TruckTransactionKind, number>> = {}
  let total = 0
  for (const [kind, w] of Object.entries(landsideOf(ctx.config).mix) as [TruckTransactionKind, number][])
    if (w > 0 && feasible[kind]) {
      weights[kind] = w
      total += w
    }
  const drawn = total > 0 ? pickWeighted(weights, rng) : 'dropEmpty'
  // the draw above is always taken, so a mix with no feasible kind does not change the stream
  return { transaction: drawn, fallback: total === 0 && Object.values(landsideOf(ctx.config).mix).some((w) => (w ?? 0) > 0) }
}

/** Build the legs of a transaction at `ctx.state.now`, creating the boxes that ride in and claiming the ones that leave. */
function makeLegs(ctx: EngineContext, truck: string, transaction: TruckTransactionKind): TruckLeg[] {
  const { state } = ctx
  const rng = () => landsideRandom(state)
  const legs: TruckLeg[] = []
  const drop = (purpose: 'export' | 'empty') => {
    if (purpose === 'export') {
      const vessels = exportVessels(ctx)
      const total = vessels.reduce((s, v) => s + v.weight, 0)
      let r = rng() * total
      let chosen = vessels[vessels.length - 1]
      for (const v of vessels) {
        r -= v.weight
        if (r < 0) {
          chosen = v
          break
        }
      }
      const open = undeliveredBookings(ctx, chosen.vesselId)
      const booked: ContainerState | undefined = open[open.length - 1]
      if (booked) {
        // an empty start: the truck brings the box booked to the vessel (the last in load sequence first, so the box loaded first ends up on top)
        booked.truckClaim = truck
        ctx.transferCustody(booked.id, { kind: 'truck', id: truck })
      }
      const box = booked ?? newBox(ctx, truck, true, chosen.vesselId)
      const slotId = booked ? undefined : bookExtraExport(ctx, box, chosen.vesselId)
      legs.push({ kind: 'drop', purpose, containerId: box.id, vesselId: chosen.vesselId, ...(slotId ? { slotId } : {}), done: false })
    } else {
      const box = newBox(ctx, truck, false, POOL_VESSEL_ID)
      legs.push({ kind: 'drop', purpose, containerId: box.id, done: false })
    }
  }
  const pick = (purpose: 'import' | 'empty') => {
    const candidates = eligiblePickups(state, purpose === 'import')
    const box = candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))]
    box.truckClaim = truck
    legs.push({ kind: 'pick', purpose, containerId: box.id, done: false })
  }
  switch (transaction) {
    case 'dropExport':
      drop('export')
      break
    case 'pickImport':
      pick('import')
      break
    case 'dropEmpty':
      drop('empty')
      break
    case 'pickEmpty':
      pick('empty')
      break
    case 'dual':
      drop('export')
      pick('import')
      break
  }
  return legs
}

// ── truck motion helpers ────────────────────────────────────────────────────

/** Time and position at which the truck's planned motion on `axis` ends (null if it has none). */
function restOf(truck: TruckState, axis: 'x' | 'z'): { at: number; pos: number } | null {
  let last: MotionSegment | null = null
  for (const s of truck.motion) if (s.axis === axis && (last === null || s.t1 >= last.t1)) last = s
  return last ? { at: last.t1, pos: last.to } : null
}

/** Truck position (plan view) at `t` from its current plan; at rest it is at its node. */
export function truckPositionAt(graph: LandsideGraph, truck: TruckState, t: number): { x: number; z: number } {
  const node = graph.nodes[truck.nodeId]
  const axis = (a: 'x' | 'z', rest: number): number => {
    let last: MotionSegment | null = null
    let first: MotionSegment | null = null
    for (const s of truck.motion) {
      if (s.axis !== a) continue
      first ??= s
      if (s.t0 <= t) last = s
    }
    if (last) return positionAt(last, t)
    return first ? first.from : rest
  }
  return { x: axis('x', node.x), z: axis('z', node.z) }
}

/** Shift a relative trip to start at `start` and install it as the truck's plan. */
function install(truck: TruckState, trip: TripBuilder<PlannedType>, start: number): void {
  const segments = trip.segments.map((s) => ({ ...s, t0: s.t0 + start, t1: s.t1 + start }))
  truck.motion = segments
  let prevAt = -Infinity
  truck.plan = trip.marks.map((m) => {
    const at = m.at + start
    const mine = segments.filter((s) => s.t1 <= at + 1e-9 && s.t1 > prevAt + 1e-9)
    prevAt = at
    return { type: m.type, at, segments: mine }
  })
}

function scheduleNext(ctx: EngineContext, truck: TruckState): void {
  const next = truck.plan[0]
  if (!next) return
  const subjects = { equipment: [truck.id], containers: truck.carrying ? [truck.carrying] : undefined }
  const base = { truckId: truck.id, segments: next.segments }
  switch (next.type) {
    case 'TruckGateIn':
      ctx.schedule(next.type, next.at, subjects, { ...base, laneId: truck.laneId as string, processingS: next.processingS ?? 0 })
      break
    case 'TruckRoutingToHolding':
      ctx.schedule(next.type, next.at, subjects, { ...base, holdingId: truck.holdingId as string, laneId: truck.laneId as string })
      break
    case 'TruckAtHolding':
      ctx.schedule(next.type, next.at, subjects, { ...base, holdingId: truck.holdingId as string })
      break
    case 'TruckRoutingToStall':
      ctx.schedule(next.type, next.at, subjects, { ...base, stallId: truck.stallId as string, laneId: truck.laneId as string })
      break
    case 'TruckAtStall':
      ctx.schedule(next.type, next.at, subjects, { ...base, stallId: truck.stallId as string })
      break
    case 'TruckRoutingToExit':
      break // scheduled by planExit with its reservations
    case 'TruckGateOut':
      ctx.schedule(next.type, next.at, subjects, { ...base, laneId: truck.outLaneId as string, turnS: r3(next.at - (truck.gateInAt ?? next.at)) })
      break
    case 'TruckDeparted':
      ctx.schedule(next.type, next.at, { equipment: [truck.id] }, base)
      break
  }
}

/** Common phase handling: pop the plan, set the status, schedule the next phase. */
function advance(ctx: EngineContext, e: EventOf<PlannedType>): TruckState {
  const truck = ctx.state.trucks[e.payload.truckId]
  const head = truck.plan.shift()
  if (head?.type !== e.type) throw new Error(`${truck.id}: unexpected ${e.type} (planned ${head?.type ?? 'nothing'})`)
  const status = STATUS_AFTER[e.type]
  if (status) truck.status = status
  scheduleNext(ctx, truck)
  return truck
}

const graphOf = (ctx: EngineContext): LandsideGraph => landsideGraphOf(ctx.config)

function processingTime(ctx: EngineContext, meanS: number): number {
  if (isInstant(ctx.state)) return 0
  const pct = landsideOf(ctx.config).gate.processingVariationPct ?? 0
  return pct === 0 ? meanS : Math.max(0, meanS * (1 + ((landsideRandom(ctx.state) * 2 - 1) * pct) / 100))
}

// ── gate queue ──────────────────────────────────────────────────────────────

/** The queued trucks' motion: each moves up to its slot (rest to rest, starting once its last move is over). */
function planQueueMoves(ctx: EngineContext): void {
  const { state } = ctx
  const graph = graphOf(ctx)
  const ls = landside(state)
  ls.queue.forEach((id, index) => {
    const truck = state.trucks[id]
    truck.queueIndex = index
    const rest = restOf(truck, 'z')
    const target = queueSlotZ(graph, index)
    const from = rest ? rest.pos : graph.gate.spawnZ
    if (Math.abs(from - target) < 1e-9) return
    const seg = planSegment(id, 'z', from, target, Math.max(state.now, rest?.at ?? state.now), driveOf(ctx))
    if (isInstant(state)) seg.t1 = seg.t0
    truck.motion = [seg]
  })
}

/** Ask gateLaneAssignment for the head of the queue when a lane is free (one request at a time). */
function pumpGate(ctx: EngineContext): void {
  const { state } = ctx
  const ls = landside(state)
  if (ls.laneAsking !== null || ls.queue.length === 0) return
  const graph = graphOf(ctx)
  if (!graph.inLanes.some((l) => ls.inLanes[l.id].truckId === null)) return
  const truck = state.trucks[ls.queue[0]]
  if (holdingOn(ctx)) {
    // TT-R16: a truck passes the gate only with a stall or a holding position reserved; one decision at a time
    if (ls.stallAsking !== null) return
    if (truck.stallId === null && truck.holdingId === null && !admit(ctx, truck)) return
  }
  ls.laneAsking = truck.id
  ctx.requestDecision(
    'gateLaneAssignment',
    {
      truckId: truck.id,
      transaction: truck.transaction,
      queueLength: ls.queue.length,
      waitedS: r3(state.now - truck.arrivedAt),
      lanes: graph.inLanes.map((l) => ({
        laneId: l.id,
        index: l.index,
        free: ls.inLanes[l.id].truckId === null,
        processed: ls.inLanes[l.id].processed,
      })),
    },
    { equipment: [truck.id] },
  )
}

function gateTrip(ctx: EngineContext, truck: TruckState, lane: GateLaneLayout): { trip: TripBuilder<PlannedType>; processingS: number } {
  const graph = graphOf(ctx)
  const trip = new TripBuilder<PlannedType>(graph, truck.id, waypoints(graph, [graph.gate.queueHeadNode])[0], isInstant(ctx.state))
  const path = landsideRoute(graph, graph.gate.queueHeadNode, lane.kioskNode)
  trip.driveThrough(waypoints(graph, path).slice(1), driveOf(ctx))
  const processingS = processingTime(ctx, landsideOf(ctx.config).gate.inProcessingS)
  trip.dwell(processingS)
  trip.mark('TruckGateIn')
  return { trip, processingS }
}

function resolveLane(ctx: EngineContext, truckId: string, laneId: string | null): void {
  const { state } = ctx
  const ls = landside(state)
  ls.laneAsking = null
  if (laneId === null) return
  const graph = graphOf(ctx)
  const lane = graph.inLanes.find((l) => l.id === laneId)
  if (!lane) throw new Error(`gateLaneAssignment handler returned ${laneId}, which is not an inbound lane (${graph.inLanes.map((l) => l.id).join(', ')})`)
  if (ls.inLanes[laneId].truckId !== null)
    throw new Error(`gateLaneAssignment handler returned ${laneId} for ${truckId}, but that lane is busy with ${ls.inLanes[laneId].truckId}`)
  if (ls.queue[0] !== truckId) {
    pumpGate(ctx) // the queue changed while the reply was on its way
    return
  }
  const truck = state.trucks[truckId]
  ls.queue.shift()
  ls.inLanes[laneId].truckId = truckId
  truck.status = 'in-lane'
  truck.laneId = laneId
  truck.gateStartedAt = state.now
  truck.queueIndex = -1
  const k = counters(state)
  const waited = state.now - truck.arrivedAt
  k.gateWaitSumS += waited
  k.gateWaitMaxS = Math.max(k.gateWaitMaxS, waited)
  const rest = restOf(truck, 'z')
  const start = Math.max(state.now, rest?.at ?? state.now)
  const { trip, processingS } = gateTrip(ctx, truck, lane)
  install(truck, trip, start)
  truck.plan[0].processingS = r3(processingS)
  truck.nodeId = lane.kioskNode
  ctx.schedule('TruckGateStarted', state.now, { equipment: [truck.id] }, {
    truckId,
    laneId,
    queueWaitS: r3(waited),
    queueLength: ls.queue.length,
  })
  planQueueMoves(ctx)
}

// ── transfer stalls ─────────────────────────────────────────────────────────

const stallOptions = (ctx: EngineContext, from: string) => {
  const { state } = ctx
  const graph = graphOf(ctx)
  const ls = landside(state)
  return graph.stalls.map((s) => ({
    stallId: s.id,
    blockId: s.blockId,
    x: s.x,
    z: s.z,
    occupiedBy: ls.stalls[s.id].truckId,
    distanceM: roadDistance(graph, from, graph.stallNode[s.id]),
  }))
}

const distCache = new WeakMap<LandsideGraph, Map<string, number>>()
function roadDistance(graph: LandsideGraph, from: string, to: string): number {
  let cache = distCache.get(graph)
  if (!cache) distCache.set(graph, (cache = new Map()))
  const key = `${from}>${to}`
  let d = cache.get(key)
  if (d === undefined) {
    const path = landsideRoute(graph, from, to)
    d = 0
    for (let i = 1; i < path.length; i++) d += Math.abs(graph.nodes[path[i]].x - graph.nodes[path[i - 1]].x) + Math.abs(graph.nodes[path[i]].z - graph.nodes[path[i - 1]].z)
    cache.set(key, d)
  }
  return d
}

/** Block of a yard-slot id. */
const blockOfSlot = (slotId: string): string => parseYardSlotId(slotId).blockId

/** The blocks whose stalls a truck may use: the block holding the box it picks (an ASC only reaches the stalls of its own block); every block for a drop. */
function legalBlocks(ctx: EngineContext, truck: TruckState): Set<string> | null {
  const blocks = new Set<string>()
  for (const leg of truck.legs) {
    const box = ctx.state.containers[leg.containerId]
    if (leg.kind === 'pick' && box.custody.kind === 'yardSlot') blocks.add(blockOfSlot(box.custody.id))
  }
  return blocks.size > 0 ? blocks : null
}

/** Ask transferStallSelection for `truck` (one request at a time): the stalls it may use, from where it stands now. */
function askStall(ctx: EngineContext, truck: TruckState): void {
  const { state } = ctx
  const ls = landside(state)
  const blocks = legalBlocks(ctx, truck)
  const blockLoad: Record<string, number> = Object.fromEntries(blockSpecs(ctx.config).map((b) => [b.id, 0]))
  for (const st of Object.values(ls.stalls)) if (st.truckId !== null) blockLoad[st.blockId]++
  for (const other of ls.stallWaiting.includes(truck.id) ? ls.stallWaiting : [...ls.stallWaiting, truck.id]) {
    const b = legalBlocks(ctx, state.trucks[other])
    if (b !== null) for (const x of b) blockLoad[x]++
  }
  ls.stallAsking = truck.id
  ctx.requestDecision(
    'transferStallSelection',
    {
      truckId: truck.id,
      transaction: truck.transaction,
      legs: truck.legs.map((l) => {
        const box = state.containers[l.containerId]
        return {
          kind: l.kind,
          purpose: l.purpose,
          containerId: l.containerId,
          size: box.size,
          blockId: l.kind === 'pick' && box.custody.kind === 'yardSlot' ? blockOfSlot(box.custody.id) : null,
        }
      }),
      stalls: stallOptions(ctx, truck.nodeId).filter((o) => blocks === null || blocks.has(o.blockId)),
      blockLoad,
    },
    { equipment: [truck.id] },
  )
}

/**
 * Ask transferStallSelection for the first waiting truck that has a free stall it may use (one request at a
 * time). A truck whose block has no free stall does not hold up the trucks behind it.
 */
function pumpStalls(ctx: EngineContext): void {
  const { state } = ctx
  const ls = landside(state)
  if (ls.stallAsking !== null || ls.stallWaiting.length === 0) return
  const graph = graphOf(ctx)
  for (const id of ls.stallWaiting) {
    const truck = state.trucks[id]
    const blocks = legalBlocks(ctx, truck)
    const legal = graph.stalls.filter((s) => (blocks === null || blocks.has(s.blockId)))
    if (!legal.some((s) => ls.stalls[s.id].truckId === null)) continue
    askStall(ctx, truck)
    return
  }
}

// ── stall admission and holding (TT-R16) ────────────────────────────────────

/** True when the scenario has holding positions: the gate then admits trucks against stall and holding capacity. */
const holdingOn = (ctx: EngineContext): boolean => Object.keys(landside(ctx.state).holding).length > 0

/** TT-R18: close the holding-use integral up to now; call before the occupied count changes. */
function touchHolding(state: SimState): void {
  const k = counters(state)
  k.holdBusyS += holdingInUse(state) * (state.now - k.holdLastT)
  k.holdLastT = state.now
}

/** TT-R18: a truck starts (`+1`) or ends (`-1`) a drive on the internal roads; `driveS` accumulates its inbound driving. */
function driveStep(state: SimState, truck: TruckState, delta: 1 | -1, inbound: boolean): void {
  const k = counters(state)
  k.roadBusyS += k.roadNow * (state.now - k.roadLastT)
  k.roadLastT = state.now
  k.roadNow += delta
  k.roadMax = Math.max(k.roadMax, k.roadNow)
  if (delta === 1) truck.driveSince = state.now
  else {
    if (inbound && truck.driveSince !== null) truck.driveS += state.now - truck.driveSince
    truck.driveSince = null
  }
}

const holdingInUse = (state: SimState): number => Object.values(landside(state).holding).filter((h) => h.truckId !== null).length

/**
 * Admission of the head of the gate queue (called with a free inbound lane). A stall that can take it is reserved first
 * (the transferStallSelection decision, answered later: returns false and the reply re-runs the gate); with none free a
 * free holding position is reserved (true: the truck may go through); with holding full the truck stays outside the gate.
 */
function admit(ctx: EngineContext, truck: TruckState): boolean {
  const { state } = ctx
  const ls = landside(state)
  const graph = graphOf(ctx)
  const blocks = legalBlocks(ctx, truck)
  if (graph.stalls.some((s) => (blocks === null || blocks.has(s.blockId)) && ls.stalls[s.id].truckId === null)) {
    askStall(ctx, truck)
    return false
  }
  const free = Object.values(ls.holding).find((h) => h.truckId === null)
  if (free) {
    touchHolding(state)
    free.truckId = truck.id
    truck.holdingId = free.id
    const k = counters(state)
    k.admittedToHolding++
    k.holdingMax = Math.max(k.holdingMax, holdingInUse(state))
    ctx.schedule('TruckHoldingAssigned', state.now, { equipment: [truck.id] }, { truckId: truck.id, holdingId: free.id, holdingInUse: holdingInUse(state) })
    return true
  }
  if (!truck.heldOutside) {
    truck.heldOutside = true
    counters(state).heldOutside++
    ctx.schedule('TruckHeldOutside', state.now, { equipment: [truck.id] }, { truckId: truck.id, queueLength: ls.queue.length })
  }
  return false
}

function resolveStall(ctx: EngineContext, truckId: string, stallId: string | null): void {
  const { state } = ctx
  const ls = landside(state)
  ls.stallAsking = null
  if (stallId === null) return
  const stall = ls.stalls[stallId]
  if (!stall) throw new Error(`transferStallSelection handler returned ${stallId}, which is not a transfer stall`)
  if (stall.truckId !== null) throw new Error(`transferStallSelection handler returned ${stallId} for ${truckId}, but ${stall.truckId} holds it`)
  const truck = state.trucks[truckId]
  const admitting = holdingOn(ctx) && truck?.status === 'queued' && ls.queue[0] === truckId
  if (!admitting && !ls.stallWaiting.includes(truckId)) {
    pumpStalls(ctx)
    return
  }
  const allowed = legalBlocks(ctx, truck)
  if (allowed !== null && !allowed.has(stall.blockId))
    throw new Error(`transferStallSelection handler returned ${stallId} for ${truckId}, but its box is in ${[...allowed].join(', ')} (an ASC only serves the stalls of its own block)`)
  stall.truckId = truckId
  truck.stallId = stallId
  if (admitting) {
    // reserved before the truck is sent: the trip is planned when it is through the gate (TruckGateIn)
    counters(state).admittedToStall++
    ctx.schedule('TruckStallReserved', state.now, { equipment: [truck.id] }, { truckId, stallId, blockId: stall.blockId })
    pumpGate(ctx)
    return
  }
  ls.stallWaiting.splice(ls.stallWaiting.indexOf(truckId), 1)
  if (truck.holdingAt !== null) {
    const k = counters(state)
    const held = state.now - truck.holdingAt
    k.holdingWaitSumS += held
    k.holdingWaitMaxS = Math.max(k.holdingWaitMaxS, held)
    k.holdingWaitCount++
  }
  planStallTrip(ctx, truck, stallId)
  pumpStalls(ctx)
  if (holdingOn(ctx)) pumpGate(ctx)
}

/** Plan and reserve the truck's trip from where it stands to its stall (reserved already) and announce it. */
function planStallTrip(ctx: EngineContext, truck: TruckState, stallId: string): void {
  const { state } = ctx
  const graph = graphOf(ctx)
  const stall = landside(state).stalls[stallId]
  const truckId = truck.id
  truck.stallAssignedAt = state.now
  const trip = new TripBuilder<PlannedType>(graph, truck.id, waypoints(graph, [truck.nodeId])[0], isInstant(state))
  const path = landsideRoute(graph, truck.nodeId, graph.stallNode[stallId])
  trip.mark('TruckRoutingToStall')
  trip.driveThrough(waypoints(graph, path).slice(1), driveOf(ctx))
  trip.mark('TruckAtStall')
  const windows = trip.windows()
  const start = earliestStart(state, windows, state.now)
  const reservations = reserve(state, truck.id, windows, start)
  install(truck, trip, start)
  truck.nodeId = graph.stallNode[stallId]
  for (const job of Object.values(state.ascJobs)) if (job.truckId === truckId && job.kind === 'retrieve') job.stallId = stallId
  const waited = state.now - (truck.gateInAt as number)
  const k = counters(state)
  k.stallAllocWaitSumS += waited
  k.stallAllocWaitMaxS = Math.max(k.stallAllocWaitMaxS, waited)
  ctx.schedule('TruckStallAssigned', state.now, { equipment: [truck.id] }, {
    truckId,
    stallId,
    blockId: stall.blockId,
    departAt: start,
    waitedS: r3(waited),
    reservations,
  })
  if (preRetrievalOn(ctx.config)) maybeDispatchAsc(ctx, stall.blockId) // the box may be fetched before the truck arrives
}

/** Plan and reserve the trip from the kiosk to the truck's holding position (reserved at admission). */
function planHoldingTrip(ctx: EngineContext, truck: TruckState): void {
  const { state } = ctx
  const graph = graphOf(ctx)
  const lane = graph.inLanes.find((l) => l.id === truck.laneId) as GateLaneLayout
  const holding = graph.holding.find((h) => h.id === truck.holdingId) as HoldingLayout
  const trip = new TripBuilder<PlannedType>(graph, truck.id, waypoints(graph, [lane.kioskNode])[0], isInstant(state))
  const path = landsideRoute(graph, lane.kioskNode, holding.nodeId)
  trip.mark('TruckRoutingToHolding')
  trip.driveThrough(waypoints(graph, path).slice(1), driveOf(ctx))
  trip.mark('TruckAtHolding')
  const windows = trip.windows()
  const start = earliestStart(state, windows, state.now)
  reserve(state, truck.id, windows, start)
  install(truck, trip, start)
  truck.nodeId = holding.nodeId
  scheduleNext(ctx, truck)
}

// ── exit ────────────────────────────────────────────────────────────────────

/** Plan the way out: reverse out of the stall, the roads, the outbound lane with the least wait. */
function planExit(ctx: EngineContext, truck: TruckState): void {
  const { state } = ctx
  const graph = graphOf(ctx)
  const stallNode = graph.stallNode[truck.stallId as string]
  let best: { trip: TripBuilder<PlannedType>; lane: GateLaneLayout; windows: WindowSpec[]; start: number } | null = null
  for (const lane of graph.outLanes) {
    const trip = new TripBuilder<PlannedType>(graph, truck.id, waypoints(graph, [stallNode])[0], isInstant(state))
    trip.mark('TruckRoutingToExit')
    const path = landsideRoute(graph, stallNode, lane.kioskNode)
    trip.driveThrough(waypoints(graph, path).slice(1), driveOf(ctx))
    trip.dwell(processingTime(ctx, landsideOf(ctx.config).gate.outProcessingS))
    trip.mark('TruckGateOut')
    const rest = landsideRoute(graph, lane.kioskNode, lane.endNode)
    trip.driveThrough(waypoints(graph, rest).slice(1), driveOf(ctx))
    trip.mark('TruckDeparted')
    const windows = mergeWindows(trip.windows())
    const start = earliestStart(state, windows, state.now)
    if (best === null || start < best.start - 1e-9) best = { trip, lane, windows, start }
  }
  const chosen = best as NonNullable<typeof best>
  const reservations = reserve(state, truck.id, chosen.windows, chosen.start)
  install(truck, chosen.trip, chosen.start)
  truck.outLaneId = chosen.lane.id
  truck.nodeId = chosen.lane.endNode
  ctx.schedule('TruckRoutingToExit', chosen.start, { equipment: [truck.id] }, {
    truckId: truck.id,
    stallId: truck.stallId as string,
    laneId: chosen.lane.id,
    departAt: chosen.start,
    reservations,
  })
}

// ── jobs ────────────────────────────────────────────────────────────────────

/** True while the truck stands at its stall with a free chassis for a pick (every drop leg is done). */
export function truckReadyForPick(state: SimState, job: AscJob): boolean {
  const truck = state.trucks[job.truckId ?? '']
  if (!truck || (truck.status !== 'at-stall' && truck.status !== 'being-served')) return false
  if (truck.carrying !== null) return false
  return truck.legs.every((l) => l.kind !== 'drop' || l.done)
}

/** TT-R17 [A]: an ASC only starts an early retrieval when the truck is at most this many seconds from its stall (bounds the hover). */
export const PRE_RETRIEVAL_MAX_LEAD_S = 150

/** TT-R17: the ascDispatch strategy `pre-retrieval` is selected, so the dispatch may start pick retrievals before the truck is at its stall. */
export function preRetrievalOn(config: EngineContext['config']): boolean {
  return config.decisions?.points?.ascDispatch?.strategy === 'pre-retrieval'
}

/** When the truck is planned to stand in its stall (TruckAtStall), or null before its trip is planned or once it is there. */
export function truckStallEta(state: SimState, truckId: string | undefined): number | null {
  return state.trucks[truckId ?? '']?.plan.find((p) => p.type === 'TruckAtStall')?.at ?? null
}

/**
 * TT-R17: a pick retrieval that may start before the truck stands in its stall: the stall is reserved and the trip planned
 * (`stallId` set, TruckAtStall planned), the truck is within `PRE_RETRIEVAL_MAX_LEAD_S` of arriving, its chassis is empty and
 * it has nothing to drop (a dual transaction drops first, so it never qualifies).
 */
export function earlyPickReady(state: SimState, job: AscJob): boolean {
  const truck = state.trucks[job.truckId ?? '']
  if (!truck || job.stallId === undefined || truck.stallId !== job.stallId || truck.carrying !== null) return false
  if (truck.legs.some((l) => l.kind === 'drop')) return false
  const eta = truckStallEta(state, truck.id)
  return eta !== null && eta - state.now <= PRE_RETRIEVAL_MAX_LEAD_S
}

function newJobId(state: SimState): string {
  return `A${++state.nextAscJob}`
}

/** The truck stands in its stall: its drop legs and pick legs become ASC work. */
function startInterchange(ctx: EngineContext, truck: TruckState): void {
  const { state } = ctx
  const blocks = new Set<string>()
  const stall = landside(state).stalls[truck.stallId as string]
  for (const leg of truck.legs) {
    if (leg.kind !== 'drop') continue
    const job: AscJob = {
      id: newJobId(state),
      blockId: stall.blockId,
      containerId: leg.containerId,
      wtpPadId: '',
      vesselId: leg.vesselId ?? state.containers[leg.containerId].vesselId,
      allocation: 'waiting',
      yardSlotId: null,
      claimSeq: null,
      cleared: true,
      ascId: null,
      stallId: stall.id,
      truckId: truck.id,
    }
    state.ascJobs[job.id] = job
    blocks.add(job.blockId)
  }
  for (const b of blocks) pumpAllocation(ctx, b)
  for (const b of blocks) maybeDispatchAsc(ctx, b)
  maybeDispatchAsc(ctx, stall.blockId) // pick legs: their retrieval jobs were created at arrival and wait for the chassis
}

/** Pick legs become retrieval jobs on arrival, so the ASC can dig the box out (rehandles) while the truck is still at the gate. */
function announcePicks(ctx: EngineContext, truck: TruckState): void {
  const { state } = ctx
  for (const leg of truck.legs) {
    if (leg.kind !== 'pick') continue
    const box = state.containers[leg.containerId]
    const job: AscJob = {
      id: newJobId(state),
      blockId: blockOfSlot(box.custody.id),
      containerId: box.id,
      wtpPadId: '',
      vesselId: box.vesselId,
      allocation: 'claimed',
      yardSlotId: box.custody.id,
      claimSeq: null,
      cleared: true,
      ascId: null,
      kind: 'retrieve',
      truckId: truck.id,
    }
    state.ascJobs[job.id] = job
  }
}

/** A leg of the truck is finished (the ASC lifted the box off, or set it on the chassis). */
export function legDone(ctx: EngineContext, truckId: string, containerId: string): void {
  const { state } = ctx
  const truck = state.trucks[truckId]
  const leg = truck.legs.find((l) => l.containerId === containerId) as TruckLeg
  leg.done = true
  const k = counters(state)
  if (leg.kind === 'drop') {
    k.boxesDropped++
    delete state.containers[containerId].truckClaim // the box is in the yard now: other trucks may collect it later
  } else k.boxesPicked++
  if (truck.legs.every((l) => l.done)) {
    truck.interchangeDoneAt = state.now
    const serviceS = state.now - (truck.atStallAt as number)
    k.serviceSumS += serviceS
    ctx.schedule('TruckInterchangeDone', state.now, { equipment: [truck.id] }, { truckId, stallId: truck.stallId as string, serviceS: r3(serviceS) })
  }
}

export const landsideReactors: ReactorMap = {
  /** Start the arrival process. */
  ScenarioStarted: (_e, ctx) => {
    const { state } = ctx
    if (state.subsystems.landside === 'off') return
    if (landsideOf(ctx.config).appointments) {
      // TT-R15: appointment windows replace the Poisson arrivals; every booking is one arrival at its time
      const plan = planAppointments(ctx.config, () => landsideRandom(state))
      landside(state).appointments = { windowS: appointmentWindowS(ctx.config), capPerWindow: plan.capPerWindow, windows: plan.windows, rejected: plan.rejected, list: plan.appointments }
      for (const a of plan.appointments) ctx.schedule('TruckArrivalDue', a.arriveAtS, {}, { transaction: a.transaction, appointmentId: a.id })
    } else {
      const next = nextPoissonArrival(ctx, 0)
      if (next !== null) ctx.schedule('TruckArrivalDue', next, {}, {})
    }
    for (const s of landsideOf(ctx.config).scripted ?? []) ctx.schedule('TruckArrivalDue', s.atS, {}, { transaction: s.transaction })
  },

  /** The arrival process fired: draw the truck's transaction from today's demand, create it and its boxes. */
  TruckArrivalDue: (e, ctx) => {
    const { state } = ctx
    const ls = landside(state)
    const plan = drawTransaction(ctx, e.payload.transaction)
    const id = truckId(++ls.nextTruck)
    const legs = makeLegs(ctx, id, plan.transaction)
    const graph = graphOf(ctx)
    const truck: TruckState = {
      id,
      transaction: plan.transaction,
      legs,
      status: 'queued',
      arrivedAt: e.t,
      queueIndex: ls.queue.length,
      laneId: null,
      outLaneId: null,
      stallId: null,
      holdingId: null,
      holdingAt: null,
      heldOutside: false,
      nodeId: graph.gate.queueHeadNode,
      carrying: legs.find((l) => l.kind === 'drop')?.containerId ?? null,
      gateStartedAt: null,
      gateInAt: null,
      stallAssignedAt: null,
      booked: e.payload.appointmentId !== undefined,
      driveS: 0,
      driveSince: null,
      atStallAt: null,
      serviceStartedAt: null,
      interchangeDoneAt: null,
      motion: [],
      plan: [],
    }
    state.trucks[id] = truck
    ls.queue.push(id)
    const k = counters(state)
    k.transactions[plan.transaction]++
    if (plan.fallback) k.fallbacks++
    k.gateQueueMax = Math.max(k.gateQueueMax, ls.queue.length)
    const slot = queueSlotZ(graph, truck.queueIndex)
    const seg = planSegment(id, 'z', graph.gate.spawnZ, slot, e.t, driveOf(ctx))
    if (isInstant(state)) seg.t1 = seg.t0
    truck.motion = [seg]
    const infos: TruckLegInfo[] = legs.map((l) => ({
      kind: l.kind,
      purpose: l.purpose,
      containerId: l.containerId,
      size: state.containers[l.containerId].size,
      ...(l.vesselId ? { vesselId: l.vesselId } : {}),
      ...(l.slotId ? { slotId: l.slotId } : {}),
    }))
    ctx.schedule('TruckArrived', e.t, { equipment: [id], containers: legs.map((l) => l.containerId) }, {
      truckId: id,
      transaction: plan.transaction,
      legs: infos,
      queueLength: ls.queue.length,
      ...(plan.fallback ? { fallback: true as const } : {}),
      ...(e.payload.appointmentId ? { appointmentId: e.payload.appointmentId } : {}),
    })
    // the next arrival of the Poisson process (scripted trucks were scheduled at the start)
    if (e.payload.transaction === undefined && !landsideOf(ctx.config).appointments) {
      const next = nextPoissonArrival(ctx, e.t)
      if (next !== null) ctx.schedule('TruckArrivalDue', next, {}, {})
    }
  },

  TruckArrived: (e, ctx) => {
    const truck = ctx.state.trucks[e.payload.truckId]
    announcePicks(ctx, truck)
    for (const b of new Set(Object.values(ctx.state.ascJobs).filter((j) => j.truckId === truck.id).map((j) => j.blockId))) maybeDispatchAsc(ctx, b)
    pumpGate(ctx)
  },

  DecisionResolved: (e, ctx) => {
    if (e.payload.decisionPoint === 'gateLaneAssignment') resolveLane(ctx, e.payload.request.truckId, e.payload.reply.laneId)
    else if (e.payload.decisionPoint === 'transferStallSelection') resolveStall(ctx, e.payload.request.truckId, e.payload.reply.stallId)
  },

  TruckGateStarted: (e, ctx) => {
    const truck = ctx.state.trucks[e.payload.truckId]
    const book = ctx.state.landside?.appointments
    // TT-R18: a booked truck is delayed when it passes the gate after the end of its window
    if (truck.booked && book && e.t >= (Math.floor(truck.arrivedAt / book.windowS) + 1) * book.windowS) counters(ctx.state).appointmentsDelayed++
    scheduleNext(ctx, truck)
    pumpGate(ctx) // another lane may be free for the next truck
  },

  /** Processed: the truck is in. It now needs a stall. */
  TruckGateIn: (e, ctx) => {
    const { state } = ctx
    const truck = advance(ctx, e)
    truck.gateInAt = e.t
    landside(state).inLanes[e.payload.laneId].processed++
    const kIn = counters(state)
    kIn.trucksIn++
    kIn.gateProcSumS += e.payload.processingS
    kIn.gateProcMaxS = Math.max(kIn.gateProcMaxS, e.payload.processingS)
    const ls = landside(state)
    if (holdingOn(ctx)) {
      // TT-R16: the stall was reserved before the gate (go to it) or a holding position was (go and wait there)
      if (truck.stallId !== null) {
        planStallTrip(ctx, truck, truck.stallId)
      } else planHoldingTrip(ctx, truck)
      return
    }
    ls.stallWaiting.push(truck.id)
    if (!landsideHasFreeStall(ctx)) ctx.schedule('TruckWaitingForStall', e.t, { equipment: [truck.id] }, { truckId: truck.id })
    pumpStalls(ctx)
  },

  TruckWaitingForStall: () => {},

  TruckStallAssigned: (e, ctx) => scheduleNext(ctx, ctx.state.trucks[e.payload.truckId]),

  TruckStallReserved: () => {},

  TruckHoldingAssigned: () => {},

  TruckHeldOutside: () => {},

  /** The truck leaves the kiosk for its holding position: the lane is free for the next truck. */
  TruckRoutingToHolding: (e, ctx) => {
    const { state } = ctx
    const truck = advance(ctx, e)
    driveStep(state, truck, 1, true)
    landside(state).inLanes[e.payload.laneId].truckId = null
    pumpGate(ctx)
  },

  /** The truck stands in its holding position (off every road) and waits for a stall. */
  TruckAtHolding: (e, ctx) => {
    const truck = advance(ctx, e)
    driveStep(ctx.state, truck, -1, true)
    truck.holdingAt = e.t
    landside(ctx.state).stallWaiting.push(truck.id)
    pumpStalls(ctx)
  },

  /** The truck leaves the kiosk: the lane is free for the next truck. */
  TruckRoutingToStall: (e, ctx) => {
    const { state } = ctx
    const truck = advance(ctx, e)
    const ls = landside(state)
    driveStep(state, truck, 1, true)
    if (ls.inLanes[e.payload.laneId].truckId === truck.id) ls.inLanes[e.payload.laneId].truckId = null
    if (truck.holdingId !== null) {
      touchHolding(state)
      // driving out of the holding position frees it for the next admission
      ls.holding[truck.holdingId].truckId = null
      truck.holdingId = null
    }
    pumpGate(ctx)
  },

  TruckAtStall: (e, ctx) => {
    const truck = advance(ctx, e)
    driveStep(ctx.state, truck, -1, true)
    truck.atStallAt = e.t
    if (Object.values(ctx.state.ascJobs).some((j) => j.truckId === truck.id && j.ascId !== null)) {
      // TT-R17: the box was fetched ahead of the truck, so service starts at once and the stall wait is zero
      truck.serviceStartedAt = e.t
      truck.status = 'being-served'
      const k = counters(ctx.state)
      k.stallWaitCount++
    }
    startInterchange(ctx, truck)
  },

  /** An ASC job for the truck was assigned: the stall wait ends when the first one starts. */
  AscJobAssigned: (e, ctx) => {
    const truckId = e.payload.truckId
    if (!truckId) return
    const { state } = ctx
    const truck = state.trucks[truckId]
    if (truck.serviceStartedAt !== null) return
    if (e.payload.early) return // TT-R17: the ASC fetches the box ahead of the truck; service starts when the truck is at its stall
    truck.serviceStartedAt = e.payload.departAt
    truck.status = 'being-served'
    const waited = e.payload.departAt - (truck.atStallAt as number)
    const k = counters(state)
    k.stallWaitSumS += waited
    k.stallWaitMaxS = Math.max(k.stallWaitMaxS, waited)
    k.stallWaitCount++
  },

  /** The ASC lifted the box off the chassis. */
  AscPickedFromTruck: (e, ctx) => {
    const truck = ctx.state.trucks[e.payload.truckId]
    truck.carrying = null
    legDone(ctx, truck.id, e.payload.containerId)
  },

  /** The ASC set the box on the chassis. */
  AscDroppedAtStall: (e, ctx) => {
    const truck = ctx.state.trucks[e.payload.truckId]
    if (truck.atStallAt === null) throw new Error(`${truck.id}: ${e.payload.containerId} set down on a chassis that is not at its stall`)
    truck.carrying = e.payload.containerId
    legDone(ctx, truck.id, e.payload.containerId)
  },

  /** Every leg is done: plan the way out (the stall is released when the truck leaves it). */
  TruckInterchangeDone: (e, ctx) => {
    const truck = ctx.state.trucks[e.payload.truckId]
    planExit(ctx, truck)
  },

  TruckRoutingToExit: (e, ctx) => {
    const { state } = ctx
    const truck = advance(ctx, e)
    driveStep(state, truck, 1, false)
    const stall = landside(state).stalls[e.payload.stallId]
    if (stall.truckId === truck.id) stall.truckId = null
    pumpStalls(ctx)
    if (holdingOn(ctx)) pumpGate(ctx)
  },

  TruckGateOut: (e, ctx) => {
    const { state } = ctx
    const truck = advance(ctx, e)
    driveStep(state, truck, -1, false)
    const k = counters(state)
    k.trucksOut++
    k.driveSumS += truck.driveS
    k.driveMaxS = Math.max(k.driveMaxS, truck.driveS)
    const totalS = e.t - truck.arrivedAt
    k.totalTurnSumS += totalS
    k.totalTurnMaxS = Math.max(k.totalTurnMaxS, totalS)
    k.turnSumS += e.payload.turnS
    k.turnMaxS = Math.max(k.turnMaxS, e.payload.turnS)
  },

  TruckDeparted: (e, ctx) => {
    const { state } = ctx
    const truck = advance(ctx, e)
    // boxes collected leave the terminal with the truck
    for (const leg of truck.legs)
      if (leg.kind === 'pick') {
        delete state.containers[leg.containerId].truckClaim
        ctx.transferCustody(leg.containerId, { kind: 'external', id: truck.id })
      }
    delete state.trucks[truck.id]
  },

  /** A box stacked in the yard becomes collectable (imports and empties) once its dwell has elapsed. */
  AscStacked: (e, ctx) => {
    const { state } = ctx
    if (state.landside === null || e.payload.rehandle) return
    const box = state.containers[e.payload.containerId]
    if (box.pickupReadyAt !== undefined) return
    const first = box.custodyHistory[0].owner.kind
    const collectable = first === 'truck' ? !box.full : box.onwardVesselId === undefined
    if (!collectable) return
    const cfg = landsideOf(ctx.config)
    box.pickupReadyAt = e.t + sampleDwell(cfg.importDwell, () => landsideRandom(state))
  },
}

function landsideHasFreeStall(ctx: EngineContext): boolean {
  return Object.values(landside(ctx.state).stalls).some((s) => s.truckId === null)
}
