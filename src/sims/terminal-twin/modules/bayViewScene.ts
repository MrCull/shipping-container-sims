/**
 * Bay viewer data at the 3D scene's display time (spec #154, #159). The worker answers the `bayView` query from the
 * live engine, which runs ahead of the display while playing (the controller's lookahead: up to 1.5 wall seconds
 * times the speed, an hour and a half of sim time at x3600) and stays ahead after a pause. Read as is, the bay view
 * showed bays already worked that the 3D vessel still drew loaded. This moves the data back to the display time with
 * the scene model's replayed custody, the same record the 3D boxes are posed from, and takes the ROB boxes from the
 * scene model too, so the bay view and the 3D vessel show the same boxes in the same cells. Pure: no Vue, no Three.js.
 */
import { presentShared, type BayBox, type BayViewData } from './bayView'
import type { SceneModel } from './sceneModel'

export type BayViewScene = Pick<SceneModel, 'custodyAt' | 'robBoxesOf'>

/** `data` (the engine's, read at `data.now`) as the scene draws the vessel at display time `t`. */
export function bayViewDataAt(data: BayViewData, scene: BayViewScene, t: number): BayViewData {
  const boxes: Record<string, BayBox> = {}
  const slots = data.slots.map((s) => {
    const sc = data.shared?.[s.id]
    if (sc) {
      // a shared cell (#203): both boxes at display time, then the cell as the viewer presents it
      const kindAt = (b: BayBox) => scene.custodyAt(b.id, t)?.kind ?? 'external'
      const shown = presentShared({ slot: sc.slot, arrival: { ...sc.arrival, custody: kindAt(sc.arrival) }, ...(sc.load ? { load: { ...sc.load, custody: kindAt(sc.load) } } : {}) })
      boxes[s.id] = shown.box
      return shown.slot
    }
    const box = data.boxes[s.id]
    if (!box) return s
    const at = scene.custodyAt(box.id, t)
    boxes[s.id] = { ...box, custody: at?.kind ?? 'external' }
    const here = at?.kind === 'vesselSlot' && at.id === s.id
    if (s.purpose === 'discharge') return { ...s, containerId: here ? box.id : null }
    // a load slot not loaded yet at `t` is still booked to its box
    return here ? { ...s, containerId: box.id } : { ...s, containerId: null, plannedContainerId: s.plannedContainerId ?? box.id }
  })
  return { ...data, slots, boxes, robBoxes: scene.robBoxesOf(data.vesselId), now: Math.min(t, data.now ?? t) }
}
