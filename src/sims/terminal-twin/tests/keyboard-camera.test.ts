/**
 * TT-R03: keyboard camera. The keymap (camera actions present, dashboard on B, no key bound twice) and the pure
 * pose stepper that turns held keys into pan, orbit, tilt and zoom.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cameraKeyFor, cameraMotion, SHORTCUT_HELP, shortcutFor, type CameraKey } from '../modules/shortcuts'
import { stepCameraPose, type CameraLimits, type CameraPose } from '../modules/cameraKeys'

const key = (k: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; target: EventTarget | null }> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: null,
  ...extra,
})

describe('keymap', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('maps every camera action', () => {
    const cases: [string, CameraKey][] = [
      ['w', 'forward'], ['W', 'forward'], ['ArrowUp', 'forward'],
      ['s', 'back'], ['S', 'back'], ['ArrowDown', 'back'],
      ['a', 'left'], ['A', 'left'], ['ArrowLeft', 'left'],
      ['d', 'right'], ['D', 'right'], ['ArrowRight', 'right'],
      ['=', 'zoomIn'], ['+', 'zoomIn'],
      ['-', 'zoomOut'], ['_', 'zoomOut'],
    ]
    for (const [k, action] of cases) expect(cameraKeyFor(key(k)), k).toBe(action)
  })

  it('puts the dashboard on B and frees D', () => {
    expect(shortcutFor(key('b'))).toEqual({ kind: 'dashboard' })
    expect(shortcutFor(key('d'))).toBeNull()
  })

  it('binds no key as both a camera key and a shortcut', () => {
    for (const k of ['w', 'a', 's', 'd', 'W', 'A', 'S', 'D', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '=', '+', '-', '_']) {
      expect(shortcutFor(key(k)), `${k} is a camera key`).toBeNull()
    }
    for (const k of ['b', 'f', 'n', 'o', 'e', 'i', 'p', 'q', 'y', 'g', 'v', '.', '?', ' ', '0', '1', 'Escape']) {
      expect(cameraKeyFor(key(k)), `${k} is a shortcut`).toBeNull()
    }
  })

  it('ignores modifiers and typing targets', () => {
    class FakeElement {
      isContentEditable = false
    }
    class FakeInput extends FakeElement {}
    vi.stubGlobal('HTMLElement', FakeElement)
    vi.stubGlobal('HTMLInputElement', FakeInput)
    vi.stubGlobal('HTMLTextAreaElement', class {})
    vi.stubGlobal('HTMLSelectElement', class {})
    expect(cameraKeyFor(key('w', { ctrlKey: true }))).toBeNull()
    expect(cameraKeyFor(key('w', { metaKey: true }))).toBeNull()
    expect(cameraKeyFor(key('w', { altKey: true }))).toBeNull()
    expect(cameraKeyFor(key('w', { target: new FakeInput() as unknown as EventTarget }))).toBeNull()
    expect(cameraKeyFor(key('w', { target: new FakeElement() as unknown as EventTarget }))).toBe('forward')
  })

  it('lists the camera keys in the help', () => {
    const actions = SHORTCUT_HELP.map((r) => r.action)
    for (const a of ['shortcuts.camPan', 'shortcuts.camOrbit', 'shortcuts.camTilt', 'shortcuts.camZoom']) expect(actions).toContain(a)
    const dashboard = SHORTCUT_HELP.find((r) => r.action === 'shortcuts.dashboard')
    expect(dashboard?.keys).toBe('shortcuts.key.b')
  })
})

describe('cameraMotion', () => {
  it('pans without Shift, orbits and tilts with Shift, zooms either way', () => {
    expect(cameraMotion(new Set<CameraKey>(['forward', 'right']), false)).toEqual({ forward: 1, right: 1, orbit: 0, tilt: 0, zoom: 0 })
    expect(cameraMotion(new Set<CameraKey>(['forward', 'right']), true)).toEqual({ forward: 0, right: 0, orbit: 1, tilt: -1, zoom: 0 })
    expect(cameraMotion(new Set<CameraKey>(['back', 'left']), true)).toEqual({ forward: 0, right: 0, orbit: -1, tilt: 1, zoom: 0 })
    expect(cameraMotion(new Set<CameraKey>(['zoomIn']), true).zoom).toBe(1)
    expect(cameraMotion(new Set<CameraKey>(['zoomOut']), false).zoom).toBe(-1)
    expect(cameraMotion(new Set<CameraKey>(['forward', 'back']), false).forward).toBe(0)
  })
})

describe('stepCameraPose', () => {
  const limits: CameraLimits = { minDistance: 8, maxDistance: 3500, minPolar: 0.01, maxPolar: Math.PI / 2.05 }
  const pose: CameraPose = { target: { x: 0, y: 0, z: 0 }, distance: 100, azimuth: 0, polar: 1 }
  const idle = { forward: 0, right: 0, orbit: 0, tilt: 0, zoom: 0 }

  it('does nothing without motion', () => {
    expect(stepCameraPose(pose, idle, 0.5, limits)).toEqual(pose)
  })

  it('pans forward along the heading (away from the camera) on the ground plane', () => {
    const next = stepCameraPose(pose, { ...idle, forward: 1 }, 1, limits)
    expect(next.target.z).toBeLessThan(0) // azimuth 0 puts the camera on +z looking toward -z
    expect(next.target.x).toBeCloseTo(0)
    expect(next.target.y).toBe(0)
    const turned = stepCameraPose({ ...pose, azimuth: Math.PI / 2 }, { ...idle, forward: 1 }, 1, limits)
    expect(turned.target.x).toBeLessThan(0)
    expect(turned.target.z).toBeCloseTo(0)
  })

  it('pans right of the heading', () => {
    expect(stepCameraPose(pose, { ...idle, right: 1 }, 1, limits).target.x).toBeGreaterThan(0)
  })

  it('scales pan speed with distance and time', () => {
    const near = stepCameraPose({ ...pose, distance: 50 }, { ...idle, forward: 1 }, 1, limits)
    const far = stepCameraPose({ ...pose, distance: 500 }, { ...idle, forward: 1 }, 1, limits)
    expect(Math.abs(far.target.z)).toBeCloseTo(Math.abs(near.target.z) * 10)
    const half = stepCameraPose(pose, { ...idle, forward: 1 }, 0.5, limits)
    expect(Math.abs(half.target.z)).toBeCloseTo(Math.abs(stepCameraPose(pose, { ...idle, forward: 1 }, 1, limits).target.z) / 2)
  })

  it('orbits the azimuth and keeps the target and distance', () => {
    const next = stepCameraPose(pose, { ...idle, orbit: 1 }, 0.5, limits)
    expect(next.azimuth).toBeGreaterThan(pose.azimuth)
    expect(next.target).toEqual(pose.target)
    expect(next.distance).toBe(pose.distance)
  })

  it('tilts within the polar limits', () => {
    expect(stepCameraPose(pose, { ...idle, tilt: 1 }, 0.1, limits).polar).toBeGreaterThan(pose.polar)
    expect(stepCameraPose(pose, { ...idle, tilt: 1 }, 100, limits).polar).toBe(limits.maxPolar)
    expect(stepCameraPose(pose, { ...idle, tilt: -1 }, 100, limits).polar).toBe(limits.minPolar)
  })

  it('zooms within the distance range', () => {
    expect(stepCameraPose(pose, { ...idle, zoom: 1 }, 0.5, limits).distance).toBeLessThan(100)
    expect(stepCameraPose(pose, { ...idle, zoom: -1 }, 0.5, limits).distance).toBeGreaterThan(100)
    expect(stepCameraPose(pose, { ...idle, zoom: 1 }, 1000, limits).distance).toBe(limits.minDistance)
    expect(stepCameraPose(pose, { ...idle, zoom: -1 }, 1000, limits).distance).toBe(limits.maxDistance)
  })
})
