import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { FAR_ATLAS_BLEND_M, liveryMaterial, LIVERY_ATLAS } from '../modules/containerAssets'

function compile(mat: THREE.Material) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: '#include <common>\n#include <uv_vertex>',
    fragmentShader: '#include <common>\n#include <map_fragment>',
  }
  ;(mat.onBeforeCompile as (s: unknown, r: unknown) => void)(shader, null)
  return shader
}

describe('far-field wordmark atlas (#256)', () => {
  it('blends to the far atlas between two distances, with no extra per-instance data', () => {
    const [start, end] = FAR_ATLAS_BLEND_M
    expect(start).toBeGreaterThanOrEqual(60)
    expect(end).toBeLessThanOrEqual(110)
    expect(end - start).toBeGreaterThanOrEqual(20) // a wide blend is what keeps the switch from popping
    const far = new THREE.Texture()
    const mat = liveryMaterial(new THREE.MeshStandardMaterial({ map: new THREE.Texture() }), LIVERY_ATLAS, true, far)
    const s = compile(mat)
    expect(s.uniforms.farMap.value).toBe(far)
    expect(s.uniforms.farRange.value).toEqual(new THREE.Vector2(start, end))
    expect(s.fragmentShader).toContain('texture2D( farMap, vMapUv )')
    expect(s.fragmentShader).toContain('vViewPosition')
    expect(s.fragmentShader).not.toContain('#include <map_fragment>')
    // Same UV, same livery attribute: only the texture changes.
    expect(s.vertexShader.match(/attribute /g)?.length).toBe(1)
  })

  it('leaves the shader as it was without a far atlas (vessels, placeholders)', () => {
    const s = compile(liveryMaterial(new THREE.MeshStandardMaterial({ map: new THREE.Texture() })))
    expect(s.fragmentShader).toContain('#include <map_fragment>')
    expect(s.uniforms.farMap).toBeUndefined()
  })

  it('the atlas manifest names the far atlas and its layout equals the near one', () => {
    const far = (LIVERY_ATLAS as unknown as { far?: { file: string; size: number[]; ribPitchM: number } }).far
    expect(far?.file).toBe('livery-atlas-far.webp')
    expect(far?.size).toEqual([1024, 1024])
    expect(far!.ribPitchM).toBeGreaterThan(0.56) // coarser than the LOD0 rib so it survives the mip chain
  })
})
