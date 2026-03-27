// ---------------------------------------------------------------------------
// Box Empire — Spatial occupancy / soft collision system
// ---------------------------------------------------------------------------
// Entities register axis-aligned bounding rectangles on the XZ ground plane.
// Before moving, call canMoveTo() to check for overlaps.  The grid is rebuilt
// each tick from current entity positions so no explicit "update" call is needed.
// ---------------------------------------------------------------------------

export interface OccupancyRect {
  entityId: string
  entityType: 'truck' | 'equipment' | 'container'
  cx: number
  cz: number
  halfW: number
  halfD: number
}

const registry = new Map<string, OccupancyRect>()

function overlaps(a: OccupancyRect, b: OccupancyRect): boolean {
  return (
    Math.abs(a.cx - b.cx) < a.halfW + b.halfW &&
    Math.abs(a.cz - b.cz) < a.halfD + b.halfD
  )
}

export function registerEntity(rect: OccupancyRect): void {
  registry.set(rect.entityId, rect)
}

export function removeEntity(entityId: string): void {
  registry.delete(entityId)
}

export function canMoveTo(
  entityId: string,
  cx: number,
  cz: number,
): boolean {
  const existing = registry.get(entityId)
  if (!existing) return true

  const probe: OccupancyRect = {
    entityId,
    entityType: existing.entityType,
    cx,
    cz,
    halfW: existing.halfW,
    halfD: existing.halfD,
  }

  for (const [id, rect] of registry) {
    if (id === entityId) continue
    if (overlaps(probe, rect)) return false
  }
  return true
}

export function clearAll(): void {
  registry.clear()
}
