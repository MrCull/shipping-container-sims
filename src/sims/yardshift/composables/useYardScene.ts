/**
 * Thin Three.js renderer for the Yardshift yard. A fixed orthographic camera, pitched down and turned a little to the
 * side, so containers show top and side faces. Every object is placed by projecting a layout point (from the
 * view-model) onto the ground, so what the player sees sits inside the hit region that the layout defines.
 *
 * Scene adapter (.ai/skills/threejs-vue3-animation): the meshes are built once per layout (surface size, stack count,
 * capacity) and kept; each render only updates transforms, colours, label textures and visibility. Container bodies
 * are one `InstancedMesh` (instance colours, one shared corrugation normal map); each container's number, bonus
 * medallion and heavy "H" badge is one label mesh (top and front faces merged) whose texture encodes only the label
 * and badges, with colour, dimming and glint on the material. Contact shadows are baked quads (one `InstancedMesh`),
 * and the harbour backdrop (water, quay edge, distant crane and ship silhouettes) is built from boxes in code.
 * Renders only when the view-model, the crane move or the size changes.
 */
import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { ViewModel } from '../types/presentation'
import { RECEIPT_TRUCK, type CraneMove } from '../store/yardshiftStore'

/** CSS pixels per world unit. */
const PX_PER_UNIT = 40
const PITCH = THREE.MathUtils.degToRad(28)
const YAW = THREE.MathUtils.degToRad(-14)

/** How far a selected container lifts, as a share of its height (selection never changes its colour). */
const SELECTED_LIFT = 0.3
/** The selected container's rim: a white shell drawn round it. */
const SELECTED_RIM = 0xffffff
/** A receipt container while it waits on the receipt truck or rides the crane (V20 arrival orange). */
const ARRIVAL = '#eda54e'
/** Warning red of the static urgency glow (reduced motion), V20's arrow red. */
const URGENT_GLOW = '#e9483d'
/** Most containers a level shows at once (13 levels: at most 16), plus headroom. */
const MAX_CONTAINERS = 32
/** Darkening of the yard while a receipt is mandatory. */
const DIM = 0.45

const COLOURS = {
  background: 0x101c27,
  ground: 0x1d3140,
  apron: 0x16242f,
  water: 0x0d2a3d,
  quay: 0x55616a,
  silhouette: 0x1b3346,
  column: 0x26404f,
  destination: 0x2f8f6a,
  ghost: 0x5ff0b0,
  slotLine: 0x6f8a99,
  emptyBed: 0x56636b,
  collectionBay: 0x31595a,
  receiptBay: 0x85552e,
  receiptBayUrgent: 0x85382e,
  collectionTruck: 0xd8e1e3,
  receiptTruck: 0xd99b40,
  cab: 0x2b3a44,
  gantry: 0x3f7fb5,
  trolley: 0xe9b849,
  cable: 0x1a1f24,
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t))

/**
 * Crane phases by progress u (V20): travel to the source, lower, lift (the box rides the hook from u 0.30), travel,
 * lower, then release and rise (the box sits on the destination from u 0.88). Returns the hook position along the
 * travel (0 source, 1 destination, relative to rest at the start), the hook height share (0 down, 1 up) and whether
 * the box is on the hook.
 */
function cranePhase(u: number): { leg: 'toSource' | 'carry' | 'release'; t: number; lift: number; carrying: boolean } {
  if (u < 0.16) return { leg: 'toSource', t: u / 0.16, lift: 1, carrying: false }
  if (u < 0.3) return { leg: 'carry', t: 0, lift: 1 - (u - 0.16) / 0.14, carrying: false }
  if (u < 0.46) return { leg: 'carry', t: 0, lift: (u - 0.3) / 0.16, carrying: true }
  if (u < 0.72) return { leg: 'carry', t: (u - 0.46) / 0.26, lift: 1, carrying: true }
  if (u < 0.88) return { leg: 'carry', t: 1, lift: 1 - (u - 0.72) / 0.16, carrying: true }
  return { leg: 'release', t: 1, lift: (u - 0.88) / 0.12, carrying: false }
}

/** Draws a gold star medallion (V20 gold palette) centred at (cx, cy) with radius r. */
function drawMedallion(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const fill = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r)
  fill.addColorStop(0, '#fff2bd')
  fill.addColorStop(1, '#d39b31')
  g.beginPath()
  g.arc(cx, cy, r, 0, Math.PI * 2)
  g.fillStyle = fill
  g.fill()
  g.lineWidth = r * 0.16
  g.strokeStyle = '#87531d'
  g.stroke()
  g.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 === 0 ? r * 0.62 : r * 0.26
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
  }
  g.closePath()
  g.fillStyle = '#634016'
  g.fill()
}

/** V20's heavy tile: a dark rounded square with a white "H", at (x, y) with side s. */
function drawHeavyTile(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.fillStyle = '#1d232a'
  g.beginPath()
  g.roundRect(x, y, s, s, s * 0.18)
  g.fill()
  g.lineWidth = 2
  g.strokeStyle = '#f2f4f5'
  g.stroke()
  g.fillStyle = '#f2f4f5'
  g.font = `900 ${Math.round(s * 0.78)}px system-ui, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('H', x + s / 2, y + s / 2 + 1)
}

interface LabelSpec {
  label: string
  bonus: boolean
  heavy: boolean
}

/**
 * A label texture on a transparent background: the number, a gold star medallion on a bonus container and an "H"
 * tile on a heavy one. It encodes only these (the body colour, dimming and selection are material colours), so the
 * cache holds at most one texture per container id and badge pair of the level.
 */
function labelTexture(spec: LabelSpec, cache: Map<string, THREE.CanvasTexture>): THREE.CanvasTexture {
  const key = `${spec.label}|${spec.bonus ? 'b' : ''}${spec.heavy ? 'h' : ''}`
  const hit = cache.get(key)
  if (hit) return hit
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 64
  const g = canvas.getContext('2d')!
  g.fillStyle = '#0d1b24'
  g.font = 'bold 44px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const x = spec.bonus ? (spec.heavy ? 64 : 50) : spec.heavy ? 76 : 64
  g.fillText(spec.label, x, 34)
  if (spec.bonus) drawMedallion(g, 104, 32, 19)
  if (spec.heavy) drawHeavyTile(g, 5, 15, 32)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  cache.set(key, tex)
  return tex
}

/** A shared corrugation normal map: vertical ribs across every container face. */
function corrugationMap(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 4
  const g = canvas.getContext('2d')!
  for (let x = 0; x < 32; x++) {
    const nx = Math.sin((x / 32) * Math.PI * 2)
    g.fillStyle = `rgb(${Math.round(128 + 110 * nx)}, 128, ${Math.round(255 - 40 * Math.abs(nx))})`
    g.fillRect(x, 0, 1, 4)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(7, 1)
  return tex
}

/** A soft round contact shadow (black, alpha falling off from the centre). */
function shadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const g = canvas.getContext('2d')!
  const fill = g.createRadialGradient(32, 32, 4, 32, 32, 32)
  fill.addColorStop(0, 'rgba(0,0,0,0.75)')
  fill.addColorStop(0.6, 'rgba(0,0,0,0.45)')
  fill.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = fill
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(canvas)
}

/**
 * Shake offset in CSS px for a risk 0..1 at time `now` (V20): amplitude 0.65 + 3.35 x risk, x frequency
 * 0.009 + 0.041 x risk per ms, y at a fifth of the amplitude. Render offset only: hit regions never move.
 */
function shakeOffset(risk: number, now: number, seed: number): { dx: number; dy: number } {
  if (risk <= 0) return { dx: 0, dy: 0 }
  const amp = 0.65 + 3.35 * risk
  const f = 0.009 + 0.041 * risk
  return { dx: amp * Math.sin(now * f + seed), dy: amp * 0.2 * Math.cos(now * f * 1.3 + seed) }
}

/** Disposes every geometry and material under `root` once, also when meshes share them. */
function disposeTree(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  root.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      geometries.add(o.geometry)
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m)
    }
  })
  for (const g of geometries) g.dispose()
  for (const m of materials) m.dispose()
  root.clear()
}

/** One container to draw this render: what its label shows, its colour and where it sits. */
interface ContainerDraw extends LabelSpec {
  colour: string
  dim: boolean
  urgent: boolean
  glint: boolean
  x: number
  y: number
  z: number
  seed: number
  /** Drawn lifted with the white selection rim. */
  selected?: boolean
  /** Uniform scale (the receipt cargo shrinks to fit a short desktop bay); 1 elsewhere. */
  scale?: number
}

/** The meshes of one layout, built once and updated every render. */
interface Built {
  key: string
  group: THREE.Group
  cw: number
  ch: number
  cd: number
  topY: number
  bedY: number
  colBase: THREE.Vector3[]
  collect: THREE.Vector3
  receiptBed: THREE.Vector3
  yardCentre: THREE.Vector3
  columnMats: THREE.MeshStandardMaterial[]
  receiptBayMat: THREE.MeshStandardMaterial
  receiptBedMat: THREE.MeshStandardMaterial
  cargoScale: number
  rim: THREE.Mesh
  ghosts: THREE.InstancedMesh
  bodies: THREE.InstancedMesh
  labelGeometry: THREE.BufferGeometry
  labels: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[]
  shadows: THREE.InstancedMesh
  beam: THREE.Mesh
  legL: THREE.Mesh
  legR: THREE.Mesh
  trolley: THREE.Mesh
  cable: THREE.Mesh
  first: THREE.Vector3
  last: THREE.Vector3
  dir: { x: number; z: number }
  reach: number
  rest: { x: number; z: number }
}

export function useYardScene(
  canvasRef: Ref<HTMLCanvasElement | null>,
  view: Ref<ViewModel>,
  move: Ref<CraneMove | null>,
) {
  const webglFailed = ref(false)
  let renderer: THREE.WebGLRenderer | null = null
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(COLOURS.background)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400)
  const textures = new Map<string, THREE.CanvasTexture>()
  const corrugation = corrugationMap()
  const contact = shadowTexture()
  const raycaster = new THREE.Raycaster()
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  let built: Built | null = null

  scene.add(new THREE.HemisphereLight(0xdfefff, 0x1a2630, 1.6))
  const sun = new THREE.DirectionalLight(0xffffff, 1.8)
  sun.position.set(-6, 14, 9)
  scene.add(sun)

  function placeCamera(width: number, height: number): void {
    const hw = width / PX_PER_UNIT / 2
    const hh = height / PX_PER_UNIT / 2
    camera.left = -hw
    camera.right = hw
    camera.top = hh
    camera.bottom = -hh
    const d = 50
    camera.position.set(Math.sin(YAW) * Math.cos(PITCH) * d, Math.sin(PITCH) * d, Math.cos(YAW) * Math.cos(PITCH) * d)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
  }

  /** The ground point under a play-surface pixel. */
  function groundAt(px: number, py: number, width: number, height: number): THREE.Vector3 {
    const ndc = new THREE.Vector2((px / width) * 2 - 1, -(py / height) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    const out = new THREE.Vector3()
    raycaster.ray.intersectPlane(ground, out)
    return out
  }

  const standard = (color: number, roughness = 0.8) => new THREE.MeshStandardMaterial({ color, roughness })

  function boxAt(group: THREE.Group, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    mesh.position.set(x, y, z)
    group.add(mesh)
    return mesh
  }

  /** The harbour backdrop behind the yard: apron, quay edge, water and distant crane and ship silhouettes. */
  function buildBackdrop(group: THREE.Group, quay: THREE.Vector3, dir: { x: number; z: number }): void {
    const back = new THREE.Group()
    back.position.set(quay.x, 0, quay.z)
    back.rotation.y = -Math.atan2(dir.z, dir.x)
    const plane = (w: number, d: number, color: number, z: number, y: number) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color }))
      mesh.rotation.x = -Math.PI / 2
      mesh.position.set(0, y, z)
      back.add(mesh)
    }
    plane(400, 200, COLOURS.apron, 100, -0.06)
    plane(400, 200, COLOURS.water, -100, -0.3)
    // Quay edge and the distant silhouettes, merged into one draw call each.
    const quayEdge = new THREE.BoxGeometry(400, 0.3, 0.35).translate(0, -0.15, 0)
    back.add(new THREE.Mesh(quayEdge, new THREE.MeshBasicMaterial({ color: COLOURS.quay })))
    const parts: THREE.BufferGeometry[] = []
    const part = (w: number, h: number, d: number, x: number, y: number, z: number) =>
      parts.push(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z))
    // Close enough to the quay that a phone's short strip of water above the yard still shows them.
    for (const [x, z] of [[-9, -3.4], [1, -3.8], [11, -3.4]] as const) {
      // A ship-to-shore crane: two legs, a portal beam and a boom reaching out over the water.
      part(0.18, 2.2, 0.18, x - 0.7, 0, z)
      part(0.18, 2.2, 0.18, x + 0.7, 0, z)
      part(1.7, 0.22, 0.22, x, 2.2, z)
      part(0.2, 0.18, 3.4, x, 2.4, z - 0.9)
    }
    for (const [x, z, w] of [[-4, -7.5, 10], [7, -8.5, 8]] as const) {
      // A ship: hull, a few container rows and a bridge.
      part(w, 0.6, 1.6, x, -0.3, z)
      part(w * 0.7, 0.45, 1.3, x - w * 0.08, 0.3, z)
      part(0.6, 1, 1, x + w * 0.4, 0.3, z)
    }
    const silhouettes = new THREE.Mesh(mergeGeometries(parts)!, new THREE.MeshBasicMaterial({ color: COLOURS.silhouette }))
    // Distant and small: the strip of water above the yard is only a few world units deep on a phone.
    silhouettes.scale.setScalar(0.45)
    back.add(silhouettes)
    for (const g of parts) g.dispose()
    group.add(back)
  }

  function build(vm: ViewModel, width: number, height: number): Built {
    const group = new THREE.Group()
    const { layout } = vm
    const colW = layout.columns[0]?.w ?? 80
    const cw = Math.min(colW * 0.86, 120) / PX_PER_UNIT
    const cd = cw * 0.55
    // Fit the stacks at full capacity (plus the gantry over them) to the yard height, so the yard is the hero.
    const baseY = layout.yard.y + layout.yard.h - 22
    const rise = (baseY - layout.yard.y) * 0.8
    const tierPx = rise / (vm.capacity + 1.5) - (cd * PX_PER_UNIT * Math.sin(PITCH)) / (vm.capacity + 1.5)
    const ch = Math.min(cw * 0.62, Math.max(cw * 0.36, tierPx / Math.cos(PITCH) / PX_PER_UNIT))
    const colBase = layout.columns.map((col) => groundAt(col.x + col.w / 2, baseY, width, height))
    const first = colBase[0] ?? new THREE.Vector3()
    const last = colBase[colBase.length - 1] ?? first
    const run = Math.hypot(last.x - first.x, last.z - first.z) || 1
    const dir = { x: (last.x - first.x) / run, z: (last.z - first.z) / run }

    buildBackdrop(group, groundAt(layout.yard.x + layout.yard.w / 2, layout.yard.y + layout.yard.h * 0.3, width, height), dir)

    const yardCentre = groundAt(layout.yard.x + layout.yard.w / 2, baseY, width, height)
    const yardPad = boxAt(group, run + cw * 2, 0.02, cd * 2.2, standard(COLOURS.ground), yardCentre.x, -0.02, yardCentre.z)
    yardPad.rotation.y = -Math.atan2(dir.z, dir.x)

    const columnMats = colBase.map((base) => {
      const mat = standard(COLOURS.column)
      boxAt(group, cw * 1.12, 0.03, cd * 1.3, mat, base.x, 0, base.z)
      return mat
    })

    const collect = groundAt(layout.collection.x + layout.collection.w / 2, layout.collection.y + layout.collection.h * 0.66, width, height)
    const receiptBed = groundAt(layout.receipt.x + layout.receipt.w / 2, layout.receipt.y + layout.receipt.h * 0.66, width, height)
    // Trucks and the receipt cargo shrink to fit a short bay (desktop), so they stay under the bay label.
    const cargoPx = (ch * Math.cos(PITCH) + cd * Math.sin(PITCH) + ch) * PX_PER_UNIT
    const k = Math.min(1, Math.max(0.55, (layout.receipt.h * 0.6) / Math.max(1, cargoPx)))
    let receiptBayMat = standard(COLOURS.receiptBay)
    let receiptBedMat = standard(COLOURS.receiptTruck, 0.6)
    const shadowSpots: { x: number; z: number; w: number; d: number }[] = []
    for (const [rect, centre, bayColour, truckColour, facing] of [
      [layout.collection, collect, COLOURS.collectionBay, COLOURS.collectionTruck, -1],
      [layout.receipt, receiptBed, COLOURS.receiptBay, COLOURS.receiptTruck, 1],
    ] as const) {
      const bw = (rect.w * 0.9) / PX_PER_UNIT
      const bayMat = standard(bayColour)
      if (facing === 1) receiptBayMat = bayMat
      boxAt(group, bw, 0.02, cd * 1.8, bayMat, centre.x, 0, centre.z)
      const tl = Math.min(bw * 0.8, cw * 1.6 * k)
      const bedMat = standard(truckColour, 0.6)
      if (facing === 1) receiptBedMat = bedMat
      boxAt(group, tl * 0.72, ch * 0.35 * k, cd * 0.9 * k, bedMat, centre.x - facing * tl * 0.12, ch * 0.3 * k, centre.z)
      boxAt(group, tl * 0.22, ch * 0.9 * k, cd * 0.9 * k, standard(COLOURS.cab, 0.6), centre.x + facing * tl * 0.38, ch * 0.45 * k, centre.z)
      shadowSpots.push({ x: centre.x, z: centre.z, w: tl * 1.15, d: cd * 1.5 * k })
    }


    // Capacity: a dashed outline of every slot up to the stack capacity (story 8), one merged line mesh.
    const slotEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(cw, ch, cd))
    const slotParts: THREE.BufferGeometry[] = []
    for (const base of colBase) {
      for (let t = 0; t < vm.capacity; t++) slotParts.push(slotEdges.clone().translate(base.x, ch / 2 + t * ch * 1.04, base.z))
    }
    slotEdges.dispose()
    if (slotParts.length > 0) {
      const slotGeo = mergeGeometries(slotParts)!
      for (const g of slotParts) g.dispose()
      const slots = new THREE.LineSegments(
        slotGeo,
        new THREE.LineDashedMaterial({ color: COLOURS.slotLine, dashSize: 0.12, gapSize: 0.1, transparent: true, opacity: 0.55 }),
      )
      slots.computeLineDistances()
      group.add(slots)
    }

    // Legal destinations: a ghost container at the drop height of each one (fix 4), filled per render.
    const ghosts = new THREE.InstancedMesh(
      new THREE.BoxGeometry(cw, ch, cd),
      new THREE.MeshBasicMaterial({ color: COLOURS.ghost, transparent: true, opacity: 0.4, depthWrite: false }),
      Math.max(1, colBase.length),
    )
    ghosts.count = 0
    ghosts.frustumCulled = false
    group.add(ghosts)

    // The selection rim: a white back-face shell a little larger than a container (fix 1).
    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(cw * 1.1, ch * 1.16, cd * 1.12),
      new THREE.MeshBasicMaterial({ color: SELECTED_RIM, side: THREE.BackSide }),
    )
    rim.visible = false
    group.add(rim)

    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.1, normalMap: corrugation })
    bodyMat.normalScale.set(0.6, 0.6)
    const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(cw, ch, cd), bodyMat, MAX_CONTAINERS)
    bodies.count = 0
    bodies.frustumCulled = false
    group.add(bodies)

    // The label faces: the top face and the front face (toward the camera) of a container, one geometry.
    const eps = 0.004
    const top = new THREE.PlaneGeometry(cw, cd).rotateX(-Math.PI / 2).translate(0, ch / 2 + eps, 0)
    const front = new THREE.PlaneGeometry(cw, ch).translate(0, 0, cd / 2 + eps)
    const labelGeometry = mergeGeometries([top, front])!
    top.dispose()
    front.dispose()

    // Contact shadows: one quad per stack, truck and the moving container; spots are filled per render.
    const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
    const shadows = new THREE.InstancedMesh(
      shadowGeo,
      new THREE.MeshBasicMaterial({ map: contact, transparent: true, depthWrite: false }),
      colBase.length + 3,
    )
    shadows.frustumCulled = false
    shadows.renderOrder = 1
    group.add(shadows)
    const m = new THREE.Matrix4()
    shadowSpots.forEach((s, i) => shadows.setMatrixAt(i, m.compose(new THREE.Vector3(s.x, 0.02, s.z), new THREE.Quaternion(), new THREE.Vector3(s.w, 1, s.d))))

    // Gantry: a beam along the row of stacks on two legs (one shared geometry and material), a trolley and a cable.
    const topY = (vm.capacity + 1.2) * ch * 1.04
    const reach = cw * 0.62
    const gantryMat = standard(COLOURS.gantry, 0.5)
    const beam = boxAt(group, run + 2 * reach, ch * 0.3, cd * 0.3, gantryMat, 0, topY + ch * 0.6, 0)
    beam.rotation.y = -Math.atan2(dir.z, dir.x)
    const legGeo = new THREE.BoxGeometry(ch * 0.25, topY + ch * 0.6, ch * 0.25)
    const legL = new THREE.Mesh(legGeo, gantryMat)
    const legR = new THREE.Mesh(legGeo, gantryMat)
    group.add(legL, legR)
    const trolley = boxAt(group, cw * 0.6, ch * 0.35, cd * 0.6, standard(COLOURS.trolley, 0.5), 0, topY + ch * 0.6, 0)
    const cable = boxAt(group, 0.04, 1, 0.04, standard(COLOURS.cable), 0, 0, 0)

    scene.add(group)
    return {
      key: '',
      group,
      cw,
      ch,
      cd,
      topY,
      bedY: ch * k,
      colBase,
      collect,
      receiptBed,
      yardCentre,
      columnMats,
      receiptBayMat,
      receiptBedMat,
      cargoScale: k,
      rim,
      ghosts,
      bodies,
      labelGeometry,
      labels: [],
      shadows,
      beam,
      legL,
      legR,
      trolley,
      cable,
      first,
      last,
      dir,
      reach,
      rest: { x: yardCentre.x, z: yardCentre.z },
    }
  }

  function teardown(): void {
    if (!built) return
    scene.remove(built.group)
    disposeTree(built.group)
    built = null
  }

  const tmp = {
    m: new THREE.Matrix4(),
    p: new THREE.Vector3(),
    q: new THREE.Quaternion(),
    s: new THREE.Vector3(1, 1, 1),
    e: new THREE.Euler(),
    c: new THREE.Color(),
  }

  function labelMesh(b: Built, i: number): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
    let mesh = b.labels[i]
    if (!mesh) {
      const mat = new THREE.MeshStandardMaterial({ transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1 })
      mesh = new THREE.Mesh(b.labelGeometry, mat)
      mesh.renderOrder = 2
      b.labels[i] = mesh
      b.group.add(mesh)
    }
    return mesh
  }

  /** Draws one container into slot `i`: instance transform and colour, and its label mesh. */
  function containerMesh(b: Built, i: number, c: ContainerDraw, now: number): void {
    const rock = c.glint ? Math.sin(now * 0.006 + c.seed) * 0.06 : 0
    tmp.q.setFromEuler(tmp.e.set(0, 0, rock))
    tmp.p.set(c.x, c.y, c.z)
    const k = c.scale ?? 1
    tmp.s.setScalar(k)
    b.bodies.setMatrixAt(i, tmp.m.compose(tmp.p, tmp.q, tmp.s))
    tmp.s.setScalar(1)
    // The glint: a gold flash sweeping over the exposed bonus container's body; the number stays dark navy.
    const flash = c.glint ? Math.pow(0.5 + 0.5 * Math.sin(now * 0.004 + c.seed), 6) : 0
    tmp.c.set(c.colour)
    if (flash > 0) tmp.c.lerp(new THREE.Color(0xffe39a), flash * 0.45)
    if (c.urgent) tmp.c.lerp(new THREE.Color(URGENT_GLOW), 0.35)
    if (c.dim) tmp.c.multiplyScalar(DIM)
    b.bodies.setColorAt(i, tmp.c)
    const label = labelMesh(b, i)
    label.visible = true
    label.position.copy(tmp.p)
    label.quaternion.copy(tmp.q)
    label.scale.setScalar(k)
    const map = labelTexture(c, textures)
    if (label.material.map !== map) {
      label.material.map = map
      label.material.needsUpdate = true
    }
    label.material.color.setScalar(c.dim ? DIM : 1)
  }

  function update(vm: ViewModel, b: Built): void {
    const { cw, ch, topY, colBase, receiptBed, bedY } = b
    const now = performance.now()
    b.columnMats.forEach((mat, i) => mat.color.setHex(vm.destinations.includes(i) ? COLOURS.destination : COLOURS.column))
    b.receiptBayMat.color.setHex(vm.incoming.status === 'mandatory' ? COLOURS.receiptBayUrgent : COLOURS.receiptBay)
    // No truck waiting: the empty bed is grey, so it never reads as cargo (story 23).
    b.receiptBedMat.color.setHex(vm.receiptCargo ? COLOURS.receiptTruck : COLOURS.emptyBed)

    const m = move.value
    const stackTop = (stack: number) => vm.containers.filter((o) => o.stack === stack).length
    const cargo = vm.receiptCargo
    // A receipt lifts the cargo off the receipt truck; anything else lifts the top container of its source stack.
    const moving =
      m && m.from === RECEIPT_TRUCK
        ? cargo && { id: cargo.id, label: cargo.label, tier: 0, colour: ARRIVAL, bonus: cargo.bonus, heavy: cargo.heavy }
        : m
          ? vm.containers.find((c) => c.stack === m.from && c.tier === stackTop(m.from) - 1)
          : undefined

    const draws: ContainerDraw[] = []
    for (const c of vm.containers) {
      if (c === moving) continue
      const base = colBase[c.stack]
      if (!base) continue
      const { dx, dy } = shakeOffset(c.shake, now, c.id)
      draws.push({
        label: c.label,
        bonus: c.bonus,
        heavy: c.heavy,
        colour: c.colour,
        selected: c.selected,
        dim: vm.dimYard,
        urgent: c.urgent,
        glint: c.glint,
        x: base.x + dx / PX_PER_UNIT,
        y: ch / 2 + c.tier * ch * 1.04 + (c.selected ? ch * SELECTED_LIFT : 0) + dy / PX_PER_UNIT,
        z: base.z,
        seed: c.id,
      })
    }
    // The waiting truck's cargo sits on the receipt truck bed (raised when selected) until the crane lifts it.
    if (cargo && !(m && m.from === RECEIPT_TRUCK)) {
      const { dx, dy } = shakeOffset(cargo.shake, now, cargo.id)
      draws.push({
        label: cargo.label,
        bonus: cargo.bonus,
        heavy: cargo.heavy,
        colour: ARRIVAL,
        selected: cargo.selected,
        dim: false,
        urgent: cargo.urgent,
        glint: false,
        x: receiptBed.x + dx / PX_PER_UNIT,
        y: bedY + (cargo.selected ? ch * SELECTED_LIFT : 0) + dy / PX_PER_UNIT,
        z: receiptBed.z,
        seed: cargo.id,
        scale: b.cargoScale,
      })
    }
    // The rim follows the selected container (a stack top or the receipt cargo), never while the crane moves it.
    const sel = draws.find((d) => d.selected)
    b.rim.visible = !m && sel !== undefined
    if (sel) {
      b.rim.position.set(sel.x, sel.y, sel.z)
      b.rim.scale.setScalar(sel.scale ?? 1)
    }
    // Ghost containers at the drop height of each legal destination.
    b.ghosts.count = 0
    for (const to of vm.destinations) {
      const base = colBase[to]
      if (!base || b.ghosts.count >= b.ghosts.instanceMatrix.count) continue
      tmp.p.set(base.x, ch / 2 + stackTop(to) * ch * 1.04, base.z)
      b.ghosts.setMatrixAt(b.ghosts.count++, tmp.m.compose(tmp.p, new THREE.Quaternion(), tmp.s))
    }
    b.ghosts.instanceMatrix.needsUpdate = true

    // The crane: the trolley rests where the last move ended; a move animates hook and box.
    let hook = { x: b.rest.x, z: b.rest.z, y: topY }
    let carried: { x: number; y: number; z: number } | null = null
    if (m && moving) {
      const fromTruck = m.from === RECEIPT_TRUCK
      const src = fromTruck ? receiptBed : colBase[m.from]!
      const dst = m.to >= 0 ? colBase[m.to]! : b.collect
      const truckY = bedY + (ch * (1 - b.cargoScale)) / 2
      const srcY = fromTruck ? truckY : ch / 2 + moving.tier * ch * 1.04
      const dstY = m.to >= 0 ? ch / 2 + stackTop(m.to) * ch * 1.04 : truckY
      const p = cranePhase(m.progress)
      if (p.leg === 'toSource') {
        hook = { x: lerp(b.rest.x, src.x, p.t), z: lerp(b.rest.z, src.z, p.t), y: topY }
        carried = { x: src.x, y: srcY, z: src.z }
      } else {
        const x = lerp(src.x, dst.x, p.t)
        const z = lerp(src.z, dst.z, p.t)
        const lowY = (p.t < 1 ? srcY : dstY) + ch / 2
        hook = { x, z, y: lerp(lowY, topY, p.lift) }
        carried = p.leg === 'release' ? { x: dst.x, y: dstY, z: dst.z } : p.carrying ? { x, y: hook.y - ch / 2, z } : { x: src.x, y: srcY, z: src.z }
      }
      if (m.progress >= 0.999) b.rest = { x: dst.x, z: dst.z }
      draws.push({
        label: moving.label,
        bonus: moving.bonus,
        heavy: moving.heavy,
        colour: moving.colour,
        dim: false,
        urgent: false,
        glint: false,
        ...carried,
        seed: moving.id,
      })
    }

    const n = Math.min(draws.length, MAX_CONTAINERS)
    for (let i = 0; i < n; i++) containerMesh(b, i, draws[i]!, now)
    for (let i = n; i < b.labels.length; i++) b.labels[i]!.visible = false
    b.bodies.count = n
    b.bodies.instanceMatrix.needsUpdate = true
    if (b.bodies.instanceColor) b.bodies.instanceColor.needsUpdate = true

    // Contact shadows under each non-empty stack and under a lifted container (the trucks' are fixed at build).
    let s = 2
    const footprint = (x: number, z: number, scale: number) => {
      tmp.p.set(x, 0.025, z)
      tmp.s.set(cw * 1.25 * scale, 1, b.cd * 1.5 * scale)
      b.shadows.setMatrixAt(s++, tmp.m.compose(tmp.p, new THREE.Quaternion(), tmp.s))
      tmp.s.set(1, 1, 1)
    }
    colBase.forEach((base, i) => {
      if (stackTop(i) > 0) footprint(base.x, base.z, 1)
    })
    if (carried && carried.y > ch) footprint(carried.x, carried.z, 0.8)
    b.shadows.count = s
    b.shadows.instanceMatrix.needsUpdate = true

    // The gantry travels on its rails with the trolley: shift the whole frame across the row to the hook.
    const { first, last, dir, reach } = b
    const mid = { x: (first.x + last.x) / 2, z: (first.z + last.z) / 2 }
    const along = (hook.x - mid.x) * dir.x + (hook.z - mid.z) * dir.z
    const off = { x: hook.x - mid.x - along * dir.x, z: hook.z - mid.z - along * dir.z }
    const legH = topY + ch * 0.6
    b.beam.position.set(mid.x + off.x, legH, mid.z + off.z)
    b.legL.position.set(first.x - dir.x * reach + off.x, legH / 2, first.z - dir.z * reach + off.z)
    b.legR.position.set(last.x + dir.x * reach + off.x, legH / 2, last.z + dir.z * reach + off.z)
    b.trolley.position.set(hook.x, legH, hook.z)
    const cableLen = Math.max(0.01, legH - hook.y)
    b.cable.scale.set(1, cableLen, 1)
    b.cable.position.set(hook.x, hook.y + cableLen / 2, hook.z)
  }

  function render(): void {
    const canvas = canvasRef.value
    if (!renderer || !canvas) return
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return
    const vm = view.value
    const key = `${width}x${height}x${vm.layout.columns.length}x${vm.capacity}`
    if (!built || built.key !== key) {
      // A resize or a new level rebuilds the layout's meshes and puts the trolley back over the yard centre.
      teardown()
      renderer.setSize(width, height, false)
      placeCamera(width, height)
      built = build(vm, width, height)
      built.key = key
    }
    update(vm, built)
    renderer.render(scene, camera)
  }

  onMounted(() => {
    const canvas = canvasRef.value
    if (!canvas) return
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    } catch {
      webglFailed.value = true
      return
    }
    render()
  })

  const stop = watch([view, move], render)

  onBeforeUnmount(() => {
    stop()
    teardown()
    for (const t of textures.values()) t.dispose()
    textures.clear()
    corrugation.dispose()
    contact.dispose()
    renderer?.dispose()
    renderer = null
  })

  return { webglFailed, render }
}
