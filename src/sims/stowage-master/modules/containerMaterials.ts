/**
 * Canvas-texture based container materials — ported from container-stack sim.
 * Produces realistic PBR containers with corrugated side panels, ISO markings,
 * door detail, and per-shipping-line livery colours.
 */
import * as THREE from 'three'

// Cache corrugated/door base canvases per colour hex (shared across containers of same line)
const baseCache = new Map<string, { longBase: HTMLCanvasElement; doorBase: HTMLCanvasElement }>()

// Shipping line livery data keyed by port name
export const SHIPPING_LINE_LIVERY: Record<string, { hex: string; name: string; code: string }> = {
  Rotterdam: { hex: '#1c4fa0', name: 'MAERSK',    code: 'MAEU' },
  Singapore: { hex: '#1a7a35', name: 'EVERGREEN', code: 'EGLV' },
  Shanghai:  { hex: '#cc1c1c', name: 'COSCO',     code: 'COSU' },
  Hamburg:   { hex: '#dd7200', name: 'HAPAG',      code: 'HLCU' },
  Busan:     { hex: '#3f22aa', name: 'HMM',        code: 'HDMU' },
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  const n = parseInt(h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** Derive pseudo-unique ISO-style codes from a container ID string */
function isoCodesFromId(containerId: string, lineName: string, lineCode: string): { idLine: string; typeCode: string; lineName: string; lineCode: string } {
  let h = 0
  for (let i = 0; i < containerId.length; i++) {
    h = (h * 31 + containerId.charCodeAt(i)!) >>> 0
  }
  const num = String(100000 + (h % 900000)).slice(1)
  const check = String(h % 10)
  const idLine = `${lineCode} ${num} ${check}`
  const types = ['22G1', '42G1', '45G1', '25G1']
  const typeCode = types[h % types.length]!
  return { idLine, typeCode, lineName, lineCode }
}

/** Corrugated long-wall canvas (vertical ribs + subtle gradient) */
function makeCorrugatedBase(
  w: number, h: number,
  rgb: { r: number; g: number; b: number },
): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')!

  const g = ctx.createLinearGradient(0, 0, w, 0)
  g.addColorStop(0,   `rgb(${Math.floor(rgb.r * 0.85)},${Math.floor(rgb.g * 0.85)},${Math.floor(rgb.b * 0.85)})`)
  g.addColorStop(0.5, `rgb(${Math.min(255, Math.floor(rgb.r * 1.06))},${Math.min(255, Math.floor(rgb.g * 1.06))},${Math.min(255, Math.floor(rgb.b * 1.06))})`)
  g.addColorStop(1,   `rgb(${Math.floor(rgb.r * 0.88)},${Math.floor(rgb.g * 0.88)},${Math.floor(rgb.b * 0.88)})`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  // Vertical corrugation ribs
  const rib = Math.max(3, Math.floor(w / 34))
  ctx.globalAlpha = 0.18
  ctx.fillStyle = '#000'
  for (let x = 0; x < w; x += rib * 2) {
    ctx.fillRect(x, 0, rib, h)
  }
  ctx.globalAlpha = 1

  // Horizontal division lines
  ctx.strokeStyle = 'rgba(0,0,0,0.22)'
  ctx.lineWidth = 1
  for (let i = 1; i < 6; i++) {
    ctx.beginPath()
    ctx.moveTo(0, (h / 6) * i)
    ctx.lineTo(w, (h / 6) * i)
    ctx.stroke()
  }
  return c
}

/** Door-end canvas with two panels, hinges, hazard stripe, and data plate */
function makeDoorBase(
  w: number, h: number,
  rgb: { r: number; g: number; b: number },
): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')!

  ctx.fillStyle = `rgb(${Math.floor(rgb.r * 0.74)},${Math.floor(rgb.g * 0.74)},${Math.floor(rgb.b * 0.74)})`
  ctx.fillRect(0, 0, w, h)

  // Centre divider
  const mid = w * 0.5
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'
  ctx.lineWidth = 4
  ctx.beginPath(); ctx.moveTo(mid, h * 0.06); ctx.lineTo(mid, h * 0.94); ctx.stroke()

  // Panel outlines
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 2
  ctx.strokeRect(w * 0.05, h * 0.05, w * 0.42, h * 0.9)
  ctx.strokeRect(w * 0.54, h * 0.05, w * 0.42, h * 0.9)

  // Horizontal cross-bars on each panel
  for (let i = 1; i < 7; i++) {
    const y = h * (0.1 + i * 0.11)
    ctx.beginPath(); ctx.moveTo(w * 0.07, y); ctx.lineTo(w * 0.45, y); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(w * 0.55, y); ctx.lineTo(w * 0.93, y); ctx.stroke()
  }

  // Yellow/black hazard stripe at top
  const stripeH = h * 0.048
  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#000' : '#facc15'
    ctx.fillRect((w / 18) * i, 0, w / 18 + 1, stripeH)
  }

  // Data plate (CSC safety)
  ctx.fillStyle = 'rgba(180,190,200,0.90)'
  ctx.fillRect(w * 0.06, h * 0.73, w * 0.34, h * 0.19)
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'
  ctx.lineWidth = 1.5
  ctx.strokeRect(w * 0.06, h * 0.73, w * 0.34, h * 0.19)
  ctx.fillStyle = 'rgba(20,22,28,0.95)'
  ctx.font = `600 ${Math.floor(h * 0.027)}px monospace`
  ctx.textAlign = 'left'
  let ly = h * 0.755
  for (const line of ['CSC SAFETY', 'MAX GROSS 30480 KG', 'TARE 3900 KG']) {
    ctx.fillText(line, w * 0.09, ly)
    ly += h * 0.046
  }

  // Height plate
  ctx.fillStyle = 'rgba(250,204,21,0.95)'
  ctx.fillRect(w * 0.58, h * 0.79, w * 0.36, h * 0.09)
  ctx.fillStyle = '#1a1a1a'
  ctx.font = `bold ${Math.floor(h * 0.05)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText('2.9m', w * 0.76, h * 0.845)

  return c
}

/** Roof canvas */
function makeRoofCanvas(w: number, h: number, rgb: { r: number; g: number; b: number }): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = `rgb(${Math.floor(rgb.r * 0.88)},${Math.floor(rgb.g * 0.88)},${Math.floor(rgb.b * 0.88)})`
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = 'rgba(0,0,0,0.15)'
  for (let x = 0; x < w; x += 16) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
  }
  return c
}

/** Under-floor canvas */
function makeUnderCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#18191f'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(55,60,70,0.5)'
  for (let i = 0; i < 8; i++) ctx.fillRect((w / 8) * i, 0, 3, h)
  return c
}

/** Finalize long-wall canvas: draw ISO codes, operator logo patch, and safety triangle */
function finalizeLongWall(
  base: HTMLCanvasElement,
  iso: { idLine: string; typeCode: string; lineName: string },
): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = base.width; c.height = base.height
  const ctx = c.getContext('2d')!
  ctx.drawImage(base, 0, 0)
  const W = c.width; const H = c.height

  // Rotated ID code near right end
  ctx.save()
  ctx.translate(W * 0.91, H * 0.5)
  ctx.rotate(-Math.PI / 2)
  ctx.fillStyle = 'rgba(255,255,255,0.90)'
  ctx.font = `bold ${Math.floor(H * 0.092)}px monospace`
  ctx.textAlign = 'center'
  ctx.fillText(iso.idLine, 0, -H * 0.04)
  ctx.fillStyle = 'rgba(255,255,255,0.72)'
  ctx.font = `600 ${Math.floor(H * 0.068)}px monospace`
  ctx.fillText(iso.typeCode, 0, H * 0.065)
  ctx.restore()

  // Green operator badge
  ctx.fillStyle = 'rgba(34,197,94,0.92)'
  ctx.fillRect(W * 0.04, H * 0.12, W * 0.15, H * 0.22)
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.lineWidth = 1.5
  ctx.strokeRect(W * 0.04, H * 0.12, W * 0.15, H * 0.22)
  ctx.fillStyle = '#052e16'
  ctx.font = `bold ${Math.floor(H * 0.06)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText(iso.lineName.slice(0, 3), W * 0.115, H * 0.245)

  // Warning triangle
  ctx.fillStyle = 'rgba(251,191,36,0.95)'
  ctx.beginPath()
  ctx.moveTo(W * 0.22, H * 0.70); ctx.lineTo(W * 0.29, H * 0.88); ctx.lineTo(W * 0.15, H * 0.88)
  ctx.closePath(); ctx.fill()
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke()
  ctx.fillStyle = '#000'
  ctx.font = `bold ${Math.floor(H * 0.065)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText('!', W * 0.22, H * 0.845)

  return c
}

/** Finalize door canvas: draw ISO id, type code, max-gross data */
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
  ctx.font = `bold ${Math.floor(H * 0.056)}px monospace`
  ctx.textAlign = 'right'
  ctx.fillText(iso.idLine, W * 0.94, H * 0.14)
  ctx.font = `600 ${Math.floor(H * 0.044)}px monospace`
  ctx.fillStyle = 'rgba(255,255,255,0.78)'
  ctx.fillText(iso.typeCode, W * 0.94, H * 0.20)

  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.textAlign = 'left'
  ctx.font = `500 ${Math.floor(H * 0.032)}px monospace`
  const lines = ['MAX. GROSS 32,500 KG', 'TARE 3,789 KG', 'NET 28,711 KG', 'CU.CAP. 67.6 CU.M']
  let y = H * 0.35
  for (const line of lines) {
    ctx.fillText(line, W * 0.56, y)
    y += H * 0.055
  }
  return c
}

function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

function getBasePair(colorHex: string): { longBase: HTMLCanvasElement; doorBase: HTMLCanvasElement } {
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
 * The "long sides" of the container run along X (length direction).
 */
export function createContainerMaterials(
  colorHex: string,
  containerId: string,
  port: string,
): THREE.MeshStandardMaterial[] {
  const livery = SHIPPING_LINE_LIVERY[port]
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

  const matOpts = (map: THREE.Texture, rough = 0.52, metal = 0.36): THREE.MeshStandardMaterialParameters => ({ map, roughness: rough, metalness: metal })
  const longMat = () => new THREE.MeshStandardMaterial(matOpts(texLong))
  const doorMat = () => new THREE.MeshStandardMaterial(matOpts(texDoor, 0.45, 0.34))

  // Box faces: +X end (door), -X end (door), +Y (roof), -Y (under), +Z (long side), -Z (long side)
  return [
    doorMat(),
    doorMat(),
    new THREE.MeshStandardMaterial(matOpts(texRoof, 0.60, 0.40)),
    new THREE.MeshStandardMaterial(matOpts(texUnder, 0.88, 0.20)),
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
