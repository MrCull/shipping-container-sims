/**
 * Entity inspector model (TT-18): current state, current job and history of a
 * container, STS, SHC or vessel, from the engine's query results. Pure TS; the
 * component formats values with the display formatter and the catalogue.
 */
import type { ContainerState, ShcJob } from '../engine'
import type { CarrierRef, ContainerProps } from '../scenario/containerProps'
import { EQUIPMENT_KINDS, kindOfEntity, type EquipmentKind } from './equipmentKinds'
import type { ContainerSize } from '../scenario/types'
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
  unit?: 'length' | 'time' | 'mass'
  /** The value is a token with catalogue texts `inspector.<token>.<value>` (otherwise shown as is). */
  token?: 'load' | 'shcState' | 'direction' | 'weightClass'
  /** The value is a custody owner; the UI shows a slot in maritime notation (`modules/locationNotation.ts`). */
  owner?: { kind: string; id: string; size: ContainerSize }
}

export interface CustodyRow {
  t: number
  ownerKind: string
  ownerId: string
  eventId: number | null
  current: boolean
  /** The box's size, for the yard bay number of a slot owner. */
  size: ContainerSize
}

export interface EntityView {
  kind: EntityKind
  id: string
  facts: Fact[]
  /** What the entity is doing for: null when idle. */
  job: Fact[] | null
  /** Containers only: custody history, oldest first. */
  custody: CustodyRow[]
  /** Containers only: the stored properties a hover tooltip lists (a subset of `facts`). */
  tooltip?: Fact[]
}

export interface EntityExtras {
  /** SHC: sim time the view is for (an assigned SHC queues until its trip starts); without it the status alone decides. */
  now?: number
  /** SHC: the job it holds, from the `shcJobs` query. */
  job?: Readonly<ShcJob>
  /** Extras of other kinds (see `EquipmentKindDef.loadExtras`). */
  [key: string]: unknown
}

const carrierText = (c: CarrierRef): string => (c.id ? `${c.kind}:${c.id}` : c.kind)

/** The stored properties (spec #106) as facts; none for a box restored from a snapshot that predates them. */
function propFacts(box: Readonly<ContainerState>): { all: Fact[]; tooltip: Fact[] } {
  const p = box.props as ContainerProps | undefined
  if (!p) return { all: [], tooltip: [] }
  const tooltip: Fact[] = [
    { label: 'inspector.fact.direction', value: p.direction, token: 'direction' },
    { label: 'inspector.fact.isoType', value: p.isoType },
    { label: 'inspector.fact.pol', value: p.pol },
    { label: 'inspector.fact.pod', value: p.pod },
    { label: 'inspector.fact.grossWeight', value: p.tareKg + p.cargoKg, unit: 'mass' },
    { label: 'inspector.fact.weightClass', value: p.weightClass, token: 'weightClass' },
  ]
  const all: Fact[] = [
    ...tooltip,
    { label: 'inspector.fact.tareWeight', value: p.tareKg, unit: 'mass' },
    { label: 'inspector.fact.cargoWeight', value: p.cargoKg, unit: 'mass' },
    { label: 'inspector.fact.plannedDeparture', value: p.plannedDepartureS, unit: 'time' },
    { label: 'inspector.fact.inbound', value: carrierText(p.inbound) },
    { label: 'inspector.fact.outbound', value: carrierText(p.outbound) },
    ...(p.reeferSetpointC === undefined ? [] : [{ label: 'inspector.fact.setpoint' as const, value: p.reeferSetpointC }]),
    { label: 'inspector.fact.booking', value: p.bookingRef },
    { label: 'inspector.fact.holds', value: p.holds.length === 0 ? null : p.holds.join(', ') },
  ]
  return { all, tooltip }
}

function containerView(box: Readonly<ContainerState>): EntityView {
  const history = box.custodyHistory
  const props = propFacts(box)
  return {
    kind: 'container',
    id: box.id,
    facts: [
      { label: 'inspector.fact.line', value: box.line },
      { label: 'inspector.fact.size', value: box.size },
      { label: 'inspector.fact.load', value: box.full ? 'full' : 'empty', token: 'load' },
      { label: 'inspector.fact.custody', value: `${box.custody.kind}:${box.custody.id}`, owner: { kind: box.custody.kind, id: box.custody.id, size: box.size } },
      ...props.all,
    ],
    tooltip: props.tooltip,
    job: null,
    custody: history.map((h, i) => ({ t: h.t, ownerKind: h.owner.kind, ownerId: h.owner.id, eventId: h.eventId, current: i === history.length - 1, size: box.size })),
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
