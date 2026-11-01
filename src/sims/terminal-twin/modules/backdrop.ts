/**
 * Distant backdrop (TT-21): a handful of flat-shaded low-poly meshes, no textures. The generic backdrop is a coastline;
 * a scenario that belongs to a terminal (`terminals/`) gets that terminal's scenery instead (TTI Algeciras: the Rock of
 * Gibraltar, the hills, the North Quay). This module never names a terminal or a preset. Scene axes: quay along +x,
 * water towards -z.
 */
import * as THREE from 'three'
import { terminalForScenario } from '../terminals'
import type { SceneryContext, TerminalScenery } from '../terminals/types'
import { jaggedRidge, ridge } from './backdropGeometry'
import { clipMeshToHalfSpace } from './meshClip'
import type { InfraAssetName, InfraAssets } from './infrastructureAssets'

/** `generic`, or the kind of a terminal's scenery (`tti`). */
export type BackdropKind = string

/** Camera-far-safe fog far distance of the generic backdrop (m). */
export const GENERIC_FOG_FAR_M = 9000

/** The coastline every scenario without terminal scenery gets. */
export const GENERIC_SCENERY: TerminalScenery = {
  kind: 'generic',
  parts: ['land', 'coast', 'headland'],
  modelParts: {},
  fogFarM: GENERIC_FOG_FAR_M,
  build(ctx) {
    const midX = ctx.quayLengthM / 2
    ctx.add('coast', ridge(jaggedRidge(14000, 400, 10, 60, 3), 600), ctx.flat('#7f8a74'), midX, -0.5, -4200)
    ctx.add('headland', ridge([[-900, 0], [-600, 40], [-250, 95], [150, 120], [500, 70], [900, 0]], 500), ctx.flat('#76826a'), midX + 2600, -0.5, -3300)
  },
}

/** The scenery for a scenario name: its terminal's, else the generic coastline. */
export function sceneryFor(scenarioName: string): TerminalScenery {
  return terminalForScenario(scenarioName)?.scenery ?? GENERIC_SCENERY
}

/**
 * TT-28: the phase 2 backdrop GLBs replace the procedural parts a terminal's scenery names (`modelParts`); the
 * generic backdrop keeps its procedural coastline.
 */
export function backdropModelAssets(scenery: TerminalScenery): InfraAssetName[] {
  return Object.values(scenery.modelParts).filter((a): a is InfraAssetName => a !== undefined)
}

/**
 * Ticket #172: the part of a baked geometry at `x >= minX` (in the geometry's own frame), as a new geometry with every
 * attribute kept. Triangles that cross the line are cut on it; the shared loader cache's geometry is not touched.
 */
function clipGeometryToX(geometry: THREE.BufferGeometry, minX: number): THREE.BufferGeometry {
  const names = Object.keys(geometry.attributes)
  const cut = clipMeshToHalfSpace(
    {
      index: geometry.index ? (geometry.index.array as ArrayLike<number>) : null,
      attributes: Object.fromEntries(names.map((n) => [n, { array: geometry.attributes[n].array as ArrayLike<number>, itemSize: geometry.attributes[n].itemSize }])),
    },
    0,
    minX,
  )
  const out = new THREE.BufferGeometry()
  for (const n of names) out.setAttribute(n, new THREE.BufferAttribute(cut[n], geometry.attributes[n].itemSize))
  out.computeBoundingBox()
  out.computeBoundingSphere()
  return out
}

export interface Backdrop {
  kind: BackdropKind
  group: THREE.Group
  parts: string[]
  /** 'procedural' until `useModels` swaps in the GLB meshes (terminal scenery with `modelParts` only). */
  models: 'procedural' | 'glb'
  /** Swaps the parts the scenery names for the phase 2 meshes (no-op without `modelParts`). */
  useModels(assets: InfraAssets): void
  dispose(): void
}

export function buildBackdrop(scenery: TerminalScenery, quayLengthM: number): Backdrop {
  const group = new THREE.Group()
  group.name = `backdrop-${scenery.kind}`
  const disposables: { dispose(): void }[] = []
  const flat = (color: string) => {
    const m = new THREE.MeshLambertMaterial({ color, flatShading: true })
    disposables.push(m)
    return m
  }
  const add: SceneryContext['add'] = (name, geometry, material, x, y, z) => {
    disposables.push(geometry)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    mesh.position.set(x, y, z)
    mesh.castShadow = false
    mesh.receiveShadow = false
    group.add(mesh)
    return mesh
  }

  // Hinterland behind the terminal, so the yard does not float in the void.
  const land = new THREE.PlaneGeometry(40000, 12000)
  land.rotateX(-Math.PI / 2)
  add('land', land, flat(scenery.kind === 'generic' ? '#80866f' : '#7b8068'), quayLengthM / 2, -1.2, 900 + 6000)

  scenery.build({ group, quayLengthM, flat, add, track: (thing) => disposables.push(thing) })
  const modelParts = Object.entries(scenery.modelParts) as [string, InfraAssetName][]
  const modelClipX = scenery.modelClipX ?? {}
  const backdrop: Backdrop = {
    kind: scenery.kind,
    group,
    parts: scenery.parts,
    models: 'procedural',
    useModels: (assets) => {
      if (modelParts.length === 0 || backdrop.models === 'glb') return
      for (const [part, asset] of modelParts) {
        const mesh = group.getObjectByName(part) as THREE.Mesh | undefined
        let geometry = assets.geometries[asset]
        if (!mesh || !geometry) continue
        const minX = modelClipX[part]
        if (minX !== undefined) {
          // the GLB's frame is the mesh's: its origin sits at `mesh.position`
          geometry = clipGeometryToX(geometry, minX - mesh.position.x)
          disposables.push(geometry)
        }
        mesh.geometry.dispose()
        mesh.geometry = geometry // shared with the loader's cache: not disposed here (a clipped copy is, with the backdrop)
        mesh.material = assets.material
      }
      backdrop.models = 'glb'
    },
    dispose: () => {
      for (const d of disposables) d.dispose()
    },
  }
  return backdrop
}
