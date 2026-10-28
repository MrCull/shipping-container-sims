/**
 * Distant backdrop (TT-21): a handful of flat-shaded low-poly meshes, no textures.
 * The TTI preset gets Algeciras (the Rock of Gibraltar across the bay, the
 * Algeciras hills, the 550 m North Quay rendered non-operational); every other
 * preset gets a generic coastline. Scene axes: quay along +x, water towards -z.
 */
import * as THREE from 'three'
import { TTI_PRESET_NAME } from '../scenario/presets'

export type BackdropKind = 'tti' | 'generic'

/** The backdrop for a scenario name: Algeciras for the TTI preset only. */
export function backdropKindFor(scenarioName: string): BackdropKind {
  return scenarioName === TTI_PRESET_NAME ? 'tti' : 'generic'
}

/** Named parts of each backdrop (dev API / tests). */
export const BACKDROP_PARTS: Record<BackdropKind, string[]> = {
  tti: ['land', 'coast', 'rock', 'hills', 'northQuay'],
  generic: ['land', 'coast', 'headland'],
}

/** Length of TTI's North Quay (m): [V] from the reference pack; shown idle. */
export const NORTH_QUAY_LENGTH_M = 550

export interface Backdrop {
  kind: BackdropKind
  group: THREE.Group
  parts: string[]
  dispose(): void
}

/** Tiny deterministic generator: the backdrop looks the same every run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** A silhouette (x along the ridge, height y) extruded `depth` metres along z, centred on z. */
function ridge(points: [number, number][], depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(points[0][0], 0)
  for (const [x, y] of points) shape.lineTo(x, y)
  shape.lineTo(points[points.length - 1][0], 0)
  shape.closePath()
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false })
  g.translate(0, 0, -depth / 2)
  return g
}

/** A jagged ridge of the given length with heights between `lo` and `hi`. */
function jaggedRidge(length: number, step: number, lo: number, hi: number, seed: number): [number, number][] {
  const rnd = lcg(seed)
  const pts: [number, number][] = []
  let h = (lo + hi) / 2
  for (let x = -length / 2; x <= length / 2; x += step) {
    h = Math.min(hi, Math.max(lo, h + (rnd() - 0.5) * (hi - lo) * 0.7))
    pts.push([x, h])
  }
  return pts
}

export function buildBackdrop(kind: BackdropKind, quayLengthM: number): Backdrop {
  const group = new THREE.Group()
  group.name = `backdrop-${kind}`
  const disposables: { dispose(): void }[] = []
  const flat = (color: string) => {
    const m = new THREE.MeshLambertMaterial({ color, flatShading: true })
    disposables.push(m)
    return m
  }
  const add = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    disposables.push(geometry)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    mesh.position.set(x, y, z)
    mesh.castShadow = false
    mesh.receiveShadow = false
    group.add(mesh)
    return mesh
  }
  const midX = quayLengthM / 2

  // Hinterland behind the terminal, so the yard does not float in the void.
  const land = new THREE.PlaneGeometry(40000, 12000)
  land.rotateX(-Math.PI / 2)
  add('land', land, flat(kind === 'tti' ? '#7b8068' : '#80866f'), midX, -1.2, 900 + 6000)

  if (kind === 'tti') {
    // The Rock of Gibraltar: ~1.4 km long, 426 m high at its northern end, steep east face, low to the south.
    const rock = add(
      'rock',
      ridge(
        [[-700, 0], [-680, 30], [-560, 120], [-380, 230], [-180, 330], [20, 390], [160, 426], [300, 410], [420, 330], [520, 160], [600, 50], [720, 0]],
        520,
      ),
      flat('#8f9288'),
      midX + 3400,
      0,
      -6200,
    )
    rock.scale.y = 1.25
    // The low isthmus and Spanish coast running away from the Rock.
    add('coast', ridge(jaggedRidge(6000, 300, 6, 26, 11), 500), flat('#8a8f77'), midX + 7200, -0.5, -6200)
    // The Algeciras hills behind the terminal.
    add('hills', ridge(jaggedRidge(9000, 450, 150, 480, 7), 900), flat('#6a7358'), midX - 800, -1, 4300)
    // North Quay: 550 m of bare quay beside the working berths, no cranes, no lights.
    const north = new THREE.Group()
    north.name = 'northQuay'
    const x0 = quayLengthM + 70 + NORTH_QUAY_LENGTH_M / 2
    const slabGeo = new THREE.BoxGeometry(NORTH_QUAY_LENGTH_M, 0.3, 70)
    const slab = new THREE.Mesh(slabGeo, flat('#838a93'))
    slab.position.set(x0, 0.06, 38)
    slab.receiveShadow = true
    const edgeGeo = new THREE.BoxGeometry(NORTH_QUAY_LENGTH_M, 0.32, 1)
    const edge = new THREE.Mesh(edgeGeo, flat('#6f6a55'))
    edge.position.set(x0, 0.08, 2)
    const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.5, 1.1, 6), flat('#4a4d52'), 12)
    const m = new THREE.Matrix4()
    for (let i = 0; i < 12; i++) {
      m.makeTranslation(x0 - NORTH_QUAY_LENGTH_M / 2 + 25 + i * 45, 0.7, 4)
      posts.setMatrixAt(i, m)
    }
    disposables.push(slabGeo, edgeGeo, posts.geometry)
    north.add(slab, edge, posts)
    group.add(north)
  } else {
    add('coast', ridge(jaggedRidge(14000, 400, 10, 60, 3), 600), flat('#7f8a74'), midX, -0.5, -4200)
    add('headland', ridge([[-900, 0], [-600, 40], [-250, 95], [150, 120], [500, 70], [900, 0]], 500), flat('#76826a'), midX + 2600, -0.5, -3300)
  }
  return {
    kind,
    group,
    parts: BACKDROP_PARTS[kind],
    dispose: () => {
      for (const d of disposables) d.dispose()
    },
  }
}
