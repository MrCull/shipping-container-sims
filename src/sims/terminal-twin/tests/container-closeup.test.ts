/**
 * Close-up container level (#119) through the instancer's public seam: which boxes become close-ups (distance, cap,
 * hysteresis), that they leave the instanced layers, and that textures are cached per box and evicted beyond the cap.
 * Textures are stubbed (no canvas in Node); the painted result is covered by the browser smoke spec.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { ContainerAssets } from '../modules/containerAssets'
import { ContainerCloseups } from '../modules/containerCloseups'
import { closeupGeometry, TEXTURE_LAYOUT } from '../modules/closeupGeometry'
import { ContainerInstancer } from '../modules/containerInstancer'
import { describeMarkings } from '../modules/containerMarkings'
import { makeIso6346Id } from '../scenario/iso6346'

function assets(): ContainerAssets {
  const box = () => new THREE.BoxGeometry(1, 1, 1)
  const sizes = { '20': { lod0: box(), lod1: box() }, '40': { lod0: box(), lod1: box() }, '40HC': { lod0: box(), lod1: box() } }
  return { sizes, lod0Material: new THREE.MeshStandardMaterial(), lod1Material: new THREE.MeshStandardMaterial() }
}

function setup(n: number, opts: { cacheCap?: number; painted?: number[] } = {}) {
  const painted = opts.painted ?? []
  let disposed = 0
  const closeups = new ContainerCloseups(
    opts.cacheCap ?? 64,
    () => {
      const t = new THREE.Texture()
      t.addEventListener('dispose', () => disposed++)
      return t
    },
    () => null,
  )
  const inst = new ContainerInstancer({ '40': n }, {}, closeups)
  inst.setAssets(assets())
  inst.setMarkingsSource((key) => {
    painted.push(key)
    return { markings: describeMarkings({ id: makeIso6346Id('MSCU', key + 1), size: '40', line: 'MSC', laden: true }), bodyColour: '#d8c9a3' }
  })
  return { inst, closeups, painted, disposed: () => disposed }
}

/** `n` boxes in a row along X, 13 m apart, at ground level. */
function frame(inst: ContainerInstancer, n: number, camX: number, camDist = 20): ReturnType<ContainerInstancer['end']> {
  inst.begin()
  for (let i = 0; i < n; i++) inst.push(i, '40', i * 13, 1.3, 0, 0)
  return inst.end(new THREE.Vector3(camX, 1.3, camDist))
}

describe('close-up selection', () => {
  it('is above zero near a box and zero when far', () => {
    const { inst } = setup(10)
    const near = frame(inst, 10, 0, 10)
    expect(near.closeup).toBeGreaterThan(0)
    expect(near.lod0).toBeGreaterThanOrEqual(near.closeup)
    const far = frame(inst, 10, 0, 200)
    expect(far.closeup).toBe(0)
  })

  it('keeps close-up boxes out of the instanced layers and counts them in lod0 + lod1 = drawn', () => {
    const { inst } = setup(10)
    const s = frame(inst, 10, 0, 10)
    expect(s.lod0 + s.lod1).toBe(s.drawn)
    const lod0Mesh = inst.group.getObjectByName('containers-40-lod0') as THREE.InstancedMesh
    expect(lod0Mesh.count + s.closeup).toBe(s.lod0)
    expect(inst.cost().drawCalls).toBeGreaterThanOrEqual(s.closeup)
  })

  it('draws at most the cap, the nearest first', () => {
    const { inst } = setup(120)
    const s = frame(inst, 120, 0, 5)
    expect(s.closeup).toBeLessThanOrEqual(48)
    expect(inst.renderedContainer(0)?.lod).toBe(0)
    inst.setLodOptions({ closeupCap: 3 })
    expect(frame(inst, 120, 0, 5).closeup).toBe(3)
    inst.setLodOptions({ closeupCap: 0 })
    expect(frame(inst, 120, 0, 5).closeup).toBe(0)
  })

  it('switches back only beyond the hysteresis distance', () => {
    const { inst } = setup(1)
    expect(frame(inst, 1, 0, 34).closeup).toBe(1) // enters inside 35 m
    expect(frame(inst, 1, 0, 38).closeup).toBe(1) // stays out to 35 x 1.15 = 40.25 m
    expect(frame(inst, 1, 0, 41).closeup).toBe(0)
    expect(frame(inst, 1, 0, 38).closeup).toBe(0) // and does not re-enter until inside 35 m again
    expect(frame(inst, 1, 0, 34).closeup).toBe(1)
  })

  it('paints a box once while it stays shown or cached', () => {
    const { inst, painted } = setup(5)
    frame(inst, 5, 0, 10)
    const first = painted.length
    expect(first).toBeGreaterThan(0)
    frame(inst, 5, 0, 10)
    frame(inst, 5, 0, 200) // all hidden, still cached
    frame(inst, 5, 0, 10)
    expect(painted.length).toBe(first)
  })

  it('evicts the least recently shown textures beyond the cache cap and disposes them', () => {
    const { inst, closeups, disposed } = setup(30, { cacheCap: 4 })
    inst.setLodOptions({ closeupCap: 2 })
    for (let step = 0; step < 10; step++) frame(inst, 30, step * 13, 6) // sweep along the row
    expect(closeups.cached).toBeLessThanOrEqual(4)
    expect(disposed()).toBeGreaterThan(0)
  })
})

describe('close-up geometry', () => {
  it('adds corner castings and door rods to the box, with both UV sets', () => {
    const g = closeupGeometry('40HC')
    const body = 6 * 6 // six quads
    expect(g.getAttribute('position').count).toBeGreaterThan(body + 8 * 36)
    expect(g.getAttribute('uv')).toBeDefined()
    expect(g.getAttribute('uv1')).toBeDefined()
    expect(g.boundingSphere!.radius).toBeGreaterThan(6)
  })

  it('maps the faces into the canvas layout', () => {
    for (const r of Object.values(TEXTURE_LAYOUT)) {
      expect(r.x + r.w).toBeLessThanOrEqual(1024)
      expect(r.y + r.h).toBeLessThanOrEqual(512)
    }
    const uv = closeupGeometry('20').getAttribute('uv')
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(0)
      expect(uv.getX(i)).toBeLessThanOrEqual(1)
      expect(uv.getY(i)).toBeGreaterThanOrEqual(0)
      expect(uv.getY(i)).toBeLessThanOrEqual(1)
    }
  })
})
