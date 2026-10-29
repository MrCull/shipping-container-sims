/**
 * HUD layout model. The HUD is a set of named regions; each region's root element carries
 * `data-hud-region="<name>"`. `readHudLayout` reports their bounding boxes (the dev API's `hudLayout()`),
 * `overlappingRegions` is the no-overlap rule the browser spec asserts.
 */

/** Top bar (clock, speeds, actions), settings (Daylight, Sound, Quality, Stats), KPI strip, side panels, overlay bar. */
export const HUD_REGIONS = ['topBar', 'settings', 'kpiStrip', 'leftPanel', 'rightPanel', 'overlayBar'] as const
export type HudRegion = (typeof HUD_REGIONS)[number]

export interface HudBox {
  x: number
  y: number
  width: number
  height: number
}

export interface HudLayout {
  viewport: { width: number; height: number }
  /** `null` when the region is not shown. */
  regions: Partial<Record<HudRegion, HudBox | null>>
}

export function readHudLayout(root: ParentNode, viewport: { width: number; height: number }): HudLayout {
  const regions: HudLayout['regions'] = {}
  for (const name of HUD_REGIONS) regions[name] = null
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-hud-region]'))) {
    const name = el.dataset.hudRegion as HudRegion
    if (!HUD_REGIONS.includes(name)) continue
    const r = el.getBoundingClientRect()
    regions[name] = r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null
  }
  return { viewport, regions }
}

/** Pairs of shown regions whose boxes overlap by more than `tolerance` px on both axes (touching edges do not count). */
export function overlappingRegions(layout: HudLayout, tolerance = 0.5): [HudRegion, HudRegion][] {
  const shown = HUD_REGIONS.flatMap((name) => {
    const b = layout.regions[name]
    return b ? [{ name, b }] : []
  })
  const pairs: [HudRegion, HudRegion][] = []
  for (let i = 0; i < shown.length; i++) {
    for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i].b
      const b = shown[j].b
      const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
      const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
      if (w > tolerance && h > tolerance) pairs.push([shown[i].name, shown[j].name])
    }
  }
  return pairs
}
