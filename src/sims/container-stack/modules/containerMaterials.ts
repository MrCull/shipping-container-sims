import * as THREE from 'three'

const textureCache = new Map<string, { longBase: HTMLCanvasElement; doorBase: HTMLCanvasElement }>()

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function isoCodesFromId(containerId: string): { line1: string; line2: string; side: string } {
  let h = 0
  for (let i = 0; i < containerId.length; i++) {
    h = (h * 31 + containerId.charCodeAt(i)!) >>> 0
  }
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ'
  const o = letters[h % letters.length]!
  const p = letters[(h >> 5) % letters.length]!
  const q = letters[(h >> 10) % letters.length]!
  const u = letters[(h >> 15) % letters.length]!
  const num = String(100000 + (h % 900000)).slice(1)
  const check = String((h % 9) + 1)
  const line1 = `${o}${p}${q}${u} ${num} ${check}`
  const types = ['22G1', '42G1', '45G1', '25G1']
  const line2 = types[h % types.length]!
  const side = `SIDE ${(h % 89) + 10}`
  return { line1, line2, side }
}

function makeCorrugatedBase(
  w: number,
  h: number,
  baseRgb: { r: number; g: number; b: number },
  vertical: boolean
): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, vertical ? w : 0, vertical ? 0 : h)
  const darken = 0.88
  g.addColorStop(
    0,
    `rgb(${Math.floor(baseRgb.r * darken)},${Math.floor(baseRgb.g * darken)},${Math.floor(baseRgb.b * darken)})`
  )
  g.addColorStop(
    1,
    `rgb(${Math.min(255, Math.floor(baseRgb.r * 1.08))},${Math.min(255, Math.floor(baseRgb.g * 1.08))},${Math.min(255, Math.floor(baseRgb.b * 1.08))})`
  )
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  const rib = vertical ? Math.max(3, Math.floor(w / 36)) : Math.max(3, Math.floor(h / 30))
  ctx.globalAlpha = 0.2
  ctx.fillStyle = '#000000'
  if (vertical) {
    for (let x = 0; x < w; x += rib * 2) {
      ctx.fillRect(x, 0, rib, h)
    }
  } else {
    for (let y = 0; y < h; y += rib * 2) {
      ctx.fillRect(0, y, w, rib)
    }
  }
  ctx.globalAlpha = 1
  ctx.strokeStyle = 'rgba(0,0,0,0.28)'
  ctx.lineWidth = 1
  for (let i = 0; i < 6; i++) {
    ctx.beginPath()
    ctx.moveTo(0, (h / 6) * i)
    ctx.lineTo(w, (h / 6) * i)
    ctx.stroke()
  }
  return c
}

function makeDoorBase(w: number, h: number, baseRgb: { r: number; g: number; b: number }): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = `rgb(${Math.floor(baseRgb.r * 0.78)},${Math.floor(baseRgb.g * 0.78)},${Math.floor(baseRgb.b * 0.78)})`
  ctx.fillRect(0, 0, w, h)

  const mid = w * 0.5
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(mid, h * 0.06)
  ctx.lineTo(mid, h * 0.94)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(255,255,255,0.1)'
  ctx.lineWidth = 2
  ctx.strokeRect(w * 0.05, h * 0.05, w * 0.4, h * 0.9)
  ctx.strokeRect(w * 0.55, h * 0.05, w * 0.4, h * 0.9)

  for (let i = 1; i < 7; i++) {
    const y = h * (0.1 + i * 0.11)
    ctx.beginPath()
    ctx.moveTo(w * 0.07, y)
    ctx.lineTo(w * 0.43, y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(w * 0.57, y)
    ctx.lineTo(w * 0.93, y)
    ctx.stroke()
  }

  const stripeH = h * 0.045
  ctx.fillStyle = '#facc15'
  ctx.fillRect(0, 0, w, stripeH)
  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#000000' : '#facc15'
    ctx.fillRect((w / 18) * i, 0, w / 18 + 1, stripeH)
  }

  ctx.fillStyle = 'rgba(180,190,200,0.92)'
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'
  ctx.lineWidth = 2
  ctx.fillRect(w * 0.06, h * 0.72, w * 0.32, h * 0.2)
  ctx.strokeRect(w * 0.06, h * 0.72, w * 0.32, h * 0.2)
  ctx.fillStyle = 'rgba(20,22,28,0.95)'
  ctx.font = `600 ${Math.floor(h * 0.028)}px monospace`
  ctx.textAlign = 'left'
  let ly = h * 0.745
  for (const line of ['CSC SAFETY', 'APPR. VALID', 'MAX GROSS 30480 KG']) {
    ctx.fillText(line, w * 0.08, ly)
    ly += h * 0.045
  }

  ctx.fillStyle = 'rgba(250,204,21,0.95)'
  ctx.fillRect(w * 0.58, h * 0.78, w * 0.36, h * 0.1)
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'
  ctx.strokeRect(w * 0.58, h * 0.78, w * 0.36, h * 0.1)
  ctx.fillStyle = '#1a1a1a'
  ctx.font = `bold ${Math.floor(h * 0.05)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText('2.9m', w * 0.76, h * 0.845)

  return c
}

function makeRoofCanvas(w: number, h: number, baseRgb: { r: number; g: number; b: number }): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = `rgb(${Math.floor(baseRgb.r * 0.92)},${Math.floor(baseRgb.g * 0.92)},${Math.floor(baseRgb.b * 0.92)})`
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = 'rgba(0,0,0,0.18)'
  for (let x = 0; x < w; x += 14) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
  }
  return c
}

function makeUnderCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#1a1d24'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(60,65,75,0.5)'
  for (let i = 0; i < 8; i++) {
    ctx.fillRect((w / 8) * i, 0, 3, h)
  }
  return c
}

function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  return t
}

function getColorPatternBases(colorHex: string): { longBase: HTMLCanvasElement; doorBase: HTMLCanvasElement } {
  let hit = textureCache.get(colorHex)
  if (!hit) {
    const rgb = hexToRgb(colorHex)
    hit = {
      longBase: makeCorrugatedBase(512, 256, rgb, true),
      doorBase: makeDoorBase(384, 384, rgb),
    }
    textureCache.set(colorHex, hit)
  }
  return hit
}

function finalizeLongWallCanvas(base: HTMLCanvasElement, iso: { line1: string; line2: string; side: string }): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = base.width
  c.height = base.height
  const ctx = c.getContext('2d')!
  ctx.drawImage(base, 0, 0)
  ctx.save()
  ctx.translate(c.width * 0.92, c.height * 0.5)
  ctx.rotate(-Math.PI / 2)
  ctx.fillStyle = 'rgba(255,255,255,0.88)'
  ctx.font = `bold ${Math.floor(c.height * 0.09)}px monospace`
  ctx.textAlign = 'center'
  ctx.fillText(iso.line1, 0, -c.height * 0.04)
  ctx.font = `600 ${Math.floor(c.height * 0.065)}px monospace`
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.fillText(iso.line2, 0, c.height * 0.06)
  ctx.restore()
  ctx.fillStyle = 'rgba(34,197,94,0.9)'
  ctx.fillRect(c.width * 0.04, c.height * 0.12, c.width * 0.14, c.height * 0.2)
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.strokeRect(c.width * 0.04, c.height * 0.12, c.width * 0.14, c.height * 0.2)
  ctx.fillStyle = '#052e16'
  ctx.font = `600 ${Math.floor(c.height * 0.05)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText('FSC', c.width * 0.11, c.height * 0.24)
  ctx.fillStyle = 'rgba(251,191,36,0.95)'
  ctx.beginPath()
  ctx.moveTo(c.width * 0.22, c.height * 0.72)
  ctx.lineTo(c.width * 0.28, c.height * 0.88)
  ctx.lineTo(c.width * 0.16, c.height * 0.88)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#000'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = '#000'
  ctx.font = `bold ${Math.floor(c.height * 0.06)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText('!', c.width * 0.22, c.height * 0.84)
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.font = `500 ${Math.floor(c.height * 0.055)}px monospace`
  ctx.textAlign = 'left'
  ctx.fillText(iso.side, c.width * 0.06, c.height * 0.94)
  return c
}

function finalizeDoorCanvas(base: HTMLCanvasElement, iso: { line1: string; line2: string }): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = base.width
  c.height = base.height
  const ctx = c.getContext('2d')!
  ctx.drawImage(base, 0, 0)
  const w = c.width
  const h = c.height
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.font = `bold ${Math.floor(h * 0.055)}px monospace`
  ctx.textAlign = 'right'
  ctx.fillText(iso.line1, w * 0.94, h * 0.14)
  ctx.font = `600 ${Math.floor(h * 0.045)}px monospace`
  ctx.fillStyle = 'rgba(255,255,255,0.8)'
  ctx.fillText(iso.line2, w * 0.94, h * 0.2)
  ctx.textAlign = 'left'
  ctx.fillStyle = 'rgba(255,255,255,0.88)'
  ctx.font = `500 ${Math.floor(h * 0.032)}px monospace`
  const lines = [
    'MAX. GROSS 32,500 KG',
    'TARE 3,789 KG',
    'NET 28,800 KG',
    'CU.CAP. 67.6 CU.M',
  ]
  let y = h * 0.34
  for (const line of lines) {
    ctx.fillText(line, w * 0.58, y)
    y += h * 0.055
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(w * 0.22, h * 0.22, h * 0.08, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.font = `600 ${Math.floor(h * 0.028)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText('UCS', w * 0.22, h * 0.23)
  return c
}

/**
 * Unique materials per container instance (so hover highlight does not affect same-colour blocks).
 */
export function createInstanceContainerMaterials(
  colorHex: string,
  longAlongX: boolean,
  containerId: string
): THREE.MeshStandardMaterial[] {
  const rgb = hexToRgb(colorHex)
  const { longBase, doorBase } = getColorPatternBases(colorHex)
  const iso = isoCodesFromId(containerId)

  const longCanvas = finalizeLongWallCanvas(longBase, iso)
  const doorCanvas = finalizeDoorCanvas(doorBase, iso)

  const texLong = canvasTexture(longCanvas)
  const texDoor = canvasTexture(doorCanvas)
  texDoor.wrapS = THREE.ClampToEdgeWrapping
  texDoor.wrapT = THREE.ClampToEdgeWrapping

  const roofCanvas = makeRoofCanvas(512, 256, rgb)
  const underCanvas = makeUnderCanvas(512, 256)
  const texRoof = canvasTexture(roofCanvas)
  const texUnder = canvasTexture(underCanvas)

  const matOpts = (map: THREE.Texture, rough = 0.55, metal = 0.38): THREE.MeshStandardMaterialParameters => ({
    map,
    roughness: rough,
    metalness: metal,
  })

  const doorMat = () => new THREE.MeshStandardMaterial(matOpts(texDoor, 0.46, 0.36))
  const longMat = () => new THREE.MeshStandardMaterial(matOpts(texLong, 0.5, 0.37))

  if (longAlongX) {
    return [
      longMat(),
      longMat(),
      new THREE.MeshStandardMaterial(matOpts(texRoof, 0.62, 0.42)),
      new THREE.MeshStandardMaterial(matOpts(texUnder, 0.9, 0.2)),
      doorMat(),
      doorMat(),
    ]
  }
  return [
    doorMat(),
    doorMat(),
    new THREE.MeshStandardMaterial(matOpts(texRoof, 0.62, 0.42)),
    new THREE.MeshStandardMaterial(matOpts(texUnder, 0.9, 0.2)),
    longMat(),
    longMat(),
  ]
}

export function disposeInstanceMaterials(materials: THREE.MeshStandardMaterial[]): void {
  for (const m of materials) {
    m.map?.dispose()
    m.dispose()
  }
}

/** @deprecated use createInstanceContainerMaterials */
export function getShippingContainerMaterials(
  colorHex: string,
  longAlongX: boolean
): THREE.MeshStandardMaterial[] {
  return createInstanceContainerMaterials(colorHex, longAlongX, 'legacy')
}

export function disposeContainerMaterialCache(): void {
  textureCache.clear()
}
