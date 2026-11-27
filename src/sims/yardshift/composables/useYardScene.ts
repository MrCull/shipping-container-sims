/**
 * Thin Three.js renderer for the Yardshift yard. A fixed orthographic camera, pitched down and turned a little to the
 * side, so containers show top and side faces. Every object is placed by projecting a layout point (from the
 * view-model) onto the ground, so what the player sees sits inside the hit region that the layout defines. Renders
 * only when the view-model or the size changes.
 */
import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import * as THREE from 'three'
import type { ViewModel } from '../types/presentation'

/** CSS pixels per world unit. */
const PX_PER_UNIT = 40
const PITCH = THREE.MathUtils.degToRad(28)
const YAW = THREE.MathUtils.degToRad(-14)

const COLOURS = {
  background: 0x101c27,
  ground: 0x1d3140,
  column: 0x26404f,
  destination: 0x2f8f6a,
  next: 0x54ddb0,
  other: 0x84949c,
  selected: 0xffcb60,
  collectionBay: 0x31595a,
  receiptBay: 0x85552e,
  collectionTruck: 0xd8e1e3,
  receiptTruck: 0xd99b40,
  cab: 0x2b3a44,
}

function labelTexture(text: string, cache: Map<string, THREE.CanvasTexture>): THREE.CanvasTexture {
  const hit = cache.get(text)
  if (hit) return hit
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 64
  const g = canvas.getContext('2d')!
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, 128, 64)
  g.fillStyle = '#0d1b24'
  g.font = 'bold 44px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, 64, 34)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  cache.set(text, tex)
  return tex
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

export function useYardScene(canvasRef: Ref<HTMLCanvasElement | null>, view: Ref<ViewModel>) {
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

    for (const c of vm.containers) {
      const col = layout.columns[c.stack]
      if (!col) continue
      const base = groundAt(col.x + col.w / 2, baseY, width, height)
      const colour = c.selected ? COLOURS.selected : c.next ? COLOURS.next : COLOURS.other
      const body = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.7 })
      const label = new THREE.MeshStandardMaterial({ color: colour, map: labelTexture(c.label, textures), roughness: 0.7 })
      // BoxGeometry faces: +x, -x, +y (top), -y, +z (front, toward the camera), -z.
      const mesh = box(cw, ch, cd, [body, body, label, body, label, body])
      mesh.position.set(base.x, ch / 2 + c.tier * ch * 1.04 + (c.selected ? ch * 0.25 : 0), base.z)
      dynamic.add(mesh)
    }

    const bays: [typeof layout.collection, number, number, number][] = [
      [layout.collection, COLOURS.collectionBay, COLOURS.collectionTruck, -1],
      [layout.receipt, COLOURS.receiptBay, COLOURS.receiptTruck, 1],
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

  const stop = watch(view, render)

  onBeforeUnmount(() => {
    stop()
    disposeGroup(dynamic)
    for (const t of textures.values()) t.dispose()
    renderer?.dispose()
    renderer = null
  })

  return { webglFailed, render }
}
