import { onMounted, onUnmounted, ref, type Ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { ShipPreset } from '../types'

const KEY_PAN_SPEED  = 20   // units per second
const KEY_ZOOM_SPEED = 25    // units per second

export interface GameSceneRefs {
  /** Plain (non-reactive) Three.js objects — do NOT put these in shallowRef */
  getScene: () => THREE.Scene | null
  getCamera: () => THREE.PerspectiveCamera | null
  isReady: Ref<boolean>
  render: () => void
  setCameraForShip: (shipConfig: ShipPreset) => void
  applyKeyboardCamera: (dt: number) => void
}

export function useGameThreeScene(canvasRef: Ref<HTMLCanvasElement | null>): GameSceneRefs {
  // Plain variables — NOT shallowRef/ref — Three.js objects must never be proxied
  let renderer: THREE.WebGLRenderer | null = null
  let scene: THREE.Scene | null = null
  let camera: THREE.PerspectiveCamera | null = null
  let controls: OrbitControls | null = null
  const isReady = ref(false)

  // Keyboard camera state
  const keys = { left: false, right: false, up: false, down: false, zoomIn: false, zoomOut: false }
  const _spherical = new THREE.Spherical()
  const _offset = new THREE.Vector3()

  function onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return
    const t = e.target as Node | null
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return
    switch (e.code) {
      case 'KeyA': case 'ArrowLeft':  keys.left    = true; e.preventDefault(); break
      case 'KeyD': case 'ArrowRight': keys.right   = true; e.preventDefault(); break
      case 'KeyW': case 'ArrowUp':    keys.up      = true; e.preventDefault(); break
      case 'KeyS': case 'ArrowDown':  keys.down    = true; e.preventDefault(); break
      case 'Equal': case 'NumpadAdd':        keys.zoomIn  = true; e.preventDefault(); break
      case 'Minus': case 'NumpadSubtract':   keys.zoomOut = true; e.preventDefault(); break
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    switch (e.code) {
      case 'KeyA': case 'ArrowLeft':  keys.left    = false; break
      case 'KeyD': case 'ArrowRight': keys.right   = false; break
      case 'KeyW': case 'ArrowUp':    keys.up      = false; break
      case 'KeyS': case 'ArrowDown':  keys.down    = false; break
      case 'Equal': case 'NumpadAdd':        keys.zoomIn  = false; break
      case 'Minus': case 'NumpadSubtract':   keys.zoomOut = false; break
    }
  }

  function applyKeyboardCamera(dt: number): void {
    if (!camera || !controls) return
    const anyKey = keys.left || keys.right || keys.up || keys.down || keys.zoomIn || keys.zoomOut
    if (!anyKey) return

    const panDist = KEY_PAN_SPEED * dt

    // Pan: derive right and forward vectors from camera orientation (ignoring Y for forward)
    const right = new THREE.Vector3()
    const forward = new THREE.Vector3()
    camera.getWorldDirection(forward)
    forward.y = 0
    forward.normalize()
    right.crossVectors(forward, camera.up).normalize()

    const pan = new THREE.Vector3()
    if (keys.left)  pan.addScaledVector(right, -panDist)
    if (keys.right) pan.addScaledVector(right,  panDist)
    if (keys.up)    pan.addScaledVector(forward,  panDist)
    if (keys.down)  pan.addScaledVector(forward, -panDist)

    camera.position.add(pan)
    controls.target.add(pan)

    // Zoom along the view axis
    if (keys.zoomIn || keys.zoomOut) {
      _offset.copy(camera.position).sub(controls.target)
      _spherical.setFromVector3(_offset)
      if (keys.zoomIn)  _spherical.radius -= KEY_ZOOM_SPEED * dt
      if (keys.zoomOut) _spherical.radius += KEY_ZOOM_SPEED * dt
      _spherical.radius = Math.max(controls.minDistance, Math.min(controls.maxDistance, _spherical.radius))
      _offset.setFromSpherical(_spherical)
      camera.position.copy(controls.target).add(_offset)
    }

    controls.update()
  }

  function init(): void {
    if (!canvasRef.value) return

    scene = new THREE.Scene()

    renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.value,
      antialias: true,
      logarithmicDepthBuffer: true,
    })
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
    renderer.outputColorSpace = THREE.SRGBColorSpace

    camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.5, 1000)
    camera.position.set(30, 25, 30)
    camera.lookAt(0, 0, 0)

    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.06
    controls.minDistance = 12
    controls.maxDistance = 150
    controls.maxPolarAngle = Math.PI / 2.05
    controls.screenSpacePanning = false

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

  function render(): void {
    if (!renderer || !scene || !camera) return
    controls?.update()
    renderer.render(scene, camera)
  }

  function setCameraForShip(shipConfig: ShipPreset): void {
    if (!camera) return
    const dist = Math.max(shipConfig.length, shipConfig.width) * 1.35
    // Position camera at a nice elevated diagonal angle
    camera.position.set(dist * 0.65, dist * 0.45, dist * 0.75)
    const target = new THREE.Vector3(0, shipConfig.height * 0.5, 0)
    camera.lookAt(target)
    if (controls) {
      controls.target.copy(target)
      controls.update()
    }
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
  }

  onMounted(init)
  onUnmounted(dispose)

  return {
    getScene: () => scene,
    getCamera: () => camera,
    isReady,
    render,
    setCameraForShip,
    applyKeyboardCamera,
  }
}
