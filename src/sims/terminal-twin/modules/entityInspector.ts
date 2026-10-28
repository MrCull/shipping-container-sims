/**
 * Entity inspector model (TT-18): current state, current job and history of a
 * container, STS, SHC or vessel, from the engine's query results. Pure TS; the
 * component formats values with the display formatter and the catalogue.
 */
import type { ContainerState, ShcJob, ShcState, StsState, VesselState } from '../engine'
import type { MessageKey } from '../i18n/messages'
import type { EventSummary, QueryKind } from '../worker/protocol'
import type { SceneModel } from './sceneModel'

export type EntityKind = 'container' | 'sts' | 'shc' | 'vessel'

export function entityKind(model: SceneModel, id: string): EntityKind | null {
  if (model.containerSize[id]) return 'container'
  if (model.shcIds.includes(id)) return 'shc'
  if (model.stsIds.includes(id)) return 'sts'
  if (model.vesselIds.includes(id)) return 'vessel'
  return null
}

/** The worker query that returns the state of an entity of this kind. */
export function entityQueryKind(kind: EntityKind): QueryKind {
  return kind
}

/** One line of the state list. `link` marks an entity id that can be selected. `unit` asks for a formatted number. */
export interface Fact {
  label: MessageKey
  value: string | number | null
  link?: boolean
  unit?: 'length' | 'time'
  /** The value is a token with catalogue texts `inspector.<token>.<value>` (otherwise shown as is). */
  token?: 'load'
}

export interface CustodyRow {
  t: number
  ownerKind: string
  ownerId: string
  eventId: number | null
  current: boolean
}

export interface EntityView {
  kind: EntityKind
  id: string
  facts: Fact[]
  /** What the entity is doing for: null when idle. */
  job: Fact[] | null
  /** Containers only: custody history, oldest first. */
  custody: CustodyRow[]
}

export interface EntityExtras {
  /** SHC: the job it holds, from the `shcJobs` query. */
  job?: Readonly<ShcJob>
}

function containerView(box: Readonly<ContainerState>): EntityView {
  const history = box.custodyHistory
  return {
    kind: 'container',
    id: box.id,
    facts: [
      { label: 'inspector.fact.line', value: box.line },
      { label: 'inspector.fact.size', value: box.size },
      { label: 'inspector.fact.load', value: box.full ? 'full' : 'empty', token: 'load' },
      { label: 'inspector.fact.custody', value: `${box.custody.kind}:${box.custody.id}` },
    ],
    job: null,
    custody: history.map((h, i) => ({ t: h.t, ownerKind: h.owner.kind, ownerId: h.owner.id, eventId: h.eventId, current: i === history.length - 1 })),
  }
}

function shcView(shc: Readonly<ShcState>, job?: Readonly<ShcJob>): EntityView {
  const facts: Fact[] = [
    { label: 'inspector.fact.status', value: shc.status },
    { label: 'inspector.fact.node', value: shc.nodeId },
    { label: 'inspector.fact.carrying', value: shc.carrying, link: shc.carrying !== null },
  ]
  const working = shc.jobId !== null
  return {
    kind: 'shc',
    id: shc.id,
    facts,
    job: working
      ? [
          { label: 'inspector.fact.job', value: shc.jobId },
          { label: 'inspector.fact.container', value: job?.containerId ?? shc.carrying, link: true },
          { label: 'inspector.fact.fromPosition', value: job?.groundPositionId ?? null },
          { label: 'inspector.fact.toPad', value: job?.wtpPadId ?? null },
        ]
      : null,
    custody: [],
  }
}

function stsView(sts: Readonly<StsState>): EntityView {
  const working = sts.carrying.length > 0 || sts.workQueue.length > 0
  return {
    kind: 'sts',
    id: sts.id,
    facts: [
      { label: 'inspector.fact.status', value: sts.status },
      { label: 'inspector.fact.vessel', value: sts.vesselId, link: sts.vesselId !== null },
      { label: 'inspector.fact.gantry', value: sts.gantryX, unit: 'length' },
      { label: 'inspector.fact.bays', value: sts.bays.join(', ') || null },
    ],
    job: working
      ? [
          { label: 'inspector.fact.carryingBoxes', value: sts.carrying.join(', ') || null },
          { label: 'inspector.fact.nextBox', value: sts.workQueue[0] ?? null, link: sts.workQueue.length > 0 },
          { label: 'inspector.fact.queued', value: sts.workQueue.length },
        ]
      : null,
    custody: [],
  }
}

function vesselView(v: Readonly<VesselState>): EntityView {
  return {
    kind: 'vessel',
    id: v.id,
    facts: [
      { label: 'inspector.fact.status', value: v.status },
      { label: 'inspector.fact.class', value: v.sizeClass },
      { label: 'inspector.fact.berthX', value: v.berthX, unit: 'length' },
      { label: 'inspector.fact.stsAssigned', value: v.stsIds.join(', ') || null },
      { label: 'inspector.fact.remaining', value: v.remainingDischarge },
      { label: 'inspector.fact.anchorageWait', value: v.anchorageWaitS, unit: 'time' },
    ],
    job: null,
    custody: [],
  }
}

/** Turn a query result into the inspector view of its kind. */
export function describeEntity(kind: EntityKind, state: unknown, extras: EntityExtras = {}): EntityView {
  switch (kind) {
    case 'container':
      return containerView(state as ContainerState)
    case 'shc':
      return shcView(state as ShcState, extras.job)
    case 'sts':
      return stsView(state as StsState)
    case 'vessel':
      return vesselView(state as VesselState)
  }
}

/** The newest `limit` events that name `id` in any subject list, oldest first. */
export function eventsInvolving(events: readonly EventSummary[], id: string, limit: number): EventSummary[] {
  const out: EventSummary[] = []
  for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
    const s = events[i].subjects
    if (s.containers?.includes(id) || s.equipment?.includes(id) || s.vessels?.includes(id) || s.jobs?.includes(id)) out.push(events[i])
  }
  return out.reverse()
}
