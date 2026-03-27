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

    if (intersects.length > 0) {
      const hit = intersects[0].object
      let current: THREE.Object3D | null = hit
      while (current) {
        if (current.name && current.name.startsWith('rs-')) {
          store.selectedEquipmentId = current.name
          store.selectedContainerId = null
          return
        }
        if (current.name && current.name.startsWith('mhc-')) {
          store.selectedEquipmentId = current.name
          store.selectedContainerId = null
          return
        }
        current = current.parent
      }

      if (hit instanceof THREE.InstancedMesh && intersects[0].instanceId !== undefined) {
        const mesh = hit as THREE.InstancedMesh
        const instanceId = intersects[0].instanceId
        const containerMeshes = scene.children.filter(c => c instanceof THREE.InstancedMesh)
        if (containerMeshes.includes(mesh)) {
          const container = store.containers.filter(c => c.lifecycleState !== 'departed')[instanceId]
          if (container) {
            store.selectedContainerId = container.id
            store.selectedEquipmentId = null
            return
          }
        }
      }
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
