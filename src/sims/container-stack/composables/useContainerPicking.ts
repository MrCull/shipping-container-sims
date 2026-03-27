import { ref, type Ref } from 'vue'
import * as THREE from 'three'

export function useContainerPicking(
  canvasRef: Ref<HTMLCanvasElement | null>,
  getCamera: () => THREE.PerspectiveCamera | null,
  getIntersectRoot: () => THREE.Object3D | null
) {
  const raycaster = new THREE.Raycaster()
  const mouse = new THREE.Vector2()
  const hoveredPick = ref<{ layerIndex: number; slotIndex: number } | null>(null)

  function updatePointer(clientX: number, clientY: number): void {
    if (!canvasRef.value) return
    const rect = canvasRef.value.getBoundingClientRect()
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1
  }

  function pick(clientX: number, clientY: number): { layerIndex: number; slotIndex: number } | null {
    const camera = getCamera()
    const root = getIntersectRoot()
    if (!camera || !root) return null

    updatePointer(clientX, clientY)
    raycaster.setFromCamera(mouse, camera)

    const hits = raycaster.intersectObject(root, true)
    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object
      while (obj) {
        const ud = obj.userData as { isJengaBlock?: boolean; layerIndex?: number; slotIndex?: number }
        if (ud?.isJengaBlock && ud.layerIndex !== undefined && ud.slotIndex !== undefined) {
          return { layerIndex: ud.layerIndex, slotIndex: ud.slotIndex }
        }
        obj = obj.parent
      }
    }
    return null
  }

  function onPointerMove(clientX: number, clientY: number): void {
    hoveredPick.value = pick(clientX, clientY)
  }

  function onPointerLeave(): void {
    hoveredPick.value = null
  }

  return { hoveredPick, pick, onPointerMove, onPointerLeave }
}
