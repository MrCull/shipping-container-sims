/**
 * Close-up marking level (#119, #143) through the instancer's public seam: which faces get markings (distance, face
 * budget, hysteresis, exposed faces of stacked boxes), that boxes keep their LOD layer, that tiles are painted once
 * while they stay cached, and that the cost is one draw call per atlas page. Painting is stubbed (no canvas in
 * Node); the painted result is covered by the browser smoke spec.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { ContainerAssets } from '../modules/containerAssets'
import { ContainerCloseups, type AtlasBackend, type PaintJob } from '../modules/containerCloseups'
import { ContainerInstancer } from '../modules/containerInstancer'
import { describeMarkings } from '../modules/containerMarkings'
import { makeIso6346Id } from '../scenario/iso6346'

function assets(): ContainerAssets {
  const box = () => new THREE.BoxGeometry(1, 1, 1)
  const sizes = { '20': { lod0: box(), lod1: box() }, '40': { lod0: box(), lod1: box() }, '40HC': { lod0: box(), lod1: box() } }
  return { sizes, lod0Material: new THREE.MeshStandardMaterial(), lod1Material: new THREE.MeshStandardMaterial() }
}

function setup(n: number, opts: { painted?: number[] } = {}) {
  const painted = opts.painted ?? []
  const jobs: PaintJob[] = []
  const backend: AtlasBackend = {
    createPage: () => ({ texture: new THREE.Texture(), ctx: null }),
    paint: (_source, _size, j) => jobs.push(...j),
  }
  const closeups = new ContainerCloseups(backend, () => null)
  const inst = new ContainerInstancer({ '40': n }, {}, closeups)
  inst.setAssets(assets())
  inst.setMarkingsSource((key) => {
    painted.push(key)
    return { markings: describeMarkings({ id: makeIso6346Id('MSCU', key + 1), size: '40', line: 'MSC', laden: true }), bodyColour: '#d8c9a3' }
  })
  return { inst, closeups, painted, jobs }
}

/** `n` free (vessel or vehicle) boxes in a row along X, 13 m apart, at ground level; the camera is `camDist` away along Z. */
function frame(inst: ContainerInstancer, n: number, camX: number, camDist = 20): ReturnType<ContainerInstancer['end']> {
  inst.begin()
  for (let i = 0; i < n; i++) inst.push(i, '40', i * 13, 1.3, 0, 0)
  return inst.end(new THREE.Vector3(camX, 1.3, camDist))
}

describe('close-up marking faces', () => {
  it('draws faces near a box and none when far', () => {
    const { inst } = setup(10)
    const near = frame(inst, 10, 0, 10)
    expect(near.closeup).toBeGreaterThan(0)
    expect(near.closeupFaces).toBeGreaterThan(0)
    const far = frame(inst, 10, 0, 200)
    expect(far.closeup).toBe(0)
    expect(far.closeupFaces).toBe(0)
  })

  it('leaves the boxes in their LOD layers (the faces are decals) and keeps lod0 + lod1 = drawn', () => {
    const { inst } = setup(10)
    const s = frame(inst, 10, 0, 10)
    expect(s.lod0 + s.lod1).toBe(s.drawn)
    const lod0Mesh = inst.group.getObjectByName('containers-40-lod0') as THREE.InstancedMesh
    expect(lod0Mesh.count).toBe(s.lod0)
    expect(inst.renderedContainer(0)?.lod).toBe(0)
  })

  it('draws only faces turned towards the camera: a box seen from the +Z side shows its +Z side and roof, not the -Z side', () => {
    const { inst, jobs } = setup(1)
    inst.begin()
    inst.push(0, '40', 0, 1.3, 0, 0)
    const s = inst.end(new THREE.Vector3(0, 5, 10))
    expect(s.closeupFaces).toBe(2)
    expect(jobs.map((j) => j.face).sort()).toEqual(['sideP', 'top'])
  })

  it('draws at most the face budget, the nearest first', () => {
    const { inst } = setup(120)
    const s = frame(inst, 120, 0, 5)
    expect(s.closeupFaces).toBeLessThanOrEqual(400)
    inst.setLodOptions({ closeupFaceBudget: 3 })
    expect(frame(inst, 120, 0, 5).closeupFaces).toBe(3)
    expect(inst.renderedContainer(0)?.lod).toBe(0)
    inst.setLodOptions({ closeupFaceBudget: 0 })
    expect(frame(inst, 120, 0, 5).closeupFaces).toBe(0)
  })

  it('keeps a face out to the distance times the hysteresis, and does not take it back until inside the distance', () => {
    const { inst } = setup(1)
    expect(frame(inst, 1, 0, 30).closeupFaces).toBeGreaterThan(0) // the side is 30 m - 1.2 m away
    const edge = frame(inst, 1, 0, 40)
    expect(edge.closeupFaces).toBeGreaterThan(0) // stays out to 35 x 1.15
    expect(frame(inst, 1, 0, 50).closeupFaces).toBe(0)
    expect(frame(inst, 1, 0, 40).closeupFaces).toBe(0) // not back until inside 35 m
    expect(frame(inst, 1, 0, 33).closeupFaces).toBeGreaterThan(0)
  })

  it('paints a face once while it stays shown or cached, and again when the tint changes', () => {
    const { inst, painted, jobs } = setup(3)
    frame(inst, 3, 0, 10)
    const first = jobs.length
    expect(first).toBeGreaterThan(0)
    frame(inst, 3, 0, 10)
    frame(inst, 3, 0, 200) // all hidden, still cached
    frame(inst, 3, 0, 10)
    expect(jobs.length).toBe(first)
    expect(painted.length).toBeGreaterThan(0)
    inst.begin()
    for (let i = 0; i < 3; i++) inst.push(i, '40', i * 13, 1.3, 0, 0, 0, 0x4c9be8)
    inst.end(new THREE.Vector3(0, 1.3, 10))
    expect(jobs.length).toBeGreaterThan(first)
  })

  it('hides the faces a yard box shares with its neighbours', () => {
    const { inst } = setup(3)
    // three stacked yard boxes (length along Z), one tier-1 row next to another and a box on top of the first
    const push = (key: number, row: number, tier: number) => inst.push(key, '40', row * 2.9, 1.3 + (tier - 1) * 2.896, 0, 0, Math.PI / 2, -1, true)
    inst.begin()
    push(0, 0, 1)
    push(1, 1, 1)
    push(2, 0, 2)
    const cam = new THREE.Vector3(-8, 4, 0.5)
    const withNeighbours = inst.end(cam).closeupFaces
    inst.begin()
    push(0, 0, 1)
    const alone = inst.end(cam).closeupFaces
    expect(withNeighbours).toBeLessThan(3 * 3)
    expect(alone).toBeGreaterThan(0)
  })

  it('costs one draw call per atlas page, not per box', () => {
    const { inst, closeups } = setup(40)
    const s = frame(inst, 40, 100, 6)
    expect(s.closeup).toBeGreaterThan(1)
    expect(closeups.cost().drawCalls).toBeLessThanOrEqual(2)
    expect(closeups.cost().triangles).toBe(s.closeupFaces * 2)
  })
})

describe('colour by tint (#130)', () => {
  const tinted = (inst: ContainerInstancer, n: number, camDist: number, tint: number) => {
    inst.begin()
    for (let i = 0; i < n; i++) inst.push(i, '40', i * 13, 1.3, 0, 0, 0, tint)
    return inst.end(new THREE.Vector3(0, 1.3, camDist))
  }

  it('reports the tint drawn per box, at LOD1 and as a close-up, and -1 without one', () => {
    const { inst } = setup(3)
    tinted(inst, 3, 10, 0x4c9be8)
    expect(inst.renderedContainer(0)).toMatchObject({ tint: 0x4c9be8, lod: 0 })
    expect(inst.renderedContainer(2)).toMatchObject({ tint: 0x4c9be8 })
    frame(inst, 3, 0, 10)
    expect(inst.renderedContainer(0)?.tint).toBe(-1)
  })

  it('gives tinted boxes the generic livery tile and an instance colour, plain ones the white livery', () => {
    const { inst } = setup(60)
    tinted(inst, 60, 400, 0xe8a33c)
    const lod1 = inst.group.getObjectByName('containers-40-lod1') as THREE.InstancedMesh
    const livery = lod1.geometry.getAttribute('liveryIndex')
    expect(lod1.count).toBe(60)
    expect(livery.getX(0)).toBe(10) // genericIndex of the atlas
    expect(lod1.instanceColor).not.toBeNull()
    frame(inst, 60, 0, 400)
    expect(livery.getX(0)).toBe(0)
    const c = new THREE.Color()
    lod1.getColorAt(0, c)
    expect([c.r, c.g, c.b]).toEqual([1, 1, 1])
  })

  it('paints a close-up again when its tint changes, and not while it stays', () => {
    const { inst, painted } = setup(1)
    tinted(inst, 1, 10, 0x4c9be8)
    tinted(inst, 1, 10, 0x4c9be8)
    expect(painted).toEqual([0])
    tinted(inst, 1, 10, 0xe8a33c)
    expect(painted).toEqual([0, 0])
  })
})
