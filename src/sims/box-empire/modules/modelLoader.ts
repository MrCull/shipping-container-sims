// ---------------------------------------------------------------------------
// Box Empire — Async GLB model loader with caching
// ---------------------------------------------------------------------------

import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const loader = new GLTFLoader()
const cache = new Map<string, THREE.Group>()
const pending = new Map<string, Promise<THREE.Group>>()

/**
 * Load a GLB model from a URL and return a cloned copy.
 * Subsequent calls for the same URL return a clone of the cached root.
 */
export function loadModel(url: string): Promise<THREE.Group> {
  if (pending.has(url)) {
    return pending.get(url)!.then(group => group.clone(true))
  }

  const promise = new Promise<THREE.Group>((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const root = gltf.scene
        root.traverse(obj => {
          const mesh = obj as THREE.Mesh
          if (mesh.isMesh) {
            mesh.castShadow = true
            mesh.receiveShadow = true
          }
        })
        cache.set(url, root)
        resolve(root)
      },
      undefined,
      reject,
    )
  })

  pending.set(url, promise)
  return promise.then(group => {
    pending.delete(url)
    return group.clone(true)
  })
}

/**
 * Returns a clone of a cached model synchronously, or null if not yet loaded.
 */
export function getModelSync(url: string): THREE.Group | null {
  const cached = cache.get(url)
  return cached ? cached.clone(true) : null
}

export function disposeModel(group: THREE.Group): void {
  group.traverse(obj => {
    const mesh = obj as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    if (mesh.material) {
      if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose())
      else mesh.material.dispose()
    }
  })
}
