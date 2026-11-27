/**
 * Thin Three.js renderer for the Yardshift yard. A fixed orthographic camera, pitched down and turned a little to the
 * side, so containers show top and side faces. Every object is placed by projecting a layout point (from the
 * view-model) onto the ground, so what the player sees sits inside the hit region that the layout defines. Renders
 * only when the view-model or the size changes.
 */
import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import * as THREE from 'three'
import type { ViewModel } from '../types/presentation'
import { RECEIPT_TRUCK, type CraneMove } from '../store/yardshiftStore'

/** CSS pixels per world unit. */
const PX_PER_UNIT = 40
const PITCH = THREE.MathUtils.degToRad(28)
const YAW = THREE.MathUtils.degToRad(-14)

/** The selected container (sequence colours and grey come from the view-model). */
const SELECTED = '#ffcb60'
/** A receipt container while it waits on the receipt truck or rides the crane (V20 arrival orange). */
const ARRIVAL = '#eda54e'

/** A hex colour darkened for the dimmed yard (mandatory receipt). */
function dimmed(hex: string): string {
  return `#${new THREE.Color(hex).multiplyScalar(0.45).getHexString()}`
}

const COLOURS = {
  background: 0x101c27,
  ground: 0x1d3140,
  column: 0x26404f,
  destination: 0x2f8f6a,
  collectionBay: 0x31595a,
  receiptBay: 0x85552e,
  receiptBayUrgent: 0x85382e,
  collectionTruck: 0xd8e1e3,
  receiptTruck: 0xd99b40,
  cab: 0x2b3a44,
  gantry: 0x3f7fb5,
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

/** A face texture: the container colour, its number, and a gold star medallion on a bonus container. */
function labelTexture(text: string, colour: string, bonus: boolean, cache: Map<string, THREE.CanvasTexture>): THREE.CanvasTexture {
  const key = `${text}|${colour}|${bonus ? 1 : 0}`
  const hit = cache.get(key)
  if (hit) return hit
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 64
  const g = canvas.getContext('2d')!
  g.fillStyle = colour
  g.fillRect(0, 0, 128, 64)
  g.fillStyle = '#0d1b24'
  g.font = 'bold 44px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, bonus ? 50 : 64, 34)
  if (bonus) drawMedallion(g, 104, 32, 19)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  cache.set(key, tex)
  return tex
}

/** Warning red of the static urgency glow (reduced motion), V20's arrow red. */
const URGENT_GLOW = '#e9483d'

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

function disposeGroup(group: THREE.Group): void {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose()
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats) m.dispose()
    }
  })
  group.clear()
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
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200)
  const dynamic = new THREE.Group()
  scene.add(dynamic)
  const textures = new Map<string, THREE.CanvasTexture>()
  const raycaster = new THREE.Raycaster()
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  /** Where the trolley rests between moves (world x, z); null until the first build. */
  let rest: { x: number; z: number } | null = null
  /** The layout the rest point belongs to; a resize or a new level puts the trolley back over the yard centre. */
  let restKey = ''

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

  function box(w: number, h: number, d: number, material: THREE.Material | THREE.Material[]): THREE.Mesh {
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  }

  function build(vm: ViewModel, width: number, height: number): void {
    disposeGroup(dynamic)
    const { layout } = vm
    const colW = layout.columns[0]?.w ?? 80
    const cw = Math.min(colW * 0.82, 110) / PX_PER_UNIT
    const ch = cw * 0.42
    const cd = cw * 0.55
    const baseY = layout.yard.y + layout.yard.h * 0.82

    const yardCentre = groundAt(layout.yard.x + layout.yard.w / 2, baseY, width, height)
    const yardPad = box(layout.yard.w / PX_PER_UNIT, 0.02, cd * 2.2, new THREE.MeshStandardMaterial({ color: COLOURS.ground }))
    yardPad.position.set(yardCentre.x, -0.02, yardCentre.z)
    dynamic.add(yardPad)

    layout.columns.forEach((col, i) => {
      const base = groundAt(col.x + col.w / 2, baseY, width, height)
      const pad = box(cw * 1.12, 0.03, cd * 1.3, new THREE.MeshStandardMaterial({
        color: vm.destinations.includes(i) ? COLOURS.destination : COLOURS.column,
      }))
      pad.position.set(base.x, 0, base.z)
      dynamic.add(pad)
    })

    const m = move.value
    const stackTop = (stack: number) => vm.containers.filter((o) => o.stack === stack).length
    const cargo = vm.receiptCargo
    // A receipt lifts the cargo off the receipt truck; anything else lifts the top container of its source stack.
    const moving =
      m && m.from === RECEIPT_TRUCK
        ? cargo && { id: cargo.id, label: cargo.label, tier: 0, colour: ARRIVAL, bonus: cargo.bonus }
        : m
          ? vm.containers.find((c) => c.stack === m.from && c.tier === stackTop(m.from) - 1)
          : undefined
    const receiptBed = groundAt(layout.receipt.x + layout.receipt.w / 2, layout.receipt.y + layout.receipt.h * 0.55, width, height)
    const bedY = ch * 0.5 + ch / 2

    const now = performance.now()
    /** Shake (a render offset) or, under reduced motion, a static red glow. */
    const urgency = (mesh: THREE.Mesh, mats: THREE.MeshStandardMaterial[], u: { shake: number; urgent: boolean }, seed: number) => {
      const { dx, dy } = shakeOffset(u.shake, now, seed)
      mesh.position.x += dx / PX_PER_UNIT
      mesh.position.y += dy / PX_PER_UNIT
      if (u.urgent) for (const mat of mats) mat.emissive.set(URGENT_GLOW).multiplyScalar(0.35)
    }

    for (const c of vm.containers) {
      if (c === moving) continue
      const col = layout.columns[c.stack]
      if (!col) continue
      const base = groundAt(col.x + col.w / 2, baseY, width, height)
      const base0 = c.selected ? SELECTED : c.colour
      const colour = vm.dimYard ? dimmed(base0) : base0
      const body = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.7 })
      const label = new THREE.MeshStandardMaterial({ map: labelTexture(c.label, colour, c.bonus, textures), roughness: 0.7 })
      // BoxGeometry faces: +x, -x, +y (top), -y, +z (front, toward the camera), -z.
      const mesh = box(cw, ch, cd, [body, body, label, body, label, body])
      mesh.position.set(base.x, ch / 2 + c.tier * ch * 1.04 + (c.selected ? ch * 0.25 : 0), base.z)
      urgency(mesh, [body, label], c, c.id)
      dynamic.add(mesh)
    }

    // The waiting truck's cargo sits on the receipt truck bed (raised when selected) until the crane lifts it.
    if (cargo && !(m && m.from === RECEIPT_TRUCK)) {
      const colour = cargo.selected ? SELECTED : ARRIVAL
      const body = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.7 })
      const label = new THREE.MeshStandardMaterial({ map: labelTexture(cargo.label, colour, cargo.bonus, textures), roughness: 0.7 })
      const mesh = box(cw, ch, cd, [body, body, label, body, label, body])
      mesh.position.set(receiptBed.x, bedY + (cargo.selected ? ch * 0.25 : 0), receiptBed.z)
      urgency(mesh, [body, label], cargo, cargo.id)
      dynamic.add(mesh)
    }

    // Gantry: a beam across the yard on two legs, a trolley and a hook cable; a crane move animates them.
    const topY = (vm.capacity + 1.2) * ch * 1.04
    const collect = groundAt(layout.collection.x + layout.collection.w / 2, layout.collection.y + layout.collection.h * 0.55, width, height)
    const colBase = (i: number) => {
      const col = layout.columns[i]!
      return groundAt(col.x + col.w / 2, baseY, width, height)
    }
    const key = `${width}x${height}x${layout.columns.length}`
    if (key !== restKey) rest = null
    restKey = key
    rest ??= groundAt(layout.yard.x + layout.yard.w / 2, baseY, width, height)
    let hook = { x: rest.x, z: rest.z, y: topY }
    if (m && moving) {
      const fromTruck = m.from === RECEIPT_TRUCK
      const src = fromTruck ? receiptBed : colBase(m.from)
      const dst = m.to >= 0 ? colBase(m.to) : collect
      const srcY = fromTruck ? bedY : ch / 2 + moving.tier * ch * 1.04
      const dstY = m.to >= 0 ? ch / 2 + stackTop(m.to) * ch * 1.04 : ch * 0.5 + ch / 2
      const p = cranePhase(m.progress)
      let boxPos: { x: number; y: number; z: number }
      if (p.leg === 'toSource') {
        hook = { x: lerp(rest.x, src.x, p.t), z: lerp(rest.z, src.z, p.t), y: topY }
        boxPos = { x: src.x, y: srcY, z: src.z }
      } else {
        const x = lerp(src.x, dst.x, p.t)
        const z = lerp(src.z, dst.z, p.t)
        const lowY = (p.t < 1 ? srcY : dstY) + ch / 2
        hook = { x, z, y: lerp(lowY, topY, p.lift) }
        boxPos = p.leg === 'release' ? { x: dst.x, y: dstY, z: dst.z } : p.carrying ? { x, y: hook.y - ch / 2, z } : { x: src.x, y: srcY, z: src.z }
      }
      if (m.progress >= 0.999) rest = { x: dst.x, z: dst.z }
      const mat = new THREE.MeshStandardMaterial({ color: moving.colour, roughness: 0.7 })
      const lab = new THREE.MeshStandardMaterial({ map: labelTexture(moving.label, moving.colour, moving.bonus, textures), roughness: 0.7 })
      const boxMesh = box(cw, ch, cd, [mat, mat, lab, mat, lab, mat])
      boxMesh.position.set(boxPos.x, boxPos.y, boxPos.z)
      dynamic.add(boxMesh)
    }
    const gantryMat = new THREE.MeshStandardMaterial({ color: COLOURS.gantry, roughness: 0.5 })
    // The beam runs along the row of stacks (which the side-turned camera makes a slanted world line), from just
    // outside the first stack to just outside the last, so it never runs past the screen edge on a phone (#389).
    const first = colBase(0)
    const last = colBase(layout.columns.length - 1)
    const run = Math.hypot(last.x - first.x, last.z - first.z) || 1
    const dir = { x: (last.x - first.x) / run, z: (last.z - first.z) / run }
    const reach = cw * 0.62
    const beamLen = run + 2 * reach
    const beam = box(beamLen, ch * 0.3, cd * 0.3, gantryMat)
    // The gantry travels on its rails with the trolley: shift the whole frame across the row to the hook.
    const mid = { x: (first.x + last.x) / 2, z: (first.z + last.z) / 2 }
    const along = (hook.x - mid.x) * dir.x + (hook.z - mid.z) * dir.z
    const off = { x: hook.x - mid.x - along * dir.x, z: hook.z - mid.z - along * dir.z }
    beam.position.set(mid.x + off.x, topY + ch * 0.6, mid.z + off.z)
    beam.rotation.y = -Math.atan2(dir.z, dir.x)
    const legL = box(ch * 0.25, topY + ch * 0.6, ch * 0.25, gantryMat)
    legL.position.set(first.x - dir.x * reach + off.x, (topY + ch * 0.6) / 2, first.z - dir.z * reach + off.z)
    const legR = legL.clone()
    legR.position.set(last.x + dir.x * reach + off.x, (topY + ch * 0.6) / 2, last.z + dir.z * reach + off.z)
    const trolley = box(cw * 0.6, ch * 0.35, cd * 0.6, new THREE.MeshStandardMaterial({ color: 0xe9b849 }))
    trolley.position.set(hook.x, topY + ch * 0.6, hook.z)
    const cableLen = Math.max(0.01, topY + ch * 0.6 - hook.y)
    const cable = box(0.04, cableLen, 0.04, new THREE.MeshStandardMaterial({ color: COLOURS.cable }))
    cable.position.set(hook.x, hook.y + cableLen / 2, hook.z)
    dynamic.add(beam, legL, legR, trolley, cable)

    const bays: [typeof layout.collection, number, number, number][] = [
      [layout.collection, COLOURS.collectionBay, COLOURS.collectionTruck, -1],
      [layout.receipt, vm.incoming.status === 'mandatory' ? COLOURS.receiptBayUrgent : COLOURS.receiptBay, COLOURS.receiptTruck, 1],
    ]
    for (const [rect, bayColour, truckColour, facing] of bays) {
      const c = groundAt(rect.x + rect.w / 2, rect.y + rect.h * 0.55, width, height)
      const bw = (rect.w * 0.9) / PX_PER_UNIT
      const pad = box(bw, 0.02, cd * 1.8, new THREE.MeshStandardMaterial({ color: bayColour }))
      pad.position.set(c.x, 0, c.z)
      dynamic.add(pad)
      const tl = Math.min(bw * 0.8, cw * 1.6)
      const trailer = box(tl * 0.72, ch * 0.35, cd * 0.9, new THREE.MeshStandardMaterial({ color: truckColour }))
      trailer.position.set(c.x - facing * tl * 0.12, ch * 0.3, c.z)
      const cab = box(tl * 0.22, ch * 0.9, cd * 0.9, new THREE.MeshStandardMaterial({ color: COLOURS.cab }))
      cab.position.set(c.x + facing * tl * 0.38, ch * 0.45, c.z)
      dynamic.add(trailer, cab)
    }
  }

  function render(): void {
    const canvas = canvasRef.value
    if (!renderer || !canvas) return
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return
    renderer.setSize(width, height, false)
    placeCamera(width, height)
    build(view.value, width, height)
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
    disposeGroup(dynamic)
    for (const t of textures.values()) t.dispose()
    renderer?.dispose()
    renderer = null
  })

  return { webglFailed, render }
}
