/**
 * #301: the sun's shadow camera covers a raised STS boom (tip about 126 m up), so its shadow is not clipped, at every
 * hour that casts shadows, for cranes within the shadow-covered stretch of the quay.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { lightingFor } from '../modules/atmosphere'
import { configureSunShadow, sunPosition } from '../modules/atmosphereRig'
import { STS, stsBoundsYZ } from '../modules/equipmentDims'

describe('sun shadow camera', () => {
  it('holds every corner of a raised STS box (boom at 80 degrees) at every shadow-casting hour', () => {
    const raised = stsBoundsYZ(80)
    expect(raised.y1).toBeGreaterThan(124)
    let checked = 0
    for (let hour = 0; hour < 24; hour += 0.5) {
      const l = lightingFor(hour, false)
      if (!l.shadows) continue
      const sun = new THREE.DirectionalLight()
      configureSunShadow(sun)
      const p = sunPosition(l)
      sun.position.set(p.x, p.y, p.z)
      sun.updateMatrixWorld()
      sun.target.updateMatrixWorld()
      sun.shadow.updateMatrices(sun)
      const cam = sun.shadow.camera
      for (const x of [-150, 0, 150]) {
        for (const y of [raised.y0, raised.y1]) {
          for (const z of [raised.z0, raised.z1]) {
            for (const dx of [-STS.legSpacingX / 2 - 2, STS.legSpacingX / 2 + 2]) {
              const ndc = new THREE.Vector3(x + dx, y, z).project(cam)
              const where = `ndc ${ndc.x.toFixed(2)} ${ndc.y.toFixed(2)} ${ndc.z.toFixed(2)} sun ${p.x.toFixed(0)} ${p.y.toFixed(0)} hour ${hour} x ${x + dx} y ${y.toFixed(0)} z ${z.toFixed(0)}`
              expect(Math.abs(ndc.x), where).toBeLessThanOrEqual(1)
              expect(Math.abs(ndc.y), where).toBeLessThanOrEqual(1)
              expect(Math.abs(ndc.z), where).toBeLessThanOrEqual(1)
              // where its shadow lands on the ground (same light-space x and y, deeper): inside the depth range too
              const ground = new THREE.Vector3(x + dx, y, z).addScaledVector(new THREE.Vector3(p.x, p.y, p.z).normalize(), -y / (p.y / Math.hypot(p.x, p.y, p.z)))
              expect(Math.abs(ground.y)).toBeLessThan(1e-6)
              expect(Math.abs(ground.clone().project(cam).z), `ground ${where}`).toBeLessThanOrEqual(1)
              checked++
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100)
  })
})
