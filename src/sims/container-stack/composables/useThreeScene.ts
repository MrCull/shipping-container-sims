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
  setShowTopMode: (show: boolean) => void
  applyKeyboardCamera: (dt: number) => void
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
  let showTopMode = false
  let normalPhi: number | null = null
  let lastFrameTime = performance.now()

  const keyOrbitLeft = ref(false)
  const keyOrbitRight = ref(false)
  const keyOrbitUp = ref(false)
  const keyOrbitDown = ref(false)
  const keyZoomIn = ref(false)
  const keyZoomOut = ref(false)

  const spherical = new THREE.Spherical()
  const offset = new THREE.Vector3()

  function onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return
    const t = e.target as Node | null
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) {
      return
    }
    switch (e.code) {
      case 'KeyA':
      case 'ArrowLeft':
        keyOrbitLeft.value = true
        e.preventDefault()
        break
      case 'KeyD':
      case 'ArrowRight':
        keyOrbitRight.value = true
        e.preventDefault()
        break
      case 'KeyW':
      case 'ArrowUp':
        keyOrbitUp.value = true
        e.preventDefault()
        break
      case 'KeyS':
      case 'ArrowDown':
        keyOrbitDown.value = true
        e.preventDefault()
        break
      case 'Equal':
      case 'NumpadAdd':
        keyZoomIn.value = true
        e.preventDefault()
        break
      case 'Minus':
      case 'NumpadSubtract':
        keyZoomOut.value = true
        e.preventDefault()
        break
      default:
        break
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    switch (e.code) {
      case 'KeyA':
      case 'ArrowLeft':
        keyOrbitLeft.value = false
        break
      case 'KeyD':
      case 'ArrowRight':
        keyOrbitRight.value = false
        break
      case 'KeyW':
      case 'ArrowUp':
        keyOrbitUp.value = false
        break
      case 'KeyS':
      case 'ArrowDown':
        keyOrbitDown.value = false
        break
      case 'Equal':
      case 'NumpadAdd':
        keyZoomIn.value = false
        break
      case 'Minus':
      case 'NumpadSubtract':
        keyZoomOut.value = false
        break
      default:
        break
    }
  }

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
    renderer.toneMappingExposure = 1.35

    camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.4, 500)
    camera.position.set(22, 20, 26)
    camera.lookAt(0, 8, 0)

    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.06
    controls.minDistance = CAMERA.minDistance
    controls.maxDistance = CAMERA.maxDistance
    controls.minPolarAngle = CAMERA.minPolarAngle
    controls.maxPolarAngle = CAMERA.maxPolarAngle
    controls.target.set(0, 8, 0)
    controls.enableRotate = false
    controls.enablePan = false
    controls.enableZoom = false

    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
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
    const targetY = showTopMode
      ? Math.max(BLOCK.height * 2, topY * 0.85)
      : Math.max(BLOCK.height * 2, topY * 0.55)
    controls.target.y += (targetY - controls.target.y) * CAMERA.targetLerp

    const dist = Math.max(18, topY * 1.15 + 14)
    offset.copy(camera.position).sub(controls.target)
    const currentDist = offset.length()
    if (currentDist > 0.001) {
      offset.normalize().multiplyScalar(dist)
      const desired = controls.target.clone().add(offset)
      camera.position.lerp(desired, CAMERA.targetLerp * 0.5)
    }
  }

  function setIdleOrbit(enabled: boolean): void {
    idleOrbit = enabled
  }

  function setCameraShake(intensity: number): void {
    shakeIntensity = intensity
  }

  function setShowTopMode(show: boolean): void {
    if (show && !showTopMode) {
      // Entering placing mode: capture current phi
      if (camera) {
        offset.copy(camera.position).sub(controls?.target || new THREE.Vector3())
        spherical.setFromVector3(offset)
        normalPhi = spherical.phi
      }
    }
    showTopMode = show
  }

  function applyKeyboardCamera(dt: number): void {
    if (!camera || !controls) return

    const anyKey =
      keyOrbitLeft.value ||
      keyOrbitRight.value ||
      keyOrbitUp.value ||
      keyOrbitDown.value ||
      keyZoomIn.value ||
      keyZoomOut.value
    if (anyKey) {
      idleOrbit = false
    }

    offset.copy(camera.position).sub(controls.target)
    spherical.setFromVector3(offset)

    const sp = CAMERA.keyOrbitSpeed * dt
    if (keyOrbitLeft.value) spherical.theta += sp
    if (keyOrbitRight.value) spherical.theta -= sp
    if (keyOrbitUp.value) spherical.phi -= sp * 0.85
    if (keyOrbitDown.value) spherical.phi += sp * 0.85

    // When in placing mode, automatically tilt down to look at top of stack
    // When exiting, return to normal phi
    if (showTopMode) {
      const targetPhi = 0.65
      const phiDiff = targetPhi - spherical.phi
      if (Math.abs(phiDiff) > 0.01) {
        spherical.phi += phiDiff * 0.08
      }
    } else if (normalPhi !== null) {
      const phiDiff = normalPhi - spherical.phi
      if (Math.abs(phiDiff) > 0.01) {
        spherical.phi += phiDiff * 0.06
      } else {
        normalPhi = null
      }
    }

    spherical.phi = Math.max(
      CAMERA.minPolarAngle,
      Math.min(CAMERA.maxPolarAngle, spherical.phi)
    )

    let radius = spherical.radius
    if (keyZoomIn.value) radius -= CAMERA.keyZoomSpeed * dt
    if (keyZoomOut.value) radius += CAMERA.keyZoomSpeed * dt
    radius = Math.max(CAMERA.minDistance, Math.min(CAMERA.maxDistance, radius))
    spherical.radius = radius

    offset.setFromSpherical(spherical)
    camera.position.copy(controls.target).add(offset)
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

    const now = performance.now()
    const dt = Math.min((now - lastFrameTime) / 1000, 0.1)
    lastFrameTime = now

    if (idleOrbit) {
      offset.copy(camera.position).sub(controls.target)
      spherical.setFromVector3(offset)
      spherical.theta += CAMERA.idleOrbitSpeed * dt
      offset.setFromSpherical(spherical)
      camera.position.copy(controls.target).add(offset)
    }

    controls.update()
    applyShake()
    renderer.render(scene, camera)
  }

  function dispose(): void {
    window.removeEventListener('resize', onResize)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
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
    setShowTopMode,
    applyKeyboardCamera,
  }
}
