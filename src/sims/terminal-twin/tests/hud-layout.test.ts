/** HUD layout model: region boxes and the no-overlap rule (browser spec: tests/browser/terminal-twin-hud.smoke.ts). */
import { describe, expect, it } from 'vitest'
import { HUD_REGIONS, overlappingRegions, readHudLayout, type HudBox, type HudLayout } from '../modules/hudLayout'

const box = (x: number, y: number, width: number, height: number): HudBox => ({ x, y, width, height })

function layoutOf(regions: HudLayout['regions']): HudLayout {
  return { viewport: { width: 1280, height: 720 }, regions }
}

describe('hud layout', () => {
  it('names six regions', () => {
    expect([...HUD_REGIONS]).toEqual(['topBar', 'settings', 'kpiStrip', 'leftPanel', 'rightPanel', 'overlayBar'])
  })

  it('reports no overlap for boxes that only touch', () => {
    const layout = layoutOf({ topBar: box(0, 0, 100, 40), settings: box(100, 0, 50, 40), kpiStrip: box(0, 40, 100, 40) })
    expect(overlappingRegions(layout)).toEqual([])
  })

  it('reports each overlapping pair once, ignoring absent regions', () => {
    const layout = layoutOf({ kpiStrip: box(0, 0, 200, 50), leftPanel: box(150, 0, 100, 300), rightPanel: null })
    expect(overlappingRegions(layout)).toEqual([['kpiStrip', 'leftPanel']])
  })

  it('reads boxes from data-hud-region elements and skips empty ones', () => {
    const el = (name: string, r: HudBox) => ({ dataset: { hudRegion: name }, getBoundingClientRect: () => ({ ...r }) })
    const root = {
      querySelectorAll: () => [el('kpiStrip', box(10.4, 20, 300, 60)), el('overlayBar', box(0, 0, 0, 0))],
    } as unknown as ParentNode
    const layout = readHudLayout(root, { width: 1280, height: 720 })
    expect(layout.regions.kpiStrip).toEqual(box(10.4, 20, 300, 60))
    expect(layout.regions.overlayBar).toBeNull()
    expect(layout.regions.topBar).toBeNull()
  })
})
