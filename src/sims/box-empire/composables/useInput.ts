// ---------------------------------------------------------------------------
// Box Empire — Click/hover raycasting for 3D objects
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
) {
  const store = useGameStore()
  const raycaster = new THREE.Raycaster()
  const mouse = new THREE.Vector2()

  function onClick(event: MouseEvent): void {
    const canvas = canvasRef.value
    const camera = getCamera()
    const scene = getScene()
    if (!canvas || !camera || !scene) return

    const rect = canvas.getBoundingClientRect()
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

    raycaster.setFromCamera(mouse, camera)
    const intersects = raycaster.intersectObjects(scene.children, true)

    for (const hit of intersects) {
      // Check for equipment selection (walk up the parent chain)
      let current: THREE.Object3D | null = hit.object
      const foundEquipment = false
      while (current) {
        if (current.name && (current.name.startsWith('rs-') || current.name.startsWith('mhc-'))) {
          store.selectedEquipmentId = current.name
          store.selectedContainerId = null
          return
        }
        current = current.parent
        if (foundEquipment) break
      }

      // Check for container selection via the InstancedMesh
      const containerMesh = getContainerMesh()
      if (containerMesh && hit.object === containerMesh && hit.instanceId !== undefined) {
        const containerId = getContainerIdAtInstance(hit.instanceId)
        if (containerId) {
          store.selectedContainerId = containerId
          store.selectedEquipmentId = null
          return
        }
      }
    }

    // Clicked on empty space — deselect
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
