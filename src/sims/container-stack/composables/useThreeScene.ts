import { onMounted, onUnmounted, ref, type Ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { buildScene } from '../modules/sceneBuilder'
import { BLOCK, CAMERA } from '../modules/config'

export interface TowerSceneRefs {
  getScene: () => THREE.Scene | null
  getCamera: () => THREE.PerspectiveCamera | null
  getControls: () => OrbitControls | null
  getTowerPivot: () => THREE.Group | null
  isReady: Ref<boolean>
  render: () => void
  frameTower: (topY: number) => void
  setIdleOrbit: (enabled: boolean) => void
  setCameraShake: (intensity: number) => void
}

export function useContainerStackThreeScene(
  canvasRef: Ref<HTMLCanvasElement | null>
): TowerSceneRefs {
  let renderer: THREE.WebGLRenderer | null = null
  let scene: THREE.Scene | null = null
  let camera: THREE.PerspectiveCamera | null = null
  let controls: OrbitControls | null = null
  let towerPivot: THREE.Group | null = null
  const isReady = ref(false)

  let idleOrbit = true
  let shakeIntensity = 0

  function init(): void {
    if (!canvasRef.value) return

    scene = new THREE.Scene()
    const built = buildScene(scene)
    towerPivot = built.towerPivot

    renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.value,
      antialias: true,
    })
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05

    camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.4, 500)
    camera.position.set(22, 20, 26)
    camera.lookAt(0, 8, 0)

    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.06
    controls.minDistance = CAMERA.minDistance
    controls.maxDistance = CAMERA.maxDistance
    controls.maxPolarAngle = CAMERA.maxPolarAngle
    controls.target.set(0, 8, 0)

    window.addEventListener('resize', onResize)
    isReady.value = true
  }

  function onResize(): void {
    if (!camera || !renderer) return
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  }

  function frameTower(topY: number): void {
    if (!camera || !controls) return
    const targetY = Math.max(BLOCK.height * 2, topY * 0.55)
    controls.target.y += (targetY - controls.target.y) * CAMERA.targetLerp

    const dist = Math.max(18, topY * 1.15 + 14)
    const dir = new THREE.Vector3()
    dir.copy(camera.position).sub(controls.target).normalize()
    const desired = controls.target.clone().addScaledVector(dir, dist)
    camera.position.lerp(desired, CAMERA.targetLerp * 0.5)
  }

  function setIdleOrbit(enabled: boolean): void {
    idleOrbit = enabled
  }

  function setCameraShake(intensity: number): void {
    shakeIntensity = intensity
  }

  function applyShake(): void {
    if (!camera || shakeIntensity <= 0.001) return
    const s = shakeIntensity * CAMERA.shakeIntensity
    camera.position.x += (Math.random() - 0.5) * s
    camera.position.y += (Math.random() - 0.5) * s * 0.5
    camera.position.z += (Math.random() - 0.5) * s
  }

  function render(): void {
    if (!renderer || !scene || !camera || !controls) return

    if (idleOrbit) {
      controls.autoRotate = true
      controls.autoRotateSpeed = CAMERA.idleOrbitSpeed
    } else {
      controls.autoRotate = false
    }

    controls.update()
    applyShake()
    renderer.render(scene, camera)
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
    towerPivot = null
  }

  onMounted(init)
  onUnmounted(dispose)

  return {
    getScene: () => scene,
    getCamera: () => camera,
    getControls: () => controls,
    getTowerPivot: () => towerPivot,
    isReady,
    render,
    frameTower,
    setIdleOrbit,
    setCameraShake,
  }
}
