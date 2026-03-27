// ---------------------------------------------------------------------------
// Box Empire — Click input: container and equipment selection
// ---------------------------------------------------------------------------
// Container selection: use getContainerIdNearScreen (screen-space projection)
// Equipment selection: standard raycasting against named Group meshes
// ---------------------------------------------------------------------------

import { onMounted, onBeforeUnmount, type Ref } from 'vue'
import * as THREE from 'three'
import { useGameStore } from '../store/gameStore'

export function useInput(
  canvasRef: Ref<HTMLCanvasElement | null>,
  getCamera: () => THREE.PerspectiveCamera | null,
  getScene: () => THREE.Scene | null,
  getContainerIdAtInstance: (instanceId: number) => string | null,
  getContainerMesh: () => THREE.InstancedMesh | null,
  getContainerIdNearScreen: (clickX: number, clickY: number, canvasW: number, canvasH: number) => string | null,
) {
  const store = useGameStore()
  const raycaster = new THREE.Raycaster()
  const mouse = new THREE.Vector2()

  // Silence unused-variable warnings (kept for API compat)
  void getContainerIdAtInstance
  void getContainerMesh

  function onClick(event: MouseEvent): void {
    const canvas = canvasRef.value
    const camera = getCamera()
    const scene = getScene()
    if (!canvas || !camera || !scene) return

    const rect = canvas.getBoundingClientRect()
    const clickX = event.clientX - rect.left
    const clickY = event.clientY - rect.top

    mouse.x = (clickX / rect.width) * 2 - 1
    mouse.y = -(clickY / rect.height) * 2 + 1

    // ---- 1. Equipment selection (raycasting against named groups) --------
    raycaster.setFromCamera(mouse, camera)
    const intersects = raycaster.intersectObjects(scene.children, true)
    for (const hit of intersects) {
      let cur: THREE.Object3D | null = hit.object
      while (cur) {
        if (cur.name && (cur.name.startsWith('rs-') || cur.name.startsWith('mhc-'))) {
          store.selectedEquipmentId = cur.name
          store.selectedContainerId = null
          return
        }
        cur = cur.parent
      }
    }

    // ---- 2. Container selection (screen-space proximity) -----------------
    const W = rect.width
    const H = rect.height
    const containerId = getContainerIdNearScreen(clickX, clickY, W, H)
    if (containerId) {
      store.selectedContainerId = containerId
      store.selectedEquipmentId = null
      return
    }

    store.selectedContainerId = null
    store.selectedEquipmentId = null
  }

  onMounted(() => {
    canvasRef.value?.addEventListener('click', onClick)
  })

  onBeforeUnmount(() => {
    canvasRef.value?.removeEventListener('click', onClick)
  })
}
