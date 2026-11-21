/**
 * The asset viewer's side of the URL switches (#345): it reads `?quality=` and `?render=` with the same parser and
 * the same meaning as the twin (`modules/urlSwitches.ts`). Render off keeps every per-frame update (auto LOD, orbit
 * controls) and skips only the draw; `__ttAssets.renderOnce()` draws one frame and refreshes the draw counts.
 */
import { profileFor } from '../modules/quality'
import { parseUrlSwitches } from '../modules/urlSwitches'

export interface ViewerRenderSettings {
  /** False with `?render=off`. */
  draw: boolean
  shadows: boolean
  shadowMapSize: number
  /** Multiplier on the device pixel ratio, before the cap of 2. */
  resolutionScale: number
}

export interface ViewerRenderInfo {
  calls: number
  triangles: number
}

/** A fixed `?quality=` level takes that level's shadows and resolution; none (or `auto`) keeps the viewer's full look. */
export function viewerRenderSettings(search: string): ViewerRenderSettings {
  const switches = parseUrlSwitches(search)
  const level = switches.quality === null || switches.quality === 'auto' ? 'high' : switches.quality
  const p = profileFor(level)
  return { draw: switches.render, shadows: p.shadows, shadowMapSize: p.shadowMapSize, resolutionScale: p.resolutionScale }
}

/** Counts the viewer's frames and draws them unless render is off. */
export class ViewerFrames {
  /** Frames updated (and drawn unless render is off). */
  frames = 0
  /** Draw calls and triangles of the last drawn frame (0 until one is drawn). */
  render: ViewerRenderInfo = { calls: 0, triangles: 0 }

  constructor(
    readonly drawEnabled: boolean,
    private readonly draw: () => ViewerRenderInfo,
  ) {}

  frame(update: () => void): void {
    update()
    if (this.drawEnabled) this.renderOnce()
    this.frames++
  }

  renderOnce(): ViewerRenderInfo {
    this.render = { ...this.draw() }
    return { ...this.render }
  }
}
