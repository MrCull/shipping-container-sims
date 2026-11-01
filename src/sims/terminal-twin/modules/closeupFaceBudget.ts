/**
 * Face budget selection for the close-up level (#143), pure: from the visible faces near the camera pick at most
 * `budget`, nearest first, within `maxDistM`. Hysteresis keeps the picture steady while the camera moves: a face
 * drawn last frame keeps its place out to 1.15 x the cut (the budget-th nearest distance, at most `maxDistM`), so a
 * newcomer only a little nearer does not push it out and faces do not pop at the edge.
 */

export interface FaceCandidate {
  /** Stable face id (box key and face). */
  id: number
  /** Squared distance from the camera to the face centre. */
  d2: number
}

export interface FaceBudgetOptions {
  budget: number
  maxDistM: number
  /** A drawn face stays out to the cut times this factor. */
  hysteresis: number
}

export function selectFaces(candidates: readonly FaceCandidate[], opts: FaceBudgetOptions, previous: ReadonlySet<number>): number[] {
  const { budget, maxDistM, hysteresis } = opts
  if (budget <= 0 || maxDistM <= 0) return []
  const max2 = maxDistM * maxDistM
  const stickyMax2 = max2 * hysteresis * hysteresis
  const inRange = candidates.filter((c) => c.d2 <= max2 || (previous.has(c.id) && c.d2 <= stickyMax2)).sort((a, b) => a.d2 - b.d2)
  // The cut: the budget-th nearest face among those inside the distance, else the distance itself.
  const fresh = inRange.filter((c) => c.d2 <= max2)
  const cut2 = fresh.length >= budget ? fresh[budget - 1].d2 : max2
  const sticky2 = cut2 * hysteresis * hysteresis
  const out: number[] = []
  const taken = new Set<number>()
  for (const c of inRange) {
    if (out.length >= budget) break
    if (previous.has(c.id) && c.d2 <= sticky2) {
      out.push(c.id)
      taken.add(c.id)
    }
  }
  for (const c of fresh) {
    if (out.length >= budget) break
    if (!taken.has(c.id)) out.push(c.id)
  }
  return out
}
