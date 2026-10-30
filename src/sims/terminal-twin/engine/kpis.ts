/**
 * KPI report: a plain, rounded (3 dp) summary derived from SimState. Later
 * tickets (TT-07) add time series, hourly/shift buckets and more groups.
 */
import { zeroStateS, type ShcOperationalState } from './shcStates'
import type { AppointmentBook, LandsideKpiCounters, LandsideState, SimState } from './state'

/** Per-decision-point (TOS handler) KPIs. Latencies are per resolved decision. */
export interface HandlerKpiReport {
  /** "strategy:<name>" or "custom". */
  handler: string
  calls: number
  resolved: number
  /** Answered by the handler. */
  ok: number
  /** Answered by the fallback strategy after a timeout or error. */
  fallbacks: number
  timeouts: number
  errors: number
  /** Async replies that arrived after their timeout (discarded). */
  lateReplies: number
  /** Pending backlog now, and its peak. */
  pending: number
  maxPending: number
  simLatencyS: { mean: number; max: number }
  /** Injected latency plus measured time of async handlers (sync handlers count as 0). */
  wallLatencyMs: { mean: number; max: number }
  /** Equipment idle time caused by waiting on this decision point (equipment × s). */
  equipmentIdleS: number
}

export interface KpiReport {
  /** Sim time of the measured period (after a warm-up, counted from its end). */
  simTimeS: number
  /** Warm-up start (TT-14): its length and whether it is over; absent for other starts. */
  warmUp?: { durationS: number; ended: boolean }
  eventsProcessed: number
  movesCompleted: number
  vesselsCompleted: number
  sts: Record<
    string,
    { moves: number; cycles: number; twinLifts: number; grossMovesPerHour: number | null; railWaitS: number }
  >
  vessels: Record<
    string,
    {
      sizeClass: string
      arrivedAtS: number | null
      /** Arrival → berth allocation. */
      anchorageWaitS: number | null
      berthX: number | null
      berthedAtS: number | null
      departedAtS: number | null
      /** All fast → departure. */
      turnaroundS: number | null
      /** STS cranes that worked the vessel. */
      sts: string[]
    }
  >
  /** Berth congestion: anchorage waits over vessels that have been allocated a berth. */
  quay: { vesselsWaited: number; anchorageWaitS: { total: number; mean: number; max: number } }
  /** TOS handler KPIs per decision point (decision points never called are omitted). */
  handlers: Record<string, HandlerKpiReport>
  /** Horizontal transport (only when SHCs are configured). */
  horizontal?: HorizontalKpiReport
  /** Yard blocks and ASCs (only when blocks are configured with SHCs). */
  yard?: YardKpiReport
  /** Work packages (only when some were released). */
  workPackages?: WorkPackageKpiReport
  /** Hatch cover moves of the STS cranes (only when a hatch move has started). */
  hatch?: HatchKpiReport
  /** Trucks and the gate (only when the landside is on). */
  landside?: LandsideKpiReport
}

export interface LandsideKpiReport {
  /** Trucks that completed gate processing / left through an outbound lane. */
  trucksIn: number
  trucksOut: number
  /** Trucks in the terminal now, and queued at the gate now / at most. */
  trucksInside: number
  gateQueue: number
  gateQueueMax: number
  /** Truck turn time: gate-in to gate-out (s), over the trucks that left. */
  turnTimeS: { mean: number; max: number }
  /** Gate queue wait: arrival to lane assignment (s), over the trucks that got a lane. */
  gateWaitS: { mean: number; max: number }
  /** Kiosk processing at the in gate (s), over the trucks that got through. */
  gateProcessingS: { mean: number; max: number }
  /**
   * Internal drive time (s) over the trucks that left: the inbound drive from the kiosk to the stall (through the holding
   * position when there was one). Standing time (holding, at the stall) and the way out are not in it.
   */
  internalDriveS: { mean: number; max: number }
  /** Total truck turnaround: arrival at the gate to gate-out (s), so it includes the wait outside and in holding. */
  totalTurnaroundS: { mean: number; max: number }
  /** Road use: trucks driving on the internal roads (inbound legs and the way out), time-weighted mean over the run and peak. */
  road: { meanTrucks: number; maxTrucks: number }
  /** Stall allocation wait: gate-in to stall assigned (s). */
  stallAllocWaitS: { mean: number; max: number }
  /** Transfer-stall wait: standing at the stall until the ASC starts on the truck (s). */
  stallWaitS: { mean: number; max: number }
  /** Time at the stall from arrival to the interchange being done, mean (s). */
  serviceS: number
  /** Arrivals by transaction kind. */
  transactions: Record<string, number>
  boxesDropped: number
  boxesPicked: number
  /** Arrivals that could not get the drawn transaction and came to drop an empty. */
  fallbacks: number
  /** Appointment system (only with `config.landside.appointments`, TT-R15). */
  appointments?: {
    windowS: number
    capPerWindow: number
    windows: number
    booked: number
    /** Bookings refused because their window was full. */
    rejected: number
    maxBookedPerWindow: number
    /** Booked trucks that passed the gate after the end of their window (TT-R18). */
    delayed: number
  }
  /** Stall admission and holding (only with `config.landside.holding`, TT-R16). */
  holding?: {
    positions: number
    admittedToStall: number
    admittedToHolding: number
    /** Trucks that waited outside the gate because no stall and no holding position was free. */
    heldOutside: number
    /** Holding positions in use now, and at most. */
    inUse: number
    maxInUse: number
    /** Standing in a holding position until its stall is assigned (s). */
    waitS: { mean: number; max: number }
    /** Occupied position-seconds (reserved until the truck drives out) over positions x run time, in % (TT-R18). */
    utilisationPct: number
  }
}

export interface HatchKpiReport {
  /** Hatch moves: panels lifted off and put back. */
  moves: number
  removes: number
  replaces: number
  /** STS time spent on hatch moves, start of a move to the panel set down (s). */
  stsTimeS: number
  /** Crane idle time waiting for a lashing release or a securing (s). */
  waitS: number
  /** Per STS: hatch moves, their time and waiting. */
  sts: Record<string, { moves: number; timeS: number; waitS: number }>
}

export interface WorkPackageKpiReport {
  released: number
  started: number
  completed: number
  /** Time from release to the start of work: the look-ahead the yard had (s). */
  leadTimeMeanS: number
  leadTimeMaxS: number
  /** Export boxes loaded. */
  boxesLoaded: number
}

export interface YardKpiReport {
  /** Boxes the ASCs have stacked. */
  boxesStacked: number
  /** Boxes on WTP pads or in ASC hands (not stacked yet). */
  boxesInTransit: number
  /** yardAllocation replies with no slot (block full). */
  allocationFailures: number
  /**
   * Rehandles (blocker moves, TT-12) against productive ASC moves (stack + retrieve);
   * `perProductiveMove` is null until a productive move is done.
   */
  rehandles: { total: number; productiveMoves: number; perProductiveMove: number | null; failures: number }
  /** Per block: stacked boxes, slots in use (20 ft cells), the highest stack and its rehandle ratio. */
  blocks: Record<
    string,
    {
      boxes: number
      cells: number
      capacityCells: number
      maxHeight: number
      rehandles: number
      productiveMoves: number
      rehandlesPerProductiveMove: number | null
    }
  >
  ascs: Record<
    string,
    {
      jobs: number
      gantryM: number
      trolleyM: number
      hoistM: number
      padWaitS: number
      /** Twin-ASC blocks only: seconds jobs waited for the other ASC's rail segments. */
      railWaitS?: number
      /** Twin-ASC blocks only: seconds on cycles and yield moves. */
      busyS?: number
      /** Twin-ASC blocks only: times this ASC stepped aside. */
      yields?: number
    }
  >
}

export interface HorizontalKpiReport {
  /** Boxes SHCs delivered to WTP pads. */
  boxesToWtp: number
  shcs: Record<
    string,
    {
      jobs: number
      emptyDistanceM: number
      loadedDistanceM: number
      reservationWaitS: number
      /** Seconds in each operational state over the measured run (TT-R11; from the KPI collector). */
      stateS: Record<ShcOperationalState, number>
      /** Custody changes at buffers: one per box picked up and one per box put down (TT-R11). */
      handovers: number
      /** Drives back to the parking spot (TT-R12): fewer when SHCs chain jobs instead of parking. */
      parkingReturns: number
      /** Arrivals at a queue spot (TT-R12). */
      queueArrivals: number
    }
  >
  /** STS seconds spent waiting for a free ground position (SHCs too slow). */
  stsGroundPositionWaitS: Record<string, number>
}

const r3 = (n: number) => Math.round(n * 1000) / 1000


/** Trucks that have been given an inbound lane (arrived minus those still queued). */
const gateServed = (state: SimState): number => {
  const k = state.kpis.landside
  if (!k) return 0
  return Object.values(k.transactions).reduce((a, b) => a + b, 0) - (state.landside?.queue.length ?? 0)
}

/** Trucks that have been given a stall (through the gate minus those still waiting for one). */
function appointmentReport(book: AppointmentBook, k: LandsideKpiCounters): NonNullable<LandsideKpiReport['appointments']> {
  const perWindow = new Map<number, number>()
  for (const a of book.list) perWindow.set(a.windowIndex, (perWindow.get(a.windowIndex) ?? 0) + 1)
  return {
    windowS: book.windowS,
    capPerWindow: book.capPerWindow,
    windows: book.windows,
    booked: book.list.length,
    rejected: book.rejected,
    maxBookedPerWindow: Math.max(0, ...perWindow.values()),
    delayed: k.appointmentsDelayed,
  }
}

function holdingReport(ls: LandsideState, k: LandsideKpiCounters, now: number): NonNullable<LandsideKpiReport['holding']> {
  const positions = Object.values(ls.holding)
  return {
    positions: positions.length,
    admittedToStall: k.admittedToStall,
    admittedToHolding: k.admittedToHolding,
    heldOutside: k.heldOutside,
    inUse: positions.filter((h) => h.truckId !== null).length,
    maxInUse: k.holdingMax,
    waitS: { mean: k.holdingWaitCount > 0 ? r3(k.holdingWaitSumS / k.holdingWaitCount) : 0, max: r3(k.holdingWaitMaxS) },
    utilisationPct: now > 0 ? r3((100 * (k.holdBusyS + positions.filter((h) => h.truckId !== null).length * (now - k.holdLastT))) / (positions.length * now)) : 0,
  }
}

const stallsAssigned = (state: SimState): number => (state.kpis.landside?.trucksIn ?? 0) - (state.landside?.stallWaiting.length ?? 0)

export function buildKpiReport(state: SimState, eventsProcessed: number): KpiReport {
  const sts: KpiReport['sts'] = {}
  for (const [id, k] of Object.entries(state.kpis.perSts)) {
    const span = k.firstMoveStartS !== null && k.lastMoveEndS !== null ? k.lastMoveEndS - k.firstMoveStartS : 0
    sts[id] = {
      moves: k.moves,
      cycles: k.cycles,
      twinLifts: k.twinLifts,
      grossMovesPerHour: span > 0 ? r3((k.moves * 3600) / span) : null,
      railWaitS: r3(k.railWaitS),
    }
  }
  const vessels: KpiReport['vessels'] = {}
  const n3 = (x: number | null) => (x === null ? null : r3(x))
  const waits: number[] = []
  for (const v of Object.values(state.vessels)) {
    if (v.anchorageWaitS !== null) waits.push(v.anchorageWaitS)
    vessels[v.id] = {
      sizeClass: v.sizeClass,
      arrivedAtS: n3(v.arrivedAt),
      anchorageWaitS: n3(v.anchorageWaitS),
      berthX: n3(v.berthX),
      berthedAtS: n3(v.berthedAt),
      departedAtS: n3(v.departedAt),
      turnaroundS: v.berthedAt !== null && v.departedAt !== null ? r3(v.departedAt - v.berthedAt) : null,
      sts: [...v.stsHistory],
    }
  }
  const totalWait = waits.reduce((a, b) => a + b, 0)
  const quay: KpiReport['quay'] = {
    vesselsWaited: waits.filter((w) => w > 0).length,
    anchorageWaitS: {
      total: r3(totalWait),
      mean: waits.length ? r3(totalWait / waits.length) : 0,
      max: waits.length ? r3(Math.max(...waits)) : 0,
    },
  }
  const handlers: KpiReport['handlers'] = {}
  const pending = Object.values(state.decisions.pending)
  for (const [dp, k] of Object.entries(state.decisions.kpis)) {
    if (k.calls === 0) continue
    const mean = (total: number) => (k.resolved > 0 ? r3(total / k.resolved) : 0)
    handlers[dp] = {
      handler: k.handler,
      calls: k.calls,
      resolved: k.resolved,
      ok: k.ok,
      fallbacks: k.fallbacks,
      timeouts: k.timeouts,
      errors: k.errors,
      lateReplies: k.lateReplies,
      pending: pending.filter((p) => p.decisionPoint === dp).length,
      maxPending: k.maxPending,
      simLatencyS: { mean: mean(k.simLatencyTotalS), max: r3(k.simLatencyMaxS) },
      wallLatencyMs: { mean: mean(k.wallLatencyTotalMs), max: r3(k.wallLatencyMaxMs) },
      equipmentIdleS: r3(k.equipmentIdleS),
    }
  }
  const h = state.kpis.horizontal
  const horizontal: HorizontalKpiReport | undefined = h && {
    boxesToWtp: h.boxesToWtp,
    shcs: Object.fromEntries(
      Object.entries(h.perShc).map(([id, k]) => [
        id,
        {
          jobs: k.jobs,
          emptyDistanceM: r3(k.emptyDistanceM),
          loadedDistanceM: r3(k.loadedDistanceM),
          reservationWaitS: r3(k.reservationWaitS),
          stateS: zeroStateS(),
          handovers: 0,
          parkingReturns: k.parkingReturns,
          queueArrivals: k.queueArrivals,
        },
      ]),
    ),
    stsGroundPositionWaitS: Object.fromEntries(Object.entries(h.stsGroundPositionWaitS).map(([id, s]) => [id, r3(s)])),
  }
  const y = state.kpis.yard
  const yard: YardKpiReport | undefined = y && {
    boxesStacked: y.boxesStacked,
    boxesInTransit: Object.values(state.ascJobs).filter((j) => j.kind !== 'rehandle' && j.truckId === undefined).length,
    allocationFailures: y.allocationFailures,
    rehandles: {
      total: y.rehandles,
      productiveMoves: y.productiveMoves,
      perProductiveMove: y.productiveMoves > 0 ? r3(y.rehandles / y.productiveMoves) : null,
      failures: y.rehandleFailures,
    },
    blocks: Object.fromEntries(
      Object.values(state.yardBlocks).map((b) => {
        const slots = Object.values(state.yardSlots).filter((s) => s.blockId === b.id)
        return [
          b.id,
          {
            boxes: slots.length,
            cells: slots.reduce((n, s) => n + s.span, 0),
            capacityCells: b.bays * b.rows * b.tiers,
            maxHeight: slots.reduce((m, s) => Math.max(m, s.tier), 0),
            rehandles: y.perBlock[b.id].rehandles,
            productiveMoves: y.perBlock[b.id].productiveMoves,
            rehandlesPerProductiveMove:
              y.perBlock[b.id].productiveMoves > 0 ? r3(y.perBlock[b.id].rehandles / y.perBlock[b.id].productiveMoves) : null,
          },
        ]
      }),
    ),
    ascs: Object.fromEntries(
      Object.entries(y.perAsc).map(([id, k]) => [
        id,
        {
          jobs: k.jobs,
          gantryM: r3(k.gantryM),
          trolleyM: r3(k.trolleyM),
          hoistM: r3(k.hoistM),
          padWaitS: r3(k.padWaitS),
          ...(k.railWaitS !== undefined ? { railWaitS: r3(k.railWaitS), busyS: r3(k.busyS ?? 0), yields: k.yields ?? 0 } : {}),
        },
      ]),
    ),
  }
  const ls = state.kpis.landside
  const landside: LandsideKpiReport | undefined = ls && {
    trucksIn: ls.trucksIn,
    trucksOut: ls.trucksOut,
    trucksInside: Object.keys(state.trucks).length,
    gateQueue: state.landside?.queue.length ?? 0,
    gateQueueMax: ls.gateQueueMax,
    turnTimeS: { mean: ls.trucksOut > 0 ? r3(ls.turnSumS / ls.trucksOut) : 0, max: r3(ls.turnMaxS) },
    gateWaitS: { mean: gateServed(state) > 0 ? r3(ls.gateWaitSumS / gateServed(state)) : 0, max: r3(ls.gateWaitMaxS) },
    stallAllocWaitS: { mean: ls.trucksIn > 0 ? r3(ls.stallAllocWaitSumS / Math.max(1, stallsAssigned(state))) : 0, max: r3(ls.stallAllocWaitMaxS) },
    stallWaitS: { mean: ls.stallWaitCount > 0 ? r3(ls.stallWaitSumS / ls.stallWaitCount) : 0, max: r3(ls.stallWaitMaxS) },
    gateProcessingS: { mean: ls.trucksIn > 0 ? r3(ls.gateProcSumS / ls.trucksIn) : 0, max: r3(ls.gateProcMaxS) },
    internalDriveS: { mean: ls.trucksOut > 0 ? r3(ls.driveSumS / ls.trucksOut) : 0, max: r3(ls.driveMaxS) },
    totalTurnaroundS: { mean: ls.trucksOut > 0 ? r3(ls.totalTurnSumS / ls.trucksOut) : 0, max: r3(ls.totalTurnMaxS) },
    road: {
      meanTrucks: state.now > 0 ? r3((ls.roadBusyS + ls.roadNow * (state.now - ls.roadLastT)) / state.now) : 0,
      maxTrucks: ls.roadMax,
    },
    serviceS: ls.trucksOut > 0 ? r3(ls.serviceSumS / ls.trucksOut) : 0,
    transactions: { ...ls.transactions },
    boxesDropped: ls.boxesDropped,
    boxesPicked: ls.boxesPicked,
    fallbacks: ls.fallbacks,
    ...(state.landside?.appointments ? { appointments: appointmentReport(state.landside.appointments, ls) } : {}),
    ...(state.landside && Object.keys(state.landside.holding).length > 0 ? { holding: holdingReport(state.landside, ls, state.now) } : {}),
  }
  return {
    simTimeS: r3(state.now - (state.warmUp?.ended ? state.warmUp.durationS : 0)),
    ...(state.warmUp ? { warmUp: { durationS: state.warmUp.durationS, ended: state.warmUp.ended } } : {}),
    eventsProcessed,
    movesCompleted: state.kpis.movesCompleted,
    vesselsCompleted: state.kpis.vesselsCompleted,
    sts,
    vessels,
    quay,
    handlers,
    ...(horizontal ? { horizontal } : {}),
    ...(yard ? { yard } : {}),
    ...(landside ? { landside } : {}),
    ...(state.kpis.hatch
      ? {
          hatch: {
            moves: state.kpis.hatch.removes + state.kpis.hatch.replaces,
            removes: state.kpis.hatch.removes,
            replaces: state.kpis.hatch.replaces,
            stsTimeS: r3(state.kpis.hatch.stsTimeS),
            waitS: r3(state.kpis.hatch.waitS),
            sts: Object.fromEntries(
              Object.entries(state.kpis.hatch.perSts).map(([id, k]) => [id, { moves: k.moves, timeS: r3(k.timeS), waitS: r3(k.waitS) }]),
            ),
          },
        }
      : {}),
    ...(state.kpis.workPackages.released > 0
      ? {
          workPackages: {
            released: state.kpis.workPackages.released,
            started: state.kpis.workPackages.started,
            completed: state.kpis.workPackages.completed,
            leadTimeMeanS: r3(state.kpis.workPackages.started > 0 ? state.kpis.workPackages.leadTimeSumS / state.kpis.workPackages.started : 0),
            leadTimeMaxS: r3(state.kpis.workPackages.leadTimeMaxS),
            boxesLoaded: state.kpis.workPackages.boxesLoaded,
          },
        }
      : {}),
  }
}
