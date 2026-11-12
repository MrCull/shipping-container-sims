/**
 * Close-up container textures (#119, #143): paints one box's `ContainerMarkings` onto a canvas laid out as
 * `TEXTURE_LAYOUT` (closeupGeometry.ts), plus the two maps every close-up box shares: a corrugation normal map and
 * a roughness map (wear). Needs a DOM canvas, so it is exercised by the browser smoke specs, not Vitest.
 *
 * Faces are painted in metres (the canvas context is scaled per region), so print sizes are real: the box number is
 * about 0.25 m high, the plate text about 0.07 m. Roofs get dust and wear only, no text (#170).
 */
import * as THREE from 'three'
import type { ContainerSize } from '../scenario/types'
import type { ContainerMarkings, WeightPlate } from './containerMarkings'
import { CORRUGATION_PITCH_M, TEXTURE_LAYOUT, TEXTURE_SIZE, type Region } from './closeupGeometry'
import type { AtlasBackend, AtlasPage, CloseupSource, PaintJob } from './containerCloseups'
import type { HeroMarkBackend } from './heroMarkings'
import type { Face } from './exposedFaces'

const DIMS: Record<ContainerSize, { length: number; height: number; width: number }> = {
  '20': { length: 6.058, height: 2.591, width: 2.438 },
  '40': { length: 12.192, height: 2.591, width: 2.438 },
  '40HC': { length: 12.192, height: 2.896, width: 2.438 },
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** mulberry32, for the speckle: the same seed paints the same pixels. */
function stream(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function mix(a: string, b: string, t: number): string {
  const ca = new THREE.Color(a)
  const cb = new THREE.Color(b)
  return `#${ca.lerp(cb, t).getHexString()}`
}

/** Runs `draw` in metre coordinates of a face of `wM` x `hM` metres, clipped to the region (y down, origin top-left). */
function inRegion(ctx: CanvasRenderingContext2D, r: Region, wM: number, hM: number, draw: () => void): void {
  ctx.save()
  ctx.beginPath()
  ctx.rect(r.x, r.y, r.w, r.h)
  ctx.clip()
  ctx.translate(r.x, r.y)
  ctx.scale(r.w / wM, r.h / hM)
  draw()
  ctx.restore()
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, sizeM: number, colour: string, weight = '600', align: CanvasTextAlign = 'left'): void {
  ctx.font = `${weight} ${sizeM}px Arial, Helvetica, sans-serif`
  ctx.fillStyle = colour
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  ctx.fillText(s, x, y)
}

const fmt = (n: number): string => n.toLocaleString('en-US')

function plateRows(p: WeightPlate): [string, string, string][] {
  const rows: [string, string, string][] = [
    ['MAX. GROSS', `${fmt(p.maxGrossKg)} KGS.`, `${fmt(p.maxGrossLbs)} LBS.`],
    ['TARE', `${fmt(p.tareKg)} KGS.`, `${fmt(p.tareLbs)} LBS.`],
    ['NET', `${fmt(p.netKg)} KGS.`, `${fmt(p.netLbs)} LBS.`],
  ]
  if (p.cuCapM3 !== undefined && p.cuCapCuFt !== undefined) rows.push(['CU. CAP.', `${p.cuCapM3.toFixed(1)} CU.M.`, `${fmt(p.cuCapCuFt)} CU.FT.`])
  return rows
}

function drawWear(ctx: CanvasRenderingContext2D, r: Region, wM: number, hM: number, m: ContainerMarkings, body: string, salt = r.x * 31 + r.y): void {
  const rng = stream(m.wear.seed ^ salt)
  inRegion(ctx, r, wM, hM, () => {
    // fine speckle: scuffs and dust
    const specks = Math.round(60 + 240 * m.wear.fade + 80 * wM)
    for (let i = 0; i < specks; i++) {
      ctx.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)'
      ctx.fillRect(rng() * wM, rng() * hM, 0.01 + rng() * 0.05, 0.01 + rng() * 0.03)
    }
    for (const s of m.wear.rustStreaks) {
      const x = s.x * wM
      const g = ctx.createLinearGradient(0, 0, 0, s.len * hM)
      g.addColorStop(0, `rgba(122,58,28,${s.alpha})`)
      g.addColorStop(1, 'rgba(122,58,28,0)')
      ctx.fillStyle = g
      ctx.fillRect(x, 0, s.w * wM, s.len * hM)
    }
    for (const d of m.wear.dents) {
      const cx = d.x * wM
      const cy = d.y * hM
      const rad = d.r * hM
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
      g.addColorStop(0, mix(body, '#000000', 0.28) + 'aa')
      g.addColorStop(0.7, mix(body, '#ffffff', 0.12) + '44')
      g.addColorStop(1, mix(body, '#000000', 0) + '00')
      ctx.fillStyle = g
      ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2)
    }
  })
}

/** What a long side prints, in metres of a face `L` x `H` (y down): line name, box number, rails. Shared with the hero level. */
function drawSideMarks(ctx: CanvasRenderingContext2D, side: ContainerMarkings['side'], L: number, H: number, ink: string): void {
  text(ctx, side.lineName, L * 0.5, H * 0.52, H * 0.34, ink, '800', 'center')
  text(ctx, side.boxNumber, L - 0.5, H * 0.14, 0.2, ink, '600', 'right')
  ctx.fillStyle = 'rgba(0,0,0,0.25)' // top and bottom side rails
  ctx.fillRect(0, 0, L, 0.1)
  ctx.fillRect(0, H - 0.12, L, 0.12)
}

/** Width of a door leaf between the centre seam and the corner post (generators: `fy` in containers.py). */
export const DOOR_LEAF_M = 1.064
/** The two locking bars of a leaf, metres from the centre seam (`DOOR_BAR_FRACS` in containers.py). */
export const DOOR_BAR_INNER_M = 0.17 * DOOR_LEAF_M
export const DOOR_BAR_OUTER_M = 0.55 * DOOR_LEAF_M
/** Clear space kept either side of a bar's centre line. */
const BAR_CLEAR_M = 0.035

/** `text`, shrunk so it is no wider than `maxW` (a line must fit between two locking bars). */
function fitText(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, sizeM: number, maxW: number, colour: string, weight = '600', align: CanvasTextAlign = 'left'): void {
  ctx.font = `${weight} ${sizeM}px Arial, Helvetica, sans-serif`
  const w = ctx.measureText?.(s)?.width ?? 0 // a test's stub context measures nothing
  text(ctx, s, x, y, w > maxW && w > 0 ? (sizeM * maxW) / w : sizeM, colour, weight, align)
}

/**
 * What the door end prints, seen from behind the box: left leaf x in 0..W/2, right leaf W/2..W (y down from the top).
 * Laid out around the locking bars as on a real door: on the right leaf the owner prefix and the plate labels sit between
 * the two bars, the serial, check digit, type code and the plate values beside the outer bar; the CSC plate, the roundel
 * and the SUPER HEAVY mark sit on the left leaf outside its outer bar.
 */
function drawDoorMarks(ctx: CanvasRenderingContext2D, door: ContainerMarkings['door'], W: number, H: number, ink: string): void {
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.fillRect(W / 2 - 0.012, 0.12, 0.024, H - 0.24) // the seam between the leaves
  ctx.fillStyle = 'rgba(0,0,0,0.22)'
  ctx.fillRect(0, 0, W, 0.14) // header and sill
  ctx.fillRect(0, H - 0.14, W, 0.14)
  // right leaf: column A between the bars, column B from the outer bar to the leaf edge
  const a0 = W / 2 + DOOR_BAR_INNER_M + BAR_CLEAR_M
  const aW = DOOR_BAR_OUTER_M - DOOR_BAR_INNER_M - 2 * BAR_CLEAR_M
  const b0 = W / 2 + DOOR_BAR_OUTER_M + BAR_CLEAR_M
  const b1 = W / 2 + DOOR_LEAF_M - 0.04
  const bW = b1 - b0
  // identity: prefix between the bars, serial and boxed check digit beside the outer bar, type code under the serial
  const box = 0.085
  fitText(ctx, door.ownerPrefix, a0 + aW, 0.4, 0.095, aW, ink, '600', 'right')
  fitText(ctx, door.serial, b0, 0.4, 0.095, bW - box - 0.015, ink)
  text(ctx, String(door.checkDigit), b1 - box / 2, 0.4, 0.085, ink, '600', 'center')
  ctx.strokeStyle = ink
  ctx.lineWidth = 0.008
  ctx.strokeRect(b1 - box, 0.4 - 0.065, box, 0.125)
  fitText(ctx, door.isoType, b0, 0.58, 0.095, bW, ink)
  // weight plate: labels between the bars, values beside the outer bar
  const rows = door.plate ? plateRows(door.plate) : []
  rows.forEach(([label, kg, lbs], i) => {
    const y = 0.76 + i * 0.19 // the plate ends above the bar handles
    fitText(ctx, label, a0, y + 0.045, 0.06, aW, ink, '500')
    fitText(ctx, kg, b1, y, 0.062, bW, ink, '500', 'right')
    fitText(ctx, lbs, b1, y + 0.09, 0.062, bW, ink, '500', 'right')
  })
  // left leaf, outside its outer bar: CSC approval plate, the corten steel roundel, SUPER HEAVY
  const l0 = W / 2 - DOOR_LEAF_M + 0.04
  const l1 = W / 2 - DOOR_BAR_OUTER_M - BAR_CLEAR_M
  const lc = (l0 + l1) / 2
  ctx.fillStyle = '#8f9396'
  ctx.fillRect(lc - 0.1, H * 0.62, 0.2, 0.15)
  ctx.fillStyle = '#4a4d50'
  for (let i = 0; i < 4; i++) ctx.fillRect(lc - 0.08, H * 0.62 + 0.025 + i * 0.03, 0.16, 0.012)
  ctx.fillStyle = '#d9d9d4'
  ctx.beginPath()
  ctx.ellipse(lc, H * 0.82, 0.11, 0.045, 0, 0, Math.PI * 2)
  ctx.fill()
  text(ctx, 'CORTEN STEEL', lc, H * 0.82 - 0.01, 0.028, '#222', '600', 'center')
  text(ctx, 'CONTAINER', lc, H * 0.82 + 0.015, 0.028, '#222', '600', 'center')
  if (door.superHeavy) {
    const cx = lc
    const cy = H * 0.5
    ctx.fillStyle = '#f2c318'
    ctx.strokeStyle = '#1a1a1a'
    ctx.lineWidth = 0.012
    ctx.beginPath()
    ctx.moveTo(cx, cy - 0.17)
    ctx.lineTo(cx + 0.16, cy + 0.1)
    ctx.lineTo(cx - 0.16, cy + 0.1)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    text(ctx, 'SUPER', cx, cy + 0.02, 0.04, '#1a1a1a', '700', 'center')
    text(ctx, 'HEAVY', cx, cy + 0.065, 0.04, '#1a1a1a', '700', 'center')
  }
  if (door.boltSeal) {
    // hangs from the handle of the right-hand leaf's inner bar (the handle runs 1.05 to 1.10 m above the floor, towards the post)
    const z = W / 2 + DOOR_BAR_INNER_M + 0.12
    const y = H - 1.05
    ctx.strokeStyle = '#222'
    ctx.lineWidth = 0.008
    ctx.beginPath()
    ctx.moveTo(z, y)
    ctx.lineTo(z, y + 0.07)
    ctx.stroke()
    ctx.fillStyle = '#d8281c'
    ctx.fillRect(z - 0.03, y + 0.07, 0.06, 0.1)
    ctx.fillStyle = '#7a120c'
    ctx.fillRect(z - 0.03, y + 0.07, 0.06, 0.02)
  }
}

/** What the front end prints: the box number. */
function drawFrontMarks(ctx: CanvasRenderingContext2D, door: ContainerMarkings['door'], W: number, H: number, ink: string): void {
  ctx.fillStyle = 'rgba(0,0,0,0.22)'
  ctx.fillRect(0, 0, W, 0.14)
  ctx.fillRect(0, H - 0.14, W, 0.14)
  text(ctx, `${door.ownerPrefix} ${door.serial} ${door.checkDigit}`, W * 0.5, 0.36, 0.12, ink, '600', 'center')
}

/** Paints one box. `bodyColour` is the livery body colour. */
export function paintContainer(ctx: CanvasRenderingContext2D, markings: ContainerMarkings, size: ContainerSize, bodyColour: string): void {
  const { length: L, height: H, width: W } = DIMS[size]
  const { door, side, wear } = markings
  const paint = mix(bodyColour, '#d8d4c8', wear.fade * 0.4)
  const ink = side.lineColour
  ctx.fillStyle = paint
  ctx.fillRect(0, 0, TEXTURE_SIZE.w, TEXTURE_SIZE.h)
  const sw = (r: Region, colour: string) => {
    ctx.fillStyle = colour
    ctx.fillRect(r.x, r.y, r.w, r.h)
  }
  sw(TEXTURE_LAYOUT.steel, '#3b3a38')
  sw(TEXTURE_LAYOUT.zinc, '#b5b8ba')

  // Long sides: the line name in the line colour (no logo), the box number near the door end.
  inRegion(ctx, TEXTURE_LAYOUT.side, L, H, () => drawSideMarks(ctx, side, L, H, ink))
  inRegion(ctx, TEXTURE_LAYOUT.roof, L, W, () => {
    ctx.fillStyle = 'rgba(70,70,60,0.18)' // dust and grime; a roof prints nothing (#170)
    ctx.fillRect(0, 0, L, W)
  })

  // Door end, seen from behind the box: left leaf x in 0..W/2, right leaf W/2..W (y down from the top).
  inRegion(ctx, TEXTURE_LAYOUT.door, W, H, () => drawDoorMarks(ctx, door, W, H, ink))
  inRegion(ctx, TEXTURE_LAYOUT.front, W, H, () => drawFrontMarks(ctx, door, W, H, ink))

  drawWear(ctx, TEXTURE_LAYOUT.side, L, H, markings, paint)
  drawWear(ctx, TEXTURE_LAYOUT.door, W, H, markings, paint)
  drawWear(ctx, TEXTURE_LAYOUT.front, W, H, markings, paint)
}

const FACE_REGION: Record<Exclude<Face, 'bottom'>, Region> = {
  top: TEXTURE_LAYOUT.roof,
  door: TEXTURE_LAYOUT.door,
  front: TEXTURE_LAYOUT.front,
  sideP: TEXTURE_LAYOUT.side,
  sideN: TEXTURE_LAYOUT.side,
}

/**
 * The canvas backend of the close-up face atlas (#143): pages are canvas textures, and a box is painted whole into one
 * scratch canvas (`paintContainer`) whose face regions are then copied into the atlas tiles.
 */
export function canvasAtlasBackend(): AtlasBackend {
  let scratch: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null
  return {
    createPage(w: number, h: number): AtlasPage {
      const c = canvas(w, h)
      const texture = new THREE.CanvasTexture(c)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = 4
      return { texture, ctx: c.getContext('2d') }
    },
    paint(source: CloseupSource, size: ContainerSize, jobs: PaintJob[]): void {
      if (!scratch) {
        const c = canvas(TEXTURE_SIZE.w, TEXTURE_SIZE.h)
        const ctx = c.getContext('2d')
        if (!ctx) return
        scratch = { canvas: c, ctx }
      }
      paintContainer(scratch.ctx, source.markings, size, source.bodyColour)
      for (const job of jobs) {
        const dst = job.page.ctx
        const r = FACE_REGION[job.face as keyof typeof FACE_REGION]
        if (!dst || !r) continue
        dst.clearRect(job.rect.x, job.rect.y, job.rect.w, job.rect.h)
        dst.drawImage(scratch.canvas, r.x, r.y, r.w, r.h, job.rect.x, job.rect.y, job.rect.w, job.rect.h)
      }
    },
  }
}

let shared: { normal: THREE.Texture; roughness: THREE.Texture } | null = null

/**
 * Shared by every close-up box: a corrugation normal map (one ridge per `CORRUGATION_PITCH_M` of uv1 u) and a wear
 * roughness map (1 m per tile). Both repeat and are read from the second UV set.
 */
export function sharedContainerMaps(): { normal: THREE.Texture; roughness: THREE.Texture } {
  if (shared) return shared
  const nw = 64
  const nc = canvas(nw, 4)
  const nctx = nc.getContext('2d')
  if (nctx) {
    const img = nctx.createImageData(nw, 4)
    for (let x = 0; x < nw; x++) {
      // trapezoid-ish ridge: surface height h(u) = sin(2 pi u); slope along u tilts the normal
      const slope = Math.cos((x / nw) * Math.PI * 2)
      const nx = -slope * 0.9
      const len = Math.hypot(nx, 1)
      for (let y = 0; y < 4; y++) {
        const i = (y * nw + x) * 4
        img.data[i] = Math.round((nx / len * 0.5 + 0.5) * 255)
        img.data[i + 1] = 128
        img.data[i + 2] = Math.round((1 / len * 0.5 + 0.5) * 255)
        img.data[i + 3] = 255
      }
    }
    nctx.putImageData(img, 0, 0)
  }
  const normal = new THREE.CanvasTexture(nc)
  const rc = canvas(128, 128)
  const rctx = rc.getContext('2d')
  if (rctx) {
    const rng = stream(0x7a11)
    const img = rctx.createImageData(128, 128)
    for (let i = 0; i < 128 * 128; i++) {
      const v = Math.round(185 + rng() * 55 - (rng() < 0.04 ? 70 : 0)) // mostly rough, scuffed patches shinier
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
      img.data[i * 4 + 3] = 255
    }
    rctx.putImageData(img, 0, 0)
  }
  const roughness = new THREE.CanvasTexture(rc)
  for (const t of [normal, roughness]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.channel = 1
    t.anisotropy = 4
  }
  normal.repeat.set(1, 1)
  shared = { normal, roughness }
  return shared
}

/** The ridge pitch the normal map is authored for (uv1 u is metres / pitch, so one texture repeat = one ridge). */
export const NORMAL_MAP_PITCH_M = CORRUGATION_PITCH_M

/** The tile content of one face of a box, in canvas pixels: marks and wear on a transparent ground (the hero level draws its own paint). */
const HERO_FACES = ['sideP', 'sideN', 'door', 'front'] as const

/**
 * Paints one face's markings and wear into `rect` of `ctx` over a transparent ground (hero level, #260): the same
 * `drawSideMarks` / `drawDoorMarks` / `drawFrontMarks` and `drawWear` the close-up level paints, in metres of the face,
 * so a hero face and a close-up face of one box say the same. The speckle seed is the close-up region's, so the pixels match too.
 */
export function paintFaceMarks(ctx: CanvasRenderingContext2D, markings: ContainerMarkings, size: ContainerSize, face: Face, rect: Region, bodyColour: string): void {
  const { length: L, height: H, width: W } = DIMS[size]
  const { door, side, wear } = markings
  const paint = mix(bodyColour, '#d8d4c8', wear.fade * 0.4)
  const ink = side.lineColour
  const canon = FACE_REGION[face as keyof typeof FACE_REGION]
  if (!canon || !(HERO_FACES as readonly Face[]).includes(face)) return
  const salt = canon.x * 31 + canon.y
  if (face === 'sideP' || face === 'sideN') {
    inRegion(ctx, rect, L, H, () => drawSideMarks(ctx, side, L, H, ink))
    drawWear(ctx, rect, L, H, markings, paint, salt)
  } else if (face === 'door') {
    inRegion(ctx, rect, W, H, () => drawDoorMarks(ctx, door, W, H, ink))
    drawWear(ctx, rect, W, H, markings, paint, salt)
  } else {
    inRegion(ctx, rect, W, H, () => drawFrontMarks(ctx, door, W, H, ink))
    drawWear(ctx, rect, W, H, markings, paint, salt)
  }
}

/** The canvas backend of the hero marking atlas (#260). Without a DOM (Vitest, workers) pages have no context and painting is a no-op. */
export function canvasHeroMarkBackend(): HeroMarkBackend {
  return {
    createPage(px: number): AtlasPage {
      if (typeof document === 'undefined') return { texture: new THREE.Texture(), ctx: null }
      const c = canvas(px, px)
      const texture = new THREE.CanvasTexture(c)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.premultiplyAlpha = true // transparent ground: no dark halos at the glyph edges
      texture.anisotropy = 8
      return { texture, ctx: c.getContext('2d') }
    },
    paint(source: CloseupSource, size: ContainerSize, face: Face, page: AtlasPage, rect: Region): void {
      const ctx = page.ctx
      if (!ctx) return
      ctx.clearRect(rect.x, rect.y, rect.w, rect.h)
      paintFaceMarks(ctx, source.markings, size, face, rect, source.bodyColour)
    },
  }
}
