// ---------------------------------------------------------------------------
// Box Empire — Click input: container and equipment selection
// ---------------------------------------------------------------------------
// InstancedMesh raycasting requires bounding sphere updates after each instance
// matrix update which is complex and frame-dependent. Instead, we use a
// screen-space proximity approach: project each container's 3D world position
// to 2D screen coordinates and pick the closest one within a tap radius.
// Equipment meshes are still picked via standard raycasting since they are
// individual THREE.Group objects with unique names.
// ---------------------------------------------------------------------------

import { onMounted, onBeforeUnmount, type Ref } from 'vue'
import * as THREE from 'three'
import { useGameStore } from '../store/gameStore'

const CONTAINER_PICK_RADIUS_PX = 40  // pixels — max distance for container click

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
  const projected = new THREE.Vector3()

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

    // ---- 1. Try equipment selection first (standard raycasting) ----------
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

    // ---- 2. Screen-space container selection ----------------------------
    const containerMesh = getContainerMesh()
    const W = rect.width
    const H = rect.height

    let bestId: string | null = null
    let bestDist = CONTAINER_PICK_RADIUS_PX

    if (containerMesh && containerMesh.count > 0) {
      const mat = new THREE.Matrix4()
      for (let i = 0; i < containerMesh.count; i++) {
        containerMesh.getMatrixAt(i, mat)
        projected.setFromMatrixPosition(mat)
        projected.project(camera)

        const sx = (projected.x * 0.5 + 0.5) * W
        const sy = (1 - (projected.y * 0.5 + 0.5)) * H

        // Skip if behind camera
        if (projected.z > 1) continue

        const dx = sx - clickX
        const dy = sy - clickY
        const dist = Math.sqrt(dx * dx + dy * dy)

        if (dist < bestDist) {
          const cid = getContainerIdAtInstance(i)
          if (cid) {
            bestDist = dist
            bestId = cid
          }
        }
      }
    }

    if (bestId) {
      store.selectedContainerId = bestId
      store.selectedEquipmentId = null
      return
    }

    // Nothing selected
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
