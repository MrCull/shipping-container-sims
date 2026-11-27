/**
 * Thin Canvas 2D renderer for the Yardshift yard (owner decision on spec #374: a flat illustrated look like the
 * reference prototype, not 3D). Every shape comes from `modules/yardGeometry.ts`, which places it from the
 * view-model's layout, so what is drawn lines up with the hit regions; this file only paints. The canvas backing store
 * follows `devicePixelRatio` for crisp lines. It renders when the view-model or the crane move changes, and keeps
 * drawing frame by frame only while a container shakes or glints.
 */
import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import type { ContainerView, Rect, ViewModel } from '../types/presentation'
import { RECEIPT_TRUCK, type CraneMove } from '../store/yardshiftStore'
import { boxAt, freeSlots, slotsFor, truckIn, type Box, type Truck, type YardGeometry, yardGeometry } from '../modules/yardGeometry'
import { shade, YARD_COLOURS as C } from '../modules/yardPalette'

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t))

/**
 * Crane phases by progress u (V20): travel to the source, lower, lift (the box rides the hook from u 0.30), travel,
 * lower, then release and rise (the box sits on the destination from u 0.88).
 */
export function cranePhase(u: number): { leg: 'toSource' | 'carry' | 'release'; t: number; lift: number; carrying: boolean } {
  if (u < 0.16) return { leg: 'toSource', t: u / 0.16, lift: 1, carrying: false }
  if (u < 0.3) return { leg: 'carry', t: 0, lift: 1 - (u - 0.16) / 0.14, carrying: false }
  if (u < 0.46) return { leg: 'carry', t: 0, lift: (u - 0.3) / 0.16, carrying: true }
  if (u < 0.72) return { leg: 'carry', t: (u - 0.46) / 0.26, lift: 1, carrying: true }
  if (u < 0.88) return { leg: 'carry', t: 1, lift: 1 - (u - 0.72) / 0.16, carrying: true }
  return { leg: 'release', t: 1, lift: (u - 0.88) / 0.12, carrying: false }
}

/** Shake offset (V20): amplitude 0.65 + 3.35 x risk px, frequency rising with risk. */
function shakeOffset(risk: number, now: number, seed: number): { x: number; y: number } {
  if (risk <= 0) return { x: 0, y: 0 }
  const amp = 0.65 + 3.35 * risk
  const f = 0.009 + 0.041 * risk
  return { x: amp * Math.sin(now * f + seed), y: amp * 0.2 * Math.cos(now * f * 1.3 + seed) }
}

const moveBox = (b: Box, x: number, y: number): Box => ({ ...b, x: b.x + x, y: b.y + y })
const lerpBox = (a: Box, b: Box, t: number): Box => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  w: lerp(a.w, b.w, t),
  h: lerp(a.h, b.h, t),
  dx: lerp(a.dx, b.dx, t),
  dy: lerp(a.dy, b.dy, t),
})
const centreX = (b: Box) => b.x + (b.w + b.dx) / 2

interface Paint {
  label: string
  colour: string
  bonus: boolean
  heavy: boolean
  selected?: boolean
  urgent?: boolean
  glint?: boolean
  seed: number
}

/** The outline of a whole box (front, top and side), for the rim and the shadow. */
function outline(g: CanvasRenderingContext2D, b: Box): void {
  g.beginPath()
  g.moveTo(b.x, b.y + b.h)
  g.lineTo(b.x, b.y)
  g.lineTo(b.x + b.dx, b.y - b.dy)
  g.lineTo(b.x + b.w + b.dx, b.y - b.dy)
  g.lineTo(b.x + b.w + b.dx, b.y + b.h - b.dy)
  g.lineTo(b.x + b.w, b.y + b.h)
  g.closePath()
}

function medallion(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const fill = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r)
  fill.addColorStop(0, C['medal-light'])
  fill.addColorStop(1, C['medal-dark'])
  g.beginPath()
  g.arc(cx, cy, r, 0, Math.PI * 2)
  g.fillStyle = fill
  g.fill()
  g.lineWidth = Math.max(1, r * 0.16)
  g.strokeStyle = C['medal-rim']
  g.stroke()
  g.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 === 0 ? r * 0.66 : r * 0.28
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
  }
  g.closePath()
  g.fillStyle = C['medal-star']
  g.fill()
}

function heavyTile(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.fillStyle = C['heavy-tile']
  g.beginPath()
  g.roundRect(x, y, s, s, s * 0.2)
  g.fill()
  g.lineWidth = 1.5
  g.strokeStyle = C.rim
  g.stroke()
  g.fillStyle = C.rim
  g.font = `900 ${Math.round(s * 0.74)}px system-ui, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('H', x + s / 2, y + s / 2 + 1)
}

/** One container: a bold oblique box with corrugations, outline and its big number. */
function container(g: CanvasRenderingContext2D, b: Box, p: Paint, now: number): void {
  g.save()
  if (p.glint) {
    // The exposed bonus container rocks a little on its bottom edge.
    const a = Math.sin(now * 0.006 + p.seed) * 0.035
    g.translate(b.x + b.w / 2, b.y + b.h)
    g.rotate(a)
    g.translate(-(b.x + b.w / 2), -(b.y + b.h))
  }
  const { x, y, w, h, dx, dy } = b
  // Top face, then the right side face, then the front.
  g.beginPath()
  g.moveTo(x, y)
  g.lineTo(x + dx, y - dy)
  g.lineTo(x + w + dx, y - dy)
  g.lineTo(x + w, y)
  g.closePath()
  g.fillStyle = shade(p.colour, 0.38)
  g.fill()
  g.beginPath()
  g.moveTo(x + w, y)
  g.lineTo(x + w + dx, y - dy)
  g.lineTo(x + w + dx, y + h - dy)
  g.lineTo(x + w, y + h)
  g.closePath()
  g.fillStyle = shade(p.colour, -0.28)
  g.fill()
  g.fillStyle = p.colour
  g.fillRect(x, y, w, h)
  // Corrugations: vertical ribs on the front and the side, and a darker frame rail top and bottom.
  g.lineWidth = 1
  g.strokeStyle = shade(p.colour, -0.14)
  g.beginPath()
  const ribs = Math.max(5, Math.round(w / 7))
  for (let i = 1; i < ribs; i++) {
    const rx = Math.round(x + (i * w) / ribs) + 0.5
    g.moveTo(rx, y + 3)
    g.lineTo(rx, y + h - 3)
  }
  g.stroke()
  g.strokeStyle = shade(p.colour, -0.42)
  g.beginPath()
  for (let i = 1; i < 4; i++) {
    const sx = x + w + (i * dx) / 4
    const sy = y - (i * dy) / 4
    g.moveTo(sx, sy + 2)
    g.lineTo(sx, sy + h - 2)
  }
  g.stroke()
  g.fillStyle = shade(p.colour, -0.2)
  g.fillRect(x, y, w, Math.max(2, h * 0.07))
  g.fillRect(x, y + h - Math.max(2, h * 0.07), w, Math.max(2, h * 0.07))
  if (p.glint) {
    const flash = Math.pow(0.5 + 0.5 * Math.sin(now * 0.004 + p.seed), 6)
    if (flash > 0.02) {
      g.fillStyle = `rgb(255 244 200 / ${Math.round(flash * 55)}%)`
      g.fillRect(x, y, w, h)
    }
  }
  // Outline over every face.
  g.lineJoin = 'round'
  g.lineWidth = 1.6
  g.strokeStyle = C.outline
  outline(g, b)
  g.stroke()
  g.beginPath()
  g.moveTo(x, y)
  g.lineTo(x + w, y)
  g.lineTo(x + w + dx, y - dy)
  g.moveTo(x + w, y)
  g.lineTo(x + w, y + h)
  g.stroke()
  // The big dark number on the front face.
  const size = Math.round(Math.min(h * 0.64, w * 0.5))
  g.fillStyle = C['number-ink']
  g.font = `900 ${size}px system-ui, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(p.label, x + w / 2, y + h / 2 + size * 0.04)
  if (p.bonus) {
    const r = Math.max(5, Math.min(h * 0.22, w * 0.15))
    medallion(g, x + r + 3, y + r + 3, r)
  }
  if (p.heavy) {
    const s = Math.max(9, Math.min(h * 0.36, w * 0.24))
    heavyTile(g, x + w - s - 3, y + h - s - 3, s)
  }
  if (p.urgent) {
    g.lineWidth = 3
    g.strokeStyle = C.urgent
    outline(g, b)
    g.stroke()
  }
  if (p.selected) {
    g.lineWidth = 3
    g.strokeStyle = C.rim
    outline(g, b)
    g.stroke()
  }
  g.restore()
}

/** A soft contact shadow on the ground under a box. */
function shadow(g: CanvasRenderingContext2D, b: Box, groundY: number, strength = 0.22): void {
  g.fillStyle = `rgb(20 30 36 / ${Math.round(strength * 100)}%)`
  g.beginPath()
  g.ellipse(b.x + (b.w + b.dx) / 2, groundY - b.dy * 0.4, (b.w + b.dx) * 0.55, Math.max(3, b.dy * 0.7), 0, 0, Math.PI * 2)
  g.fill()
}

function backdrop(g: CanvasRenderingContext2D, r: Rect, seed: number): void {
  const horizon = r.y + r.h * 0.42
  const sky = g.createLinearGradient(0, r.y, 0, horizon)
  sky.addColorStop(0, C['sky-top'])
  sky.addColorStop(1, C['sky-low'])
  g.fillStyle = sky
  g.fillRect(r.x, r.y, r.w, horizon - r.y)
  const water = g.createLinearGradient(0, horizon, 0, r.y + r.h)
  water.addColorStop(0, C.water)
  water.addColorStop(1, C['water-deep'])
  g.fillStyle = water
  g.fillRect(r.x, horizon, r.w, r.y + r.h - horizon)
  // Distant ship-to-shore cranes: an A-frame with a boom reaching over the water.
  g.strokeStyle = C.distant
  g.lineWidth = 2
  const craneH = (horizon - r.y) * 0.92
  for (let i = 0; i < 4; i++) {
    const cx = r.x + r.w * (0.12 + i * 0.26) + ((seed * 7 + i * 13) % 9)
    const top = horizon - craneH
    g.beginPath()
    g.moveTo(cx - 6, horizon)
    g.lineTo(cx - 2, top)
    g.moveTo(cx + 6, horizon)
    g.lineTo(cx + 2, top)
    g.moveTo(cx - 14, top + craneH * 0.25)
    g.lineTo(cx + 26, top + craneH * 0.25)
    g.moveTo(cx - 2, top)
    g.lineTo(cx + 24, top + craneH * 0.25)
    g.stroke()
  }
  // A ship at the berth, deck loaded with a row of small boxes.
  const shipW = r.w * 0.62
  const sx = r.x + r.w * 0.2
  const deck = horizon + (r.y + r.h - horizon) * 0.42
  const hullH = Math.max(6, (r.y + r.h - horizon) * 0.32)
  g.fillStyle = C.hull
  g.beginPath()
  g.moveTo(sx, deck)
  g.lineTo(sx + shipW, deck)
  g.lineTo(sx + shipW - hullH * 1.4, deck + hullH)
  g.lineTo(sx + hullH * 0.4, deck + hullH)
  g.closePath()
  g.fill()
  g.fillStyle = C['hull-stripe']
  g.fillRect(sx + hullH * 0.5, deck + hullH * 0.62, shipW - hullH * 2, Math.max(1.5, hullH * 0.12))
  const cw = Math.max(6, shipW / 14)
  const ch = Math.max(4, hullH * 0.7)
  const tones = [C['hull-stripe'], C['sky-low'], C.distant, C['cab-orange']]
  for (let i = 0; i < 11; i++) {
    g.fillStyle = tones[(i * 3 + seed) % tones.length]!
    g.fillRect(sx + cw * 1.2 + i * cw * 1.05, deck - ch, cw, ch)
  }
  g.fillStyle = C['sky-low']
  g.fillRect(sx + shipW * 0.06, deck - ch * 2.2, cw * 1.2, ch * 2.2)
  // The quay edge between water and yard.
  g.fillStyle = C.quay
  g.fillRect(r.x, r.y + r.h - 4, r.w, 4)
}

function floor(g: CanvasRenderingContext2D, geo: YardGeometry): void {
  const f = geo.floor
  const grad = g.createLinearGradient(0, f.y, 0, f.y + f.h)
  grad.addColorStop(0, C['concrete-dark'])
  grad.addColorStop(0.25, C.concrete)
  grad.addColorStop(1, C.concrete)
  g.fillStyle = grad
  g.fillRect(f.x, f.y, f.w, f.h)
  // Expansion joints in the concrete.
  g.strokeStyle = shade(C['concrete-dark'], -0.06)
  g.lineWidth = 1
  g.beginPath()
  for (let y = f.y + 18; y < f.y + f.h; y += 26) {
    g.moveTo(f.x, Math.round(y) + 0.5)
    g.lineTo(f.x + f.w, Math.round(y) + 0.5)
  }
  g.stroke()
}

function slots(g: CanvasRenderingContext2D, boxes: Box[]): void {
  g.save()
  g.setLineDash([4, 3])
  g.lineWidth = 1.2
  g.strokeStyle = C['slot-line']
  for (const b of boxes) {
    outline(g, b)
    g.stroke()
    g.beginPath()
    g.moveTo(b.x, b.y)
    g.lineTo(b.x + b.w, b.y)
    g.lineTo(b.x + b.w + b.dx, b.y - b.dy)
    g.stroke()
  }
  g.restore()
}

function ghost(g: CanvasRenderingContext2D, b: Box): void {
  g.save()
  g.globalAlpha = 0.45
  g.fillStyle = C.ghost
  outline(g, b)
  g.fill()
  g.globalAlpha = 1
  g.setLineDash([5, 3])
  g.lineWidth = 2
  g.strokeStyle = C.ghost
  g.stroke()
  g.restore()
}

function bay(g: CanvasRenderingContext2D, r: Rect, fill: string, line: string): void {
  g.fillStyle = fill
  g.beginPath()
  g.roundRect(r.x, r.y, r.w, r.h, 6)
  g.fill()
  g.save()
  g.setLineDash([6, 4])
  g.lineWidth = 1.5
  g.strokeStyle = line
  g.beginPath()
  g.roundRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6, 4)
  g.stroke()
  // Lane markings across the bay.
  g.globalAlpha = 0.35
  g.beginPath()
  const ly = Math.round(r.y + r.h * 0.42) + 0.5
  g.moveTo(r.x + 10, ly)
  g.lineTo(r.x + r.w - 10, ly)
  g.stroke()
  g.restore()
}

function truck(g: CanvasRenderingContext2D, t: Truck, cabColour: string): void {
  const { bed, cab, wheelR } = t
  g.fillStyle = C.chassis
  g.fillRect(bed.x, bed.y, bed.w, bed.h)
  g.fillRect(bed.x, bed.y + bed.h, cab.x - bed.x, Math.max(2, bed.h * 0.5))
  // Cab: body with a sloped windscreen and a glass window.
  g.fillStyle = cabColour
  g.strokeStyle = C.outline
  g.lineWidth = 1.5
  g.beginPath()
  g.moveTo(cab.x, cab.y + cab.h)
  g.lineTo(cab.x, cab.y)
  g.lineTo(cab.x + cab.w * 0.55, cab.y)
  g.lineTo(cab.x + cab.w, cab.y + cab.h * 0.5)
  g.lineTo(cab.x + cab.w, cab.y + cab.h)
  g.closePath()
  g.fill()
  g.stroke()
  g.fillStyle = C.glass
  g.beginPath()
  g.moveTo(cab.x + cab.w * 0.3, cab.y + cab.h * 0.14)
  g.lineTo(cab.x + cab.w * 0.55, cab.y + cab.h * 0.14)
  g.lineTo(cab.x + cab.w * 0.86, cab.y + cab.h * 0.48)
  g.lineTo(cab.x + cab.w * 0.3, cab.y + cab.h * 0.48)
  g.closePath()
  g.fill()
  for (const w of t.wheels) {
    g.fillStyle = C.wheel
    g.beginPath()
    g.arc(w.x, w.y, wheelR, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = C.distant
    g.beginPath()
    g.arc(w.x, w.y, wheelR * 0.4, 0, Math.PI * 2)
    g.fill()
  }
}

function gantryFrame(g: CanvasRenderingContext2D, geo: YardGeometry): void {
  const { left, right, legW, beamY, beamH, footY } = geo.gantry
  g.fillStyle = C.gantry
  g.strokeStyle = C['gantry-dark']
  g.lineWidth = 1.5
  for (const lx of [left, right - legW]) {
    g.fillRect(lx, beamY, legW, footY - beamY)
    g.strokeRect(lx + 0.5, beamY + 0.5, legW - 1, footY - beamY - 1)
    // Rungs and the rail bogie.
    g.beginPath()
    for (let y = beamY + beamH + 8; y < footY - 6; y += 9) {
      g.moveTo(lx + 2, y)
      g.lineTo(lx + legW - 2, y)
    }
    g.stroke()
    g.fillStyle = C.wheel
    g.beginPath()
    g.arc(lx + legW / 2 - 3, footY, 3, 0, Math.PI * 2)
    g.arc(lx + legW / 2 + 3, footY, 3, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = C.gantry
  }
  g.fillRect(left, beamY, right - left, beamH)
  g.strokeRect(left + 0.5, beamY + 0.5, right - left - 1, beamH - 1)
  // Truss zigzag along the beam.
  g.beginPath()
  const step = beamH * 1.4
  for (let x = left + 2, up = true; x < right - 2; x += step, up = !up) {
    g.lineTo(x, up ? beamY + 2 : beamY + beamH - 2)
  }
  g.stroke()
}

function trolley(g: CanvasRenderingContext2D, geo: YardGeometry, x: number, hookY: number): void {
  const { beamY, beamH } = geo.gantry
  const w = Math.max(22, geo.boxW * 0.55)
  const h = beamH + 6
  g.strokeStyle = C.cable
  g.lineWidth = 1.5
  g.beginPath()
  g.moveTo(x - w * 0.25, beamY + beamH)
  g.lineTo(x - w * 0.25, hookY)
  g.moveTo(x + w * 0.25, beamY + beamH)
  g.lineTo(x + w * 0.25, hookY)
  g.stroke()
  g.fillStyle = C.cable
  g.fillRect(x - w * 0.42, hookY - 3, w * 0.84, 3)
  g.fillStyle = C.trolley
  g.strokeStyle = C.outline
  g.beginPath()
  g.roundRect(x - w / 2, beamY - 3, w, h, 3)
  g.fill()
  g.stroke()
}

export function useYardCanvas(canvasRef: Ref<HTMLCanvasElement | null>, view: Ref<ViewModel>, move: Ref<CraneMove | null>) {
  /** Trolley x at rest: where the last move ended (null: over the yard centre). */
  let restX: number | null = null
  let layoutKey = ''
  let pending = 0

  function draw(now: number): boolean {
    const canvas = canvasRef.value
    const g = canvas?.getContext('2d')
    if (!canvas || !g) return false
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return false
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, width, height)
    const vm = view.value
    const { layout } = vm
    const key = `${width}x${height}x${layout.columns.length}x${vm.capacity}`
    if (key !== layoutKey) {
      layoutKey = key
      restX = null
    }
    const geo = yardGeometry(layout, vm.capacity)
    const m = move.value
    let animated = false

    backdrop(g, geo.backdrop, layout.columns.length)
    floor(g, geo)
    // Destination columns: a soft green floor tint under the ghost.
    layout.columns.forEach((col, i) => {
      if (vm.destinations.includes(i)) {
        g.fillStyle = 'rgb(95 240 176 / 16%)'
        g.fillRect(col.x + 2, geo.floor.y, col.w - 4, geo.groundY - geo.floor.y)
      }
      slots(g, slotsFor(geo, layout, i, vm.capacity))
    })
    // Yard captions over the quay edge.
    g.font = '800 11px system-ui, sans-serif'
    g.textBaseline = 'alphabetic'
    g.fillStyle = C.rim
    g.shadowColor = 'rgb(0 0 0 / 45%)'
    g.shadowBlur = 3
    g.textAlign = 'left'
    g.fillText('YARD 01', geo.backdrop.x + 8, geo.floor.y - 8)
    g.textAlign = 'right'
    const free = freeSlots(vm.capacity, layout.columns.length, vm.containers.length)
    g.fillText(`${free} FREE SLOT${free === 1 ? '' : 'S'}`, geo.backdrop.x + geo.backdrop.w - 8, geo.floor.y - 8)
    g.shadowBlur = 0

    // Bays and trucks.
    const urgentBay = vm.incoming.status === 'mandatory'
    bay(g, layout.collection, C['collection-bay'], C['collection-line'])
    bay(g, layout.receipt, urgentBay ? C['receipt-urgent'] : C['receipt-bay'], urgentBay ? C.urgent : C['receipt-line'])
    const collectTruck = truckIn(layout.collection, geo)
    const receiptTruck = truckIn(layout.receipt, geo)
    truck(g, collectTruck, C['cab-white'])
    if (vm.receiptCargo) truck(g, receiptTruck, C['cab-orange'])

    // Which container rides the crane: the top of its source stack, or the receipt cargo.
    const stackHeight = (i: number) => vm.containers.filter((c) => c.stack === i).length
    const moving: ContainerView | null =
      m && m.from !== RECEIPT_TRUCK
        ? (vm.containers.find((c) => c.stack === m.from && c.tier === stackHeight(m.from) - 1) ?? null)
        : null
    const movingCargo = m && m.from === RECEIPT_TRUCK ? vm.receiptCargo : null

    // Resting containers, left to right and bottom up (each side face stays inside its own column).
    layout.columns.forEach((_, i) => {
      if (stackHeight(i) > 0 && moving?.stack !== i) shadow(g, boxAt(geo, layout, i, 0), geo.groundY)
      else if (stackHeight(i) > 1) shadow(g, boxAt(geo, layout, i, 0), geo.groundY)
    })
    for (const c of vm.containers) {
      if (c === moving) continue
      const lift = c.selected && !m ? geo.lift : 0
      const s = shakeOffset(c.shake, now, c.id)
      if (c.shake > 0 || c.glint) animated = true
      container(g, moveBox(boxAt(geo, layout, c.stack, c.tier, lift), s.x, s.y), { ...c, seed: c.id }, now)
    }
    if (vm.receiptCargo && !movingCargo) {
      const c = vm.receiptCargo
      const s = shakeOffset(c.shake, now, c.id)
      if (c.shake > 0) animated = true
      const lift = c.selected ? geo.lift * 0.6 : 0
      container(g, moveBox(receiptTruck.cargo, s.x, s.y - lift), { ...c, colour: C['cab-orange'], seed: c.id }, now)
    }
    // Ghost drop slots on every legal destination.
    if (!m) for (const to of vm.destinations) ghost(g, boxAt(geo, layout, to, stackHeight(to)))

    gantryFrame(g, geo)

    // The crane: the trolley rests where the last move ended; a move animates hook and box.
    const yardMid = layout.yard.x + layout.yard.w / 2
    let hookX = restX ?? yardMid
    let hookY = geo.carryY - geo.dy
    if (m && (moving || movingCargo)) {
      const paint: Paint = moving
        ? { ...moving, selected: false, urgent: false, glint: false, seed: moving.id }
        : { ...movingCargo!, colour: C['cab-orange'], selected: false, urgent: false, seed: movingCargo!.id }
      const src = moving ? boxAt(geo, layout, m.from, moving.tier) : receiptTruck.cargo
      const dst = m.to >= 0 ? boxAt(geo, layout, m.to, stackHeight(m.to)) : collectTruck.cargo
      const p = cranePhase(m.progress)
      let box: Box
      if (p.leg === 'toSource') {
        hookX = lerp(restX ?? yardMid, centreX(src), p.t)
        box = src
      } else if (p.leg === 'release') {
        hookX = centreX(dst)
        box = dst
        hookY = lerp(dst.y - dst.dy, geo.carryY - geo.dy, p.lift)
      } else {
        const sized = lerpBox(src, dst, p.t)
        const low = p.t < 1 ? src.y : dst.y
        const y = lerp(low, geo.carryY, p.lift)
        hookX = centreX(sized)
        box = p.carrying ? { ...sized, y } : src
        hookY = p.carrying ? y - sized.dy : y - src.dy
      }
      if (p.carrying || p.leg === 'release') shadow(g, { ...box, y: geo.groundY - box.h }, geo.groundY, 0.12)
      container(g, box, paint, now)
      if (m.progress >= 0.999) restX = centreX(dst)
    }
    trolley(g, geo, hookX, hookY)
    return animated
  }

  function render(): void {
    if (pending) return
    const animated = draw(performance.now())
    // Keep drawing only while something shakes or glints and nothing else drives a render.
    if (animated) {
      pending = requestAnimationFrame(() => {
        pending = 0
        render()
      })
    }
  }

  onMounted(render)
  const stop = watch([view, move], () => {
    if (pending) {
      cancelAnimationFrame(pending)
      pending = 0
    }
    render()
  })

  onBeforeUnmount(() => {
    stop()
    if (pending) cancelAnimationFrame(pending)
    pending = 0
  })

  return { render }
}
