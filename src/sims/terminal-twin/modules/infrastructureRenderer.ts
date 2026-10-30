/**
 * The phase 2 infrastructure in the scene (TT-28): gate modules, quay furniture, yard rails, fences, masts and
 * ground markings, and the buildings. Everything repeated is instanced: one InstancedMesh per geometry key, all on
 * one shared material, so the whole infrastructure costs about 20 draw calls however long the quay is or however
 * many lanes the gate has. The phase 1 procedural versions stay as placeholders (owned by their renderers) until
 * `setAssets` is called. Static: nothing here changes after the scene is built.
 */
import * as THREE from 'three'
import { INFRA_ASSET_NAMES, type InfraAssetName, type InfraAssets, type InfraKey } from './infrastructureAssets'
import { countByKey, infrastructurePlacements, type InfraLayoutInput, type InfraPlacement } from './infrastructureLayout'

export interface InfrastructureStats {
  /** 'placeholder' until the infrastructure GLBs have loaded. */
  assets: 'placeholder' | 'loaded'
  /** Instances per geometry key (known from the layout, also before loading). */
  instances: Partial<Record<InfraKey, number>>
  /** Draw calls of the infrastructure layer (one per instanced mesh; zero until loaded). */
  drawCalls: number
  /** Triangles drawn per frame, instances included. */
  triangles: number
}

/** Keys that are flat ground paint: no shadows cast. */
const FLAT = new Set<InfraKey>(['yard-markings:wtp_pad', 'yard-markings:transfer_stall', 'quay-edge', 'quay-rail', 'yard-asc-rail'])

/** The asset files a layout needs (so a scenario without a gate loads no gate models). */
export function assetNamesFor(placements: InfraPlacement[]): InfraAssetName[] {
  const need = new Set<string>(placements.map((p) => p.key.split(':')[0]))
  return INFRA_ASSET_NAMES.filter((n) => need.has(n) && !n.startsWith('backdrop-'))
}

export class InfrastructureScene {
  readonly group = new THREE.Group()
  readonly placements: InfraPlacement[]
  private meshes: THREE.InstancedMesh[] = []
  private loaded = false

  constructor(input: InfraLayoutInput) {
    this.group.name = 'infrastructure'
    this.placements = infrastructurePlacements(input)
  }

  /** The asset files this scene needs. */
  assetNames(): InfraAssetName[] {
    return assetNamesFor(this.placements)
  }

  /** Builds the instanced meshes from the loaded (shared) geometries. Safe to call once. */
  setAssets(assets: InfraAssets): void {
    if (this.loaded) return
    this.loaded = true
    const byKey = new Map<InfraKey, InfraPlacement[]>()
    for (const p of this.placements) {
      const list = byKey.get(p.key)
      if (list) list.push(p)
      else byKey.set(p.key, [p])
    }
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const yAxis = new THREE.Vector3(0, 1, 0)
    for (const [key, list] of byKey) {
      const geometry = assets.geometries[key]
      if (!geometry) continue
      const mesh = new THREE.InstancedMesh(geometry, assets.material, list.length)
      mesh.name = `infra:${key}`
      list.forEach((p, i) => {
        q.setFromAxisAngle(yAxis, p.yaw)
        m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.scaleX, 1, 1))
        mesh.setMatrixAt(i, m)
      })
      mesh.instanceMatrix.needsUpdate = true
      mesh.frustumCulled = false // instances span the whole quay
      mesh.castShadow = !FLAT.has(key)
      mesh.receiveShadow = !FLAT.has(key)
      this.group.add(mesh)
      this.meshes.push(mesh)
    }
  }

  get isLoaded(): boolean {
    return this.loaded
  }

  stats(): InfrastructureStats {
    let triangles = 0
    for (const mesh of this.meshes) {
      const g = mesh.geometry
      triangles += ((g.index ? g.index.count : g.getAttribute('position').count) / 3) * mesh.count
    }
    return { assets: this.loaded ? 'loaded' : 'placeholder', instances: countByKey(this.placements), drawCalls: this.meshes.length, triangles }
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose() // geometries and the material are shared, owned by the loader
    this.meshes = []
    this.group.clear()
  }
}
