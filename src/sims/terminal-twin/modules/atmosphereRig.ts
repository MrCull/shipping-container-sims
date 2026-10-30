/**
 * Three.js side of the atmosphere (TT-21): sun, sky, fog, and the cheap night
 * mode. Night uses NO extra real lights and no shadow pass: high-mast poles
 * carry additive glow points (one draw call), and every crane or carrier gets a
 * glow point too (a second draw call). Colours blend between day and night.
 */
import * as THREE from 'three'
import { ambientIntensity, type Lighting } from './atmosphere'
import type { QualityProfile } from './quality'
import type { SceneModel } from './sceneModel'
import { MAX_MASTS, mastSpots } from './infrastructureLayout'

const DAY = { sky: new THREE.Color('#a9bfd3'), hemiSky: new THREE.Color('#dfe9f5'), hemiGround: new THREE.Color('#5a5248'), sun: new THREE.Color('#fff4e0') }
const NIGHT = { sky: new THREE.Color('#0b1424'), hemiSky: new THREE.Color('#7088bd'), hemiGround: new THREE.Color('#454859'), sun: new THREE.Color('#8fa6d6') }
const DUSK_SUN = new THREE.Color('#ffb070')

export interface MastLayout {
  /** Z of the quay-side mast row. */
  quayZ: number
}

export interface AtmosphereState {
  mode: Lighting['mode']
  daylight: number
  shadows: boolean
  masts: number
  equipmentLights: number
}

function glowTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,236,190,1)')
  g.addColorStop(0.25, 'rgba(255,200,120,0.55)')
  g.addColorStop(1, 'rgba(255,170,80,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(canvas)
}

export class AtmosphereRig {
  readonly sun = new THREE.DirectionalLight('#fff4e0', 2.2)
  readonly hemi = new THREE.HemisphereLight('#dfe9f5', '#5a5248', 1.4)
  private readonly background = new THREE.Color(DAY.sky)
  private readonly fog = new THREE.Fog(DAY.sky, 900, 9000)
  private readonly masts: THREE.InstancedMesh
  private readonly mastGlow: THREE.Points
  private readonly equipGlow: THREE.Points
  private readonly equipPositions: Float32Array
  private equipCount = 0
  private mastCount = 0
  private lighting: Lighting | null = null
  /** Quality (TT-19): the sun may cast shadows, and how many mast glow points night mode draws. */
  private shadowsAllowed = true
  private mastGlowLimit = Infinity
  private disposables: { dispose(): void }[] = []

  constructor(
    scene: THREE.Scene,
    private model: SceneModel,
    layout: MastLayout,
    /** Fog far distance (m): the scenery's own, so the farthest backdrop piece stays hazy rather than erased. */
    fogFarM = 9000,
  ) {
    scene.background = this.background
    this.fog.far = fogFarM
    scene.fog = this.fog
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    // ~0.25 m shadow texels: bias so container corrugation does not self-shadow (acne).
    this.sun.shadow.normalBias = 0.35
    this.sun.shadow.bias = -0.0004
    const c = this.sun.shadow.camera
    c.left = -250
    c.right = 250
    c.top = 250
    c.bottom = -250
    c.near = 10
    c.far = 800
    scene.add(this.hemi, this.sun, this.sun.target)

    // High-mast poles (always visible) and their glow (night only).
    const spots = mastSpots({ config: model.config, blocks: model.blockList }, layout.quayZ) // same spots as the phase 2 mast models (TT-28)
    this.mastCount = Math.min(spots.length, MAX_MASTS)
    const poleGeo = new THREE.CylinderGeometry(0.35, 0.6, 30, 6)
    poleGeo.translate(0, 15, 0)
    const poleMat = new THREE.MeshStandardMaterial({ color: '#6b7078', roughness: 0.7 })
    this.masts = new THREE.InstancedMesh(poleGeo, poleMat, Math.max(1, this.mastCount))
    this.masts.count = this.mastCount
    const m = new THREE.Matrix4()
    const glow = new Float32Array(this.mastCount * 3)
    for (let i = 0; i < this.mastCount; i++) {
      const [x, z] = spots[i]
      m.makeTranslation(x, 0, z)
      this.masts.setMatrixAt(i, m)
      glow.set([x, 31, z], i * 3)
    }
    this.masts.frustumCulled = false
    scene.add(this.masts)
    const tex = glowTexture()
    const glowMat = (size: number) =>
      new THREE.PointsMaterial({
        size,
        sizeAttenuation: true,
        map: tex,
        color: '#ffd9a0',
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      })
    const mastGeo = new THREE.BufferGeometry()
    mastGeo.setAttribute('position', new THREE.BufferAttribute(glow, 3))
    this.mastGlow = new THREE.Points(mastGeo, glowMat(26))
    this.mastGlow.frustumCulled = false
    this.mastGlow.visible = false
    scene.add(this.mastGlow)

    const equipIds = model.config.sts.length + model.ascIds.length + model.shcIds.length
    this.equipPositions = new Float32Array(Math.max(1, equipIds) * 3)
    const equipGeo = new THREE.BufferGeometry()
    equipGeo.setAttribute('position', new THREE.BufferAttribute(this.equipPositions, 3))
    this.equipGlow = new THREE.Points(equipGeo, glowMat(9))
    this.equipGlow.frustumCulled = false
    this.equipGlow.visible = false
    scene.add(this.equipGlow)
    this.disposables.push(poleGeo, poleMat, this.masts, mastGeo, equipGeo, this.mastGlow.material as THREE.Material, this.equipGlow.material as THREE.Material)
    if (tex) this.disposables.push(tex)
    this.apply(lightingDay)
  }

  /** The phase 2 high-mast models (TT-28) draw the poles: hide the procedural ones (the night glow stays). */
  useMastModels(): void {
    this.masts.visible = false
  }

  /** Apply a lighting state (cheap: only recolours and toggles). */
  apply(l: Lighting): void {
    this.lighting = l
    const d = l.daylight
    this.background.lerpColors(NIGHT.sky, DAY.sky, d)
    this.fog.color.copy(this.background)
    this.hemi.color.lerpColors(NIGHT.hemiSky, DAY.hemiSky, d)
    this.hemi.groundColor.lerpColors(NIGHT.hemiGround, DAY.hemiGround, d)
    this.hemi.intensity = ambientIntensity(d)
    const warm = Math.max(0, 1 - Math.abs(l.sun.y - 40) / 90) * (l.mode === 'dusk' ? 1 : 0)
    this.sun.color.lerpColors(NIGHT.sun, DAY.sun, d).lerp(DUSK_SUN, warm * 0.6)
    // At night the "sun" is a dim moon: same light, no shadow pass.
    this.sun.intensity = 1.2 + 1.0 * d
    this.sun.castShadow = l.shadows && this.shadowsAllowed
    this.sun.position.set(l.sun.x, Math.max(30, l.sun.y), l.sun.z)
    const on = l.floodGlow > 0.02
    this.mastGlow.visible = on
    this.mastGlow.geometry.setDrawRange(0, Math.min(this.mastCount, this.mastGlowLimit))
    this.equipGlow.visible = on
    ;(this.mastGlow.material as THREE.PointsMaterial).opacity = Math.min(1, l.floodGlow)
    ;(this.equipGlow.material as THREE.PointsMaterial).opacity = Math.min(1, l.floodGlow)
  }

  /** Applies the quality profile (TT-19): shadows on/off, shadow map size, and the night glow-point budget on the masts. */
  setQuality(profile: QualityProfile): void {
    this.shadowsAllowed = profile.shadows
    this.mastGlowLimit = profile.nightLights
    if (this.sun.shadow.mapSize.x !== profile.shadowMapSize) {
      this.sun.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize)
      this.sun.shadow.map?.dispose()
      this.sun.shadow.map = null
    }
    if (this.lighting) this.apply(this.lighting)
    else this.sun.castShadow = profile.shadows
  }

  /** Follow the equipment with its glow points (only while the glow is visible). */
  update(t: number): void {
    if (!this.equipGlow.visible) return
    const model = this.model
    let n = 0
    const put = (x: number, y: number, z: number) => {
      this.equipPositions.set([x, y, z], n * 3)
      n++
    }
    for (const s of model.config.sts) put(model.stsPose(s.id, t).gantryX, 52, 4)
    for (const id of model.ascIds) {
      const p = model.ascPose(id, t)
      put(p.x, 17, p.z)
    }
    for (const id of model.shcIds) {
      const p = model.shcPose(id, t)
      put(p.x, 5.5, p.z)
    }
    this.equipCount = n
    this.equipGlow.geometry.setDrawRange(0, n)
    this.equipGlow.geometry.attributes.position.needsUpdate = true
  }

  state(): AtmosphereState {
    const l = this.lighting ?? lightingDay
    return {
      mode: l.mode,
      daylight: l.daylight,
      shadows: this.sun.castShadow,
      masts: this.mastGlow.visible ? Math.min(this.mastCount, this.mastGlowLimit) : 0,
      equipmentLights: this.equipGlow.visible ? this.equipCount : 0,
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
    this.disposables = []
  }
}

const lightingDay: Lighting = { mode: 'day', daylight: 1, sun: { x: 0, y: 300, z: 180 }, shadows: true, floodGlow: 0 }
