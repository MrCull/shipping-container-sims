import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { TRUCK, OUTBOUND_TRUCK } from './config'

const GLB_URLS = {
  trailer: new URL('../assets/container-trailer-chassis.glb', import.meta.url).href,
  cab:     new URL('../assets/truck-cab.glb', import.meta.url).href,
}

const _loader = new GLTFLoader()
const _cache  = new Map<string, THREE.Group>()

async function loadAndCache(key: 'trailer' | 'cab'): Promise<THREE.Group> {
  const url = GLB_URLS[key]
  if (_cache.has(url)) return _cache.get(url)!.clone(true)
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) =>
    _loader.load(url, resolve, undefined, reject)
  )
  const root = gltf.scene
  root.traverse(obj => {
    if ((obj as THREE.Mesh).isMesh) { obj.castShadow = true; obj.receiveShadow = true }
  })
  _cache.set(url, root.clone(true))
  return root
}

/** Pre-warm both GLBs into cache (call in buildScene alongside loadShipGLB). */
export async function loadTruckGLBs(): Promise<void> {
  await Promise.all([loadAndCache('trailer'), loadAndCache('cab')])
}

export interface OutboundTruckEntry {
  truck: THREE.Group
}

/**
 * Spawn a queue of empty outbound trucks on the far road lane (positive Z from crane dock).
 * Returns an array of truck groups ordered front-to-back (index 0 is at the crane).
 */
export async function createOutboundTruckQueue(
  scene: THREE.Scene,
  dockX: number,
  dockZ: number,
  count: number
): Promise<OutboundTruckEntry[]> {
  const entries: OutboundTruckEntry[] = []
  for (let i = 0; i < count; i++) {
    const truck = await createTruckGLB()
    // Truck 0 is at crane dock, queue extends in positive-X (land side)
    const xPos = dockX + i * OUTBOUND_TRUCK.spacing
    const zPos = dockZ + OUTBOUND_TRUCK.dockZOffset
    truck.position.set(xPos, 0, zPos)
    truck.name = `outbound-truck-${i}`
    // Face negative-X so trucks drive away toward negative-X after loading
    truck.rotation.y = Math.PI
    scene.add(truck)
    entries.push({ truck })
  }
  return entries
}

/** Assemble a combined truck+trailer group. */
export async function createTruckGLB(): Promise<THREE.Group> {
  const [trailerRoot, cabRoot] = await Promise.all([
    loadAndCache('trailer'),
    loadAndCache('cab'),
  ])

  // ── Trailer ──────────────────────────────────────────────────────────────────
  trailerRoot.rotation.y = Math.PI
  trailerRoot.scale.setScalar(TRUCK.trailerScale)
  const tBox = new THREE.Box3().setFromObject(trailerRoot)
  const tCenter = new THREE.Vector3()
  tBox.getCenter(tCenter)
  trailerRoot.position.y = -tBox.min.y   // ground
  trailerRoot.position.z = -tCenter.z   // center on Z

  // ── Cab ───────────────────────────────────────────────────────────────────────
  // Use UNIFORM scale (like the ship renderer) — this is the only way to guarantee
  // no squashing or distortion regardless of rotation angle.
  // Scale is derived from the model's actual bounding box so proportions are preserved.
  cabRoot.rotation.y = TRUCK.cabRotationY

  // Measure height in the rotated orientation, then compute uniform scale
  const preBox = new THREE.Box3().setFromObject(cabRoot)
  const preSize = new THREE.Vector3()
  preBox.getSize(preSize)
  const cabScale = TRUCK.cabTargetHeight / preSize.y
  cabRoot.scale.setScalar(cabScale)

  // Re-measure after scale, ground and centre on Z
  const cBox = new THREE.Box3().setFromObject(cabRoot)
  const cCenter = new THREE.Vector3()
  cBox.getCenter(cCenter)
  cabRoot.position.y = -cBox.min.y
  cabRoot.position.z = -cCenter.z
  cabRoot.position.x = TRUCK.cabXOffset

  const group = new THREE.Group()
  group.name = 'terminal-truck'
  group.add(trailerRoot)
  group.add(cabRoot)
  return group
}
