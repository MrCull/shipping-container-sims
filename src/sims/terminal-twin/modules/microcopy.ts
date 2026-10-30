/**
 * Friendly empty-state copy (TT-21). Pure: picks a catalogue key and params
 * from the scene model; the component renders it through `t()`.
 */
import type { SceneModel } from './sceneModel'

export interface QuayNote {
  key: 'twin.quayQuiet' | 'twin.quayQuietDone'
  /** Sim time of the next arrival (for `twin.quayQuiet`). */
  etaS?: number
}

/** A note while no vessel is alongside or waiting at anchorage; null while the quay is busy. */
export function quayNote(model: SceneModel, t: number): QuayNote | null {
  let next = Infinity
  for (const v of model.config.vessels) {
    if (model.vesselPlacement(v.id, t)) return null
    if (v.arrivalS > t && v.arrivalS < next) next = v.arrivalS
  }
  return Number.isFinite(next) ? { key: 'twin.quayQuiet', etaS: next } : { key: 'twin.quayQuietDone' }
}
