/**
 * Exposed faces (#143), pure: which of a container's six faces can be seen. A stacked yard box is hidden wherever a
 * neighbour touches it (a box on top, in the next bay at either end, in the next row at either side) and on its
 * underside; a box on a vessel, truck or spreader shows every face. The close-up level spends its face budget on
 * the visible faces only.
 *
 * Faces are named in the box's own frame (length along X, door end at +X, the frame of the GLB boxes): `door` is
 * +X, `front` is -X, `sideP` is +Z, `sideN` is -Z.
 */

export type Face = 'top' | 'bottom' | 'door' | 'front' | 'sideP' | 'sideN'

export const FACES: readonly Face[] = ['top', 'bottom', 'door', 'front', 'sideP', 'sideN']

export type ExposedFaces = Record<Face, boolean>

/** Whether a box touches the next slot in each direction. */
export interface Neighbours {
  above: boolean
  door: boolean
  front: boolean
  sideP: boolean
  sideN: boolean
}

/** 'yard' boxes are stacked and hidden by neighbours; 'free' ones (vessel, vehicle, spreader) show every face. */
export function exposedFaces(kind: 'yard' | 'free', n?: Neighbours): ExposedFaces {
  if (kind === 'free' || !n) return { top: true, bottom: true, door: true, front: true, sideP: true, sideN: true }
  return { top: !n.above, bottom: false, door: !n.door, front: !n.front, sideP: !n.sideP, sideN: !n.sideN }
}

/** The visible faces, in `FACES` order. */
export function visibleFaceList(f: ExposedFaces): Face[] {
  return FACES.filter((k) => f[k])
}

/** A box in the world: centre, yaw about Y (0 = length along X) and its size in metres. */
export interface PlacedBox {
  x: number
  y: number
  z: number
  yaw: number
  length: number
  width: number
  height: number
}

/** The largest gap that still counts as touching: yard row and bay gaps are about 0.5 m. */
const TOUCH_GAP_M = 0.9
/** How much of a face a neighbour must overlap, as a fraction of the smaller box, to hide it. */
const MIN_OVERLAP = 0.4

/** Overlap of the spans [-a, a] and [c - b, c + b]. */
const overlap = (a: number, b: number, c: number): number => Math.min(a, c + b) - Math.max(-a, c - b)

/** Which of the next slots around `box` are taken by one of `others` (the box itself, by identity, is skipped). */
export function neighboursOf(box: PlacedBox, others: Iterable<PlacedBox>): Neighbours {
  const out: Neighbours = { above: false, door: false, front: false, sideP: false, sideN: false }
  const cos = Math.cos(box.yaw)
  const sin = Math.sin(box.yaw)
  const hl = box.length / 2
  const hw = box.width / 2
  for (const o of others) {
    if (o === box) continue
    const dx = o.x - box.x
    const dz = o.z - box.z
    const dy = o.y - box.y
    // the other box in this box's frame: local x along its length, local z across it
    const lx = dx * cos - dz * sin
    const lz = dx * sin + dz * cos
    if (Math.abs(Math.cos(o.yaw - box.yaw)) < 0.9) continue // not parallel: not a slot neighbour
    const alongX = overlap(hl, o.length / 2, lx)
    const alongZ = overlap(hw, o.width / 2, lz)
    const minL = Math.min(box.length, o.length)
    if (Math.abs(dy) < box.height * 0.5) {
      // same tier: beside or in line
      if (alongX > minL * MIN_OVERLAP) {
        const gap = Math.abs(lz) - hw - o.width / 2
        if (gap > -0.2 && gap < TOUCH_GAP_M) {
          if (lz > 0) out.sideP = true
          else out.sideN = true
        }
      }
      if (alongZ > box.width * MIN_OVERLAP) {
        const gap = Math.abs(lx) - hl - o.length / 2
        if (gap > -0.2 && gap < TOUCH_GAP_M) {
          if (lx > 0) out.door = true
          else out.front = true
        }
      }
    } else if (dy > 0 && dy < box.height + 1.5 && alongX > minL * MIN_OVERLAP && alongZ > box.width * MIN_OVERLAP) {
      out.above = true
    }
  }
  return out
}
