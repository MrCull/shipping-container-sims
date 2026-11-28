/**
 * Thin Canvas 2D renderer for the Yardshift yard (owner decision on spec #374: a flat illustrated look like the
 * reference prototype, not 3D; art pass 2: side-on 20 ft containers, illustrated trucks, a quiet backdrop and phone game
 * juice). Every shape comes from `modules/yardGeometry.ts`, which places it from the view-model's layout, so what is
 * drawn lines up with the hit regions; every effect comes from `modules/yardEffects.ts`, pure in time. This file only
 * paints: effects offset what is painted, never a hit region. The canvas backing store follows `devicePixelRatio` for
 * crisp lines. It renders when the view-model or the crane move changes, and keeps drawing frame by frame only while
 * something animates (vibration, glow, gold shine, an effect in flight).
 */
import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import type { ContainerView, HitTarget, Rect, ViewModel } from '../types/presentation'
import { RECEIPT_TRUCK, type CraneMove, type YardFxEvent } from '../store/yardshiftStore'
import {
  boxAt,
  chevronAt,
  freeSlots,
  numberSize,
  slotsFor,
  truckIn,
  type Box,
  type Truck,
  type YardGeometry,
  yardGeometry,
} from '../modules/yardGeometry'
import {
  burst,
  chevronBounce,
  collectMotion,
  type Fx,
  fxProgress,
  liveFx,
  nextBob,
  pulse,
  rejectX,
  shineAt,
  sparkles,
  squash,
  urgencyStyle,
  vibrateX,
} from '../modules/yardEffects'
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
  /** A bonus still worth its bonus: the static star badge. */
  bonus: boolean
  /** The active bonus (next, window open): gold body, halo, shine, sparkles (owner, art pass 3). */
  gold?: boolean
  /** The next container: a slightly brighter fill (the glow paints its outline). */
  next?: boolean
  heavy: boolean
  selected?: boolean
  /** Urgency outline: white, flashing red and white (owner round 5: never a plain red outline, red is a sequence colour). */
  red?: boolean
  /** A bold tag on the box (the receipt cargo's "IN"), so incoming cargo never reads as a sequence container. */
  tag?: string
  /** Soft glow of the calm current container (pulsing unless `still`). */
  glow?: boolean
  /** The active bonus moving: shine sweep, sparkles and bouncing star (never under reduced motion). */
  glint?: boolean
  /** The open bonus window on this container: its remaining fraction 0..1. */
  window?: number | null
  /** A missed bonus fading from gold, 0..1. */
  miss?: number | null
  /** On top of its stack (or on the truck): the star badge sits over the corner, else inside the side. */
  exposed?: boolean
  /** Squash on landing. */
  squash?: { sx: number; sy: number }
  /** Reduced motion: every cue static. */
  still?: boolean
  seed: number
}

/** The outline of a whole box (side, top and end), for the rim and the shadow. */
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

/** Clips to everything outside the box's silhouette (front, top and end faces). */
function clipOutside(g: CanvasRenderingContext2D, b: Box): void {
  const pad = 64
  g.beginPath()
  g.rect(b.x - pad, b.y - b.dy - pad, b.w + b.dx + 2 * pad, b.h + b.dy + 2 * pad)
  g.moveTo(b.x, b.y + b.h)
  g.lineTo(b.x, b.y)
  g.lineTo(b.x + b.dx, b.y - b.dy)
  g.lineTo(b.x + b.w + b.dx, b.y - b.dy)
  g.lineTo(b.x + b.w + b.dx, b.y + b.h - b.dy)
  g.lineTo(b.x + b.w, b.y + b.h)
  g.closePath()
  g.clip('evenodd')
}

function star(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, points = 5, inner = 0.45): void {
  g.beginPath()
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points
    const rr = i % 2 === 0 ? r : r * inner
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
  }
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
  star(g, cx, cy, r * 0.66, 5, 0.42)
  g.fillStyle = C['medal-star']
  g.fill()
}

function heavyTile(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.fillStyle = C['heavy-tile']
  g.beginPath()
  g.roundRect(x, y, s, s, s * 0.2)
  g.fill()
  g.lineWidth = 1.2
  g.strokeStyle = C.rim
  g.stroke()
  g.fillStyle = C.rim
  g.font = `900 ${Math.round(s * 0.74)}px system-ui, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('H', x + s / 2, y + s / 2 + 1)
}

/**
 * The faces of a container (owner, art pass 3: the v1 look): a flat front in its colour (slightly brighter when it is
 * next), one light top face, a darker end face, a few soft ribs, subtle door bars at the right end, thin rails and
 * corner castings. No gradients or busy texture, except on the active bonus's metallic gold.
 */
function containerSide(g: CanvasRenderingContext2D, b: Box, colour: string, gold: boolean, bright = false): void {
  const { x, y, w, h, dx, dy } = b
  const rail = Math.max(1.5, h * 0.06)
  const door = w * 0.16
  // `shade` reads a hex colour, so a brighter tone is one more step from the base colour, not a shade of a shade.
  const tone = (a: number) => shade(colour, bright ? (a >= 0 ? a + 0.14 * (1 - a) : a * 0.75 + 0.1) : a)
  const front = tone(0)
  // Top face, light.
  g.beginPath()
  g.moveTo(x, y)
  g.lineTo(x + dx, y - dy)
  g.lineTo(x + w + dx, y - dy)
  g.lineTo(x + w, y)
  g.closePath()
  g.fillStyle = gold ? C['gold-shine'] : tone(0.38)
  g.fill()
  // End face, darker.
  g.beginPath()
  g.moveTo(x + w, y)
  g.lineTo(x + w + dx, y - dy)
  g.lineTo(x + w + dx, y + h - dy)
  g.lineTo(x + w, y + h)
  g.closePath()
  g.fillStyle = gold ? C['gold-deep'] : tone(-0.3)
  g.fill()
  if (gold) {
    // Bright metallic gold (owner round 5: never brown): a light gold face with a white highlight band across its upper
    // third and a warm gold shade at the foot, distinct from every sequence colour.
    const body = g.createLinearGradient(0, y, 0, y + h)
    body.addColorStop(0, C['gold-body'])
    body.addColorStop(0.2, C['gold-body'])
    body.addColorStop(0.3, C['gold-shine'])
    body.addColorStop(0.4, C['gold-body'])
    body.addColorStop(0.75, C['gold-body'])
    body.addColorStop(1, C['gold-deep'])
    g.fillStyle = body
  } else g.fillStyle = front
  g.fillRect(x, y, w, h)
  // A few soft ribs across the front, short of the door end.
  const ribs = Math.max(3, Math.min(6, Math.round((w - door) / 11)))
  const step = (w - door) / (ribs + 1)
  g.fillStyle = gold ? 'rgb(214 150 20 / 30%)' : tone(-0.12)
  for (let i = 1; i <= ribs; i++) g.fillRect(Math.round(x + i * step), y + rail + 1, 1.5, h - 2 * rail - 2)
  // End face ribs, two of them.
  g.strokeStyle = gold ? 'rgb(255 255 255 / 45%)' : tone(-0.4)
  g.lineWidth = 1
  g.beginPath()
  for (const f of [0.33, 0.66]) {
    g.moveTo(x + w + dx * f, y - dy * f + rail)
    g.lineTo(x + w + dx * f, y + h - dy * f - rail)
  }
  g.stroke()
  // Door end: two subtle locking bars.
  const dxp = x + w - door
  g.strokeStyle = gold ? 'rgb(214 150 20 / 40%)' : tone(-0.2)
  g.lineWidth = 1.5
  g.beginPath()
  for (const f of [0.35, 0.72]) {
    const bx = Math.round(dxp + door * f) + 0.5
    g.moveTo(bx, y + rail + 2)
    g.lineTo(bx, y + h - rail - 2)
  }
  g.stroke()
  // Top and bottom rails.
  g.fillStyle = gold ? C['gold-deep'] : tone(-0.22)
  g.fillRect(x, y, w, rail)
  g.fillRect(x, y + h - rail, w, rail)
  // Four corner castings.
  const cs = Math.max(2, Math.min(5, h * 0.09))
  g.fillStyle = C.casting
  for (const [cx, cy] of [
    [x, y],
    [x + w - cs, y],
    [x, y + h - cs],
    [x + w - cs, y + h - cs],
  ] as const)
    g.fillRect(cx, cy, cs, cs)
}

/** One container: a side-on 20 ft box with its big number, badges and urgency cues. */
function container(g: CanvasRenderingContext2D, b: Box, p: Paint, now: number): void {
  g.save()
  if (p.squash && (p.squash.sx !== 1 || p.squash.sy !== 1)) {
    // Squash about the bottom centre, so the box stays on what it landed on.
    const cx = b.x + (b.w + b.dx) / 2
    g.translate(cx, b.y + b.h)
    g.scale(p.squash.sx, p.squash.sy)
    g.translate(-cx, -(b.y + b.h))
  }
  const { x, y, w, h } = b
  // A soft halo under the box: gold for the active bonus, white for the next container (pulsing unless still).
  const glowPulse = p.still ? 0.6 : pulse(now, 1000, p.seed)
  if (p.gold || p.glow) {
    g.save()
    g.shadowColor = p.gold ? 'rgb(255 190 60 / 95%)' : `rgb(255 255 255 / ${Math.round(55 + 40 * glowPulse)}%)`
    g.shadowBlur = p.gold ? 16 + 8 * glowPulse : 10 + 8 * glowPulse
    g.fillStyle = C.outline
    outline(g, b)
    g.fill()
    g.restore()
  }
  const gold = p.gold || (p.miss != null && p.miss < 1)
  containerSide(g, b, p.colour, false, p.next)
  if (gold) {
    // Gold over the box's own colour; a missed bonus fades it out.
    g.save()
    g.globalAlpha = p.gold ? 1 : 1 - (p.miss ?? 1)
    containerSide(g, b, p.colour, true)
    g.restore()
    // The sequence colour runs along the bottom rail, so the order still reads on gold.
    if (p.gold) {
      g.fillStyle = p.colour
      g.fillRect(x + w * 0.08, y + h - Math.max(2.5, h * 0.12), w * 0.66, Math.max(2.5, h * 0.12))
    }
  }
  if (p.gold && p.glint && !p.still) {
    // Shine sweep: a slanted light band crossing the box every 1.6 s.
    const s = shineAt(now, p.seed)
    if (s !== null) {
      // Clipped inside the front face's outline (owner round 4): the band never reaches the end face or past the box.
      g.save()
      g.beginPath()
      g.rect(x + 1, y + 1, w - 2, h - 2)
      g.clip()
      const sx = x - h + (w + 2 * h) * s
      const grad = g.createLinearGradient(sx - h * 0.6, 0, sx + h * 0.6, 0)
      grad.addColorStop(0, 'rgb(255 255 255 / 0%)')
      grad.addColorStop(0.5, 'rgb(255 255 255 / 75%)')
      grad.addColorStop(1, 'rgb(255 255 255 / 0%)')
      g.fillStyle = grad
      g.beginPath()
      g.moveTo(sx - h * 0.6, y + h)
      g.lineTo(sx, y)
      g.lineTo(sx + h * 0.6, y)
      g.lineTo(sx, y + h)
      g.closePath()
      g.fill()
      g.restore()
    }
  }
  // Outline over every face.
  g.lineJoin = 'round'
  g.lineWidth = 1.4
  g.strokeStyle = C.outline
  outline(g, b)
  g.stroke()
  g.beginPath()
  g.moveTo(x, y)
  g.lineTo(x + w, y)
  g.lineTo(x + w + b.dx, y - b.dy)
  g.moveTo(x + w, y)
  g.lineTo(x + w, y + h)
  g.stroke()
  // The big bold number on the front (58 % of the box height), with a light halo so it reads on every colour.
  const size = numberSize(b)
  const nx = x + (w * 0.84) / 2
  const ny = y + h / 2 + size * 0.06
  g.font = `900 ${size}px system-ui, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineWidth = Math.max(2, size * 0.12)
  g.strokeStyle = 'rgb(255 255 255 / 40%)'
  g.strokeText(p.label, nx, ny)
  g.fillStyle = C['number-ink']
  g.fillText(p.label, nx, ny)
  if (p.heavy) {
    const s = Math.max(9, Math.min(h * 0.5, w * 0.18))
    heavyTile(g, x + w * 0.84 - s - 2, y + h - s - 3, s)
  }
  if (p.gold) {
    // Sparkles on the gold (fast: the bonus window is open).
    if (p.glint && !p.still) {
      g.fillStyle = C['gold-shine']
      for (const sp of sparkles(now, p.seed, p.window != null).slice(0, 3)) {
        if (sp.s < 0.05) continue
        // Only at the box ends, never over the number in the middle.
        const u = sp.u < 0.5 ? 0.04 + sp.u * 0.32 : 0.64 + (sp.u - 0.5) * 0.32
        star(g, x + w * u, y + h * (0.15 + sp.v * 0.7), 2.5 + 5 * sp.s, 4, 0.28)
        g.fill()
      }
    }
    // The star badge goes on the top-left corner casting in a second pass (`badge`), over every box.
  }
  if (p.glow && !p.red && !p.selected) {
    // The next container: a thick bright white outline with a soft outer glow that breathes (static when still).
    // Clipped to outside the box (owner round 4), so the glow never washes a pale band over the dark end face.
    g.save()
    clipOutside(g, b)
    g.shadowColor = `rgb(255 255 255 / ${Math.round(60 + 35 * glowPulse)}%)`
    g.shadowBlur = 6 + 6 * glowPulse
    g.lineWidth = 6
    g.strokeStyle = C.rim
    outline(g, b)
    g.stroke()
    g.restore()
  }
  if (p.tag) {
    // The receipt cargo's bold tag astride the top right edge (clear of the number and the top-left star badge): a
    // dark plate with white letters.
    const th = Math.max(10, Math.round(h * 0.28))
    g.font = `900 ${Math.round(th * 0.78)}px system-ui, sans-serif`
    const tw = g.measureText(p.tag).width + th * 0.6
    const tx = x + w + b.dx * 0.5 - tw
    const ty = y - b.dy * 0.5 - th / 2
    g.fillStyle = C.outline
    g.strokeStyle = C.rim
    g.lineWidth = 1.2
    g.beginPath()
    g.roundRect(tx, ty, tw, th, 3)
    g.fill()
    g.stroke()
    g.fillStyle = C.rim
    g.textAlign = 'left'
    g.textBaseline = 'middle'
    g.fillText(p.tag, tx + th * 0.3, ty + th / 2 + 0.5)
  }
  if (p.red) {
    // A thick white outline with a red one flashing over it; under reduced motion a static white outline with a red
    // inner line.
    g.lineWidth = p.next ? 4 : 3.5
    g.strokeStyle = C.rim
    outline(g, b)
    g.stroke()
    const flash = p.still ? 1 : pulse(now, 360, p.seed) > 0.5 ? 1 : 0
    if (flash > 0) {
      g.lineWidth = p.still ? 1.5 : p.next ? 4 : 3.5
      g.strokeStyle = C.urgent
      outline(g, b)
      g.stroke()
    }
  }
  if (p.selected) {
    g.lineWidth = 3
    g.strokeStyle = C.rim
    outline(g, b)
    g.stroke()
  }
  g.restore()
}

/**
 * The bonus star badge on a box's top-left corner casting, clear of the number: it bounces when the box is exposed and
 * gets the bonus window's countdown ring while that window is open.
 */
function badge(g: CanvasRenderingContext2D, b: Box, p: Paint, now: number): void {
  const r = Math.max(6, Math.min(b.h * 0.27, 10))
  // Static until it is the active bonus (owner, art pass 3): only then does the badge bounce.
  const bounce = p.gold && p.glint && !p.still ? -2.5 * Math.abs(Math.sin(now * 0.005 + p.seed)) : 0
  // Over the top-left corner, kept inside its own column (art pass 3), clear of the number.
  const bx = b.x + r * 0.55
  const by = b.y - b.dy * 0.5 - 1 + bounce
  medallion(g, bx, by, r)
  if (p.gold && p.window != null) {
    g.lineCap = 'round'
    g.lineWidth = 3
    g.strokeStyle = 'rgb(255 255 255 / 45%)'
    g.beginPath()
    g.arc(bx, by, r + 3.5, 0, Math.PI * 2)
    g.stroke()
    g.strokeStyle = C['gold-shine']
    g.beginPath()
    g.arc(bx, by, r + 3.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, p.window)))
    g.stroke()
    g.lineCap = 'butt'
  }
}

/** The NEXT chevron: a bold down-pointing arrow, white with a dark outline and a soft glow, striped in `tint`. */
function chevron(g: CanvasRenderingContext2D, r: Rect, tint: string): void {
  const { x, y, w, h } = r
  const t = Math.max(3, h * 0.38)
  g.save()
  g.beginPath()
  g.moveTo(x, y)
  g.lineTo(x + w / 2, y + h - t)
  g.lineTo(x + w, y)
  g.lineTo(x + w, y + t)
  g.lineTo(x + w / 2, y + h)
  g.lineTo(x, y + t)
  g.closePath()
  g.shadowColor = 'rgb(255 255 255 / 70%)'
  g.shadowBlur = 6
  g.fillStyle = C.rim
  g.fill()
  g.shadowBlur = 0
  g.lineJoin = 'round'
  g.lineWidth = 1.6
  g.strokeStyle = C.outline
  g.stroke()
  // A stripe of the next container's colour along the chevron, so it matches its box.
  g.beginPath()
  g.moveTo(x + w * 0.16, y + t * 0.5)
  g.lineTo(x + w / 2, y + h - t * 0.5)
  g.lineTo(x + w * 0.84, y + t * 0.5)
  g.lineWidth = Math.max(1.5, t * 0.4)
  g.lineJoin = 'miter'
  g.strokeStyle = tint
  g.stroke()
  g.restore()
}

/** A soft contact shadow on the ground under a box. */
function shadow(g: CanvasRenderingContext2D, b: Box, groundY: number, strength = 0.22): void {
  g.fillStyle = `rgb(20 30 36 / ${Math.round(strength * 100)}%)`
  g.beginPath()
  g.ellipse(b.x + (b.w + b.dx) / 2, groundY - 1, (b.w + b.dx) * 0.55, Math.max(2.5, b.h * 0.14), 0, 0, Math.PI * 2)
  g.fill()
}

/** A puff of dust at the feet of a landed box. */
function dust(g: CanvasRenderingContext2D, b: Box, t: number): void {
  g.fillStyle = `rgb(239 231 214 / ${Math.round((1 - t) * 80)}%)`
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const ox = side * (b.w * 0.45 + t * (10 + i * 6))
      g.beginPath()
      g.arc(b.x + b.w / 2 + ox, b.y + b.h - 2 - i * 2 - t * 4, 2 + t * (3 + i), 0, Math.PI * 2)
      g.fill()
    }
  }
}

/** A grey poof where a missed bonus lost its gold. */
function poof(g: CanvasRenderingContext2D, b: Box, t: number): void {
  g.fillStyle = `rgb(239 231 214 / ${Math.round((1 - t) * 85)}%)`
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    g.beginPath()
    g.arc(b.x + 8 + Math.cos(a) * t * 12, b.y - 2 + Math.sin(a) * t * 9, 3 + t * 5, 0, Math.PI * 2)
    g.fill()
  }
}

/**
 * The road strip over the yard (owner round 5: trucks above the yard): asphalt from the beam down to the yard, kerbs
 * top and bottom, and a dashed lane line along the trucks' wheels and down the middle of any road above the bays, so
 * the bays read as parking stalls on a road.
 */
function road(g: CanvasRenderingContext2D, r: Rect, top: number, lanes: number[]): void {
  g.fillStyle = C.road
  g.fillRect(r.x, top, r.w, r.y + r.h - top)
  g.fillStyle = C.kerb
  g.fillRect(r.x, top, r.w, 3)
  g.fillRect(r.x, r.y + r.h - 3, r.w, 3)
  g.save()
  g.setLineDash([14, 10])
  g.lineWidth = 2
  g.strokeStyle = C['road-line']
  g.beginPath()
  for (const y of lanes) {
    g.moveTo(r.x, Math.round(y) + 0.5)
    g.lineTo(r.x + r.w, Math.round(y) + 0.5)
  }
  g.stroke()
  g.restore()
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
  g.lineWidth = 1.1
  g.strokeStyle = C['slot-line']
  for (const b of boxes) {
    outline(g, b)
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

/** A truck bay: painted floor, dashed edge, a lane line and the painted parking stall where a truck stands. */
function bay(g: CanvasRenderingContext2D, r: Rect, fill: string, line: string, stall: Rect): void {
  // Painted over the road, so a little of the asphalt shows through.
  g.save()
  g.globalAlpha = 0.82
  g.fillStyle = fill
  g.beginPath()
  g.roundRect(r.x, r.y, r.w, r.h, 6)
  g.fill()
  g.restore()
  g.save()
  g.setLineDash([6, 4])
  g.lineWidth = 1.5
  g.strokeStyle = line
  g.beginPath()
  g.roundRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6, 4)
  g.stroke()
  g.setLineDash([])
  // The stall: painted corner marks and a stop line, so an empty bay still reads as a truck bay.
  g.globalAlpha = 0.55
  g.lineWidth = 2
  const m = 8
  g.beginPath()
  for (const [cx, cy, sx, sy] of [
    [stall.x, stall.y, 1, 1],
    [stall.x + stall.w, stall.y, -1, 1],
    [stall.x, stall.y + stall.h, 1, -1],
    [stall.x + stall.w, stall.y + stall.h, -1, -1],
  ] as const) {
    g.moveTo(cx + sx * m, cy)
    g.lineTo(cx, cy)
    g.lineTo(cx, cy + sy * m)
  }
  g.stroke()
  g.restore()
}

function wheel(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.fillStyle = C.wheel
  g.beginPath()
  g.arc(x, y, r, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = C.hub
  g.beginPath()
  g.arc(x, y, r * 0.5, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = C.chassis
  g.beginPath()
  g.arc(x, y, r * 0.18, 0, Math.PI * 2)
  g.fill()
}

/**
 * An illustrated side-view truck, drawn facing right (a left-facing truck is the same drawing mirrored about its bay):
 * cab with a rounded roof, windscreen and side window, grille, headlight, bumper, exhaust stack and mudguards; a
 * skeletal trailer with twist-lock posts; two trailer axles and the cab axle; a soft shadow on the road.
 */
function truck(g: CanvasRenderingContext2D, t: Truck, cabColour: string, stripe: string): void {
  const { cab, trailer, wheelR } = t
  // Shadow on the road.
  g.fillStyle = 'rgb(10 16 20 / 28%)'
  g.beginPath()
  g.ellipse(trailer.x + (cab.x + cab.w - trailer.x) / 2, t.groundY, (cab.x + cab.w - trailer.x) / 2 + 4, Math.max(2.5, wheelR * 0.45), 0, 0, Math.PI * 2)
  g.fill()
  // Trailer: a beam with a gooseneck up to the fifth wheel, cross members and twist-lock posts at each end.
  g.fillStyle = C.chassis
  g.fillRect(trailer.x, trailer.y, trailer.w, trailer.h)
  g.fillRect(trailer.x + trailer.w - 2, trailer.y + trailer.h * 0.3, cab.x - trailer.x - trailer.w + cab.w * 0.5, trailer.h * 0.9)
  // A lighter top flange and dark cross members make the beam read as a heavy steel chassis.
  g.fillStyle = C['heavy-tile']
  g.fillRect(trailer.x, trailer.y, trailer.w, Math.max(1.5, trailer.h * 0.3))
  g.fillStyle = C.chassis
  for (let cx = trailer.x + 6; cx < trailer.x + trailer.w - 6; cx += Math.max(10, trailer.w / 7)) {
    g.fillRect(cx, trailer.y + trailer.h, 2, trailer.h * 0.6)
  }
  // Twist-lock posts at each end, bright so they read against the deck.
  const post = Math.max(3, trailer.h * 0.8)
  g.fillStyle = C.trolley
  g.strokeStyle = C.outline
  g.lineWidth = 1
  for (const px of [trailer.x + 1, trailer.x + trailer.w - 1 - post]) {
    g.fillRect(px, trailer.y - post, post, post)
    g.strokeRect(px + 0.5, trailer.y - post + 0.5, post - 1, post - 1)
  }
  // Mudguards over the trailer wheels.
  const rearWheels = t.wheels.slice(1)
  g.fillStyle = C.chassis
  const mx = Math.min(...rearWheels.map((w) => w.x)) - wheelR * 1.2
  const mw = Math.max(...rearWheels.map((w) => w.x)) - mx + wheelR * 1.2
  g.beginPath()
  g.roundRect(mx, trailer.y + trailer.h, mw, wheelR * 0.5, [wheelR * 0.5, wheelR * 0.5, 0, 0])
  g.fill()
  // Cab body: square back, rounded roof over the front, a short bonnet line.
  const { x, y, w, h } = cab
  const roofR = Math.min(w * 0.35, h * 0.35)
  // Exhaust stack behind the cab.
  g.fillStyle = C.hub
  g.fillRect(x - 3, y - h * 0.12, 2.5, h * 0.7)
  g.fillStyle = cabColour
  g.strokeStyle = C.outline
  g.lineWidth = 1.4
  g.beginPath()
  g.moveTo(x, y + h)
  g.lineTo(x, y + roofR * 0.3)
  g.quadraticCurveTo(x, y, x + roofR * 0.3, y)
  g.lineTo(x + w - roofR, y)
  g.quadraticCurveTo(x + w, y, x + w, y + roofR)
  g.lineTo(x + w, y + h)
  g.closePath()
  g.fill()
  g.stroke()
  // Livery stripe along the cab.
  g.fillStyle = stripe
  g.fillRect(x + 1, y + h * 0.62, w - 2, Math.max(2, h * 0.08))
  // Side window and windscreen.
  g.fillStyle = C.glass
  g.beginPath()
  g.roundRect(x + w * 0.18, y + h * 0.14, w * 0.36, h * 0.3, 2)
  g.fill()
  g.beginPath()
  g.moveTo(x + w * 0.62, y + h * 0.14)
  g.lineTo(x + w - roofR * 0.6, y + h * 0.14)
  g.quadraticCurveTo(x + w - 2, y + h * 0.16, x + w - 2, y + h * 0.36)
  g.lineTo(x + w - 2, y + h * 0.44)
  g.lineTo(x + w * 0.62, y + h * 0.44)
  g.closePath()
  g.fill()
  g.fillStyle = 'rgb(255 255 255 / 45%)'
  g.fillRect(x + w * 0.66, y + h * 0.17, w * 0.06, h * 0.22)
  // Door handle and the grille, headlight and bumper at the front.
  g.fillStyle = C.outline
  g.fillRect(x + w * 0.42, y + h * 0.52, w * 0.1, 1.5)
  g.fillStyle = C.chassis
  g.fillRect(x + w - 3.5, y + h * 0.5, 3.5, h * 0.3)
  g.fillStyle = C.headlight
  g.beginPath()
  g.roundRect(x + w - 4, y + h * 0.7, 4, Math.max(2, h * 0.08), 1)
  g.fill()
  g.fillStyle = C.chassis
  g.fillRect(x + w - 2, y + h * 0.86, 4, h * 0.14)
  // Cab mudguard.
  const cw = t.wheels[0]!
  g.beginPath()
  g.arc(cw.x, cw.y, wheelR * 1.3, Math.PI, 0)
  g.fillStyle = C.chassis
  g.fill()
  for (const wh of t.wheels) wheel(g, wh.x, wh.y, wheelR)
}

/** Draw a truck facing `t.facing`: mirrored about the bay centre for a left-facing one. */
function truckFacing(g: CanvasRenderingContext2D, bayRect: Rect, geo: YardGeometry, facing: 'left' | 'right', cab: string, stripe: string): void {
  g.save()
  if (facing === 'left') {
    const cx = bayRect.x + bayRect.w / 2
    g.translate(cx, 0)
    g.scale(-1, 1)
    g.translate(-cx, 0)
  }
  truck(g, truckIn(bayRect, geo, 'right'), cab, stripe)
  g.restore()
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

/** The trolley on the beam, its hoist cables, and the spreader that grabs a box at `hookY` (the box's top face). */
function trolley(g: CanvasRenderingContext2D, geo: YardGeometry, x: number, hookY: number, gripping: boolean): void {
  const { beamY, beamH } = geo.gantry
  const tw = Math.max(22, geo.boxW * 0.5)
  const sw = geo.boxW + geo.dx
  g.strokeStyle = C.cable
  g.lineWidth = 1.2
  g.beginPath()
  for (const f of [-0.3, -0.1, 0.1, 0.3]) {
    g.moveTo(x + tw * f, beamY + beamH)
    g.lineTo(x + sw * f * 1.2, hookY - 5)
  }
  g.stroke()
  // Spreader: a frame as long as the box, with twist-lock legs that drop onto the corner castings when it grips.
  g.fillStyle = C.trolley
  g.strokeStyle = C.outline
  g.lineWidth = 1.2
  g.beginPath()
  g.roundRect(x - sw / 2, hookY - 5, sw, 4, 1.5)
  g.fill()
  g.stroke()
  g.fillStyle = C.outline
  const leg = gripping ? 4 : 2
  for (const f of [-0.5, 0.5]) g.fillRect(x + sw * f - (f < 0 ? 0 : 3), hookY - 1, 3, leg)
  // Trolley on the beam.
  g.fillStyle = C.trolley
  g.beginPath()
  g.roundRect(x - tw / 2, beamY - 3, tw, beamH + 6, 3)
  g.fill()
  g.stroke()
}

export interface YardCanvasOptions {
  /** Reduced motion: every cue static, no effects. */
  reducedMotion?: () => boolean
  /** Subscribe to engine events and refused moves (the store's `onYardEvent`); returns an unsubscribe function. */
  subscribe?: (listener: (e: YardFxEvent) => void) => () => void
}

export function useYardCanvas(
  canvasRef: Ref<HTMLCanvasElement | null>,
  view: Ref<ViewModel>,
  move: Ref<CraneMove | null>,
  options: YardCanvasOptions = {},
) {
  /** Trolley x at rest: where the last move ended (null: over the yard centre). */
  let restX: number | null = null
  let layoutKey = ''
  let pending = 0
  /** Effects in flight. */
  let fx: Fx[] = []
  /** What the crane carried on the last frame of a move, for the landing and the collection truck's drive-off. */
  let carried: { label: string; colour: string; bonus: boolean } | null = null
  const still = () => options.reducedMotion?.() ?? false

  function addFx(e: Fx): void {
    if (still()) return
    fx = [...liveFx(fx, e.at), e]
  }

  /** Effects for the event types it knows; any other type (UI sound events and future ones) only redraws. */
  function onYardEvent(e: YardFxEvent): void {
    const now = performance.now()
    if (e.type === 'bonus-awarded') addFx({ kind: 'bonus', at: now })
    else if (e.type === 'bonus-missed') addFx({ kind: 'bonus-miss', at: now, id: e.id })
    else if (e.type === 'rejected') {
      const a = e.action
      const target: HitTarget | null =
        a.type === 'receive'
          ? { kind: 'receipt' }
          : a.type === 'rehandle'
            ? { kind: 'stack', index: a.from }
            : a.type === 'collect' && a.from !== undefined
              ? { kind: 'stack', index: a.from }
              : null
      if (target) addFx({ kind: 'reject', at: now, target })
    }
    render()
  }

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
    const reduced = still()
    fx = liveFx(fx, now)
    let animated = fx.length > 0

    const collectTruck = truckIn(layout.collection, geo, 'left')
    const receiptTruck = truckIn(layout.receipt, geo, 'right')
    // Lane lines: the trucks' kerb lane, and the middle of any road above the bays.
    const above = layout.collection.y - geo.road.y
    road(g, geo.road, geo.gantry.beamY, above > 30 ? [geo.road.y + above / 2, layout.collection.y + layout.collection.h - 3] : [layout.collection.y + layout.collection.h - 3])
    floor(g, geo)
    // Destination columns: a soft green floor tint under the ghost.
    layout.columns.forEach((col, i) => {
      if (vm.destinations.includes(i)) {
        g.fillStyle = 'rgb(95 240 176 / 16%)'
        g.fillRect(col.x + 2, geo.floor.y, col.w - 4, geo.groundY - geo.floor.y)
      }
      slots(g, slotsFor(geo, layout, i, vm.capacity))
    })
    // Yard captions along the top of the concrete, in the caption room over the crane headroom.
    g.font = '800 11px system-ui, sans-serif'
    g.textBaseline = 'alphabetic'
    g.fillStyle = C['yard-text']
    g.textAlign = 'left'
    g.fillText('YARD 01', geo.floor.x + 8, geo.floor.y + 13)
    g.textAlign = 'right'
    const free = freeSlots(vm.capacity, layout.columns.length, vm.containers.length)
    g.fillText(`${free} FREE SLOT${free === 1 ? '' : 'S'}`, geo.floor.x + geo.floor.w - 8, geo.floor.y + 13)

    // Bays and trucks.
    const urgentBay = vm.incoming.status === 'mandatory'
    const stall = (t: Truck): Rect => ({ x: Math.min(t.cab.x, t.trailer.x) - 4, y: t.cab.y - 4, w: t.cab.w + t.trailer.w + 11, h: t.groundY - t.cab.y + 6 })
    bay(g, layout.collection, C['collection-bay'], C['collection-line'], stall(collectTruck))
    bay(g, layout.receipt, urgentBay ? C['receipt-urgent'] : C['receipt-bay'], urgentBay ? C.urgent : C['receipt-line'], stall(receiptTruck))
    // The collection truck: bounces when it takes a box, drives off with it and comes back empty.
    const collecting = fx.find((f): f is Extract<Fx, { kind: 'collect' }> => f.kind === 'collect')
    // It drives off left along the road strip, out past the road's edge, and comes back empty into its bay from the
    // right; clipped to the road up to the bay's right edge, so it never shows over the receipt bay.
    const roadLeft = { x: geo.road.x, y: geo.road.y, w: layout.collection.x + layout.collection.w - geo.road.x, h: geo.road.h }
    const motion = collecting ? collectMotion(fxProgress(collecting, now), roadLeft.w) : { x: 0, y: 0, carrying: false }
    g.save()
    g.beginPath()
    g.rect(roadLeft.x, roadLeft.y, roadLeft.w, roadLeft.h)
    g.clip()
    g.translate(motion.x, motion.y)
    truckFacing(g, layout.collection, geo, 'left', C['cab-white'], C['cab-teal'])
    if (collecting && motion.carrying) {
      const paint: Paint = { ...collecting, gold: collecting.bonus, heavy: false, exposed: true, seed: 1 }
      container(g, collectTruck.cargo, paint, now)
      if (paint.bonus) badge(g, collectTruck.cargo, paint, now)
    }
    g.restore()
    if (vm.receiptCargo) truckFacing(g, layout.receipt, geo, 'right', C['cab-steel'], C['gantry-dark'])

    // Which container rides the crane: the top of its source stack, or the receipt cargo.
    const stackHeight = (i: number) => vm.containers.filter((c) => c.stack === i).length
    const moving: ContainerView | null =
      m && m.from !== RECEIPT_TRUCK
        ? (vm.containers.find((c) => c.stack === m.from && c.tier === stackHeight(m.from) - 1) ?? null)
        : null
    const movingCargo = m && m.from === RECEIPT_TRUCK ? vm.receiptCargo : null

    // Effects keyed to a target: the landing squash on a stack top, the reject shake, the missed-bonus fade.
    const fxFor = (target: HitTarget, kind: 'land' | 'reject') =>
      fx.find((f) => f.kind === kind && f.target.kind === target.kind && (target.kind !== 'stack' || (f.target.kind === 'stack' && f.target.index === target.index)))
    const missFor = (id: number) => fx.find((f): f is Extract<Fx, { kind: 'bonus-miss' }> => f.kind === 'bonus-miss' && f.id === id)
    const windowFor = (id: number) => (vm.bonus && vm.bonus.id === id ? vm.bonus.fraction : null)

    /** Paint and offset of a resting container from its urgency, effects and the bonus window. */
    function dressed(c: { id: number; shake: number; urgent: boolean }, current: boolean, target: HitTarget, top: boolean) {
      const u = urgencyStyle(c, current, reduced)
      const reject = top ? fxFor(target, 'reject') : undefined
      const land = top ? fxFor(target, 'land') : undefined
      const miss = missFor(c.id)
      const rt = reject ? fxProgress(reject, now) : 0
      if (u.vibrate > 0 || (u.glow && !reduced) || (u.red && !reduced)) animated = true
      return {
        dx: vibrateX(u.vibrate, now, c.id) + rejectX(rt),
        paint: {
          red: u.red || (reject !== undefined && rt < 1),
          glow: u.glow,
          window: windowFor(c.id),
          miss: miss ? fxProgress(miss, now) : null,
          squash: land ? squash(fxProgress(land, now)) : undefined,
          still: reduced,
        },
        land,
        miss,
      }
    }

    // Resting containers, left to right and bottom up.
    layout.columns.forEach((_, i) => {
      if (stackHeight(i) > 0 && moving?.stack !== i) shadow(g, boxAt(geo, layout, i, 0), geo.groundY)
      else if (stackHeight(i) > 1) shadow(g, boxAt(geo, layout, i, 0), geo.groundY)
    })
    const badges: { b: Box; p: Paint }[] = []
    for (const c of vm.containers) {
      if (c === moving) continue
      const lift = c.selected && !m ? geo.lift : 0
      const top = c.tier === stackHeight(c.stack) - 1
      const d = dressed(c, c.next, { kind: 'stack', index: c.stack }, top)
      if (c.glint) animated = true
      // The next container bobs gently (paint only; its hit region is the column).
      const bob = c.next && !c.selected ? nextBob(now, reduced) : 0
      if (c.next && !reduced) animated = true
      const b = moveBox(boxAt(geo, layout, c.stack, c.tier, lift), d.dx, bob)
      const paint: Paint = { ...c, ...d.paint, gold: c.bonusActive, exposed: top, seed: c.id }
      container(g, b, paint, now)
      if (c.bonus) badges.push({ b, p: paint })
      if (d.land) dust(g, b, fxProgress(d.land, now))
      if (d.miss) poof(g, b, fxProgress(d.miss, now))
    }
    if (vm.receiptCargo && !movingCargo) {
      const c = vm.receiptCargo
      const d = dressed(c, c.shake > 0 || c.urgent, { kind: 'receipt' }, true)
      const lift = c.selected ? geo.lift * 0.6 : 0
      const b = moveBox(receiptTruck.cargo, d.dx, -lift)
      const paint: Paint = { ...c, ...d.paint, colour: C['receipt-cargo'], tag: 'IN', exposed: true, seed: c.id }
      container(g, b, paint, now)
      if (c.bonus) badges.push({ b, p: paint })
      if (d.miss) poof(g, b, fxProgress(d.miss, now))
    }
    for (const { b, p } of badges) badge(g, b, p, now)
    // Ghost drop slots on every legal destination.
    if (!m) for (const to of vm.destinations) ghost(g, boxAt(geo, layout, to, stackHeight(to)))

    gantryFrame(g, geo)

    // The crane: the trolley rests where the last move ended; a move animates hook, spreader and box.
    const yardMid = layout.yard.x + layout.yard.w / 2
    let hookX = restX ?? yardMid
    let hookY = geo.carryY - geo.dy
    let gripping = false
    if (m && (moving || movingCargo)) {
      const paint: Paint = moving
        ? { ...moving, gold: moving.bonusActive, selected: false, glint: false, exposed: true, seed: moving.id }
        : { ...movingCargo!, colour: C['receipt-cargo'], tag: 'IN', selected: false, exposed: true, seed: movingCargo!.id }
      carried = { label: paint.label, colour: paint.colour, bonus: paint.gold ?? false }
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
        gripping = p.carrying
      }
      if (p.carrying || p.leg === 'release') shadow(g, { ...box, y: geo.groundY - box.h }, geo.groundY, 0.12)
      container(g, box, paint, now)
      if (paint.bonus) badge(g, box, paint, now)
      if (m.progress >= 0.999) restX = centreX(dst)
    }
    trolley(g, geo, hookX, hookY, gripping)

    // The bouncing NEXT chevron over the next container's stack (static under reduced motion), hidden while the crane
    // works that stack.
    if (vm.nextMarker && !(m && (m.from === vm.nextMarker.stack || m.to === vm.nextMarker.stack))) {
      const r = chevronAt(geo, layout, vm.nextMarker.stack, stackHeight(vm.nextMarker.stack))
      chevron(g, { ...r, y: r.y + chevronBounce(now, reduced) }, vm.containers.find((c) => c.next)?.colour ?? C.rim)
      if (!reduced) animated = true
    }

    // The bonus collect: gold flash over the collection bay and a coin and star burst from the truck.
    for (const f of fx) {
      if (f.kind !== 'bonus') continue
      const t = fxProgress(f, now)
      const ox = centreX(collectTruck.cargo)
      const oy = collectTruck.cargo.y
      g.fillStyle = `rgb(255 218 117 / ${Math.round(Math.max(0, 1 - t * 2.5) * 40)}%)`
      g.fillRect(layout.collection.x, layout.collection.y, layout.collection.w, layout.collection.h)
      for (const p of burst(t, 16, Math.min(80, layout.collection.w * 0.45))) {
        g.globalAlpha = p.alpha
        if (p.star) {
          g.fillStyle = C['gold-shine']
          star(g, ox + p.x, oy + p.y, p.r * 1.6)
          g.fill()
        } else {
          g.fillStyle = C['gold-body']
          g.strokeStyle = C['gold-deep']
          g.lineWidth = 1
          g.beginPath()
          g.ellipse(ox + p.x, oy + p.y, p.r, p.r * (0.5 + 0.5 * Math.abs(Math.cos(t * 12 + p.x))), 0, 0, Math.PI * 2)
          g.fill()
          g.stroke()
        }
      }
      g.globalAlpha = 1
    }
    return animated
  }

  function render(): void {
    if (pending) return
    const animated = draw(performance.now())
    // Keep drawing only while something animates and nothing else drives a render.
    if (animated) {
      pending = requestAnimationFrame(() => {
        pending = 0
        render()
      })
    }
  }

  onMounted(render)
  const stop = watch([view, move], ([, m], [, prev]) => {
    // A crane move ended: the box lands (squash and dust), or the collection truck takes it away.
    if (prev && !m && carried) {
      const now = performance.now()
      if (prev.to >= 0) addFx({ kind: 'land', at: now, target: { kind: 'stack', index: prev.to } })
      else addFx({ kind: 'collect', at: now, ...carried })
      carried = null
    }
    if (pending) {
      cancelAnimationFrame(pending)
      pending = 0
    }
    render()
  })
  const unsubscribe = options.subscribe?.(onYardEvent)

  onBeforeUnmount(() => {
    stop()
    unsubscribe?.()
    if (pending) cancelAnimationFrame(pending)
    pending = 0
  })

  return { render }
}
