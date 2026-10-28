/**
 * Dev-only asset viewer scene: one GLB at a time with LOD switching, rig
 * controls from its `.meta.json` sidecar, livery selection and a procedural
 * 20 ft reference container for scale; or an instanced "yard" stress test
 * using the same ContainerInstancer as the twin.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { ContainerSize } from '../scenario/types'
import { LIVERY_ATLAS, liveryMaterial, loadContainerAssets, loadGltf } from '../modules/containerAssets'
import { ContainerInstancer, DEFAULT_LOD_OPTIONS } from '../modules/containerInstancer'
import { CONTAINER_DIMS } from '../modules/sceneModel'
import { AssetRig, type RigMeta } from '../modules/assetRig'
import type { AssetPose, AssetViewStats, RigControl, Vec3Tuple, ViewerLod, YardStats } from './assetViewerApi'

const glbUrls = import.meta.glob('../assets/models/**/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>
const sidecars = import.meta.glob('../assets/models/**/*.meta.json', { import: 'default', eager: true }) as Record<string, Sidecar>

interface Sidecar extends RigMeta {
  asset: string
  kind: string
  dimensions: { lengthM: number; widthM: number; heightM: number }
  travelLimits: NonNullable<RigMeta['travelLimits']>
  /** SHC only: clear tunnel size. */
  tunnel?: { clearWidthM: number; clearHeightM: number }
  attachPoints?: { name: string; node?: string; position: number[] }[]
  lods?: Record<string, { maxDistanceM?: number }>
}

export interface AssetEntry {
  name: string
  url: string
  meta: Sidecar
}

export const ASSETS: AssetEntry[] = Object.entries(glbUrls)
  .map(([path, url]) => {
    const name = path.split('/').pop()!.replace(/\.glb$/, '')
    return { name, url, meta: sidecars[path.replace(/\.glb$/, '.meta.json')] }
  })
  .filter((a) => !!a.meta)
  .sort((a, b) => a.name.localeCompare(b.name))

const tuple = (v: THREE.Vector3): Vec3Tuple => [v.x, v.y, v.z]

function meshCost(root: THREE.Object3D, onlyVisible: boolean): { triangles: number; drawCalls: number } {
  let triangles = 0
  let drawCalls = 0
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    if (onlyVisible) {
      for (let p: THREE.Object3D | null = mesh; p; p = p.parent) if (!p.visible) return
    }
    const g = mesh.geometry
    triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3
    drawCalls++
  })
  return { triangles, drawCalls }
}

export class AssetViewerScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000)
  readonly controls: OrbitControls
  private frame = 0
  private asset: { entry: AssetEntry; root: THREE.Object3D; lods: Record<string, THREE.Object3D>; rig: AssetRig } | null = null
  private lod: ViewerLod = 'LOD0'
  private shownLod = 'LOD0'
  private livery = 0
  private reference: THREE.Object3D
  private referenceSize: ContainerSize = '20'
  /** A 40 ft ISO box for assets with a `container` attach point (cranes): hangs from that node, top centre at the point. */
  private hanging: THREE.Object3D
  private hangingFrom: string | null = null
  private yardInstancer: ContainerInstancer | null = null
  private loadToken = 0
  private materials = new Set<THREE.Material & { userData: { liveryBase?: { value: number } } }>()

  constructor(host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    host.appendChild(this.renderer.domElement)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.scene.background = new THREE.Color('#a9bfd3')
    this.scene.add(new THREE.HemisphereLight('#dfe9f5', '#5a5248', 1.4))
    const sun = new THREE.DirectionalLight('#fff4e0', 2.2)
    sun.position.set(-40, 80, 50)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.normalBias = 0.06
    sun.shadow.bias = -0.0003
    Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 300 })
    this.scene.add(sun)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: '#9a9c9a', roughness: 0.95 }))
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    this.scene.add(ground)
    const grid = new THREE.GridHelper(200, 200, '#6b7280', '#8b9096')
    grid.position.y = 0.01
    this.scene.add(grid)
    // Reference: a plain ISO box outline for scale (20 ft beside most assets; 40 ft HC inside an SHC).
    this.reference = new THREE.Group()
    this.setReferenceSize('20')
    this.scene.add(this.reference)
    const d40 = CONTAINER_DIMS['40']
    const box40 = new THREE.BoxGeometry(d40.length, d40.height, d40.width).translate(0, -d40.height / 2, 0)
    this.hanging = new THREE.Group()
    this.hanging.add(
      new THREE.Mesh(box40, new THREE.MeshStandardMaterial({ color: '#2f5fae', transparent: true, opacity: 0.55 })),
      new THREE.LineSegments(new THREE.EdgesGeometry(box40), new THREE.LineBasicMaterial({ color: '#111827' })),
    )
    this.hanging.name = 'reference-40ft-hanging'
    this.hanging.userData.size = [d40.length, d40.height, d40.width]
    this.resize(host)
    const loop = () => {
      this.frame = requestAnimationFrame(loop)
      this.updateAutoLod()
      this.controls.update()
      this.renderer.render(this.scene, this.camera)
    }
    this.frame = requestAnimationFrame(loop)
  }

  private setReferenceSize(size: ContainerSize): void {
    this.referenceSize = size
    const d = CONTAINER_DIMS[size]
    for (const child of [...this.reference.children]) {
      this.reference.remove(child)
      ;(child as THREE.Mesh).geometry?.dispose()
    }
    const box = new THREE.BoxGeometry(d.length, d.height, d.width).translate(0, d.height / 2, 0)
    this.reference.add(
      new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: '#9ca3af', transparent: true, opacity: 0.35 })),
      new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: '#111827' })),
    )
    this.reference.name = `reference-${size.toLowerCase()}`
  }

  /** SHC: the reference box hangs from the spreader, so it follows the hoist slider (its top is the twist-lock plane). */
  private placeCarriedReference(): void {
    const asset = this.asset
    if (!asset || asset.entry.meta.kind !== 'shc') return
    const attach = asset.entry.meta.attachPoints?.find((a) => a.name === 'container_attach')
    const hoist = asset.rig.values.hoist ?? 0
    const top = (attach?.position[1] ?? 0) + hoist
    this.reference.position.set(0, top - CONTAINER_DIMS[this.referenceSize].height, 0)
  }

  resize(host: HTMLElement): void {
    const w = Math.max(1, host.clientWidth)
    const h = Math.max(1, host.clientHeight)
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  async show(name: string, options: { lod?: ViewerLod; livery?: number } = {}): Promise<AssetViewStats> {
    const entry = ASSETS.find((a) => a.name === name)
    if (!entry) throw new Error(`unknown asset ${name}; known: ${ASSETS.map((a) => a.name).join(', ')}`)
    const token = ++this.loadToken
    const gltf = await loadGltf(entry.url)
    if (token !== this.loadToken) throw new Error(`show(${name}) superseded by a later show/yard call`)
    this.clearYard()
    if (this.asset) this.scene.remove(this.asset.root)
    const root = gltf.scene
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
      const mat = mesh.material as THREE.MeshStandardMaterial
      if (entry.meta.kind === 'container' && mat.map) {
        const patched = liveryMaterial(mat)
        mesh.material = patched
        this.materials.add(patched)
      }
    })
    const lods: Record<string, THREE.Object3D> = {}
    for (const n of ['LOD0', 'LOD1', 'LOD2']) {
      const node = root.getObjectByName(n)
      if (node) lods[n] = node
    }
    const rig = new AssetRig(root, entry.meta)
    this.asset = { entry, root, lods, rig }
    this.scene.add(root)
    const { lengthM, widthM, heightM } = entry.meta.dimensions
    this.hanging.removeFromParent()
    this.hangingFrom = entry.meta.attachPoints?.find((a) => a.name === 'container' && a.node)?.node ?? null
    this.reference.visible = !this.hangingFrom
    if (entry.meta.kind === 'shc') {
      this.setReferenceSize('40HC')
      this.placeCarriedReference()
    } else {
      this.setReferenceSize('20')
      this.reference.position.set(0, 0, widthM / 2 + CONTAINER_DIMS['20'].width / 2 + 1.5)
    }
    const span = Math.max(lengthM, heightM, 8)
    this.controls.target.set(0, heightM / 2, entry.meta.kind === 'shc' ? 0 : 1.5)
    this.camera.position.set(span * 0.9, span * 0.55, -span * 1.1)
    if (this.hangingFrom) {
      // Cranes: frame the whole structure (boom to backreach).
      this.controls.target.set(0, heightM * 0.45, 0)
      this.camera.position.set(widthM * 0.75, heightM * 0.7, -widthM * 0.55)
    }
    this.controls.update()
    this.setLod(options.lod ?? 'LOD0')
    this.setLivery(options.livery ?? 0)
    return this.stats()!
  }

  private applyLod(level: string): void {
    if (!this.asset) return
    this.shownLod = level in this.asset.lods ? level : Object.keys(this.asset.lods)[0]
    for (const [n, node] of Object.entries(this.asset.lods)) node.visible = n === this.shownLod
    this.attachHanging()
  }

  /** Hangs the 40 ft reference box from the shown LOD's attach node. */
  private attachHanging(): void {
    if (!this.asset || !this.hangingFrom) return
    const suffix = this.asset.entry.meta.lodNaming?.[this.shownLod] ?? ''
    const node = this.asset.root.getObjectByName(this.hangingFrom + suffix)
    const point = this.asset.entry.meta.attachPoints!.find((a) => a.name === 'container')!.position
    if (!node) return
    node.add(this.hanging)
    this.hanging.position.set(point[0], point[1], point[2])
  }

  private updateAutoLod(): void {
    if (this.lod !== 'auto' || !this.asset) return
    const d = this.camera.position.distanceTo(this.controls.target)
    const lods = this.asset.entry.meta.lods ?? {}
    const lod0 = lods.LOD0?.maxDistanceM ?? DEFAULT_LOD_OPTIONS.lod0DistanceM
    const lod1 = lods.LOD1?.maxDistanceM ?? Infinity
    this.applyLod(d <= lod0 ? 'LOD0' : d <= lod1 || !('LOD2' in this.asset.lods) ? 'LOD1' : 'LOD2')
  }

  setLod(lod: ViewerLod): AssetViewStats {
    this.lod = lod
    if (lod === 'auto') this.updateAutoLod()
    else this.applyLod(lod)
    return this.stats()!
  }

  setLivery(index: number): AssetViewStats {
    this.livery = index
    for (const m of this.materials) if (m.userData.liveryBase) m.userData.liveryBase.value = index
    return this.stats()!
  }

  rigControls(): RigControl[] {
    if (!this.asset) return []
    return Object.entries(this.asset.entry.meta.travelLimits ?? {}).map(([node, l]) => ({
      node,
      type: l.type,
      axis: l.axis,
      min: l.type === 'rotation' ? (l.minDeg ?? 0) : (l.minM ?? 0),
      max: l.type === 'rotation' ? (l.maxDeg ?? 0) : (l.maxM ?? 0),
      unit: l.type === 'rotation' ? 'deg' : 'm',
    }))
  }

  /** Moves a rig node (in every LOD), clamped to its sidecar travel limits, and re-stretches ropes. */
  setRig(node: string, value: number): AssetViewStats {
    const rig = this.asset?.rig
    if (!rig || !rig.nodes.includes(node)) throw new Error(`no rig control ${node}`)
    rig.set(node, value)
    rig.applyStretch()
    if (node === 'hoist') this.placeCarriedReference()
    return this.stats()!
  }

  pose(): AssetPose | null {
    if (!this.asset) return null
    const { root, rig, entry } = this.asset
    root.updateMatrixWorld(true)
    const suffix = entry.meta.lodNaming?.[this.shownLod] ?? ''
    const nodes: Record<string, Vec3Tuple> = {}
    for (const n of rig.nodes) {
      const o = root.getObjectByName(n + suffix)
      if (o) nodes[n] = tuple(o.getWorldPosition(new THREE.Vector3()))
    }
    const stretch: Record<string, number> = {}
    for (const s of entry.meta.stretch ?? []) {
      const o = root.getObjectByName(s.node + suffix)
      if (o) stretch[s.node] = o.scale.y * s.unitLengthM
    }
    const hanging = !!this.hangingFrom && !!this.hanging.parent
    const ref = hanging ? this.hanging : this.reference
    const size = (hanging ? this.hanging.userData.size : [CONTAINER_DIMS['20'].length, CONTAINER_DIMS['20'].height, CONTAINER_DIMS['20'].width]) as Vec3Tuple
    const top = ref.getWorldPosition(new THREE.Vector3())
    if (!hanging) top.y += size[1]
    const box = new THREE.Box3().setFromObject(this.asset.lods[this.shownLod] ?? root)
    return {
      shownLod: this.shownLod,
      nodes,
      stretch,
      reference: { hangingFrom: hanging ? this.hangingFrom : null, size, topCentre: tuple(top) },
      topY: box.max.y,
    }
  }

  stats(): AssetViewStats | null {
    if (!this.asset) return null
    const shown = meshCost(this.asset.root, true)
    return {
      asset: this.asset.entry.name,
      kind: this.asset.entry.meta.kind,
      lod: this.lod,
      shownLod: this.shownLod,
      triangles: shown.triangles,
      drawCalls: shown.drawCalls,
      lods: Object.fromEntries(Object.entries(this.asset.lods).map(([n, node]) => [n, meshCost(node, false)])),
      rig: this.rigControls(),
      rigValues: { ...this.asset.rig.values },
      livery: this.livery,
      referenceContainer: this.reference.visible || !!this.hanging.parent,
      reference: this.referenceFit(),
    }
  }

  /** SHC viewer: the reference box against the sidecar's tunnel (clear width and height). */
  private referenceFit(): AssetViewStats['reference'] {
    const tunnel = this.asset?.entry.meta.tunnel
    if (!this.reference.visible || !tunnel) return null
    const d = CONTAINER_DIMS[this.referenceSize]
    const topM = this.reference.position.y + d.height
    return {
      size: this.referenceSize,
      lengthM: d.length,
      widthM: d.width,
      heightM: d.height,
      topM,
      clearWidthM: tunnel.clearWidthM,
      clearHeightM: tunnel.clearHeightM,
      fitsTunnel: d.width < tunnel.clearWidthM && topM < tunnel.clearHeightM && this.reference.position.y >= 0,
    }
  }

  private clearYard(): void {
    if (!this.yardInstancer) return
    this.scene.remove(this.yardInstancer.group)
    this.yardInstancer.dispose()
    this.yardInstancer = null
  }

  /** Fills TTI-like blocks (8 rows × 5 tiers) with `count` boxes and measures a few frames. */
  async yard(count = 18000): Promise<YardStats> {
    this.loadToken++
    if (this.asset) this.scene.remove(this.asset.root)
    this.asset = null
    this.reference.visible = false
    this.hanging.removeFromParent()
    this.clearYard()
    const assets = await loadContainerAssets()
    const sizes: ContainerSize[] = ['40', '40', '40HC', '20']
    const boxes: { size: ContainerSize; x: number; y: number; z: number; livery: number }[] = []
    const rows = 8
    const tiers = 5
    const bays = 40
    const perBlock = rows * tiers * bays
    const blocks = Math.ceil(count / perBlock)
    for (let i = 0; i < count; i++) {
      const block = Math.floor(i / perBlock)
      const k = i % perBlock
      const bay = Math.floor(k / (rows * tiers))
      const row = Math.floor((k % (rows * tiers)) / tiers)
      const tier = k % tiers
      const size = sizes[(bay * 7 + block) % sizes.length]
      const d = CONTAINER_DIMS[size]
      // Blocks run along X (bays of 12.8 m), side by side in Z (25.4 m span + 9 m gap).
      boxes.push({
        size,
        x: bay * 12.8 - (bays * 12.8) / 2,
        y: tier * 2.9 + d.height / 2,
        z: (block - blocks / 2) * 34.4 + row * 2.75,
        livery: (i * 7 + block * 3) % (LIVERY_ATLAS.liveries.length - 1),
      })
    }
    const capacity: Partial<Record<ContainerSize, number>> = {}
    for (const b of boxes) capacity[b.size] = (capacity[b.size] ?? 0) + 1
    const inst = new ContainerInstancer(capacity)
    inst.setAssets(assets)
    this.yardInstancer = inst
    this.scene.add(inst.group)
    this.controls.target.set(0, 5, 0)
    this.camera.position.set(-260, 120, -(blocks * 34.4) / 2 - 60)
    this.controls.update()
    const draw = () => {
      inst.begin()
      boxes.forEach((b, i) => inst.push(i, b.size, b.x, b.y, b.z, b.livery))
      return inst.end(this.camera.position)
    }
    let s = draw()
    this.renderer.render(this.scene, this.camera)
    const info = { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles }
    const t0 = performance.now()
    let frames = 0
    await new Promise<void>((resolve) => {
      const tick = () => {
        s = draw()
        frames++
        if (performance.now() - t0 < 1500) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
    const fps = (frames * 1000) / (performance.now() - t0)
    const cost = inst.cost()
    return {
      instances: s.drawn,
      lod0: s.lod0,
      lod1: s.lod1,
      lod0Cap: DEFAULT_LOD_OPTIONS.lod0Cap,
      containerDrawCalls: cost.drawCalls,
      containerTriangles: cost.triangles,
      drawCalls: info.calls,
      triangles: info.triangles,
      fps: Math.round(fps * 10) / 10,
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.frame)
    this.clearYard()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
