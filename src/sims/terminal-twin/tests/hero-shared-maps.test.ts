import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { shareHeroMaps } from '../modules/heroAssets'

const named = (name: string): THREE.Texture => Object.assign(new THREE.Texture(), { name })

describe('shareHeroMaps', () => {
  it('points every later file at the first file\'s copy of a map and disposes the duplicate', () => {
    const cache = new Map<string, THREE.Texture>()
    const first = new THREE.MeshStandardMaterial({ normalMap: named('hero-detail-normal'), roughnessMap: named('hero-orm') })
    expect(shareHeroMaps(first, cache)).toBe(0)
    const dupNormal = named('hero-detail-normal')
    let disposed = 0
    dupNormal.addEventListener('dispose', () => disposed++)
    const second = new THREE.MeshStandardMaterial({ normalMap: dupNormal, roughnessMap: named('hero-orm') })
    expect(shareHeroMaps(second, cache)).toBe(2)
    expect(second.normalMap).toBe(first.normalMap)
    expect(second.roughnessMap).toBe(first.roughnessMap)
    expect(disposed).toBe(1)
  })

  it('leaves unnamed maps alone', () => {
    const cache = new Map<string, THREE.Texture>()
    const a = new THREE.MeshStandardMaterial({ normalMap: new THREE.Texture() })
    const b = new THREE.MeshStandardMaterial({ normalMap: new THREE.Texture() })
    shareHeroMaps(a, cache)
    expect(shareHeroMaps(b, cache)).toBe(0)
    expect(b.normalMap).not.toBe(a.normalMap)
  })
})
