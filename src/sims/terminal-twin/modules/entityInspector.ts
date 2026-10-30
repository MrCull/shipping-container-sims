/**
 * Entity inspector model (TT-18): current state, current job and history of a
 * container, STS, SHC or vessel, from the engine's query results. Pure TS; the
 * component formats values with the display formatter and the catalogue.
 */
import type { ContainerState, ShcJob } from '../engine'
import { EQUIPMENT_KINDS, kindOfEntity, type EquipmentKind } from './equipmentKinds'
import type { MessageKey } from '../i18n/messages'
import type { EventSummary, QueryKind } from '../worker/protocol'
import type { SceneModel } from './sceneModel'

export type EntityKind = 'container' | EquipmentKind

export function entityKind(model: SceneModel, id: string): EntityKind | null {
  if (model.containerSize[id]) return 'container'
  return kindOfEntity(model, id)
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
  token?: 'load' | 'shcState'
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
  /** SHC: sim time the view is for (an assigned SHC queues until its trip starts); without it the status alone decides. */
  now?: number
  /** SHC: the job it holds, from the `shcJobs` query. */
  job?: Readonly<ShcJob>
  /** Extras of other kinds (see `EquipmentKindDef.loadExtras`). */
  [key: string]: unknown
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

/** Turn a query result into the inspector view of its kind (equipment kinds describe themselves: `modules/equipmentKinds/`). */
export function describeEntity(kind: EntityKind, state: unknown, extras: EntityExtras = {}): EntityView {
  if (kind === 'container') return containerView(state as ContainerState)
  const def = EQUIPMENT_KINDS.find((d) => d.kind === kind)
  if (!def) throw new Error(`Unknown entity kind: ${kind}`)
  return def.describe(state, extras)
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
