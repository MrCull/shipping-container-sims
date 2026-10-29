/**
 * V11-05: Labels declutter. Given the screen boxes of the labels that would be shown, in priority order, returns the
 * ids to keep: a label that would overlap an already kept one is hidden, so no two visible labels overlap.
 */
export interface LabelBox {
  id: string
  /** Top-left corner and size, in any consistent screen unit. */
  x: number
  y: number
  w: number
  h: number
}

const overlaps = (a: LabelBox, b: LabelBox): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

export function declutterLabels(boxes: readonly LabelBox[]): Set<string> {
  const kept: LabelBox[] = []
  for (const box of boxes) if (!kept.some((k) => overlaps(k, box))) kept.push(box)
  return new Set(kept.map((b) => b.id))
}
