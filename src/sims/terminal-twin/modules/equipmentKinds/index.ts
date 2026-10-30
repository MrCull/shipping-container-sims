/**
 * The equipment-kind registry (V11-01). Adding a kind: write `modules/equipmentKinds/<kind>.ts` exporting an
 * `EquipmentKindDef`, add it to `EQUIPMENT_KINDS` below, and add the `inspector.kind.<kind>` catalogue entry.
 * The scene renderer, dev API, picking, labels and inspector iterate this list; no other module changes.
 * The order is the build and update order, and the Labels overlay's priority when it hits its cap.
 */
import type { SceneModel } from '../sceneModel'
import { ascKind } from './asc'
import { hatchKind } from './hatch'
import { shcKind } from './shc'
import { stsKind } from './sts'
import { truckKind } from './truck'
import type { EquipmentKindDef } from './types'
import { vesselKind } from './vessel'

export type { EquipmentKindDef, KindFrame, KindRenderer, KindRendererHost } from './types'

export const EQUIPMENT_KINDS = [stsKind, shcKind, ascKind, truckKind, vesselKind, hatchKind] as const

export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number]['kind']

/** The registered kind of an entity id in the scene, or null (containers are not equipment). */
export function kindOfEntity(model: SceneModel, id: string): EquipmentKind | null {
  for (const def of EQUIPMENT_KINDS) if (def.ids(model).includes(id)) return def.kind
  return null
}

/** What is missing from a kind's registration: empty when it is complete. */
export function registrationProblems(def: EquipmentKindDef): string[] {
  const problems: string[] = []
  for (const key of ['kind', 'sceneKey', 'rigKey'] as const) if (typeof def[key] !== 'string' || def[key] === '') problems.push(`${key} missing`)
  for (const key of ['ids', 'bounds', 'sceneState', 'describe', 'createRenderer'] as const) {
    if (typeof def[key] !== 'function') problems.push(`${key} missing`)
  }
  if (typeof def.labelled !== 'boolean') problems.push('labelled missing')
  return problems
}
