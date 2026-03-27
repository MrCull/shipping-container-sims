// ---------------------------------------------------------------------------
// Box Empire — Canvas-texture based container materials
// Ported from stowage-master with adaptation for shipping-line liveries.
// Produces realistic PBR containers: corrugated sides, ISO markings, door panels.
// ---------------------------------------------------------------------------

import * as THREE from 'three'

// Cache corrugated/door base canvases per colour hex
const baseCache = new Map<string, { longBase: HTMLCanvasElement; doorBase: HTMLCanvasElement }>()

export const SHIPPING_LINE_LIVERY: Record<string, { hex: string; name: string; code: string }> = {
  maersk:     { hex: '#2E86C1', name: 'MAERSK',    code: 'MAEU' },
  evergreen:  { hex: '#006747', name: 'EVERGREEN', code: 'EGLV' },
  cosco:      { hex: '#004B87', name: 'COSCO',     code: 'COSU' },
  msc:        { hex: '#cc9900', name: 'MSC',       code: 'MSCU' },
  cma_cgm:    { hex: '#003DA5', name: 'CMA-CGM',  code: 'CMAU' },
  hapag_lloyd:{ hex: '#FF6600', name: 'HAPAG',     code: 'HLCU' },
  one:        { hex: '#8800AA', name: 'ONE',       code: 'ONEY' },
  hmm:        { hex: '#0099CC', name: 'HMM',       code: 'HDMU' },
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  const n = parseInt(h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function isoCodesFromId(containerId: string, lineName: string, lineCode: string) {
  let h = 0
  for (let i = 0; i < containerId.length; i++) {
    h = (h * 31 + containerId.charCodeAt(i)) >>> 0
  }
  const num = String(100000 + (h % 900000)).slice(1)
  const check = String(h % 10)
  const idLine = `${lineCode} ${num} ${check}`
  const types = ['22G1', '42G1', '45G1', '25G1']
  const typeCode = types[h % types.length]!
  return { idLine, typeCode, lineName, lineCode }
}

function makeCorrugatedBase(w: number, h: number, rgb: { r: number; g: number; b: number }): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')!

  const g = ctx.createLinearGradient(0, 0, w, 0)
  g.addColorStop(0,   `rgb(${Math.floor(rgb.r * 0.82)},${Math.floor(rgb.g * 0.82)},${Math.floor(rgb.b * 0.82)})`)
  g.addColorStop(0.5, `rgb(${Math.min(255, Math.floor(rgb.r * 1.08))},${Math.min(255, Math.floor(rgb.g * 1.08))},${Math.min(255, Math.floor(rgb.b * 1.08))})`)
  g.addColorStop(1,   `rgb(${Math.floor(rgb.r * 0.86)},${Math.floor(rgb.g * 0.86)},${Math.floor(rgb.b * 0.86)})`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  const rib = Math.max(3, Math.floor(w / 36))
  ctx.globalAlpha = 0.20
  ctx.fillStyle = '#000'
  for (let x = 0; x < w; x += rib * 2) ctx.fillRect(x, 0, rib, h)
  ctx.globalAlpha = 1

  ctx.strokeStyle = 'rgba(0,0,0,0.18)'
  ctx.lineWidth = 1
  for (let i = 1; i < 6; i++) {
    ctx.beginPath()
    ctx.moveTo(0, (h / 6) * i); ctx.lineTo(w, (h / 6) * i)
    ctx.stroke()
  }
  return c
}

function makeDoorBase(w: number, h: number, rgb: { r: number; g: number; b: number }): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')!

  ctx.fillStyle = `rgb(${Math.floor(rgb.r * 0.70)},${Math.floor(rgb.g * 0.70)},${Math.floor(rgb.b * 0.70)})`
  ctx.fillRect(0, 0, w, h)

  const mid = w * 0.5
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'
  ctx.lineWidth = 4
  ctx.beginPath(); ctx.moveTo(mid, h * 0.06); ctx.lineTo(mid, h * 0.94); ctx.stroke()

  ctx.strokeStyle = 'rgba(255,255,255,0.10)'
  ctx.lineWidth = 2
  ctx.strokeRect(w * 0.05, h * 0.05, w * 0.42, h * 0.9)
  ctx.strokeRect(w * 0.54, h * 0.05, w * 0.42, h * 0.9)

  for (let i = 1; i < 7; i++) {
    const y = h * (0.1 + i * 0.11)
    ctx.beginPath(); ctx.moveTo(w * 0.07, y); ctx.lineTo(w * 0.45, y); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(w * 0.55, y); ctx.lineTo(w * 0.93, y); ctx.stroke()
  }

  // Hazard stripe
  const stripeH = h * 0.05
  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#000' : '#facc15'
    ctx.fillRect((w / 18) * i, 0, w / 18 + 1, stripeH)
  }

  // CSC plate
  ctx.fillStyle = 'rgba(175,185,195,0.88)'
  ctx.fillRect(w * 0.06, h * 0.73, w * 0.34, h * 0.19)
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'
  ctx.lineWidth = 1.5
  ctx.strokeRect(w * 0.06, h * 0.73, w * 0.34, h * 0.19)
  ctx.fillStyle = 'rgba(15,18,22,0.95)'
  ctx.font = `600 ${Math.floor(h * 0.026)}px monospace`
  ctx.textAlign = 'left'
  let ly = h * 0.755
  for (const line of ['CSC SAFETY', 'MAX GROSS 30480 KG', 'TARE 3900 KG']) {
    ctx.fillText(line, w * 0.09, ly); ly += h * 0.046
  }

  // Height plate
  ctx.fillStyle = 'rgba(250,204,21,0.95)'
  ctx.fillRect(w * 0.58, h * 0.79, w * 0.36, h * 0.09)
  ctx.fillStyle = '#1a1a1a'
  ctx.font = `bold ${Math.floor(h * 0.048)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText('2.6m', w * 0.76, h * 0.845)
  return c
}

function makeRoofCanvas(w: number, h: number, rgb: { r: number; g: number; b: number }): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = `rgb(${Math.floor(rgb.r * 0.85)},${Math.floor(rgb.g * 0.85)},${Math.floor(rgb.b * 0.85)})`
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = 'rgba(0,0,0,0.14)'
  for (let x = 0; x < w; x += 14) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
  }
  return c
}

function makeUnderCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#16181e'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(50,55,65,0.55)'
  for (let i = 0; i < 8; i++) ctx.fillRect((w / 8) * i, 0, 3, h)
  return c
}

function finalizeLongWall(
  base: HTMLCanvasElement,
  iso: { idLine: string; typeCode: string; lineName: string },
): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = base.width; c.height = base.height
  const ctx = c.getContext('2d')!
  ctx.drawImage(base, 0, 0)
  const W = c.width; const H = c.height

  ctx.save()
  ctx.translate(W * 0.91, H * 0.5)
  ctx.rotate(-Math.PI / 2)
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.font = `bold ${Math.floor(H * 0.090)}px monospace`
  ctx.textAlign = 'center'
  ctx.fillText(iso.idLine, 0, -H * 0.04)
  ctx.fillStyle = 'rgba(255,255,255,0.70)'
  ctx.font = `600 ${Math.floor(H * 0.065)}px monospace`
  ctx.fillText(iso.typeCode, 0, H * 0.065)
  ctx.restore()

  // Operator badge
  ctx.fillStyle = 'rgba(34,197,94,0.90)'
  ctx.fillRect(W * 0.04, H * 0.12, W * 0.16, H * 0.22)
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.lineWidth = 1.5
  ctx.strokeRect(W * 0.04, H * 0.12, W * 0.16, H * 0.22)
  ctx.fillStyle = '#052e16'
  ctx.font = `bold ${Math.floor(H * 0.058)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText(iso.lineName.slice(0, 4), W * 0.12, H * 0.24)

  // Warning triangle
  ctx.fillStyle = 'rgba(251,191,36,0.95)'
  ctx.beginPath()
  ctx.moveTo(W * 0.23, H * 0.70); ctx.lineTo(W * 0.30, H * 0.88); ctx.lineTo(W * 0.16, H * 0.88)
  ctx.closePath(); ctx.fill()
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke()
  ctx.fillStyle = '#000'
  ctx.font = `bold ${Math.floor(H * 0.064)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText('!', W * 0.23, H * 0.845)
  return c
}

function finalizeDoor(
  base: HTMLCanvasElement,
  iso: { idLine: string; typeCode: string },
): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = base.width; c.height = base.height
  const ctx = c.getContext('2d')!
  ctx.drawImage(base, 0, 0)
  const W = c.width; const H = c.height
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.font = `bold ${Math.floor(H * 0.054)}px monospace`
  ctx.textAlign = 'right'
  ctx.fillText(iso.idLine, W * 0.94, H * 0.14)
  ctx.font = `600 ${Math.floor(H * 0.042)}px monospace`
  ctx.fillStyle = 'rgba(255,255,255,0.76)'
  ctx.fillText(iso.typeCode, W * 0.94, H * 0.20)
  return c
}

function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

function getBasePair(colorHex: string) {
  let hit = baseCache.get(colorHex)
  if (!hit) {
    const rgb = hexToRgb(colorHex)
    hit = {
      longBase: makeCorrugatedBase(512, 256, rgb),
      doorBase: makeDoorBase(384, 384, rgb),
    }
    baseCache.set(colorHex, hit)
  }
  return hit
}

/**
 * Build 6-face MeshStandardMaterial array with canvas textures.
 * Face order for BoxGeometry: +X, -X, +Y, -Y, +Z, -Z
 */
export function createContainerMaterials(
  colorHex: string,
  containerId: string,
  shippingLine: string,
): THREE.MeshStandardMaterial[] {
  const livery = SHIPPING_LINE_LIVERY[shippingLine]
  const { longBase, doorBase } = getBasePair(colorHex)
  const rgb = hexToRgb(colorHex)
  const iso = isoCodesFromId(containerId, livery?.name ?? 'LINE', livery?.code ?? 'XXXX')

  const longCanvas = finalizeLongWall(longBase, iso)
  const doorCanvas = finalizeDoor(doorBase, iso)

  const texLong  = canvasTexture(longCanvas)
  const texDoor  = canvasTexture(doorCanvas)
  texDoor.wrapS = THREE.ClampToEdgeWrapping
  texDoor.wrapT = THREE.ClampToEdgeWrapping
  const texRoof  = canvasTexture(makeRoofCanvas(512, 256, rgb))
  const texUnder = canvasTexture(makeUnderCanvas(512, 256))

  const opts = (map: THREE.Texture, rough = 0.52, metal = 0.34): THREE.MeshStandardMaterialParameters => ({ map, roughness: rough, metalness: metal })
  const longMat = () => new THREE.MeshStandardMaterial(opts(texLong))
  const doorMat = () => new THREE.MeshStandardMaterial(opts(texDoor, 0.45, 0.32))

  // Box faces: +X (door), -X (door), +Y (roof), -Y (under), +Z (long), -Z (long)
  return [
    doorMat(),
    doorMat(),
    new THREE.MeshStandardMaterial(opts(texRoof, 0.62, 0.38)),
    new THREE.MeshStandardMaterial(opts(texUnder, 0.88, 0.18)),
    longMat(),
    longMat(),
  ]
}

export function disposeContainerMaterials(materials: THREE.MeshStandardMaterial[]): void {
  for (const m of materials) {
    m.map?.dispose()
    m.dispose()
  }
}

export function clearMaterialCache(): void {
  baseCache.clear()
}
