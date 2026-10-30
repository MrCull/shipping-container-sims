/**
 * TT-121: each SHC shows its own fleet number ("SHC nn") on the livery panel.
 * The id gives the number; the plate material's UVs are offset to that tile.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { shcFleetNumber, shcPlateMaterial } from '../modules/shcAssets'
import meta from '../assets/models/shc/shc.meta.json'

describe('SHC fleet numbers', () => {
  it('reads the number from the SHC id', () => {
    expect(shcFleetNumber('SHC01')).toBe(1)
    expect(shcFleetNumber('SHC13')).toBe(13)
    expect(shcFleetNumber('SHC120')).toBe(120)
    expect(shcFleetNumber('nonsense')).toBeNull()
  })

  it('offsets the plate tile by column and row, with tile 1 at the origin', () => {
    const f = meta.branding.fleetNumbers
    const source = new THREE.MeshStandardMaterial({ name: 'shc_plate' })
    const a = shcPlateMaterial(source, 1)
    const b = shcPlateMaterial(source, f.cols + 3) // row 1, column 2
    expect(a.userData.plateIndex).toBe(0)
    expect(b.userData.plateIndex).toBe(f.cols + 2)
    expect(a).not.toBe(source)
    const shader = { uniforms: {} as Record<string, { value: THREE.Vector2 }>, vertexShader: '#include <common>\n#include <uv_vertex>' }
    b.onBeforeCompile(shader as never, null as never)
    expect(shader.uniforms.plateOffset.value.x).toBeCloseTo(2 * f.tileSizeUv[0])
    expect(shader.uniforms.plateOffset.value.y).toBeCloseTo(1 * f.tileSizeUv[1])
  })

  it('wraps numbers beyond the plate count and ignores unnumbered ids', () => {
    const f = meta.branding.fleetNumbers
    const source = new THREE.MeshStandardMaterial()
    expect(shcPlateMaterial(source, f.count + 1).userData.plateIndex).toBe(0)
    expect(shcPlateMaterial(source, null).userData.plateIndex).toBe(0)
  })
})
