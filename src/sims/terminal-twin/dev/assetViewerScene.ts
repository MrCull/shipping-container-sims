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
import type { AssetViewStats, RigControl, ViewerLod, YardStats } from './assetViewerApi'

const glbUrls = import.meta.glob('../assets/models/**/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>
const sidecars = import.meta.glob('../assets/models/**/*.meta.json', { import: 'default', eager: true }) as Record<string, Sidecar>

interface Sidecar {
  asset: string
  kind: string
  dimensions: { lengthM: number; widthM: number; heightM: number }
  travelLimits: Record<string, { type: 'rotation' | 'translation'; axis: string; minDeg?: number; maxDeg?: number; minM?: number; maxM?: number }>
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

function axisVector(axis: string): THREE.Vector3 {
  const v = new THREE.Vector3()
  const sign = axis.startsWith('-') ? -1 : 1
  const c = axis.replace(/^[+-]/, '').toLowerCase() as 'x' | 'y' | 'z'
  v[c] = sign
  return v
}

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
  private asset: { entry: AssetEntry; root: THREE.Object3D; lods: Record<string, THREE.Object3D>; rest: Map<string, THREE.Object3D> } | null = null
  private lod: ViewerLod = 'LOD0'
  private shownLod = 'LOD0'
  private livery = 0
  private rigValues: Record<string, number> = {}
  private reference: THREE.Object3D
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
    // Reference: a plain 20 ft ISO box outline, for scale.
    const d = CONTAINER_DIMS['20']
    const box = new THREE.BoxGeometry(d.length, d.height, d.width).translate(0, d.height / 2, 0)
    this.reference = new THREE.Group()
    this.reference.add(
      new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: '#9ca3af', transparent: true, opacity: 0.35 })),
      new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: '#111827' })),
    )
    this.reference.name = 'reference-20ft'
    this.scene.add(this.reference)
    this.resize(host)
    const loop = () => {
      this.frame = requestAnimationFrame(loop)
      this.updateAutoLod()
      this.controls.update()
      this.renderer.render(this.scene, this.camera)
    }
    this.frame = requestAnimationFrame(loop)
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
    const rest = new Map<string, THREE.Object3D>()
    for (const node of Object.keys(entry.meta.travelLimits ?? {})) {
      const o = root.getObjectByName(node)
      if (o) rest.set(node, o.clone(false))
    }
    this.asset = { entry, root, lods, rest }
    this.rigValues = Object.fromEntries([...rest.keys()].map((n) => [n, 0]))
    this.scene.add(root)
    const { lengthM, widthM, heightM } = entry.meta.dimensions
    this.reference.position.set(0, 0, widthM / 2 + CONTAINER_DIMS['20'].width / 2 + 1.5)
    this.reference.visible = true
    const span = Math.max(lengthM, heightM, 8)
    this.controls.target.set(0, heightM / 2, 1.5)
    this.camera.position.set(span * 0.9, span * 0.55, -span * 1.1)
    this.controls.update()
    this.setLod(options.lod ?? 'LOD0')
    this.setLivery(options.livery ?? 0)
    return this.stats()!
  }

  private applyLod(level: string): void {
    if (!this.asset) return
    this.shownLod = level in this.asset.lods ? level : Object.keys(this.asset.lods)[0]
    for (const [n, node] of Object.entries(this.asset.lods)) node.visible = n === this.shownLod
  }

  private updateAutoLod(): void {
    if (this.lod !== 'auto' || !this.asset) return
    const d = this.camera.position.distanceTo(this.controls.target)
    this.applyLod(d <= DEFAULT_LOD_OPTIONS.lod0DistanceM ? 'LOD0' : 'LOD1')
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

  setRig(node: string, value: number): AssetViewStats {
    const ctl = this.rigControls().find((c) => c.node === node)
    const o = this.asset?.root.getObjectByName(node)
    const rest = this.asset?.rest.get(node)
    if (!ctl || !o || !rest) throw new Error(`no rig control ${node}`)
    const v = Math.min(ctl.max, Math.max(ctl.min, value))
    const axis = axisVector(ctl.axis)
    if (ctl.type === 'rotation') {
      o.quaternion.copy(rest.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(v)))
    } else {
      o.position.copy(rest.position).addScaledVector(axis, v)
    }
    this.rigValues[node] = v
    return this.stats()!
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
      rigValues: { ...this.rigValues },
      livery: this.livery,
      referenceContainer: this.reference.visible,
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
