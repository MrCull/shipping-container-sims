import { ref, onUnmounted, type Ref } from 'vue'
import * as THREE from 'three'

export function useSlotPicking(
  canvasRef: Ref<HTMLCanvasElement | null>,
  getCamera: () => THREE.PerspectiveCamera | null,
  getScene: () => THREE.Scene | null
) {
  const raycaster = new THREE.Raycaster()
  const mouse = new THREE.Vector2()
  const hoveredSlotId = ref<string | null>(null)

  function onClick(event: MouseEvent): string | null {
    const camera = getCamera()
    const scene = getScene()
    if (!camera || !scene || !canvasRef.value) return null

    updateMouse(event)
    raycaster.setFromCamera(mouse, camera)

    const intersects = raycaster.intersectObjects(scene.children, true)

    for (const hit of intersects) {
      let obj: THREE.Object3D | null = hit.object
      while (obj) {
        if (obj.userData && obj.userData['isSlotIndicator']) {
          return obj.userData['slotId'] as string
        }
        obj = obj.parent
      }
    }
    return null
  }

  function onMouseMove(event: MouseEvent): void {
    const camera = getCamera()
    const scene = getScene()
    if (!camera || !scene || !canvasRef.value) return

    updateMouse(event)
    raycaster.setFromCamera(mouse, camera)

    const intersects = raycaster.intersectObjects(scene.children, true)

    let found: string | null = null
    for (const hit of intersects) {
      let obj: THREE.Object3D | null = hit.object
      while (obj) {
        if (obj.userData && obj.userData['isSlotIndicator']) {
          found = obj.userData['slotId'] as string
          break
        }
        obj = obj.parent
      }
      if (found) break
    }

    hoveredSlotId.value = found
  }

  function updateMouse(event: MouseEvent): void {
    if (!canvasRef.value) return
    const rect = canvasRef.value.getBoundingClientRect()
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  }

  function attach(): void {
    if (!canvasRef.value) return
    canvasRef.value.addEventListener('mousemove', onMouseMove)
  }

  function detach(): void {
    if (!canvasRef.value) return
    canvasRef.value.removeEventListener('mousemove', onMouseMove)
  }

  onUnmounted(detach)

  return { onClick, hoveredSlotId, attach, detach }
}
