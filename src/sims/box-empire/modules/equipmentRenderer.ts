// ---------------------------------------------------------------------------
// Box Empire — Equipment mesh management (improved quality)
// ---------------------------------------------------------------------------

import * as THREE from 'three'
import type { Equipment } from '../types'

interface EquipmentParts {
  boomGroup?: THREE.Group
  mhcSpreader?: THREE.Group
  mhcCable?: THREE.Mesh
}

export class EquipmentRenderer {
  private meshes = new Map<string, THREE.Group>()
  private parts = new Map<string, EquipmentParts>()
  private scene: THREE.Scene

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  private createReachStacker(): { group: THREE.Group; parts: EquipmentParts } {
    const group = new THREE.Group()

    const orangeMat  = new THREE.MeshPhongMaterial({ color: 0xe67e22, specular: 0x994400, shininess: 45 })
    const darkMat    = new THREE.MeshPhongMaterial({ color: 0x2c3e50, specular: 0x112233, shininess: 35 })
    const yellowMat  = new THREE.MeshPhongMaterial({ color: 0xf1c40f, emissive: 0x554400, emissiveIntensity: 0.3 })
    const blackMat   = new THREE.MeshPhongMaterial({ color: 0x111111, shininess: 60 })
    const chromeMat  = new THREE.MeshPhongMaterial({ color: 0xaaaaaa, specular: 0xffffff, shininess: 120 })
    const glassMat   = new THREE.MeshPhongMaterial({ color: 0x4a90d9, specular: 0xaaccee, shininess: 160, transparent: true, opacity: 0.72 })

    // Main chassis body
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.0, 5.0), orangeMat)
    body.position.set(0, 1.6, 0); body.castShadow = true; group.add(body)

    // Engine hood (slightly raised rear)
    const hood = new THREE.Mesh(new THREE.BoxGeometry(3.1, 1.6, 1.6), orangeMat)
    hood.position.set(0, 2.5, -1.7); hood.castShadow = true; group.add(hood)

    // Exhaust stack
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 1.2, 8), chromeMat)
    stack.position.set(-1.2, 3.4, -1.5); group.add(stack)

    // Operator cab
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.7, 1.6), darkMat)
    cab.position.set(-0.5, 3.2, 0.9); cab.castShadow = true; group.add(cab)

    // Cab front windscreen
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.0, 0.06), glassMat)
    win.position.set(-0.5, 3.3, 1.73); group.add(win)

    // Side windows
    for (const sx of [-1, 1]) {
      const sw = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.80, 1.1), glassMat)
      sw.position.set(sx * 1.53, 3.3, 0.8); group.add(sw)
    }

    // Counterweight at rear
    const cw = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.4, 1.3), new THREE.MeshPhongMaterial({ color: 0x444444, shininess: 20 }))
    cw.position.set(0, 1.2, -2.8); cw.castShadow = true; group.add(cw)

    // Warning light
    const wl = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.14, 8), yellowMat)
    wl.position.set(-0.5, 4.1, 0.8); group.add(wl)

    // Boom group — pivot at chassis front for angle animation
    const boomGroup = new THREE.Group()
    boomGroup.position.set(0.9, 3.3, 2.2)

    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 6.0), orangeMat)
    boom.position.set(0, 0, 3.0); boom.castShadow = true; boomGroup.add(boom)

    const ext = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.30, 3.2), orangeMat)
    ext.position.set(0, 0, 7.6); boomGroup.add(ext)

    const spreaderFrame = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.22, 0.45), new THREE.MeshPhongMaterial({ color: 0xc0392b, shininess: 40 }))
    spreaderFrame.position.set(0, -0.55, 9.2); boomGroup.add(spreaderFrame)

    for (const sx of [-3.2, 3.2]) {
      const tw = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.9, 0.32), new THREE.MeshPhongMaterial({ color: 0xc0392b }))
      tw.position.set(sx, -0.55, 9.2); boomGroup.add(tw)
    }

    boomGroup.rotation.x = -0.15
    group.add(boomGroup)

    // Wheels — rear double axle + front steer
    const wheelGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.48, 16)
    const rimGeo   = new THREE.CylinderGeometry(0.30, 0.30, 0.50, 8)
    const rimMat   = new THREE.MeshPhongMaterial({ color: 0xaaaaaa, specular: 0xffffff, shininess: 80 })
    for (const [sx, sz] of [[-1.72, -1.8], [-1.72, -2.7], [1.72, -1.8], [1.72, -2.7]]) {
      const w = new THREE.Mesh(wheelGeo, blackMat); w.rotation.z = Math.PI / 2
      w.position.set(sx, 0.62, sz); w.castShadow = true; group.add(w)
      const r = new THREE.Mesh(rimGeo, rimMat); r.rotation.z = Math.PI / 2
      r.position.set(sx, 0.62, sz); group.add(r)
    }
    for (const sx of [-1.65, 1.65]) {
      const fw = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.44, 16), blackMat)
      fw.rotation.z = Math.PI / 2; fw.position.set(sx, 0.58, 1.8); fw.castShadow = true; group.add(fw)
      const fr = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.46, 8), rimMat)
      fr.rotation.z = Math.PI / 2; fr.position.set(sx, 0.58, 1.8); group.add(fr)
    }

    return { group, parts: { boomGroup } }
  }

  private createMobileHarborCrane(): { group: THREE.Group; parts: EquipmentParts } {
    const group = new THREE.Group()

    const blueMat  = new THREE.MeshPhongMaterial({ color: 0x1a5276, specular: 0x224488, shininess: 55 })
    const redMat   = new THREE.MeshPhongMaterial({ color: 0xc0392b, specular: 0x441111, shininess: 45 })
    const yellowMat= new THREE.MeshPhongMaterial({ color: 0xf1c40f, emissive: 0x554400, emissiveIntensity: 0.3 })
    const darkMat  = new THREE.MeshPhongMaterial({ color: 0x1c2833, shininess: 22 })
    const greyMat  = new THREE.MeshPhongMaterial({ color: 0x888888, specular: 0xaaaaaa, shininess: 50 })
    const glassMat = new THREE.MeshPhongMaterial({ color: 0x4a90d9, emissive: 0x224466, emissiveIntensity: 0.5, transparent: true, opacity: 0.75 })

    // Base undercarriage
    const base = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.2, 4.2), darkMat)
    base.position.y = 0.6; base.castShadow = true; group.add(base)

    // Crawler tracks
    for (const sign of [-1, 1]) {
      const track = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.8, 1.0), darkMat)
      track.position.set(0, 0.4, sign * 2.2); group.add(track)
      for (let i = -1.5; i <= 1.5; i += 0.5) {
        const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.05, 10), greyMat)
        roller.rotation.z = Math.PI / 2; roller.position.set(i, 0.32, sign * 2.2); group.add(roller)
      }
    }

    // Rotating superstructure platform
    const platform = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.55, 4.0), blueMat)
    platform.position.y = 1.5; platform.castShadow = true; group.add(platform)

    // Tower
    const tower = new THREE.Mesh(new THREE.BoxGeometry(2.2, 13, 2.2), blueMat)
    tower.position.y = 8.3; tower.castShadow = true; group.add(tower)

    // A-frame brace
    for (const sign of [-1, 1]) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.22, 9, 0.22), greyMat)
      brace.position.set(sign * 1.4, 8, 0.5); brace.rotation.z = sign * 0.2; group.add(brace)
    }

    // Cab / operator room
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.0, 1.8), yellowMat)
    cab.position.set(0, 14.0, 1.0); cab.castShadow = true; group.add(cab)
    const cabWin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.2, 0.07), glassMat)
    cabWin.position.set(0, 14.0, 1.95); group.add(cabWin)

    // Jib (horizontal boom over vessel)
    const jib = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 16), redMat)
    jib.position.set(0, 14.5, -6); jib.castShadow = true; group.add(jib)

    // Counterjib (rear)
    const cjib = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 6), greyMat)
    cjib.position.set(0, 14.2, 4); group.add(cjib)
    const cw = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 2), new THREE.MeshPhongMaterial({ color: 0x444444 }))
    cw.position.set(0, 14.5, 6.5); group.add(cw)

    // Spreader group (animated)
    const mhcSpreader = new THREE.Group()
    mhcSpreader.position.set(0, 14.5, -6)

    const spreaderBar = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.22, 0.44), greyMat)
    mhcSpreader.add(spreaderBar)

    for (const sx of [-3.2, 3.2]) {
      const tw = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.8, 0.32), greyMat)
      tw.position.set(sx, -0.5, 0); mhcSpreader.add(tw)
    }

    const mhcCable = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1, 0.06), greyMat)
    mhcCable.position.set(0, -0.5, 0); mhcSpreader.add(mhcCable)

    group.add(mhcSpreader)
    return { group, parts: { mhcSpreader, mhcCable } }
  }

  update(equipmentList: Equipment[]): void {
    for (const eq of equipmentList) {
      let mesh = this.meshes.get(eq.id)
      if (!mesh) {
        const r = eq.type === 'reach_stacker' ? this.createReachStacker() : this.createMobileHarborCrane()
        mesh = r.group
        mesh.name = eq.id
        this.scene.add(mesh)
        this.meshes.set(eq.id, mesh)
        this.parts.set(eq.id, r.parts)
      }

      mesh.position.set(eq.position.x, 0, eq.position.z)

      if (eq.type === 'reach_stacker') {
        // Use headingY from controller (updated to face target)
        if (eq.headingY !== undefined) {
          mesh.rotation.y = eq.headingY
        } else if (eq.targetPosition) {
          const dx = eq.targetPosition.x - eq.position.x
          const dz = eq.targetPosition.z - eq.position.z
          if (Math.abs(dx) > 0.1 || Math.abs(dz) > 0.1) {
            mesh.rotation.y = Math.atan2(dx, dz)
          }
        }
      }

      const p = this.parts.get(eq.id)

      if (p?.boomGroup && eq.type === 'reach_stacker') {
        const t = Math.min(1, eq.armTargetY / 9)
        p.boomGroup.rotation.x = -0.15 - t * 0.60
      }

      if (p?.mhcSpreader && eq.type === 'mobile_harbor_crane') {
        const jibY = 14.5
        p.mhcSpreader.position.set(0, jibY, -6 + eq.spreaderZ)
        if (p.mhcCable) {
          const drop = Math.max(0.1, jibY - eq.armTargetY)
          p.mhcCable.scale.y = drop
          p.mhcCable.position.y = -drop / 2
        }
      }
    }
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) {
      mesh.traverse(obj => {
        const m = obj as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
        if (m.material) {
          if (Array.isArray(m.material)) m.material.forEach(mt => mt.dispose())
          else m.material.dispose()
        }
      })
      this.scene.remove(mesh)
    }
    this.meshes.clear()
    this.parts.clear()
  }
}
