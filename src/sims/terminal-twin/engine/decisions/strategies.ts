/**
 * Built-in strategy registry: 1–3 named strategies per decision point,
 * selected per scenario with `config.decisions.points.<dp>.strategy`.
 *
 * Built-in strategies are synchronous and pure (request + query → reply), so
 * they resolve within the same event step and both async modes give
 * identical runs. A strategy that needs randomness must take it from the
 * request, never from Math.random.
 */
import { minFutureRehandles, nearestValidRehandle } from './rehandleStrategies'
import { balancedAscDispatch, preRetrievalDispatch, watersideFirstDispatch } from './ascStrategies'
import { groupedSlot, nearestWtpSlot, randomSlot } from './yardStrategies'
import { isoTypeBestPositionEmpties, nearestWtpEmpties, oldestFirstEmpties } from './emptyStrategies'
import { leastLoadedBlockStall, leastUsedLane, lowestFreeLane, nearestToBoxStall } from './landsideStrategies'
import { justInTimeRelease, keepKAheadRelease } from './workPackageStrategies'
import { balancedMovesSplit, bestFitBerth, equalBaysSplit, firstFitBerth } from './quayStrategies'
import type { DecisionHandler, DecisionPointId, HandlerSet, ShcDispatchJob, ShcDispatchPad, WtpPadSelectionRequest } from './types'

/** `paired-dual-cycle` takes the paired job only when it is at most this far (route length, m) from the SHC; beyond that the nearest job wins. [assumed] */
export const PAIRING_RADIUS_M = 150

const isFree = (p: ShcDispatchPad) => p.occupiedBy === null && p.claimedBy === null

/** First free pad in list order. */
function firstFreePad(req: WtpPadSelectionRequest): string | null {
  return req.wtpPads.find(isFree)?.id ?? null
}

/** Free pad closest (plan distance) to a point; ties by list order. */
function nearestFreePad(req: WtpPadSelectionRequest, x: number, z: number): string | null {
  let best: ShcDispatchPad | null = null
  let bestD = Infinity
  for (const p of req.wtpPads) {
    if (!isFree(p)) continue
    const d = Math.abs(p.x - x) + Math.abs(p.z - z)
    if (d < bestD - 1e-9) {
      best = p
      bestD = d
    }
  }
  return best?.id ?? null
}

export interface StrategyDefinition<K extends DecisionPointId> {
  description: string
  handler: DecisionHandler<K>
}

export interface DecisionPointStrategies<K extends DecisionPointId> {
  /** Used when the scenario names no strategy, and as the default fallback. */
  default: string
  strategies: Record<string, StrategyDefinition<K>>
}

export type StrategyRegistry = { [K in DecisionPointId]: DecisionPointStrategies<K> }

export const strategies: StrategyRegistry = {
  stsGroundPosition: {
    default: 'lowest-free-lane',
    strategies: {
      'lowest-free-lane': {
        description: 'Free ground position nearest the quay (lowest lane).',
        handler: (msg) => ({
          groundPositionId: msg.payload.groundPositions.find((gp) => gp.occupiedBy === null)?.id ?? null,
        }),
      },
      'highest-free-lane': {
        description: 'Free ground position farthest from the quay (highest lane).',
        handler: (msg) => ({
          groundPositionId:
            [...msg.payload.groundPositions].reverse().find((gp) => gp.occupiedBy === null)?.id ?? null,
        }),
      },
    },
  },
  shcDispatch: {
    default: 'oldest-job',
    strategies: {
      'oldest-job': {
        description: 'Oldest open job first (FIFO by grounding time).',
        handler: (msg) => {
          const job = [...msg.payload.jobs].sort((a, b) => a.readyAt - b.readyAt || (a.jobId < b.jobId ? -1 : 1))[0]
          return { jobId: job?.jobId ?? null }
        },
      },
      'nearest-job': {
        description: 'Nearest open job by route length.',
        handler: (msg) => {
          const job = [...msg.payload.jobs].sort(
            (a, b) => a.distanceM - b.distanceM || a.readyAt - b.readyAt || (a.jobId < b.jobId ? -1 : 1),
          )[0]
          return { jobId: job?.jobId ?? null }
        },
      },
      'chained-nearest': {
        description:
          'Nearest open job by route length, and (engine side, TT-R12) after a delivery the SHC asks again at once and, with no job, waits at the nearest queue area while there is work, parking only when there is none.',
        handler: (msg) => {
          const job = [...msg.payload.jobs].sort(
            (a, b) => a.distanceM - b.distanceM || a.readyAt - b.readyAt || (a.jobId < b.jobId ? -1 : 1),
          )[0]
          return { jobId: job?.jobId ?? null }
        },
      },
      'paired-dual-cycle': {
        description:
          'chained-nearest with pairing (TT-R14): after delivering a discharge box to a WTP pad the SHC prefers an open load pickup, and after delivering a load box at the quay it prefers an open discharge pickup, when that job is within PAIRING_RADIUS_M of it (else the nearest job). SHCs drive loaded more often; they are reassigned freely between STS cranes and blocks. Needs queueAreas for the waiting behaviour of chained-nearest.',
        handler: (msg) => {
          const byNearest = (a: ShcDispatchJob, b: ShcDispatchJob) =>
            a.distanceM - b.distanceM || a.readyAt - b.readyAt || (a.jobId < b.jobId ? -1 : 1)
          const { lastJobKind, jobs } = msg.payload
          const wantLoad = lastJobKind === 'discharge'
          const paired = lastJobKind ? jobs.filter((j) => (j.kind === 'load') === wantLoad).sort(byNearest)[0] : undefined
          const job = paired && paired.distanceM <= PAIRING_RADIUS_M ? paired : [...jobs].sort(byNearest)[0]
          return { jobId: job?.jobId ?? null }
        },
      },
      predispatch: {
        description:
          'chained-nearest plus pre-dispatch (TT-R13, engine side): idle SHCs are sent to the queue area of a box predicted ready within their travel time plus queueAreas.predispatchMarginS (default 15 s). The SHC claims a queue spot, never a job, so nothing is collected before the box exists. Needs queueAreas.',
        handler: (msg) => {
          const job = [...msg.payload.jobs].sort(
            (a, b) => a.distanceM - b.distanceM || a.readyAt - b.readyAt || (a.jobId < b.jobId ? -1 : 1),
          )[0]
          return { jobId: job?.jobId ?? null }
        },
      },
    },
  },
  wtpPadSelection: {
    default: 'first-free',
    strategies: {
      'first-free': {
        description: 'The first free WTP pad in list order.',
        handler: (msg) => ({ wtpPadId: firstFreePad(msg.payload) }),
      },
      'nearest-box': {
        description: 'The free WTP pad nearest (plan distance) to where the box stands.',
        handler: (msg) => ({ wtpPadId: nearestFreePad(msg.payload, msg.payload.x, msg.payload.z) }),
      },
      'last-free': {
        description: 'The last free WTP pad in list order (fills the yard from the far end).',
        handler: (msg) => ({ wtpPadId: [...msg.payload.wtpPads].reverse().find(isFree)?.id ?? null }),
      },
    },
  },
  yardAllocation: {
    default: 'grouped',
    strategies: {
      random: {
        description: 'A random legal slot (from the seeded RNG).',
        handler: (msg) => randomSlot(msg.payload),
      },
      'nearest-wtp': {
        description: 'The legal slot nearest the WTP pad, spreading over low tiers before stacking high.',
        handler: (msg) => nearestWtpSlot(msg.payload),
      },
      grouped: {
        description:
          'Groups boxes: imports by line (earlier departure higher), exports by outbound vessel and POD (heavy at the bottom), transshipment by onward vessel and POD, storage empties by line, size and type. A mismatch costs score, never a slot.',
        handler: (msg) => groupedSlot(msg.payload),
      },
    },
  },
  ascDispatch: {
    default: 'waterside-first',
    strategies: {
      'waterside-first': {
        description:
          'WTP work goes to the waterside ASC, transfer-stall work to the landside ASC; the other crane helps when the separation permits (no step-aside needed).',
        handler: (msg) => watersideFirstDispatch(msg.payload),
      },
      'pre-retrieval': {
        description:
          'As waterside-first, and the ASC fetches an import box to the transfer stall before its truck arrives, once the stall is reserved and the truck is close (idle ASC only, never ahead of stacking, rehandle or pad work).',
        handler: (msg) => preRetrievalDispatch(msg.payload),
      },
      balanced: {
        description: 'The serviceable idle ASC with the fewest jobs so far (ties: nearest the pad), stepping the other aside if needed.',
        handler: (msg) => balancedAscDispatch(msg.payload),
      },
    },
  },
  workPackageRelease: {
    default: 'keep-k-ahead',
    strategies: {
      'keep-k-ahead': {
        description: 'Keeps k packages released ahead of the one the crane is working (default k = 2).',
        handler: (msg) => keepKAheadRelease(msg.payload),
      },
      'just-in-time': {
        description: 'Releases the next package only when the crane has no released package left (no look-ahead for the yard).',
        handler: (msg) => justInTimeRelease(msg.payload),
      },
    },
  },
  emptyAllocation: {
    default: 'iso-type-best-position',
    strategies: {
      'nearest-wtp': {
        description: 'The matching empties nearest the WTP pads (shortest trips), lowest tier first.',
        handler: (msg) => nearestWtpEmpties(msg.payload),
      },
      'oldest-first': {
        description: 'The matching empties that have stood in the yard longest.',
        handler: (msg) => oldestFirstEmpties(msg.payload),
      },
      'iso-type-best-position': {
        description:
          'Default (spec #106). Matches the requested ISO type (any line; `emptyAllocation.matchLine` restricts to the requesting line) and picks the best yard position: fewest boxes on top, then nearest the WTP of the block serving the vessel, then next to other allocated empties.',
        handler: (msg) => isoTypeBestPositionEmpties(msg.payload),
      },
    },
  },
  rehandleTarget: {
    default: 'nearest-valid',
    strategies: {
      'nearest-valid': {
        description: "The legal slot nearest the blocking box's stack (shortest ASC move), low tiers first.",
        handler: (msg) => nearestValidRehandle(msg.payload),
      },
      'min-future-rehandles': {
        description: 'A slot that buries no export box retrieved before it (else the box needed latest), so later retrievals need fewer rehandles.',
        handler: (msg) => minFutureRehandles(msg.payload),
      },
    },
  },
  gateLaneAssignment: {
    default: 'lowest-free-lane',
    strategies: {
      'lowest-free-lane': {
        description: 'The free inbound lane with the lowest index (west first).',
        handler: (msg) => lowestFreeLane(msg.payload),
      },
      'least-used-lane': {
        description: 'The free inbound lane that has processed the fewest trucks, spreading the work.',
        handler: (msg) => leastUsedLane(msg.payload),
      },
    },
  },
  transferStallSelection: {
    default: 'nearest-to-box',
    strategies: {
      'nearest-to-box': {
        description: 'A free stall in the block that holds the box to pick (drops: nearest the gate), nearest the gate within the block.',
        handler: (msg) => nearestToBoxStall(msg.payload),
      },
      'least-loaded-block': {
        description: 'A free stall in the block with the fewest trucks holding or waiting for a stall, whatever the box.',
        handler: (msg) => leastLoadedBlockStall(msg.payload),
      },
    },
  },
  berthAllocation: {
    default: 'first-fit',
    strategies: {
      'first-fit': {
        description: 'Lowest stern position along the quay where the vessel fits.',
        handler: (msg) => firstFitBerth(msg.payload),
      },
      'best-fit': {
        description: 'The free quay gap that leaves the least unused length.',
        handler: (msg) => bestFitBerth(msg.payload),
      },
    },
  },
  craneSplit: {
    default: 'balanced-moves',
    strategies: {
      'balanced-moves': {
        description: 'Up to max STS free cranes nearest the vessel; contiguous bay ranges with near-equal moves.',
        handler: (msg) => balancedMovesSplit(msg.payload),
      },
      'equal-bays': {
        description: 'Up to max STS free cranes nearest the vessel; contiguous bay ranges with equal numbers of bays.',
        handler: (msg) => equalBaysSplit(msg.payload),
      },
    },
  },
}

/** Look up a built-in strategy; throws with the available names if unknown. */
export function getStrategy<K extends DecisionPointId>(dp: K, name: string): DecisionHandler<K> {
  const entry = strategies[dp] as DecisionPointStrategies<K>
  const s = entry.strategies[name]
  if (!s) throw new Error(`Unknown ${dp} strategy "${name}" (available: ${Object.keys(entry.strategies).join(', ')})`)
  return s.handler
}

/** Each decision point's default strategy. */
export const defaultHandlers: HandlerSet = {
  stsGroundPosition: getStrategy('stsGroundPosition', strategies.stsGroundPosition.default),
  shcDispatch: getStrategy('shcDispatch', strategies.shcDispatch.default),
  wtpPadSelection: getStrategy('wtpPadSelection', strategies.wtpPadSelection.default),
  yardAllocation: getStrategy('yardAllocation', strategies.yardAllocation.default),
  ascDispatch: getStrategy('ascDispatch', strategies.ascDispatch.default),
  berthAllocation: getStrategy('berthAllocation', strategies.berthAllocation.default),
  craneSplit: getStrategy('craneSplit', strategies.craneSplit.default),
  workPackageRelease: getStrategy('workPackageRelease', strategies.workPackageRelease.default),
  emptyAllocation: getStrategy('emptyAllocation', strategies.emptyAllocation.default),
  rehandleTarget: getStrategy('rehandleTarget', strategies.rehandleTarget.default),
  gateLaneAssignment: getStrategy('gateLaneAssignment', strategies.gateLaneAssignment.default),
  transferStallSelection: getStrategy('transferStallSelection', strategies.transferStallSelection.default),
}
