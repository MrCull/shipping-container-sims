import { onMounted, onUnmounted, ref, type Ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { ShipPreset } from '../types'

export interface GameSceneRefs {
  /** Plain (non-reactive) Three.js objects — do NOT put these in shallowRef */
  getScene: () => THREE.Scene | null
  getCamera: () => THREE.PerspectiveCamera | null
  isReady: Ref<boolean>
  render: () => void
  setCameraForShip: (shipConfig: ShipPreset) => void
}

export function useGameThreeScene(canvasRef: Ref<HTMLCanvasElement | null>): GameSceneRefs {
  // Plain variables — NOT shallowRef/ref — Three.js objects must never be proxied
  let renderer: THREE.WebGLRenderer | null = null
  let scene: THREE.Scene | null = null
  let camera: THREE.PerspectiveCamera | null = null
  let controls: OrbitControls | null = null
  const isReady = ref(false)

  function init(): void {
    if (!canvasRef.value) return

    scene = new THREE.Scene()

    renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.value,
      antialias: true,
    })
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0

    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500)
    camera.position.set(30, 25, 30)
    camera.lookAt(0, 0, 0)

    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controls.minDistance = 10
    controls.maxDistance = 120
    controls.maxPolarAngle = Math.PI / 2.1

    window.addEventListener('resize', onResize)
    isReady.value = true
  }

  function onResize(): void {
    if (!camera || !renderer) return
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  }

  function render(): void {
    if (!renderer || !scene || !camera) return
    controls?.update()
    renderer.render(scene, camera)
  }

  function setCameraForShip(shipConfig: ShipPreset): void {
    if (!camera) return
    const dist = Math.max(shipConfig.length, shipConfig.width) * 1.2
    camera.position.set(dist * 0.7, dist * 0.5, dist * 0.7)
    camera.lookAt(0, 0, 0)
    if (controls) controls.target.set(0, 2, 0)
  }

  function dispose(): void {
    window.removeEventListener('resize', onResize)
    controls?.dispose()
    renderer?.dispose()

    if (scene) {
      scene.traverse(obj => {
        const mesh = obj as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        if (mesh.material) {
          if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose())
          else mesh.material.dispose()
        }
      })
    }

    renderer = null
    scene = null
    camera = null
    controls = null
  }

  onMounted(init)
  onUnmounted(dispose)

  return {
    getScene: () => scene,
    getCamera: () => camera,
    isReady,
    render,
    setCameraForShip,
  }
}
