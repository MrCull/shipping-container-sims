import { describe, expect, it } from 'vitest'
import { ViewerFrames, viewerRenderSettings } from './viewerRender'

describe('viewerRenderSettings (the asset viewer reads the twin URL switches)', () => {
  it('no parameters: draws every frame with the viewer look of today (shadows on, full resolution)', () => {
    expect(viewerRenderSettings('?viewer=yard')).toEqual({ draw: true, shadows: true, shadowMapSize: 2048, resolutionScale: 1 })
  })

  it('?render=off skips the draw', () => {
    expect(viewerRenderSettings('?viewer=asc&render=off').draw).toBe(false)
  })

  it('?quality=low takes the twin Low profile: no shadows, lower resolution', () => {
    expect(viewerRenderSettings('?viewer=yard&quality=low')).toEqual({ draw: true, shadows: false, shadowMapSize: 512, resolutionScale: 0.65 })
  })

  it('?quality=high and ?quality=auto keep the full look', () => {
    expect(viewerRenderSettings('?quality=high')).toEqual(viewerRenderSettings(''))
    expect(viewerRenderSettings('?quality=auto')).toEqual(viewerRenderSettings(''))
  })
})

describe('ViewerFrames (the viewer render loop)', () => {
  const fakeDraw = () => {
    let draws = 0
    return { draws: () => draws, fn: () => (draws++, { calls: 7, triangles: 1200 }) }
  }

  it('render off: every frame updates and counts, nothing is drawn, the counts stay 0', () => {
    const d = fakeDraw()
    const frames = new ViewerFrames(false, d.fn)
    let updates = 0
    for (let i = 0; i < 3; i++) frames.frame(() => updates++)
    expect(updates).toBe(3)
    expect(frames.frames).toBe(3)
    expect(d.draws()).toBe(0)
    expect(frames.render).toEqual({ calls: 0, triangles: 0 })
  })

  it('renderOnce draws one frame and refreshes the counts', () => {
    const d = fakeDraw()
    const frames = new ViewerFrames(false, d.fn)
    expect(frames.renderOnce()).toEqual({ calls: 7, triangles: 1200 })
    expect(frames.render).toEqual({ calls: 7, triangles: 1200 })
    expect(d.draws()).toBe(1)
  })

  it('render on: every frame draws', () => {
    const d = fakeDraw()
    const frames = new ViewerFrames(true, d.fn)
    frames.frame(() => {})
    frames.frame(() => {})
    expect(d.draws()).toBe(2)
    expect(frames.render.calls).toBe(7)
  })
})
