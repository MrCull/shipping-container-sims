/** The hero spreader loader (#273): fetches a kind's file on first need only and hands out clones of its LOD0 subtree. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createHeroEquipmentLoader, type HeroEquipmentKind } from '../modules/heroEquipmentAssets'

const URLS: Record<HeroEquipmentKind, string> = { sts: 'sts.glb', asc: 'asc.glb', shc: 'shc.glb', 'shc-body': 'hero-shc.glb' }

function fakeFile(): { scene: THREE.Object3D } {
  const scene = new THREE.Group()
  const root = new THREE.Group()
  const lod0 = new THREE.Group()
  lod0.name = 'LOD0'
  const lock = new THREE.Group()
  lock.name = 'twistlock_fl'
  lock.position.set(6, 0, 1.138)
  lod0.add(lock)
  root.add(lod0)
  scene.add(root)
  return { scene }
}

describe('hero spreader loader', () => {
  it('fetches nothing until a kind is asked for, then that file once', async () => {
    const fetched: string[] = []
    const load = createHeroEquipmentLoader(async (url) => (fetched.push(url), fakeFile()), URLS)
    expect(fetched).toEqual([])
    await Promise.all([load('asc'), load('asc')])
    await load('asc')
    expect(fetched).toEqual(['asc.glb'])
    await load('sts')
    expect(fetched).toEqual(['asc.glb', 'sts.glb'])
  })

  it('returns a separate clone of the LOD0 subtree on every call, rig nodes included', async () => {
    const load = createHeroEquipmentLoader(async () => fakeFile(), URLS)
    const a = await load('shc')
    const b = await load('shc')
    expect(a.name).toBe('LOD0')
    expect(a).not.toBe(b)
    expect(a.parent).toBeNull()
    const lock = a.getObjectByName('twistlock_fl')!
    expect(lock.position.toArray()).toEqual([6, 0, 1.138])
    lock.rotation.y = 1
    expect(b.getObjectByName('twistlock_fl')!.rotation.y).toBe(0)
  })

  it('retries after a failed fetch', async () => {
    let calls = 0
    const load = createHeroEquipmentLoader(async () => {
      if (calls++ === 0) throw new Error('offline')
      return fakeFile()
    }, URLS)
    await expect(load('asc')).rejects.toThrow('offline')
    expect((await load('asc')).name).toBe('LOD0')
  })
  it('fetches the SHC body (#275) from its own file, apart from the SHC spreader', async () => {
    const fetched: string[] = []
    const load = createHeroEquipmentLoader(async (url) => (fetched.push(url), fakeFile()), URLS)
    await load('shc')
    await load('shc-body')
    expect(fetched).toEqual(['shc.glb', 'hero-shc.glb'])
  })

  it('names hero-equipment/hero-shc.glb as the default file of the SHC body', () => {
    const src = readFileSync(fileURLToPath(new URL('../modules/heroEquipmentAssets.ts', import.meta.url)), 'utf8')
    expect(src).toContain("'shc-body': new URL('../assets/models/hero-equipment/hero-shc.glb', import.meta.url)")
  })
})
