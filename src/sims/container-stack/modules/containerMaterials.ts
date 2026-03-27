import * as THREE from 'three'

const materialCache = new Map<string, THREE.MeshStandardMaterial[]>()

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function makeCorrugatedCanvas(
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
  g.addColorStop(0, `rgb(${Math.floor(baseRgb.r * darken)},${Math.floor(baseRgb.g * darken)},${Math.floor(baseRgb.b * darken)})`)
  g.addColorStop(1, `rgb(${Math.min(255, Math.floor(baseRgb.r * 1.08))},${Math.min(255, Math.floor(baseRgb.g * 1.08))},${Math.min(255, Math.floor(baseRgb.b * 1.08))})`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  const rib = vertical ? Math.max(3, Math.floor(w / 32)) : Math.max(3, Math.floor(h / 28))
  ctx.globalAlpha = 0.22
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

  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.lineWidth = 1
  for (let i = 0; i < 5; i++) {
    ctx.beginPath()
    ctx.moveTo(0, (h / 5) * i)
    ctx.lineTo(w, (h / 5) * i)
    ctx.stroke()
  }
  return c
}

function makeDoorCanvas(w: number, h: number, baseRgb: { r: number; g: number; b: number }): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = `rgb(${Math.floor(baseRgb.r * 0.75)},${Math.floor(baseRgb.g * 0.75)},${Math.floor(baseRgb.b * 0.75)})`
  ctx.fillRect(0, 0, w, h)

  const mid = w * 0.5
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(mid, h * 0.08)
  ctx.lineTo(mid, h * 0.92)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 2
  ctx.strokeRect(w * 0.06, h * 0.06, w * 0.38, h * 0.88)
  ctx.strokeRect(w * 0.56, h * 0.06, w * 0.38, h * 0.88)

  for (let i = 1; i < 6; i++) {
    const y = h * (0.12 + i * 0.12)
    ctx.beginPath()
    ctx.moveTo(w * 0.08, y)
    ctx.lineTo(w * 0.42, y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(w * 0.58, y)
    ctx.lineTo(w * 0.92, y)
    ctx.stroke()
  }

  ctx.fillStyle = 'rgba(30,30,35,0.9)'
  ctx.fillRect(w * 0.18, h * 0.38, w * 0.64, h * 0.14)
  ctx.fillStyle = 'rgba(220,220,225,0.85)'
  ctx.font = `bold ${Math.floor(h * 0.07)}px monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('CONTENGA', w / 2, h * 0.45)

  return c
}

function makeRoofCanvas(w: number, h: number, baseRgb: { r: number; g: number; b: number }): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = `rgb(${Math.floor(baseRgb.r * 0.92)},${Math.floor(baseRgb.g * 0.92)},${Math.floor(baseRgb.b * 0.92)})`
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = 'rgba(0,0,0,0.2)'
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

/**
 * Six materials for BoxGeometry face order: +x, -x, +y, -y, +z, -z
 * @param longAlongX true when BoxGeometry(width, height, length) — long axis Z, long walls ±X
 * @param longAlongX false when BoxGeometry(length, height, width) — long axis X, long walls ±Z
 */
export function getShippingContainerMaterials(
  colorHex: string,
  longAlongX: boolean
): THREE.MeshStandardMaterial[] {
  const key = `${colorHex}|${longAlongX}`
  const hit = materialCache.get(key)
  if (hit) return hit

  const rgb = hexToRgb(colorHex)

  const sideW = 512
  const sideH = 256
  const doorW = 256
  const doorH = 256
  const roofW = 512
  const roofH = 256

  const corrugatedLongWall = makeCorrugatedCanvas(sideW, sideH, rgb, true)
  const door = makeDoorCanvas(doorW, doorH, rgb)
  const roof = makeRoofCanvas(roofW, roofH, rgb)
  const under = makeUnderCanvas(roofW, roofH)

  const texLong = canvasTexture(corrugatedLongWall)
  const texDoor = canvasTexture(door)
  texDoor.wrapS = THREE.ClampToEdgeWrapping
  texDoor.wrapT = THREE.ClampToEdgeWrapping
  const texRoof = canvasTexture(roof)
  const texUnder = canvasTexture(under)

  const matOpts = (map: THREE.Texture, rough = 0.55, metal = 0.38): THREE.MeshStandardMaterialParameters => ({
    map,
    roughness: rough,
    metalness: metal,
  })

  const doorMat = () => new THREE.MeshStandardMaterial(matOpts(texDoor, 0.48, 0.35))
  const longMat = () => new THREE.MeshStandardMaterial(matOpts(texLong, 0.52, 0.36))

  let mats: THREE.MeshStandardMaterial[]

  if (longAlongX) {
    mats = [
      longMat(),
      longMat(),
      new THREE.MeshStandardMaterial(matOpts(texRoof, 0.62, 0.42)),
      new THREE.MeshStandardMaterial(matOpts(texUnder, 0.9, 0.2)),
      doorMat(),
      doorMat(),
    ]
  } else {
    mats = [
      doorMat(),
      doorMat(),
      new THREE.MeshStandardMaterial(matOpts(texRoof, 0.62, 0.42)),
      new THREE.MeshStandardMaterial(matOpts(texUnder, 0.9, 0.2)),
      longMat(),
      longMat(),
    ]
  }

  materialCache.set(key, mats)
  return mats
}

export function disposeContainerMaterialCache(): void {
  for (const mats of materialCache.values()) {
    for (const m of mats) {
      m.map?.dispose()
      m.dispose()
    }
  }
  materialCache.clear()
}
