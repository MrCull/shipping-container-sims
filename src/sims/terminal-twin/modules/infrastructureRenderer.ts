/**
 * The phase 2 infrastructure in the scene (TT-28): gate modules, quay furniture, yard rails, fences, masts and
 * ground markings, and the buildings. Everything repeated is instanced: one InstancedMesh per geometry key, all on
 * one shared material, so the whole infrastructure costs about 20 draw calls however long the quay is or however
 * many lanes the gate has. The phase 1 procedural versions stay as placeholders (owned by their renderers) until
 * `setAssets` is called. Static: nothing here changes after the scene is built.
 */
import * as THREE from 'three'
import { INFRA_ASSET_NAMES, type InfraAssetName, type InfraAssets, type InfraKey } from './infrastructureAssets'
import { FAR_TIER, FarTierSelector, standInGeometry } from './farTier'
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
const POS = new THREE.Vector3()
const SCALE = new THREE.Vector3()
const Q = new THREE.Quaternion()
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const FLAT = new Set<InfraKey>(['yard-markings:wtp_pad', 'yard-markings:transfer_stall', 'quay-edge', 'quay-rail', 'yard-asc-rail'])

/** The asset files a layout needs (so a scenario without a gate loads no gate models). */
export function assetNamesFor(placements: InfraPlacement[]): InfraAssetName[] {
  const need = new Set<string>(placements.map((p) => p.key.split(':')[0]))
  return INFRA_ASSET_NAMES.filter((n) => need.has(n) && !n.startsWith('backdrop-'))
}

/** The far tier of one key: a stand-in mesh drawing the instances `selector` marks far; the near mesh draws the rest. */
interface TieredKey {
  near: THREE.InstancedMesh
  far: THREE.InstancedMesh
  selector: FarTierSelector
  list: InfraPlacement[]
  standIn: THREE.BufferGeometry
}

export class InfrastructureScene {
  readonly group = new THREE.Group()
  readonly placements: InfraPlacement[]
  private meshes: THREE.InstancedMesh[] = []
  private tiered: TieredKey[] = []
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
      const spec = FAR_TIER.find((f) => f.key === key)
      if (spec) {
        const standIn = standInGeometry(geometry)
        const far = new THREE.InstancedMesh(standIn, assets.material, list.length)
        far.name = `infra-far:${key}`
        far.frustumCulled = false
        far.castShadow = mesh.castShadow
        far.receiveShadow = mesh.receiveShadow
        far.count = 0
        far.visible = false
        this.group.add(far)
        this.meshes.push(far)
        this.tiered.push({ near: mesh, far, selector: new FarTierSelector(list.map((p) => [p.x, p.z]), spec.farM, spec.hysteresisM), list, standIn })
      }
    }
  }

  /** Per frame: moves instances between the full-detail mesh and the stand-in mesh by distance to the camera. */
  update(cameraPosition: THREE.Vector3): void {
    for (const t of this.tiered) {
      if (!t.selector.update(cameraPosition.x, cameraPosition.y, cameraPosition.z)) continue
      let nearN = 0
      let farN = 0
      const m = new THREE.Matrix4()
      for (let i = 0; i < t.list.length; i++) {
        const isFar = t.selector.far[i] === 1
        const src = isFar ? t.far : t.near
        const slot = isFar ? farN++ : nearN++
        // the near mesh's matrix for instance i is rebuilt from the placement (matrices are not read back)
        const p = t.list[i]
        m.compose(POS.set(p.x, p.y, p.z), Q.setFromAxisAngle(Y_AXIS, p.yaw), SCALE.set(p.scaleX, 1, 1))
        src.setMatrixAt(slot, m)
      }
      t.near.count = nearN
      t.far.count = farN
      t.near.visible = nearN > 0
      t.far.visible = farN > 0
      t.near.instanceMatrix.needsUpdate = true
      t.far.instanceMatrix.needsUpdate = true
    }
  }

  get isLoaded(): boolean {
    return this.loaded
  }

  stats(): InfrastructureStats {
    let triangles = 0
    let drawCalls = 0
    for (const mesh of this.meshes) {
      if (!mesh.visible || mesh.count === 0) continue
      drawCalls++
      const g = mesh.geometry
      triangles += ((g.index ? g.index.count : g.getAttribute('position').count) / 3) * mesh.count
    }
    return { assets: this.loaded ? 'loaded' : 'placeholder', instances: countByKey(this.placements), drawCalls, triangles }
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose() // geometries and the material are shared, owned by the loader
    for (const t of this.tiered) t.standIn.dispose()
    this.tiered = []
    this.meshes = []
    this.group.clear()
  }
}
