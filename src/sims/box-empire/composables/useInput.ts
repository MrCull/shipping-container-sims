// ---------------------------------------------------------------------------
// Box Empire — Click raycasting for 3D objects
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

    const containerMesh = getContainerMesh()
    const allObjects = scene.children

    const intersects = raycaster.intersectObjects(allObjects, true)

    for (const hit of intersects) {
      // Container: match against the known InstancedMesh
      if (containerMesh && hit.object === containerMesh && hit.instanceId !== undefined) {
        const containerId = getContainerIdAtInstance(hit.instanceId)
        if (containerId) {
          store.selectedContainerId = containerId
          store.selectedEquipmentId = null
          return
        }
      }

      // Equipment: walk up parent chain looking for named group
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

    // Nothing hit — clear selection
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
