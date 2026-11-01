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

function drawWear(ctx: CanvasRenderingContext2D, r: Region, wM: number, hM: number, m: ContainerMarkings, body: string): void {
  const rng = stream(m.wear.seed ^ (r.x * 31 + r.y))
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
  inRegion(ctx, TEXTURE_LAYOUT.side, L, H, () => {
    text(ctx, side.lineName, L * 0.5, H * 0.52, H * 0.34, ink, '800', 'center')
    text(ctx, side.boxNumber, L - 0.5, H * 0.14, 0.2, ink, '600', 'right')
    ctx.fillStyle = 'rgba(0,0,0,0.25)' // top and bottom side rails
    ctx.fillRect(0, 0, L, 0.1)
    ctx.fillRect(0, H - 0.12, L, 0.12)
  })
  inRegion(ctx, TEXTURE_LAYOUT.roof, L, W, () => {
    ctx.fillStyle = 'rgba(70,70,60,0.18)' // dust and grime; a roof prints nothing (#170)
    ctx.fillRect(0, 0, L, W)
  })

  // Door end, seen from behind the box: left leaf x in 0..W/2, right leaf W/2..W (y down from the top).
  inRegion(ctx, TEXTURE_LAYOUT.door, W, H, () => {
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.fillRect(W / 2 - 0.012, 0.12, 0.024, H - 0.24) // the seam between the leaves
    ctx.fillStyle = 'rgba(0,0,0,0.22)'
    ctx.fillRect(0, 0, W, 0.14) // header and sill
    ctx.fillRect(0, H - 0.14, W, 0.14)
    // identity, top of the right leaf
    text(ctx, `${door.ownerPrefix} ${door.serial}`, W * 0.51, 0.4, 0.16, ink, '600')
    text(ctx, String(door.checkDigit), W * 0.94, 0.36, 0.11, ink, '600', 'center')
    ctx.strokeStyle = ink
    ctx.lineWidth = 0.008
    ctx.strokeRect(W * 0.94 - 0.065, 0.36 - 0.08, 0.13, 0.16)
    text(ctx, door.isoType, W * 0.51, 0.64, 0.16, ink, '600')
    // weight plate, right leaf, below the identity
    const rows = door.plate ? plateRows(door.plate) : []
    rows.forEach(([label, kg, lbs], i) => {
      const y = H * 0.33 + i * 0.27
      text(ctx, label, W * 0.52, y + 0.06, 0.08, ink, '500')
      text(ctx, kg, W * 0.96, y, 0.08, ink, '500', 'right')
      text(ctx, lbs, W * 0.96, y + 0.12, 0.08, ink, '500', 'right')
    })
    // CSC approval plate, left leaf, and the corten steel roundel
    ctx.fillStyle = '#8f9396'
    ctx.fillRect(W * 0.08, H * 0.62, 0.2, 0.15)
    ctx.fillStyle = '#4a4d50'
    for (let i = 0; i < 4; i++) ctx.fillRect(W * 0.08 + 0.02, H * 0.62 + 0.025 + i * 0.03, 0.16, 0.012)
    ctx.fillStyle = '#d9d9d4'
    ctx.beginPath()
    ctx.ellipse(W * 0.14, H * 0.82, 0.11, 0.045, 0, 0, Math.PI * 2)
    ctx.fill()
    text(ctx, 'CORTEN STEEL', W * 0.14, H * 0.82 - 0.01, 0.028, '#222', '600', 'center')
    text(ctx, 'CONTAINER', W * 0.14, H * 0.82 + 0.015, 0.028, '#222', '600', 'center')
    if (door.superHeavy) {
      const cx = W * 0.2
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
      // hangs from the inner rod's handle on the right-hand leaf (as seen from behind, the viewer's right)
      const z = W * 0.62
      const y = H - 0.9
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
  })
  inRegion(ctx, TEXTURE_LAYOUT.front, W, H, () => {
    ctx.fillStyle = 'rgba(0,0,0,0.22)'
    ctx.fillRect(0, 0, W, 0.14)
    ctx.fillRect(0, H - 0.14, W, 0.14)
    text(ctx, `${door.ownerPrefix} ${door.serial} ${door.checkDigit}`, W * 0.5, 0.36, 0.12, ink, '600', 'center')
  })

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
